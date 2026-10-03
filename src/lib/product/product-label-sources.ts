import type { Product } from "@/types";
import type { MerchantView } from "./types";
import { familyLabel } from "./canonical";
export function productLabels(p: Product) {
  return [
    ...new Set([
      p.name,
      ...(p.canonical_identity
        ? [
            familyLabel(p.canonical_identity),
            p.canonical_identity.product,
            p.canonical_identity.brand,
            p.canonical_identity.variant,
          ].filter((s): s is string => !!s)
        : []),
    ]),
  ];
}
export function viewProducts(v: MerchantView) {
  return [
    ...new Map(
      [
        ...v.requests.map((r) => r.product),
        ...v.quotes.map((q) => q.product),
        ...v.orders.map((o) => o.product),
      ].map((p) => [p.id, p]),
    ).values(),
  ];
}
