import { shopActor } from "@/lib/product/auth";
import { withNetwork } from "@/lib/product/repository";
import { hash } from "@/lib/product/network";
import { normalize } from "@/lib/product/normalize";
import { body, failure, ok, text, throttle } from "@/lib/product/http";
export async function POST(req: Request) {
  try {
    const shop = await shopActor();
    throttle("intent:" + shop.id, 10);
    const b = await body(req);
    const raw = text(b.raw_text),
      intent = await normalize(raw, shop.locale);
    await withNetwork((n) => {
      n.state.auditEvents.push({
        id: crypto.randomUUID(),
        entity_type: "INTENT",
        entity_id: shop.id,
        action: "NORMALIZATION_REVIEW_REQUIRED",
        payload: {
          actor: shop.user_id,
          schema_version: 1,
          source: intent.source,
          model:
            intent.source === "gemini"
              ? process.env.GEMINI_MODEL || "gemini-2.5-flash"
              : null,
          raw_hash: hash(raw),
          missing: intent.missing,
        },
        timestamp: new Date().toISOString(),
      });
      n.state.auditEvents = n.state.auditEvents.slice(-500);
    }, true);
    return ok({ intent });
  } catch (e) {
    return failure(e);
  }
}
