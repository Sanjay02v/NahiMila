import { afterEach, describe, it, expect, vi } from "vitest";
import { VoiceUploadQueue } from "../src/lib/voice/upload-queue";
afterEach(() => vi.useRealTimers());
describe("voice under slow network conditions", () => {
  it("holds more than eight chunks without losing audio and uploads ordered batches", async () => {
    const sent: { sequence: number; audio: string }[] = [];
    const queue = new VoiceUploadQueue(
      async (sequence, audio) => {
        sent.push({ sequence, audio });
        await Promise.resolve();
      },
      (e) => {
        throw e;
      },
    );
    const chunks = Array.from({ length: 30 }, (_, i) =>
      new Uint8Array(6400).fill(i),
    );
    chunks.forEach((c) => queue.enqueue(c.buffer));
    await queue.finish();
    expect(sent).toHaveLength(6);
    expect(sent.map((s) => s.sequence)).toEqual([0, 1, 2, 3, 4, 5]);
    const actual = Buffer.concat(
      sent.map((s) => Buffer.from(s.audio, "base64")),
    );
    expect(actual).toEqual(Buffer.concat(chunks.map((c) => Buffer.from(c))));
  });
  it("flushes the partial final batch and never uploads after cancellation", async () => {
    const send = vi.fn().mockResolvedValue(undefined),
      error = vi.fn();
    const queue = new VoiceUploadQueue(send, error);
    queue.enqueue(new Uint8Array(64).buffer);
    await queue.finish();
    expect(Buffer.from(send.mock.calls[0][1], "base64")).toHaveLength(64);
    queue.cancel();
    queue.enqueue(new Uint8Array(64).buffer);
    await queue.finish();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("surfaces upload failure and stops sending later audio", async () => {
    const send = vi.fn().mockRejectedValue(new Error("VOICE_NETWORK"));
    const queue = new VoiceUploadQueue(send, () => {});
    queue.enqueue(new Uint8Array(6400).buffer);
    await expect(queue.finish()).rejects.toThrow("VOICE_NETWORK");
    queue.enqueue(new Uint8Array(6400).buffer);
    await expect(queue.finish()).rejects.toThrow("VOICE_NETWORK");
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("queued audio arriving during an upload", () => {
  it("drains audio that arrives while the first request is still in flight", async () => {
    let release: () => void = () => {};
    const sent: number[] = [];
    const q = new VoiceUploadQueue(
      async (sequence) => {
        sent.push(sequence);
        if (sequence === 0)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
      },
      () => {},
    );
    q.enqueue(new Uint8Array(6400).buffer);
    const finish = q.finish();
    for (let i = 0; i < 20; i++) q.enqueue(new Uint8Array(6400).buffer);
    release();
    await finish;
    expect(sent).toEqual([0, 1, 2, 3, 4]);
  });
});
