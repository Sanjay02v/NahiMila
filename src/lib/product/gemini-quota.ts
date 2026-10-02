import { createHash } from "node:crypto";
import { remote, withNetwork } from "./repository";

export interface GeminiUsage {
  day: string;
  requests: number;
  recent: { at: number; tokens: number }[];
  cooldown_until: number;
  daily_blocked: boolean;
}
export function quotaDay(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(new Date(now));
}
function limit(name: string, fallback: number) {
  const value = process.env[name]?.trim();
  if (!value?.trim()) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error("AI_QUOTA_CONFIG");
  return Number(value);
}
export function quotaSettings() {
  return {
    rpm: limit("GEMINI_MAX_RPM", 12),
    rpd: limit("GEMINI_MAX_RPD", 450),
    tpm: limit("GEMINI_MAX_INPUT_TPM", 200000),
    cooldown: limit("GEMINI_429_COOLDOWN_SECONDS", 60) * 1000,
    scope: process.env.GEMINI_QUOTA_SCOPE?.trim() || "nahimila-google-project",
  };
}
export function quotaBucket(url: string) {
  const model =
    new URL(url).pathname.match(/\/models\/([^/:]+)/)?.[1] ||
    process.env.GEMINI_MODEL ||
    "gemini-3.5-flash-lite";
  // API-key rotation must not reset a project's budget.
  return createHash("sha256")
    .update(quotaSettings().scope + "\n" + model)
    .digest("hex");
}
function current(previous: GeminiUsage | undefined, now: number): GeminiUsage {
  if (!previous || previous.day !== quotaDay(now))
    return {
      day: quotaDay(now),
      requests: 0,
      recent: [],
      cooldown_until: 0,
      daily_blocked: false,
    };
  return {
    ...previous,
    recent: previous.recent.filter((r) => r.at > now - 60000),
  };
}
export async function reserveGemini(bucket: string, body: RequestInit["body"]) {
  // Conservative input reservation without spending another call on countTokens.
  if (body != null && typeof body !== "string")
    throw new Error("AI_QUOTA_CONFIG");
  const tokens = Buffer.byteLength(body || "", "utf8") + 2048;
  const cfg = quotaSettings();
  const error = await withNetwork((n) => {
    if (remote && n.gemini_usage === undefined)
      throw new Error("AI_QUOTA_CONFIG");
    const now = Date.now(),
      usage = current(n.gemini_usage?.[bucket], now);
    let code: string | null = null;
    if (usage.daily_blocked || usage.requests >= cfg.rpd)
      code = "AI_DAILY_LIMIT";
    else if (
      usage.cooldown_until > now ||
      usage.recent.length >= cfg.rpm ||
      usage.recent.reduce((sum, r) => sum + r.tokens, 0) + tokens > cfg.tpm
    )
      code = "AI_RATE_LIMIT";
    if (!code) {
      usage.requests += 1;
      usage.recent.push({ at: now, tokens });
    }
    n.gemini_usage = { ...n.gemini_usage, [bucket]: usage };
    return code;
  }, true);
  if (error) throw new Error(error);
}
export async function recordGemini429(bucket: string, response: Response) {
  let daily = false,
    delay = quotaSettings().cooldown;
  try {
    const error = (await response.clone().json()).error;
    for (const detail of error?.details || []) {
      for (const violation of detail.violations || []) {
        if (
          /per.?day|daily/i.test(
            `${violation.quotaId || ""} ${violation.quotaMetric || ""}`,
          )
        )
          daily = true;
      }
      const retry = /^(\d+(?:\.\d+)?)s$/.exec(detail.retryDelay || "");
      if (retry) delay = Math.max(delay, Number(retry[1]) * 1000);
    }
  } catch {
    /* Unknown 429 gets a conservative cooldown, never an immediate retry. */
  }
  await withNetwork((n) => {
    const now = Date.now(),
      usage = current(n.gemini_usage?.[bucket], now);
    usage.daily_blocked ||= daily;
    usage.cooldown_until = Math.max(usage.cooldown_until, now + delay);
    n.gemini_usage = { ...n.gemini_usage, [bucket]: usage };
  }, true);
}
