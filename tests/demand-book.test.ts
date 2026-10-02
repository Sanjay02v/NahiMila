import { describe, it, expect } from "vitest";
import {
  seedNetwork,
  saveRequest,
  storeFor,
  merchantView,
  normalizePhone,
} from "../src/lib/product/network";
import { manualDraft } from "../src/lib/product/intent";
import { groupDemand, demandCategory } from "../src/lib/product/demand-book";
const shop = "m-sharma-001";
const entry = (extra: Record<string, unknown> = {}) => ({
  submission_key: crypto.randomUUID(),
  raw_text: "Coke Zero 500ml",
  intent: {
    ...manualDraft("Coke Zero 500ml"),
    quantity: 2,
    budget_paise: 5000,
    deadline: new Date(Date.now() + 3 * 86400000).toISOString(),
  },
  can_wait: true,
  offer_price_paise: 5000,
  ...extra,
});
describe("Demand Book reservation boundaries", () => {
  it("willing without contact stays demand only and cannot be confirmed", () => {
    const n = seedNetwork(),
      r = saveRequest(n, shop, entry());
    expect(r.status).toBe("MISSED_DEMAND");
    expect(r.can_wait).toBe(false);
    expect(n.details[r.id].willing_to_wait).toBe(true);
    expect(n.state.offers.some((o) => o.request_id === r.id)).toBe(false);
    expect(() => storeFor(n).confirmCustomerOffer(r.request_token)).toThrow();
    expect(storeFor(n).evaluateQuote("quote-b").total_demand_units).toBe(23);
  });
  it("a number requires consent and never confirms on its own", () => {
    const n = seedNetwork();
    expect(() =>
      saveRequest(n, shop, entry({ customer_phone: "9876543210" })),
    ).toThrow("CONTACT_CONSENT_REQUIRED");
    const r = saveRequest(
      n,
      shop,
      entry({ customer_phone: "9876543210", contact_consent: true }),
    );
    expect(r.customer_phone).toBe("919876543210");
    expect(r.status).toBe("OFFER_CREATED");
    expect(n.state.reservations.some((x) => x.request_id === r.id)).toBe(false);
  });
  it("in-store confirmation requires explicit terms and retries do not double count", () => {
    const n = seedNetwork(),
      b = entry({
        customer_phone: "9876543210",
        contact_consent: true,
        confirm_in_store: true,
      });
    expect(() => saveRequest(n, shop, b)).toThrow("CONFIRMATION_REQUIRED");
    const accepted = { ...b, terms_accepted: true, offer_price_paise: 4500 };
    const r = saveRequest(n, shop, accepted);
    expect(n.details[r.id].confirmation?.method).toBe("in_store");
    expect(
      n.state.reservations.find((x) => x.request_id === r.id)
        ?.confirmed_price_paise,
    ).toBe(4500);
    saveRequest(n, shop, accepted);
    expect(
      n.state.reservations.filter((x) => x.request_id === r.id),
    ).toHaveLength(1);
  });
  it("validates phone formats without guessing invalid contact details", () => {
    expect(normalizePhone("+91 98765 43210")).toBe("919876543210");
    expect(normalizePhone("+44 7700 900123")).toBe("447700900123");
    expect(normalizePhone("")).toBeNull();
    for (const value of [
      "123",
      "abcdefghij",
      "0000000000",
      "919876543210<script>",
      9876543210,
    ])
      expect(() => normalizePhone(value)).toThrow("INVALID_PHONE");
  });
  it("groups repeated exact products and keeps different packs apart", () => {
    const n = seedNetwork();
    saveRequest(n, shop, entry({ can_wait: false }));
    saveRequest(n, shop, entry({ can_wait: false }));
    const other = entry({ can_wait: false });
    other.intent = { ...other.intent, size: 2000 };
    saveRequest(n, shop, other);
    const groups = groupDemand(merchantView(n, shop).requests, "coke");
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.product.pack_size === "500ml")?.demand).toBe(4);
    expect(
      groupDemand(merchantView(n, shop).requests, "missing-product"),
    ).toHaveLength(0);
  });
  it("expired confirmations are history and never inflate confirmed order units", () => {
    const n = seedNetwork();
    const requests = merchantView(n, shop).requests;
    const confirmed = requests.find((r) => r.status === "CUSTOMER_CONFIRMED")!;
    confirmed.offer!.deadline = new Date(Date.now() - 1000).toISOString();
    expect(demandCategory(confirmed)).toBe("history");
    expect(groupDemand(requests)[0].confirmed).toBe(6);
    expect(groupDemand(requests, "", "history")[0].visible).toContain(
      confirmed,
    );
  });
});
