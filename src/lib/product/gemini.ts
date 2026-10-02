import { createHash } from "node:crypto";
import { quotaBucket, reserveGemini, recordGemini429 } from "./gemini-quota";
interface Result {
  body: string;
  status: number;
  type: string;
}
interface CacheEntry {
  result: Result;
  expires: number;
}
const globals = globalThis as unknown as {
  geminiCache?: Map<string, CacheEntry>;
  geminiFlights?: Map<string, Promise<Result>>;
};
const cache = (globals.geminiCache ||= new Map<string, CacheEntry>());
const flights = (globals.geminiFlights ||= new Map<string, Promise<Result>>());
const responseFrom = (r: Result) =>
  new Response(r.body, {
    status: r.status,
    headers: { "Content-Type": r.type },
  });
// Every provider attempt, including a 503 retry, reserves the shared budget first.
// No credentials, prompts or responses are persisted in the quota ledger.
export async function geminiFetch(
  url: string,
  init: RequestInit,
  options: { cacheKey?: string; cacheMs?: number } = {},
) {
  const bucket = quotaBucket(url);
  const fingerprint = createHash("sha256")
    .update(
      bucket +
        "\n" +
        url +
        "\n" +
        (options.cacheKey || String(init.body || "")),
    )
    .digest("hex");
  const now = Date.now();
  for (const [key, value] of cache) if (value.expires <= now) cache.delete(key);
  const hit = cache.get(fingerprint);
  if (hit) return responseFrom(hit.result);
  const pending = flights.get(fingerprint);
  if (pending) return responseFrom(await pending);
  const run = async (): Promise<Result> => {
    if (init.signal?.aborted) throw new Error("AI_UNAVAILABLE");
    await reserveGemini(bucket, init.body);
    let response = await fetch(url, init);
    if (response.status === 503 && !init.signal?.aborted) {
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (init.signal?.aborted) throw new Error("AI_UNAVAILABLE");
      await reserveGemini(bucket, init.body);
      response = await fetch(url, init);
    }
    if (response.status === 429) await recordGemini429(bucket, response);
    const result = {
      body: await response.text(),
      status: response.status,
      type: response.headers.get("Content-Type") || "application/json",
    };
    let validJson = false;
    try {
      JSON.parse(result.body);
      validJson = true;
    } catch {
      /* Invalid output is not reusable. */
    }
    if (
      response.ok &&
      validJson &&
      options.cacheKey &&
      (options.cacheMs || 0) > 0
    ) {
      cache.set(fingerprint, {
        result,
        expires: Date.now() + options.cacheMs!,
      });
      if (cache.size > 100) cache.delete(cache.keys().next().value!);
    }
    return result;
  };
  const work = run();
  flights.set(fingerprint, work);
  try {
    return responseFrom(await work);
  } finally {
    flights.delete(fingerprint);
  }
}
