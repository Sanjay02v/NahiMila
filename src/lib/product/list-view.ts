import type { NearbySignal, OrderView, QuoteView } from "./types";
const normalized = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase().trim();
export function nearbyList(
  rows: NearbySignal[],
  query: string,
  label = (s: string) => s,
) {
  const q = normalized(query);
  return rows
    .filter((r) =>
      normalized(`${r.name} ${label(r.name)} ${r.pack}`).includes(q),
    )
    .sort(
      (a, b) =>
        b.own_units - a.own_units ||
        b.shops - a.shops ||
        a.name.localeCompare(b.name),
    );
}
export function orderGroups(
  orders: OrderView[],
  quotes: QuoteView[],
  query: string,
  label = (s: string) => s,
) {
  const groups = new Map<
    string,
    {
      key: string;
      name: string;
      pack: string;
      orders: OrderView[];
      quotes: QuoteView[];
    }
  >();
  const add = (product: OrderView["product"]) => {
    let g = groups.get(product.id);
    if (!g) {
      g = {
        key: product.id,
        name: product.name,
        pack: product.pack_size,
        orders: [],
        quotes: [],
      };
      groups.set(product.id, g);
    }
    return g;
  };
  for (const order of orders) add(order.product).orders.push(order);
  for (const quote of quotes) add(quote.product).quotes.push(quote);
  for (const group of groups.values())
    group.quotes.sort(
      (a, b) =>
        Number(b.eligible) - Number(a.eligible) ||
        Math.max(0, a.quote.moq - a.total_units) -
          Math.max(0, b.quote.moq - b.total_units) ||
        a.quote.unit_cost_paise - b.quote.unit_cost_paise,
    );
  const q = normalized(query);
  return [...groups.values()]
    .filter((g) =>
      normalized(`${g.name} ${label(g.name)} ${g.pack}`).includes(q),
    )
    .sort(
      (a, b) =>
        Number(b.orders.some((o) => o.remaining > 0)) -
          Number(a.orders.some((o) => o.remaining > 0)) ||
        Number(b.quotes.some((q) => q.eligible)) -
          Number(a.quotes.some((q) => q.eligible)) ||
        a.name.localeCompare(b.name),
    );
}
