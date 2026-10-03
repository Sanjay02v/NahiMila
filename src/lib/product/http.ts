import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/same-origin";
export const ok = (data: unknown) =>
  NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
export function failure(e: unknown) {
  const code = e instanceof Error ? e.message : "UNKNOWN";
  const known = /^[A-Z_]+$/.test(code) ? code : "INVALID_REQUEST";
  return NextResponse.json(
    { error: known },
    {
      status:
        known === "UNAUTHENTICATED"
          ? 401
          : known === "FORBIDDEN"
            ? 403
            : known === "RATE_LIMIT" ||
                known === "AI_RATE_LIMIT" ||
                known === "AI_DAILY_LIMIT"
              ? 429
              : known === "NOT_FOUND"
                ? 404
                : known === "CONFLICT"
                  ? 409
                  : known === "MAP_UNAVAILABLE" ||
                      known === "MAP_NOT_CONFIGURED" ||
                      known === "DATABASE_UNAVAILABLE" ||
                      known === "AI_UNAVAILABLE" ||
                      known === "AI_QUOTA_CONFIG"
                    ? 503
                    : 400,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
export async function body(req: Request, maxBytes = 16000) {
  assertSameOrigin(req);
  const value = await req.text();
  if (Buffer.byteLength(value, "utf8") > maxBytes)
    throw new Error("INVALID_REQUEST");
  const b = JSON.parse(value);
  if (!b || Array.isArray(b) || typeof b !== "object")
    throw new Error("INVALID_REQUEST");
  return b as Record<string, unknown>;
}
export function integer(v: unknown, min = 0, max = 100000000) {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max)
    throw new Error("INVALID_REQUEST");
  return v;
}
export function text(v: unknown, max = 1200) {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw new Error("INVALID_REQUEST");
  return v.trim();
}
const limits = new Map<string, { count: number; expires: number }>();
export function throttle(key: string, max = 15) {
  const now = Date.now();
  const v = limits.get(key);
  if (v && v.expires > now && v.count >= max) throw new Error("RATE_LIMIT");
  limits.set(key, {
    count: v && v.expires > now ? v.count + 1 : 1,
    expires: v && v.expires > now ? v.expires : now + 60000,
  });
  if (limits.size > 2000)
    for (const [key, v] of limits) if (v.expires < now) limits.delete(key);
}
