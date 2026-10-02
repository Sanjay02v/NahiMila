import { afterEach, expect, it, vi } from "vitest";
import { geminiFetch } from "../src/lib/product/gemini";
afterEach(() => vi.unstubAllGlobals());
it("retries capacity failure once with identical model and request", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response("busy", { status: 503 }))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetch);
  const options = { method: "POST", body: "fictional" };
  const r = await geminiFetch("https://example.test/gemini-3.5-flash", options);
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
  for (const status of [429, 401, 400])
    expect((await geminiFetch("https://example.test", {})).status).toBe(status);
  expect(fetch).toHaveBeenCalledTimes(3);
});
