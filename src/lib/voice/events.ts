export type TranscriptEvent = {
  event: "ready" | "partial" | "final" | "done" | "error";
  session?: string;
  text?: string;
  error?: string;
};
export async function readTranscript(
  stream: ReadableStream<Uint8Array>,
  consume: (event: TranscriptEvent) => void,
) {
  const reader = stream.getReader(),
    decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      if (pending.length > 20000) throw new Error("VOICE_UNAVAILABLE");
      let line: number;
      while ((line = pending.indexOf("\n")) >= 0) {
        const part = pending.slice(0, line);
        pending = pending.slice(line + 1);
        if (part.trim()) consume(JSON.parse(part));
      }
    }
    if (pending.trim()) consume(JSON.parse(pending));
  } finally {
    reader.releaseLock();
  }
}
