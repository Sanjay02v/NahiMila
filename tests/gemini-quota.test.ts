import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GeminiUsage } from "../src/lib/product/gemini-quota";
const state = vi.hoisted(() => ({
  network: { gemini_usage: {} as Record<string, GeminiUsage> },
  queue: Promise.resolve() as Promise<unknown>,
}));
vi.mock("../src/lib/product/repository", () => ({
  remote: null,
  withNetwork: (fn: (n: typeof state.network) => unknown) => {
    const next = state.queue.then(() => fn(state.network));
    state.queue = next.catch(() => {});
    return next;
  },
}));
import { geminiFetch } from "../src/lib/product/gemini";
import {
  quotaBucket,
  quotaDay,
  reserveGemini,
} from "../src/lib/product/gemini-quota";
import { normalize } from "../src/lib/product/normalize";
import { manualDraft } from "../src/lib/product/intent";
const url =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent";
const call = (value = "item", cacheKey?: string) =>
  geminiFetch(
    url,
    { method: "POST", body: value },
    { cacheKey, cacheMs: 300000 },
  );
beforeEach(() => {
  state.network = { gemini_usage: {} };
  state.queue = Promise.resolve();
  const g = globalThis as unknown as {
    geminiCache?: Map<string, unknown>;
    geminiFlights?: Map<string, unknown>;
  };
  g.geminiCache?.clear();
  g.geminiFlights?.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
  vi.stubEnv("GEMINI_MAX_RPM", "12");
  vi.stubEnv("GEMINI_MAX_RPD", "450");
  vi.stubEnv("GEMINI_MAX_INPUT_TPM", "200000");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => Response.json({ ok: true })),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("allows 12 concurrent distinct calls and blocks the thirteenth before fetch", async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 13 }, (_, i) => call(`item-${i}`)),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(12);
  expect(fetch).toHaveBeenCalledTimes(12);
  await expect(call("extra")).rejects.toThrow("AI_RATE_LIMIT");
  vi.setSystemTime(Date.now() + 60000);
  expect((await call("next-minute")).ok).toBe(true);
});
it("blocks daily usage across minute windows, resets at Pacific midnight", async () => {
  const bucket = quotaBucket(url);
  state.network.gemini_usage[bucket] = {
    day: quotaDay(),
    requests: 449,
    recent: [],
    cooldown_until: 0,
    daily_blocked: false,
  };
  await call();
  vi.setSystemTime(Date.now() + 60000);
  await expect(call("second")).rejects.toThrow("AI_DAILY_LIMIT");
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.setSystemTime(new Date("2026-10-03T07:00:00Z"));
  expect((await call("new-day")).ok).toBe(true);
  expect(state.network.gemini_usage[bucket].requests).toBe(1);
});
it("uses Pacific day boundaries including daylight saving", () => {
  expect(quotaDay(Date.parse("2026-10-03T06:59:59Z"))).toBe("2026-10-02");
  expect(quotaDay(Date.parse("2026-10-03T07:00:00Z"))).toBe("2026-10-03");
  expect(quotaDay(Date.parse("2026-12-03T07:59:59Z"))).toBe("2026-12-02");
  expect(quotaDay(Date.parse("2026-12-03T08:00:00Z"))).toBe("2026-12-03");
});
it("key rotation and a new caller preserve counters; models have separate budgets", async () => {
  vi.stubEnv("GEMINI_MAX_RPD", "1");
  vi.stubEnv("GEMINI_API_KEY", "first-secret");
  const bucket = quotaBucket(url);
  await call();
  vi.stubEnv("GEMINI_API_KEY", "replacement-secret");
  expect(quotaBucket(url)).toBe(bucket);
  await expect(reserveGemini(quotaBucket(url), "another")).rejects.toThrow(
    "AI_DAILY_LIMIT",
  );
  expect(quotaBucket(url.replace("flash-lite", "flash"))).not.toBe(bucket);
  expect(JSON.stringify(state.network)).not.toMatch(/secret|item|replacement/);
});
it("reserves conservative input bytes and blocks excess before calling Google", async () => {
  vi.stubEnv("GEMINI_MAX_INPUT_TPM", "2052");
  await call("abc");
  await expect(call("next")).rejects.toThrow("AI_RATE_LIMIT");
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 60000);
  await expect(call("abcdefgh")).rejects.toThrow("AI_RATE_LIMIT");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("deduplicates identical in-flight calls and reuses a bounded recent result", async () => {
  const results = await Promise.all([
    call("same", "draft"),
    call("same", "draft"),
  ]);
  expect(await results[0].json()).toEqual(await results[1].json());
  await call("same", "draft");
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 300000);
  await call("same", "draft");
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("does not reuse assistant replies across turns without an explicit cache key", async () => {
  await call();
  await call();
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("keeps extraction cache separate per shop and reuses only identical reviewed text", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-only");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () =>
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    ...manualDraft("chocolate"),
                    source: "gemini",
                  }),
                },
              ],
            },
          },
        ],
      }),
    ),
  );
  await normalize("chocolate", "en", "shop-a");
  await normalize("chocolate", "en", "shop-a");
  await normalize("chocolate", "en", "shop-b");
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("honours Google retry delays without retrying 429", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { error: { details: [{ retryDelay: "90s" }] } },
          { status: 429 },
        ),
      ),
  );
  expect((await call()).status).toBe(429);
  vi.setSystemTime(Date.now() + 60000);
  await expect(call("different")).rejects.toThrow("AI_RATE_LIMIT");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("stops for the whole day when Google reports daily exhaustion from other usage", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValueOnce(
      Response.json(
        {
          error: {
            details: [
              {
                violations: [
                  {
                    quotaId:
                      "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
                  },
                ],
              },
            ],
          },
        },
        { status: 429 },
      ),
    ),
  );
  await call();
  vi.setSystemTime(Date.now() + 120000);
  await expect(call("other")).rejects.toThrow("AI_DAILY_LIMIT");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("counts a 503 retry and blocks the retry if the daily allowance is exhausted", async () => {
  vi.stubEnv("GEMINI_MAX_RPD", "1");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("busy", { status: 503 })),
  );
  const result = expect(call()).rejects.toThrow("AI_DAILY_LIMIT");
  await vi.advanceTimersByTimeAsync(350);
  await result;
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("fails closed for malformed settings and zero allowances", async () => {
  vi.stubEnv("GEMINI_MAX_RPM", "oops");
  await expect(call()).rejects.toThrow("AI_QUOTA_CONFIG");
  vi.stubEnv("GEMINI_MAX_RPM", "0");
  await expect(call()).rejects.toThrow("AI_RATE_LIMIT");
  expect(fetch).not.toHaveBeenCalled();
});
