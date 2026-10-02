import { beforeEach, afterEach, expect, it, vi } from "vitest";

const ledger = vi.hoisted(() => ({ network: { gemini_usage: {} } }));
vi.mock("../src/lib/product/repository", () => ({
  remote: null,
  withNetwork: async (fn: (n: typeof ledger.network) => unknown) =>
    fn(ledger.network),
}));
beforeEach(() => {
  ledger.network = { gemini_usage: {} };
  const g = globalThis as unknown as {
    geminiCache?: Map<string, unknown>;
    geminiFlights?: Map<string, unknown>;
  };
  g.geminiCache?.clear();
  g.geminiFlights?.clear();
});
import { geminiFetch } from "../src/lib/product/gemini";
afterEach(() => vi.unstubAllGlobals());
it("retries capacity failure once with identical model and request", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response("busy", { status: 503 }))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetch);
  const options = { method: "POST", body: "fictional" };
  const r = await geminiFetch(
    "https://example.test/gemini-3.5-flash-lite",
    options,
  );
  expect(r.status).toBe(200);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0]).toEqual(fetch.mock.calls[1]);
});
it("does not retry quota, authentication or invalid-request failures", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response("quota", { status: 429 }))
    .mockResolvedValueOnce(new Response("auth", { status: 401 }))
    .mockResolvedValueOnce(new Response("bad", { status: 400 }));
  vi.stubGlobal("fetch", fetch);
  for (const status of [429, 401, 400]) {
    ledger.network = { gemini_usage: {} };
    expect((await geminiFetch("https://example.test", {})).status).toBe(status);
  }
  expect(fetch).toHaveBeenCalledTimes(3);
});
