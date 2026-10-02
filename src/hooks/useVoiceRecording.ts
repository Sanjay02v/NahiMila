"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { MAX_RECORDING_MS, microphoneError } from "@/lib/voice/audio";
import { readTranscript } from "@/lib/voice/events";
const subscribe = () => () => {};
function microphoneSupport() {
  if (typeof window === "undefined") return "";
  if (!window.isSecureContext) return "MICROPHONE_INSECURE";
  if (
    !navigator.mediaDevices?.getUserMedia ||
    !window.AudioContext ||
    !window.AudioWorkletNode
  )
    return "MICROPHONE_UNSUPPORTED";
  return "";
}
type Session = {
  abort: AbortController;
  id: string;
  sequence: number;
  queue: Promise<void>;
  pending: number;
  stopping: boolean;
  stream: MediaStream | null;
  context: AudioContext | null;
  source: MediaStreamAudioSourceNode | null;
  node: AudioWorkletNode | null;
  timer: ReturnType<typeof setTimeout> | null;
  flush: (() => void) | null;
};
export function useVoiceRecording(
  onTranscript: (value: string, final: boolean) => void,
) {
  const support = useSyncExternalStore(subscribe, microphoneSupport, () => "");
  const [recording, setRecording] = useState(false),
    [working, setWorking] = useState(false),
    [requesting, setRequesting] = useState(false),
    [error, setError] = useState("");
  const active = useRef<Session | null>(null),
    callback = useRef(onTranscript),
    mounted = useRef(true);
  useEffect(() => {
    callback.current = onTranscript;
  }, [onTranscript]);
  const audioOff = useCallback((s: Session) => {
    if (s.timer) clearTimeout(s.timer);
    s.source?.disconnect();
    s.node?.disconnect();
    s.stream?.getTracks().forEach((t) => t.stop());
    s.stream = null;
    if (s.context && s.context.state !== "closed") void s.context.close();
  }, []);
  const cancel = useCallback(() => {
    const s = active.current;
    if (!s) return;
    active.current = null;
    audioOff(s);
    s.abort.abort();
    s.flush?.();
  }, [audioOff]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel();
    };
  }, [cancel]);
  const fail = useCallback(
    (code: string) => {
      cancel();
      if (mounted.current) {
        setError(code);
        setWorking(false);
        setRequesting(false);
        setRecording(false);
      }
    },
    [cancel],
  );
  async function send(s: Session, body: Record<string, unknown>) {
    const response = await fetch("/api/voice/live", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: s.id, ...body }),
      signal: s.abort.signal,
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || "VOICE_NETWORK");
    }
  }
  async function stop() {
    const s = active.current;
    if (!s || s.stopping) return;
    s.stopping = true;
    if (s.timer) clearTimeout(s.timer);
    setRecording(false);
    setWorking(true);
    s.source?.disconnect();
    if (s.node) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 300);
        s.flush = () => {
          clearTimeout(timeout);
          resolve();
        };
        s.node!.port.postMessage("flush");
      });
    }
    audioOff(s);
    try {
      await s.queue;
      if (s.abort.signal.aborted) return;
      await send(s, { action: "end" });
    } catch (e) {
      if (!s.abort.signal.aborted)
        fail(e instanceof Error ? e.message : "VOICE_NETWORK");
    }
  }
  async function toggle() {
    if (active.current) {
      if (recording) await stop();
      return;
    }
    setError("");
    if (support) {
      setError(support);
      return;
    }
    const s: Session = {
      abort: new AbortController(),
      id: "",
      sequence: 0,
      queue: Promise.resolve(),
      pending: 0,
      stopping: false,
      stream: null,
      context: null,
      source: null,
      node: null,
      timer: null,
      flush: null,
    };
    active.current = s;
    setRequesting(true);
    try {
      s.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (s.abort.signal.aborted) {
        audioOff(s);
        return;
      }
      s.context = new AudioContext();
      await s.context.resume();
      await s.context.audioWorklet.addModule("/voice-pcm.js");
      const response = await fetch("/api/voice/live", {
        method: "POST",
        signal: s.abort.signal,
      });
      if (!response.ok || !response.body) {
        const j = await response.json().catch(() => ({}));
        throw new Error(j.error || "VOICE_UNAVAILABLE");
      }
      let settled = false,
        finished = false,
        finalText = "";
      const ready = new Promise<void>((resolve, reject) => {
        void readTranscript(response.body!, (event) => {
          if (s.abort.signal.aborted) return;
          if (event.event === "ready" && event.session) {
            s.id = event.session;
            settled = true;
            resolve();
          }
          if (event.event === "partial" && typeof event.text === "string")
            callback.current(
              [finalText, event.text].filter(Boolean).join(" "),
              false,
            );
          if (event.event === "final" && typeof event.text === "string") {
            finalText = [finalText, event.text].filter(Boolean).join(" ");
            callback.current(finalText, true);
          }
          if (event.event === "error") {
            finished = true;
            if (!settled) reject(new Error(event.error || "VOICE_UNAVAILABLE"));
            fail(event.error || "VOICE_UNAVAILABLE");
          }
          if (event.event === "done") {
            finished = true;
            cancel();
            if (mounted.current) {
              setRecording(false);
              setWorking(false);
              setRequesting(false);
            }
          }
        })
          .then(() => {
            if (!s.abort.signal.aborted && !finished) {
              if (!settled) reject(new Error("VOICE_NETWORK"));
              fail("VOICE_NETWORK");
            }
          })
          .catch(() => {
            if (!s.abort.signal.aborted) {
              if (!settled) reject(new Error("VOICE_NETWORK"));
              fail("VOICE_NETWORK");
            }
          });
      });
      await ready;
      if (s.abort.signal.aborted) return;
      s.node = new AudioWorkletNode(s.context, "nahimila-pcm");
      s.node.port.onmessage = (e) => {
        if (e.data?.flushed) {
          s.flush?.();
          return;
        }
        if (s.abort.signal.aborted || !(e.data instanceof ArrayBuffer)) return;
        if (s.pending >= 8) {
          fail("VOICE_NETWORK");
          return;
        }
        const bytes = new Uint8Array(e.data);
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        const audio = btoa(binary),
          sequence = s.sequence++;
        s.pending++;
        s.queue = s.queue
          .then(() => send(s, { action: "audio", audio, sequence }))
          .then(() => {
            s.pending--;
          })
          .catch((e) => {
            s.pending--;
            if (!s.abort.signal.aborted)
              fail(e instanceof Error ? e.message : "VOICE_NETWORK");
          });
      };
      s.source = s.context.createMediaStreamSource(s.stream!);
      s.source.connect(s.node);
      const silent = s.context.createGain();
      silent.gain.value = 0;
      s.node.connect(silent);
      silent.connect(s.context.destination);
      setRequesting(false);
      setRecording(true);
      s.timer = setTimeout(() => {
        void stop();
      }, MAX_RECORDING_MS);
    } catch (e) {
      if (!s.abort.signal.aborted)
        fail(
          e instanceof Error && /^[A-Z_]+$/.test(e.message)
            ? e.message
            : microphoneError(e),
        );
    }
  }
  return {
    recording,
    working,
    requesting,
    error,
    support,
    toggle,
    clearError: () => setError(""),
  };
}
