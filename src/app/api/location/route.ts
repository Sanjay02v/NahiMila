import { actor } from "@/lib/product/auth";
import { body, failure, ok, throttle } from "@/lib/product/http";
import { lookupAddress } from "@/lib/product/location";
export const runtime = "nodejs";
export async function GET() {
  try {
    await actor();
    return ok({ configured: !!process.env.GEOAPIFY_API_KEY?.trim() });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    const user = await actor();
    const b = await body(req);
    throttle(
      (b.action === "autocomplete" ? "map-suggest:" : "map:") + user,
      b.action === "autocomplete" ? 45 : 12,
    );
    return ok({ results: await lookupAddress(b) });
  } catch (e) {
    return failure(e);
  }
}
