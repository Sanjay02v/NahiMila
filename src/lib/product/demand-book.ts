import type { PrivateRequest } from "./types";
import { familyKey, familyLabel, identityKey } from "./canonical";
export type DemandFilter =
  "all" | "demand" | "pending" | "confirmed" | "history";
export function demandStatus(r: PrivateRequest, now = Date.now()): string {
  if (
    ["OFFER_CREATED", "CUSTOMER_CONFIRMED"].includes(r.status) &&
    r.offer &&
    Date.parse(r.offer.deadline) <= now
  )
    return "EXPIRED";
  return r.status;
}
export function demandCategory(
  r: PrivateRequest,
  now = Date.now(),
): Exclude<DemandFilter, "all"> {
  const status = demandStatus(r, now);
  if (status === "MISSED_DEMAND") return "demand";
  if (status === "OFFER_CREATED" || status === "WAITING_INTEREST")
    return "pending";
  if (status === "CUSTOMER_CONFIRMED") return "confirmed";
  return "history";
}
export function groupDemand(
  requests: PrivateRequest[],
  search = "",
  filter: DemandFilter = "all",
  now = Date.now(),
  label = (s: string) => s,
) {
  const groups = new Map<
    string,
    {
      key: string;
      label: string;
      product: PrivateRequest["product"];
      rows: PrivateRequest[];
    }
  >();
  for (const r of [...requests].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  )) {
    // Older saved products may predate canonical_identity. Use their reviewed
    // request details rather than falling back to unrelated generated IDs.
    const identity = r.product.canonical_identity || r.detail?.intent;
    const key = identity
      ? familyKey(identity)
      : r.product.intent_key || r.product.id;
    const group = groups.get(key);
    if (group) group.rows.push(r);
    else
      groups.set(key, {
        key,
        label: identity ? familyLabel(identity) : r.product.name,
        product: r.product,
        rows: [r],
      });
  }
  const query = search.trim().toLocaleLowerCase();
  return [...groups.values()].flatMap((g) => {
    if (
      query &&
      !`${g.label} ${label(g.label)} ${g.rows.map((r) => `${r.product.name} ${label(r.product.name)} ${r.product.pack_size} ${r.detail?.raw_text || ""}`).join(" ")}`
        .toLocaleLowerCase()
        .includes(query)
    )
      return [];
    const visible = g.rows.filter(
      (r) => filter === "all" || demandCategory(r, now) === filter,
    );
    if (!visible.length) return [];
    const units = (category: Exclude<DemandFilter, "all">) =>
      g.rows
        .filter((r) => demandCategory(r, now) === category)
        .reduce((sum, r) => sum + r.quantity, 0);
    return [
      {
        ...g,
        specifications: new Set(
          g.rows.map((r) => {
            const i = r.product.canonical_identity || r.detail?.intent;
            return i ? identityKey(i) : r.product.id;
          }),
        ).size,
        visible,
        total: g.rows.reduce((sum, r) => sum + r.quantity, 0),
        demand: units("demand"),
        pending: units("pending"),
        confirmed: units("confirmed"),
      },
    ];
  });
}
