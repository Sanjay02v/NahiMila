import { shopActor } from "@/lib/product/auth";
import { body, failure, ok, throttle, text } from "@/lib/product/http";
import { withNetwork } from "@/lib/product/repository";
import { merchantView, customerView } from "@/lib/product/network";
import { locales, type Locale } from "@/lib/product/types";
import {
  productLabels,
  translateLabels,
  viewProducts,
} from "@/lib/product/display-labels";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const b = await body(req);
    if (
      !locales.includes(b.locale as Locale) ||
      !Array.isArray(b.labels) ||
      b.labels.length > 30 ||
      b.shop_id !== undefined ||
      b.merchant_id !== undefined
    )
      throw new Error("INVALID_REQUEST");
    const locale = b.locale as Locale,
      labels = [...new Set(b.labels.map((x) => text(x, 220)))];
    const token = b.token === undefined ? null : text(b.token, 100),
      shop = token ? null : await shopActor();
    throttle("labels:" + (shop?.id || token), 10);
    const products = await withNetwork((n) => {
      if (shop) {
        const view = merchantView(n, shop.id),
          own = viewProducts(view);
        const nearby = n.state.products.filter((p) =>
          view.nearby.some((r) => r.name === p.name),
        );
        return [...new Map([...own, ...nearby].map((p) => [p.id, p])).values()];
      }
      customerView(n, token!); // A customer link only grants this product's display labels.
      const r = n.state.requests.find((r) => r.request_token === token)!;
      return n.state.products.filter((p) => p.id === r.product_id);
    });
    const allowed = new Set(products.flatMap(productLabels));
    if (labels.some((label) => !allowed.has(label)))
      throw new Error("FORBIDDEN");
    const cached = Object.assign(
      {},
      ...products.map((p) => p.localized_labels?.[locale] || {}),
    ) as Record<string, string>;
    const missing = labels.filter((label) => !cached[label]);
    const translated = missing.length
      ? await translateLabels(missing, locale)
      : {};
    if (Object.keys(translated).length && locale !== "en")
      await withNetwork((n) => {
        for (const original of products) {
          const p = n.state.products.find((p) => p.id === original.id);
          if (!p) continue;
          const own = Object.fromEntries(
            productLabels(p)
              .filter((s) => translated[s])
              .map((s) => [s, translated[s]]),
          );
          if (Object.keys(own).length)
            p.localized_labels = {
              ...p.localized_labels,
              [locale]: { ...p.localized_labels?.[locale], ...own },
            };
        }
      }, true);
    const merged = { ...cached, ...translated };
    return ok({
      labels: Object.fromEntries(
        labels.filter((s) => merged[s]).map((s) => [s, merged[s]]),
      ),
    });
  } catch (e) {
    return failure(e);
  }
}
