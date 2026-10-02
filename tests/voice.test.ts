import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  audioMime,
  microphoneError,
  preferredAudioType,
  recordingFilename,
  transcribeAudio,
  validateAudio,
} from "../src/lib/voice/audio";
let shopId = "";
vi.mock("../src/lib/product/auth", () => ({
  shopActor: async () => ({ id: shopId }),
}));
import { POST } from "../src/app/api/voice/transcribe/route";
const request = (file: File) => {
  const form = new FormData();
  form.append("file", file);
  return new Request("http://localhost/api/voice/transcribe", {
    method: "POST",
    body: form,
  });
};
const sample = () =>
  new File(["fictional audio bytes"], "sample.wav", { type: "audio/wav" });
beforeEach(() => {
  shopId = crypto.randomUUID();
  vi.stubEnv("SARVAM_API_KEY", "fictional-test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Browser audio failures and formats", () => {
  it("permission, device and recording failures cannot become a missing API key message", () => {
    expect(
      microphoneError(new DOMException("blocked", "NotAllowedError")),
    ).toBe("MICROPHONE_PERMISSION");
    expect(microphoneError(new DOMException("missing", "NotFoundError"))).toBe(
      "MICROPHONE_NOT_FOUND",
    );
    expect(microphoneError(new DOMException("busy", "NotReadableError"))).toBe(
      "MICROPHONE_BUSY",
    );
    expect(microphoneError(new Error("anything"))).toBe("MICROPHONE_FAILED");
  });
  it("selects Safari-compatible MP4 when WebM is unavailable and uses the correct filename", () => {
    const recorder = {
      isTypeSupported: (mime: string) => mime === "audio/mp4",
    };
    expect(preferredAudioType(recorder)).toBe("audio/mp4");
    expect(recordingFilename("audio/mp4;codecs=mp4a.40.2")).toBe(
      "recording.m4a",
    );
    expect(recordingFilename("audio/webm;codecs=opus")).toBe("recording.webm");
  });
  it("accepts real audio MIME aliases and generic M4A without disguising a PDF", () => {
    expect(audioMime("audio/x-m4a", "sample.m4a")).toBe("audio/mp4");
    expect(audioMime("", "sample.m4a")).toBe("audio/mp4");
    expect(audioMime("audio/x-wav")).toBe("audio/wav");
    expect(audioMime("application/pdf", "pretend.wav")).toBeNull();
    expect(() => validateAudio(new Blob([], { type: "audio/wav" }))).toThrow(
      "VOICE_EMPTY_AUDIO",
    );
    expect(() =>
      validateAudio(
        new Blob([new Uint8Array(3_000_001)], { type: "audio/wav" }),
      ),
    ).toThrow("VOICE_FILE_TOO_LARGE");
  });
  it("uploads audio for actual transcription and preserves the server failure code", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ transcript: "two bottles" }))
      .mockResolvedValueOnce(
        Response.json({ error: "VOICE_NO_SPEECH" }, { status: 422 }),
      );
    vi.stubGlobal("fetch", fetch);
    expect(await transcribeAudio(sample(), "sample.wav")).toBe("two bottles");
    expect(fetch.mock.calls[0][0]).toBe("/api/voice/transcribe");
    await expect(transcribeAudio(sample(), "sample.wav")).rejects.toThrow(
      "VOICE_NO_SPEECH",
    );
  });
});
describe("Server speech diagnostics", () => {
  it("only a missing key reports that Sarvam is not configured", async () => {
    vi.stubEnv("SARVAM_API_KEY", "");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const r = await POST(request(sample()));
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe("VOICE_NOT_CONFIGURED");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects empty or unsupported files before sending them to a provider", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      (
        await (
          await POST(request(new File([], "empty.wav", { type: "audio/wav" })))
        ).json()
      ).error,
    ).toBe("VOICE_EMPTY_AUDIO");
    expect(
      (
        await (
          await POST(
            request(
              new File(["pdf"], "document.pdf", { type: "application/pdf" }),
            ),
          )
        ).json()
      ).error,
    ).toBe("VOICE_UNSUPPORTED_FORMAT");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    [401, "VOICE_AUTH_FAILED"],
    [402, "VOICE_QUOTA_EXCEEDED"],
    [429, "VOICE_SERVICE_BUSY"],
    [400, "VOICE_AUDIO_REJECTED"],
    [503, "VOICE_UNAVAILABLE"],
  ])(
    "classifies provider HTTP %s without exposing upstream content",
    async (status, code) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response("private upstream content", {
              status: Number(status),
            }),
          ),
      );
      const r = await POST(request(sample()));
      expect(r.status).toBe(502);
      const body = await r.json();
      expect(body.error).toBe(code);
      expect(JSON.stringify(body)).not.toContain("private upstream");
      expect(JSON.stringify(body)).not.toContain("fictional-test-key");
    },
  );
  it("reports silence, timeout and network failure separately", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ transcript: " " }))
      .mockRejectedValueOnce(new DOMException("slow", "TimeoutError"))
      .mockRejectedValueOnce(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetch);
    for (const code of ["VOICE_NO_SPEECH", "VOICE_TIMEOUT", "VOICE_NETWORK"])
      expect((await (await POST(request(sample()))).json()).error).toBe(code);
  });
  it("sends normalized M4A to Sarvam and returns the provider transcript for review", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          transcript: " मुझे दो बोतल चाहिए ",
          language_code: "hi-IN",
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const r = await POST(
      request(
        new File(["fictional audio"], "sample.m4a", { type: "audio/x-m4a" }),
      ),
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      transcript: "मुझे दो बोतल चाहिए",
      language_code: "hi-IN",
      provider: "Sarvam",
      requires_review: true,
    });
    const f = fetch.mock.calls[0][1].body as FormData;
    expect((f.get("file") as File).type).toBe("audio/mp4");
    expect(f.get("model")).toBe("saaras:v4");
  });
});
