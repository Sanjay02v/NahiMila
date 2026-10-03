import { NextResponse } from "next/server";
import { shopActor } from "@/lib/product/auth";
import { failure, ok } from "@/lib/product/http";
import { assertSameOrigin } from "@/lib/same-origin";
import { validateAudio } from "@/lib/voice/audio";
export const runtime = "nodejs";
export const maxDuration = 45;
const limits = new Map<string, { count: number; until: number }>();
const voiceFailure = (error: string, status: number) =>
  NextResponse.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
export async function POST(req: Request) {
  try {
    const shop = await shopActor();
    assertSameOrigin(req);
    const key = process.env.SARVAM_API_KEY?.trim();
    if (!key) return voiceFailure("VOICE_NOT_CONFIGURED", 503);
    if (Number(req.headers.get("content-length")) > 4_000_000)
      return voiceFailure("VOICE_FILE_TOO_LARGE", 413);
    const now = Date.now(),
      entry = limits.get(shop.id);
    if (entry && entry.until > now && entry.count >= 6)
      return voiceFailure("VOICE_RATE_LIMIT", 429);
    if (limits.size > 1000)
      for (const [k, v] of limits) if (v.until < now) limits.delete(k);
    limits.set(shop.id, {
      count: entry && entry.until > now ? entry.count + 1 : 1,
      until: entry && entry.until > now ? entry.until : now + 60_000,
    });
    const form = await req.formData(),
      file = form.get("file");
    if (!(file instanceof File)) return voiceFailure("VOICE_EMPTY_AUDIO", 400);
    let mime: string;
    try {
      mime = validateAudio(file, file.name);
    } catch (e) {
      return voiceFailure(
        e instanceof Error ? e.message : "VOICE_UNSUPPORTED_FORMAT",
        e instanceof Error && e.message === "VOICE_FILE_TOO_LARGE" ? 413 : 400,
      );
    }
    const outbound = new FormData();
    outbound.append("file", new File([file], file.name, { type: mime }));
    outbound.append("model", "saaras:v4");
    outbound.append("language_code", "unknown");
    let response: Response;
    try {
      response = await fetch("https://api.sarvam.ai/speech-to-text", {
        method: "POST",
        headers: { "api-subscription-key": key },
        body: outbound,
        signal: AbortSignal.timeout(25_000),
      });
    } catch (e) {
      return voiceFailure(
        e instanceof Error && ["TimeoutError", "AbortError"].includes(e.name)
          ? "VOICE_TIMEOUT"
          : "VOICE_NETWORK",
        503,
      );
    }
    if (!response.ok) {
      console.warn("Sarvam transcription request failed", {
        status: response.status,
      });
      const code =
        response.status === 401 || response.status === 403
          ? "VOICE_AUTH_FAILED"
          : response.status === 402
            ? "VOICE_QUOTA_EXCEEDED"
            : response.status === 429
              ? "VOICE_SERVICE_BUSY"
              : response.status === 400 || response.status === 422
                ? "VOICE_AUDIO_REJECTED"
                : "VOICE_UNAVAILABLE";
      return voiceFailure(code, 502);
    }
    const result = await response.json().catch(() => null);
    if (
      !result ||
      typeof result.transcript !== "string" ||
      !result.transcript.trim()
    )
      return voiceFailure("VOICE_NO_SPEECH", 422);
    return ok({
      transcript: result.transcript.trim(),
      language_code: result.language_code,
      provider: "Sarvam",
      requires_review: true,
    });
  } catch (e) {
    return failure(e);
  }
}
