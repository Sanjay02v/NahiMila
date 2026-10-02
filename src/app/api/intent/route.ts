import { shopActor } from "@/lib/product/auth";
import { withNetwork } from "@/lib/product/repository";
import { hash, productCatalog } from "@/lib/product/network";
import { normalize } from "@/lib/product/normalize";
import { resolveProduct } from "@/lib/product/matching";
import { body, failure, ok, text, throttle } from "@/lib/product/http";
export async function POST(req: Request) {
  try {
    const shop = await shopActor();
    throttle("intent:" + shop.id, 10);
    const b = await body(req);
    const raw = text(b.raw_text);
    const extracted = await normalize(raw, shop.locale);
    const catalog = await withNetwork((n) => productCatalog(n));
    const { intent, match } = await resolveProduct(extracted, catalog);
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
          match_kind: match.kind,
        },
        timestamp: new Date().toISOString(),
      });
      n.state.auditEvents = n.state.auditEvents.slice(-500);
    }, true);
    return ok({ intent, match });
  } catch (e) {
    return failure(e);
  }
}
