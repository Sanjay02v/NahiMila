import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { manualDraft } from "../src/lib/product/intent";
import { readTranscript } from "../src/lib/voice/events";
const mocks = vi.hoisted(() => ({
  sockets: [] as {
    emit: (event: string, ...args: unknown[]) => void;
    sent: string[];
    readyState: number;
    terminated: boolean;
  }[],
}));
vi.mock("ws", () => {
  class Socket {
    static OPEN = 1;
    readyState = 1;
    sent: string[] = [];
    terminated = false;
    handlers = new Map<string, ((...args: unknown[]) => void)[]>();
    constructor() {
      mocks.sockets.push(this);
    }
    on(event: string, fn: (...args: unknown[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) || []), fn]);
    }
    emit(event: string, ...args: unknown[]) {
      for (const fn of this.handlers.get(event) || []) fn(...args);
    }
    send(value: string) {
      this.sent.push(value);
    }
    terminate() {
      this.terminated = true;
      this.emit("close", 1006);
    }
  }
  return { default: Socket };
});
import { liveStream, sendLive } from "../src/lib/voice/live";
const aborts: AbortController[] = [];
afterEach(() => {
  aborts.splice(0).forEach((a) => a.abort());
  mocks.sockets.length = 0;
});
function session() {
  const abort = new AbortController();
  aborts.push(abort);
  const owner = crypto.randomUUID(),
    response = liveStream(owner, "fictional-key", abort.signal),
    socket = mocks.sockets.at(-1)!;
  return { owner, response, socket, abort };
}
const event = (s: ReturnType<typeof session>, value: unknown) =>
  s.socket.emit("message", Buffer.from(JSON.stringify(value)));
