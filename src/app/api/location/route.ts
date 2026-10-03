import { actor } from "@/lib/product/auth";
import { body, failure, ok, throttle } from "@/lib/product/http";
import { lookupAddress } from "@/lib/product/location";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const user = await actor();
    throttle("map:" + user, 12);
    return ok({ results: await lookupAddress(await body(req)) });
  } catch (e) {
    return failure(e);
  }
}
