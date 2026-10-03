import WebSocket from "ws";
export type VoiceEvent = {
  event: "ready" | "partial" | "final" | "done" | "error";
  session?: string;
  text?: string;
  error?: string;
};
type LiveSession = {
  owner: string;
  socket: WebSocket;
  next: number;
  bytes: number;
  ending: boolean;
  cancel: () => void;
};
const globalVoice = globalThis as typeof globalThis & {
  nahimilaVoiceSessions?: Map<string, LiveSession>;
};
const sessions = (globalVoice.nahimilaVoiceSessions ??= new Map<
  string,
  LiveSession
>());
export function liveStream(owner: string, key: string, signal: AbortSignal) {
  if ([...sessions.values()].some((s) => s.owner === owner))
    throw new Error("VOICE_ALREADY_ACTIVE");
  const id = crypto.randomUUID();
  let cancel = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false,
        heard = false;
      const url = new URL("wss://api.sarvam.ai/speech-to-text-realtime/ws");
      for (const [k, v] of Object.entries({
        language_code: "auto",
        model: "saaras:v4",
        stream_type: "fast",
        encoding: "linear16",
        sample_rate: "16000",
        endpointing: "manual",
      }))
        url.searchParams.set(k, v);
      const socket = new WebSocket(url, {
        headers: { "api-subscription-key": key },
        maxPayload: 65536,
      });
      const emit = (event: VoiceEvent) => {
        if (!closed)
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearTimeout(connectTimer);
        clearTimeout(lifetime);
        signal.removeEventListener("abort", cancel);
        sessions.delete(id);
        socket.terminate();
        try {
          controller.close();
        } catch {}
      };
      const fail = (error: string) => {
        emit({ event: "error", error });
        cleanup();
      };
      const connectTimer = setTimeout(() => fail("VOICE_TIMEOUT"), 8000);
      const lifetime = setTimeout(() => fail("VOICE_TIMEOUT"), 55000);
      cancel = cleanup;
      sessions.set(id, {
        owner,
        socket,
        next: 0,
        bytes: 0,
        ending: false,
        cancel,
      });
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) {
        cleanup();
        return;
      }
      socket.on("message", (bytes) => {
        if (closed) return;
        let m: Record<string, unknown>;
        try {
          m = JSON.parse(bytes.toString());
        } catch {
          fail("VOICE_UNAVAILABLE");
          return;
        }
        if (m.event === "session.begin") {
          clearTimeout(connectTimer);
          socket.send(JSON.stringify({ event: "speech_start" }));
          emit({ event: "ready", session: id });
        }
        if (
          m.event === "transcript.partial" ||
          m.event === "transcript.final"
        ) {
          if (typeof m.text !== "string" || m.text.length > 1200) {
            fail("VOICE_UNAVAILABLE");
            return;
          }
          if (m.text.trim()) heard = true;
          emit({
            event: m.event === "transcript.partial" ? "partial" : "final",
            text: m.text,
          });
          if (m.event === "transcript.final" && sessions.get(id)?.ending) {
            emit(
              heard
                ? { event: "done" }
                : { event: "error", error: "VOICE_NO_SPEECH" },
            );
            cleanup();
          }
        }
        if (m.event === "error" && m.is_fatal !== false)
          fail("VOICE_UNAVAILABLE");
        if (m.event === "session.end") {
          emit(
            heard
              ? { event: "done" }
              : { event: "error", error: "VOICE_NO_SPEECH" },
          );
          cleanup();
        }
      });
      socket.on("unexpected-response", (_req, res) =>
        fail(
          res.statusCode === 401 || res.statusCode === 403
            ? "VOICE_AUTH_FAILED"
            : res.statusCode === 429
              ? "VOICE_SERVICE_BUSY"
              : "VOICE_UNAVAILABLE",
        ),
      );
      socket.on("error", () => fail("VOICE_NETWORK"));
      socket.on("close", (code) => {
        if (!closed)
          fail(
            code === 1003
              ? "VOICE_AUTH_FAILED"
              : code === 1008
                ? "VOICE_TIMEOUT"
                : "VOICE_UNAVAILABLE",
          );
      });
    },
    cancel() {
      cancel();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Content-Encoding": "identity",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
export function sendLive(
  owner: string,
  id: string,
  message: Record<string, unknown>,
) {
  const session = sessions.get(id);
  if (!session) throw new Error("VOICE_SESSION_EXPIRED");
  if (session.owner !== owner) throw new Error("FORBIDDEN");
  if (message.action === "cancel") {
    session.cancel();
    return;
  }
  if (session.ending) throw new Error("VOICE_SESSION_EXPIRED");
  if (session.socket.readyState !== WebSocket.OPEN)
    throw new Error("VOICE_UNAVAILABLE");
  if (message.action === "end") {
    session.ending = true;
    session.socket.send(JSON.stringify({ event: "speech_end" }));
    return;
  }
  if (
    message.action !== "audio" ||
    message.sequence !== session.next ||
    typeof message.audio !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(message.audio) ||
    message.audio.length > 43000
  )
    throw new Error("INVALID_REQUEST");
  const pcm = Buffer.from(message.audio, "base64");
  if (!pcm.length || pcm.length % 2 || pcm.length > 32000)
    throw new Error("INVALID_REQUEST");
  if (session.bytes + pcm.length > 672000 || session.next >= 110)
    throw new Error("VOICE_FILE_TOO_LARGE");
  session.bytes += pcm.length;
  session.next++;
  // HTTP batching reduces browser round trips; Sarvam still receives small PCM frames.
  for (let offset = 0; offset < pcm.length; offset += 3200)
    session.socket.send(
      JSON.stringify({
        event: "audio_input",
        audio: pcm.subarray(offset, offset + 3200).toString("base64"),
      }),
    );
}
