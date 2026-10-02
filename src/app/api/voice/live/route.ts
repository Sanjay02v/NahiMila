import { shopActor } from "@/lib/product/auth";
import { body, failure, ok, text, throttle } from "@/lib/product/http";
import { assertSameOrigin } from "@/lib/same-origin";
import { liveStream, sendLive } from "@/lib/voice/live";
export const runtime = "nodejs";
export const maxDuration = 40;
export async function POST(req: Request) {
  try {
    const shop = await shopActor();
    assertSameOrigin(req);
    throttle("voice-live:" + shop.id, 6);
    const key = process.env.SARVAM_API_KEY?.trim();
    if (!key) throw new Error("VOICE_NOT_CONFIGURED");
    return liveStream(shop.id, key, req.signal);
  } catch (e) {
    return failure(e);
  }
}
export async function PUT(req: Request) {
  try {
    const shop = await shopActor();
    const b = await body(req);
    sendLive(shop.id, text(b.session, 50), b);
    return ok({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
