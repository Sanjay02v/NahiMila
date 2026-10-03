import { text } from "./http";
export function verifiedLocation(b: Record<string, unknown>) {
  const { latitude, longitude } = b;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    throw new Error("INVALID_LOCATION");
  if (b.location_confirmed !== true)
    throw new Error("LOCATION_CONFIRMATION_REQUIRED");
  return { latitude, longitude, address: text(b.address, 400) };
}
export type AddressResult = {
  address: string;
  latitude: number;
  longitude: number;
};
const cache = new Map<string, { expires: number; results: AddressResult[] }>();
const pending = new Map<string, Promise<AddressResult[]>>();
export async function lookupAddress(
  b: Record<string, unknown>,
): Promise<AddressResult[]> {
  const reverse = b.action === "reverse";
  if (!reverse && b.action !== "search") throw new Error("INVALID_REQUEST");
  const query = reverse
    ? verifiedLocation({ ...b, address: "Location", location_confirmed: true })
    : { text: text(b.text, 400) };
  const id = JSON.stringify(query),
    saved = cache.get(id);
  if (saved && saved.expires > Date.now()) return saved.results;
  if (pending.has(id)) return pending.get(id)!;
  const key = process.env.GEOAPIFY_API_KEY?.trim();
  if (!key) throw new Error("MAP_NOT_CONFIGURED");
  const task = (async () => {
    const url = new URL(
      `https://api.geoapify.com/v1/geocode/${reverse ? "reverse" : "search"}`,
    );
    url.searchParams.set("apiKey", key);
    url.searchParams.set("format", "json");
    if ("text" in query) {
      url.searchParams.set("text", query.text);
      url.searchParams.set("limit", "5");
    } else {
      url.searchParams.set("lat", String(query.latitude));
      url.searchParams.set("lon", String(query.longitude));
    }
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (!response.ok) {
      console.warn("Address provider unavailable", { status: response.status });
      throw new Error("MAP_UNAVAILABLE");
    }
    const data = await response.json();
    const results: AddressResult[] = (
      Array.isArray(data.results) ? data.results : []
    )
      .filter(
        (r: Record<string, unknown>) =>
          typeof r.formatted === "string" &&
          typeof r.lat === "number" &&
          typeof r.lon === "number" &&
          Number.isFinite(r.lat) &&
          Number.isFinite(r.lon) &&
          Math.abs(r.lat) <= 90 &&
          Math.abs(r.lon) <= 180,
      )
      .slice(0, 5)
      .map((r: { formatted: string; lat: number; lon: number }) => ({
        address: r.formatted.slice(0, 400),
        latitude: r.lat,
        longitude: r.lon,
      }));
    if (cache.size > 500) cache.clear();
    cache.set(id, { results, expires: Date.now() + 86400000 });
    return results;
  })()
    .catch(() => {
      throw new Error("MAP_UNAVAILABLE");
    })
    .finally(() => pending.delete(id));
  pending.set(id, task);
  return task;
}