describe("Private live voice sessions", () => {
  it("relays genuine partial/final events and keeps audio ordered and owner-scoped", async () => {
    const s = session(),
      reader = s.response.body!.getReader();
    event(s, { event: "session.begin" });
    const ready = JSON.parse(
      new TextDecoder().decode((await reader.read()).value),
    );
    expect(ready.event).toBe("ready");
    expect(JSON.stringify(ready)).not.toContain("fictional-key");
    expect(() =>
      sendLive("other-shop", ready.session, {
        action: "audio",
        sequence: 0,
        audio: "AAA=",
      }),
    ).toThrow("FORBIDDEN");
    expect(() =>
      sendLive(s.owner, ready.session, {
        action: "audio",
        sequence: 1,
        audio: "AAA=",
      }),
    ).toThrow("INVALID_REQUEST");
    sendLive(s.owner, ready.session, {
      action: "audio",
      sequence: 0,
      audio: "AAA=",
    });
    expect(() =>
      sendLive(s.owner, ready.session, {
        action: "audio",
        sequence: 0,
        audio: "AAA=",
      }),
    ).toThrow("INVALID_REQUEST");
    event(s, { event: "transcript.partial", text: "Two Coke" });
    expect(
      JSON.parse(new TextDecoder().decode((await reader.read()).value)),
    ).toEqual({ event: "partial", text: "Two Coke" });
    sendLive(s.owner, ready.session, { action: "end" });
    event(s, { event: "transcript.final", text: "Two Coke Zero bottles" });
    const results: unknown[] = [];
    await readTranscript(
      new ReadableStream({
        async start(c) {
          while (true) {
            const r = await reader.read();
            if (r.done) break;
            c.enqueue(r.value);
          }
          c.close();
        },
      }),
      (e) => results.push(e),
    );
    expect(results).toEqual([
      { event: "final", text: "Two Coke Zero bottles" },
      { event: "done" },
    ]);
    expect(s.socket.terminated).toBe(true);
    expect(() => sendLive(s.owner, ready.session, { action: "end" })).toThrow(
      "VOICE_SESSION_EXPIRED",
    );
  });
  it("limits one active session per shop and closes when the browser cancels", () => {
    const s = session();
    expect(() =>
      liveStream(s.owner, "fictional-key", new AbortController().signal),
    ).toThrow("VOICE_ALREADY_ACTIVE");
    s.abort.abort();
    expect(s.socket.terminated).toBe(true);
  });
  it("silence reports no speech and malformed frames cannot expose upstream content", async () => {
    const s = session();
    event(s, { event: "session.begin" });
    const events: unknown[] = [];
    const result = readTranscript(s.response.body!, (e) => events.push(e));
    event(s, { event: "session.end" });
    await result;
    expect(events).toContainEqual({ event: "error", error: "VOICE_NO_SPEECH" });
  });
});
describe("Streaming parser and microphone PCM", () => {
  it("handles fragmented NDJSON and Unicode transcripts", async () => {
    const e = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        const b = e.encode(
          JSON.stringify({ event: "partial", text: "दो बोतल" }) +
            "\n" +
            JSON.stringify({ event: "done" }) +
            "\n",
        );
        for (let i = 0; i < b.length; i += 3) c.enqueue(b.slice(i, i + 3));
        c.close();
      },
    });
    const events: unknown[] = [];
    await readTranscript(stream, (e) => events.push(e));
    expect(events).toEqual([
      { event: "partial", text: "दो बोतल" },
      { event: "done" },
    ]);
  });
  it("converts 48kHz microphone samples to mono 16kHz PCM and flushes the final short chunk", () => {
    const sent: unknown[] = [];
    let Processor: new () => {
      process: (inputs: Float32Array[][]) => boolean;
      port: { onmessage: (e: { data: string }) => void };
    };
    class Base {
      port = {
        postMessage: (value: unknown) => sent.push(value),
        onmessage: () => {},
      };
    }
    runInNewContext(readFileSync("public/voice-pcm.js", "utf8"), {
      AudioWorkletProcessor: Base,
      sampleRate: 48000,
      registerProcessor: (_name: string, p: typeof Processor) => {
        Processor = p;
      },
      Int16Array,
      Math,
    });
    const p = new Processor!();
    p.process([[new Float32Array(9600).fill(0.5)]]);
    expect(new Int16Array(sent[0] as ArrayBuffer)).toHaveLength(3200);
    expect(new Int16Array(sent[0] as ArrayBuffer)[0]).toBe(16384);
    p.process([[new Float32Array(300).fill(-1)]]);
    p.port.onmessage({ data: "flush" });
    expect(new Int16Array(sent[1] as ArrayBuffer)).toHaveLength(100);
    expect(new Int16Array(sent[1] as ArrayBuffer)[0]).toBe(-32768);
    expect(sent[2]).toEqual({ flushed: true });
  });
});

describe("Assistant draft fallback", () => {
  it("preserves explicitly labelled draft quantity when language extraction is unavailable", () => {
    const i = manualDraft(
      "Coke Zero 500ml bottles, quantity: 2, budget: under ₹50 each",
    );
    expect(i.quantity).toBe(2);
    expect(i.size).toBe(500);
    expect(i.unit).toBe("ml");
    expect(i.budget_paise).toBe(5000);
  });
});

describe("batched hosted voice uploads", () => {
  it("accepts one second of PCM and rejects oversized audio", async () => {
    const s = session(),
      reader = s.response.body!.getReader();
    event(s, { event: "session.begin" });
    const ready = JSON.parse(
      new TextDecoder().decode((await reader.read()).value),
    );
    expect(() =>
      sendLive(s.owner, ready.session, {
        action: "audio",
        sequence: 0,
        audio: Buffer.alloc(32000).toString("base64"),
      }),
    ).not.toThrow();
    expect(
      s.socket.sent.filter((x) => JSON.parse(x).event === "audio_input"),
    ).toHaveLength(10);
    expect(() =>
      sendLive(s.owner, ready.session, {
        action: "audio",
        sequence: 1,
        audio: Buffer.alloc(32002).toString("base64"),
      }),
    ).toThrow("INVALID_REQUEST");
    s.abort.abort();
  });
});
