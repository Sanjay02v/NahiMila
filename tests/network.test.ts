import { beforeEach, describe, expect, it } from "vitest";
import {
  seedNetwork,
  storeFor,
  merchantView,
  customerView,
  saveRequest,
  fingerprint,
  type Network,
} from "../src/lib/product/network";
import { manualDraft, productKey } from "../src/lib/product/intent";
let n: Network;
beforeEach(() => {
  n = seedNetwork();
});
const sharma = "m-sharma-001";
const fullCase = () => {
  const s = storeFor(n);
  s.confirmCustomerOffer(
    s.requests.find(
      (r) => r.merchant_id === sharma && r.status === "OFFER_CREATED",
    )!.request_token,
  );
  n.state = s.exportState();
};
describe("Private demand and reviewed identities", () => {
  it("returns only the authenticated shop customers and private allocations", () => {
    const v = merchantView(n, sharma);
    expect(v.requests).toHaveLength(8);
    expect(v.requests.every((r) => r.merchant_id === sharma)).toBe(true);
    expect(v.quotes.every((q) => q.own?.merchant_id === sharma)).toBe(true);
    expect(v).not.toHaveProperty("merchants");
    expect(v).not.toHaveProperty("reservations");
    expect(JSON.stringify(v.nearby)).not.toContain("Gupta");
    expect(JSON.stringify(v.nearby)).not.toContain("Customer");
  });
  it("a customer capability exposes just one exact offer", () => {
    const r = n.state.requests[0];
    const v = customerView(n, r.request_token);
    expect(Object.keys(v).sort()).toEqual([
      "area",
      "can_cancel",
      "can_confirm",
      "deadline",
      "pack",
      "price",
      "product",
      "quantity",
      "shop",
      "status",
    ]);
    expect(v).not.toHaveProperty("requests");
    expect(v).not.toHaveProperty("cash_cap_paise");
    expect(() => customerView(n, "unknown")).toThrow("NOT_FOUND");
  });
  it("records an arbitrary non-waiting product without an invented offer; retry is idempotent", () => {
    const b = {
      submission_key: crypto.randomUUID(),
      raw_text: "65 watt Type-C charger",
      intent: { ...manualDraft("65 watt Type-C charger"), quantity: 1 },
      can_wait: false,
    };
    const r = saveRequest(n, sharma, b);
    expect(r.status).toBe("MISSED_DEMAND");
    expect(storeFor(n).products.find((p) => p.id === r.product_id)?.name).toBe(
      "65 watt Type-C charger",
    );
    expect(n.state.offers.some((o) => o.request_id === r.id)).toBe(false);
    expect(saveRequest(n, sharma, b).id).toBe(r.id);
    expect(n.state.requests.filter((x) => x.id === r.id)).toHaveLength(1);
    expect(storeFor(n).evaluateQuote("quote-b").total_demand_units).toBe(23);
  });
  it("accepts an exact future time even after the previous date-only default", () => {
    const deadline = new Date(Date.now() + 24 * 3600000).toISOString();
    const r = saveRequest(n, sharma, {
      submission_key: crypto.randomUUID(),
      raw_text: "Coke Zero 500ml",
      intent: {
        ...manualDraft("Coke Zero 500ml"),
        quantity: 1,
        budget_paise: 5000,
        deadline,
      },
      can_wait: true,
      customer_phone: "9876543210",
      contact_consent: true,
      offer_price_paise: 5000,
    });
    expect(
      n.state.offers.find((o) => o.request_id === r.id)?.pickup_deadline,
    ).toBe(deadline);
  });
  it("incomplete waiting details save as pending interest, not permission to spend", () => {
    const r = saveRequest(n, sharma, {
      submission_key: crypto.randomUUID(),
      raw_text: "charger",
      intent: manualDraft("charger"),
      can_wait: true,
      customer_phone: "9876543210",
      contact_consent: true,
    });
    expect(r.status).toBe("WAITING_INTEREST");
    expect(n.state.offers.some((o) => o.request_id === r.id)).toBe(false);
    expect(storeFor(n).evaluateQuote("quote-b").total_demand_units).toBe(23);
  });
  it("canonical reviewed aliases match, while pack, brand and hard constraints separate products", () => {
    const a = manualDraft("Coke Zero half litre bottle under 50"),
      b = manualDraft("500ml zero coke bottle");
    expect(productKey(a)).toBe(productKey(b));
    expect(productKey({ ...a, size: 2000 })).not.toBe(productKey(a));
    expect(productKey({ ...a, brand: "Other" })).not.toBe(productKey(a));
    expect(productKey({ ...a, hard_constraints: ["caffeine-free"] })).not.toBe(
      productKey(a),
    );
  });
  it("cannot silently map another brand or packaging to the seeded snack", () => {
    const i = {
      ...manualDraft("Millet Crunch Masala 100g"),
      brand: "Other brand",
    };
    const r = saveRequest(n, sharma, {
      submission_key: crypto.randomUUID(),
      raw_text: "Other brand Millet Crunch Masala 100g",
      intent: i,
      can_wait: false,
    });
    expect(r.product_id).not.toBe("prod-millet");
  });
});
describe("Local anonymous intelligence and safe procurement", () => {
  it("suppresses peer counts below three other shops and does not reveal unseen products", () => {
    n.shops.slice(2).forEach((s) => (s.sharing = false));
    expect(merchantView(n, sharma).nearby[0].peer_band).toBeNull();
    saveRequest(n, "m-gupta-002", {
      submission_key: crypto.randomUUID(),
      raw_text: "special charger",
      intent: manualDraft("special charger"),
      can_wait: false,
    });
    expect(
      merchantView(n, sharma).nearby.some((p) => p.name === "special charger"),
    ).toBe(false);
  });
  it("filters distant, stale and unconfirmed-location signals", () => {
    n.shops.slice(1).forEach((s) => (s.latitude = 28.6));
    expect(merchantView(n, sharma).nearby[0].suppressed).toBe(true);
    n = seedNetwork();
    n.shops.slice(1).forEach((s) => (s.location_accuracy = "approximate"));
    expect(merchantView(n, sharma).nearby[0].suppressed).toBe(true);
    n = seedNetwork();
    n.state.requests
      .filter((r) => r.merchant_id !== sharma)
      .forEach(
        (r) =>
          (r.created_at = new Date(Date.now() - 8 * 86400000).toISOString()),
      );
    expect(merchantView(n, sharma).nearby[0].suppressed).toBe(true);
  });
  it("does not use a far-away reservation to complete a local case", () => {
    fullCase();
    expect(storeFor(n).evaluateQuote("quote-b").is_eligible).toBe(true);
    n.shops.find((s) => s.id === "m-gupta-002")!.latitude = 28.6;
    expect(storeFor(n).evaluateQuote("quote-b").total_demand_units).toBe(16);
    expect(storeFor(n).evaluateQuote("quote-b").is_eligible).toBe(false);
    expect(merchantView(n, "m-gupta-002").quotes).toHaveLength(0);
  });
  it("approval fingerprint changes for exact deadlines, cash caps and supplier permissions", () => {
    fullCase();
    const before = fingerprint(storeFor(n), "quote-b");
    n.state.offers[0].pickup_deadline = new Date(
      Date.now() + 3600000,
    ).toISOString();
    expect(fingerprint(storeFor(n), "quote-b")).not.toBe(before);
    n = seedNetwork();
    fullCase();
    const current = fingerprint(storeFor(n), "quote-b");
    n.shops[0].cash_cap_paise += 1;
    expect(fingerprint(storeFor(n), "quote-b")).not.toBe(current);
    n.shops[0].cash_cap_paise -= 1;
    n.shops[0].allowed_suppliers = [];
    expect(fingerprint(storeFor(n), "quote-b")).not.toBe(current);
  });
  it("commits only the selected whole case and retains extra active demand", async () => {
    fullCase();
    n.shops.slice(0, 3).forEach((m) => (m.cash_cap_paise = 50000));
    const s = storeFor(n);
    const { request } = s.createDemandRequest({
      merchant_id: sharma,
      product_id: "prod-millet",
      quantity: 1,
      max_retail_price_paise: 5000,
      required_by_date: s.requests[0].required_by_date,
      reason_unavailable: "not_stocked",
      can_wait: true,
    });
    s.confirmCustomerOffer(request.request_token);
    const e = s.evaluateQuote("quote-b");
    for (const a of e.allocations)
      s.recordMerchantApproval({
        merchant_id: a.merchant_id,
        quote_id: "quote-b",
        quote_version: 1,
        exposure_paise: a.total_exposure_paise,
        approved: true,
      });
    const order = await s.commitSupplierOrder("quote-b");
    expect(order.total_units).toBe(24);
    expect(s.reservations.filter((r) => r.status === "ACTIVE")).toHaveLength(1);
    expect(s.reservations.filter((r) => r.status === "COMMITTED")).toHaveLength(
      24,
    );
  });
});
