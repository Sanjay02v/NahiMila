import { afterEach, describe, expect, it, vi } from "vitest";
import { verifiedLocation, lookupAddress } from "../src/lib/product/location";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Shop location", () => {
  it("requires an explicit confirmed pin and numeric valid coordinates", () => {
    const b = {
      address: "Shop, Bengaluru",
      latitude: 12.97,
      longitude: 77.64,
      location_confirmed: true,
    };
    expect(verifiedLocation(b)).toEqual({
      address: b.address,
      latitude: b.latitude,
      longitude: b.longitude,
    });
    for (const patch of [
      { latitude: "12.97" },
      { latitude: null },
      { latitude: NaN },
      { longitude: 181 },
      { address: "" },
      { location_confirmed: false },
    ])
      expect(() => verifiedLocation({ ...b, ...patch })).toThrow();
  });
  it("looks up and caches addresses without exposing the key in results", async () => {
    vi.stubEnv("GEOAPIFY_API_KEY", "secret-test");
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        results: [
          { formatted: "Test street, Bengaluru", lat: 12.971, lon: 77.642 },
          { formatted: "Bad", lat: 999, lon: 77 },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const b = { action: "search", text: "Test street unique" };
    const results = await lookupAddress(b);
    expect(results).toHaveLength(1);
    expect(JSON.stringify(results)).not.toContain("secret-test");
    expect(await lookupAddress(b)).toEqual(results);
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.searchParams.get("text")).toBe(b.text);
  });
  it("reverse lookup retains supplied coordinates and fails clearly without configuration", async () => {
    vi.stubEnv("GEOAPIFY_API_KEY", "");
    await expect(
      lookupAddress({ action: "reverse", latitude: 12.945, longitude: 77.612 }),
    ).rejects.toThrow("MAP_NOT_CONFIGURED");
    vi.stubEnv("GEOAPIFY_API_KEY", "test");
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        results: [{ formatted: "Shop", lat: 12.945, lon: 77.612 }],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(
      await lookupAddress({
        action: "reverse",
        latitude: 12.945,
        longitude: 77.612,
      }),
    ).toHaveLength(1);
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get("lat")).toBe(
      "12.945",
    );
  });
});
