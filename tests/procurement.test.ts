import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStore } from "../src/lib/db/store";
import { getFutureDate } from "../src/lib/constants";
let db: MemoryStore;
beforeEach(() => {
  db = new MemoryStore();
});
const fullCase = () => db.confirmCustomerOffer("REQ-NML-8808");
const approve = (id = "quote-b") => {
  const ev = db.evaluateQuote(id);
  for (const a of ev.allocations)
    db.recordMerchantApproval({
      merchant_id: a.merchant_id,
      quote_id: id,
      quote_version: ev.quote_version,
      exposure_paise: a.total_exposure_paise,
      approved: true,
    });
};
describe("Customer-backed case procurement", () => {
  it("starts with 23 reservations across 3 shops; pending request does not count", () => {
    const ev = db.evaluateQuote("quote-b");
    expect(ev.total_demand_units).toBe(23);
    expect(ev.allocations.map((a) => a.allocated_units)).toEqual([7, 8, 8]);
    expect(ev.is_eligible).toBe(false);
  });
  it("the 24th confirmation covers a case exactly, including shared logistics", () => {
    fullCase();
    const ev = db.evaluateQuote("quote-b");
    expect(ev.is_eligible).toBe(true);
    expect(ev.total_procurement_cost_paise).toBe(103200);
    expect(ev.allocations.map((a) => a.total_exposure_paise)).toEqual([
      34400, 34400, 34400,
    ]);
  });
  it("duplicate confirmation cannot inflate the case", () => {
    const first = fullCase();
    const second = fullCase();
    expect(second.isDuplicate).toBe(true);
    expect(second.reservation.id).toBe(first.reservation.id);
    expect(db.evaluateQuote("quote-b").total_demand_units).toBe(24);
  });
  it("rejects the cheapest quote because its 48-unit case is unsupported", () => {
    fullCase();
    expect(db.evaluateQuote("quote-a").moq_met).toBe(false);
  });
  it("rejects C for late delivery even though its landed cost is lower", () => {
    fullCase();
    const ev = db.evaluateQuote("quote-c");
    expect(ev.total_procurement_cost_paise).toBe(98400);
    expect(ev.arrives_in_time).toBe(false);
  });
  it("one cash limit of 330 blocks 344; improving C arrival makes 328 eligible", () => {
    fullCase();
    db.updateMerchantCashCap(db.merchants[0].id, 33000);
    expect(db.evaluateQuote("quote-b").is_eligible).toBe(false);
    db.saveQuote({
      ...db.getQuoteById("quote-c")!,
      expected_delivery_date: getFutureDate(1),
    });
    const ev = db.evaluateQuote("quote-c");
    expect(ev.is_eligible).toBe(true);
    expect(ev.allocations.map((a) => a.total_exposure_paise)).toEqual([
      32800, 32800, 32800,
    ]);
  });
  it("honours every merchant supplier permission", () => {
    fullCase();
    db.merchants[2].allowed_suppliers = [];
    expect(db.evaluateQuote("quote-b").all_suppliers_permitted).toBe(false);
  });
  it("SKU and pack substitutions never inherit confirmations", () => {
    fullCase();
    db.saveQuote({ ...db.getQuoteById("quote-b")!, pack_size: "200g" });
    expect(db.evaluateQuote("quote-b").total_demand_units).toBe(0);
    db.saveQuote({
      ...db.getQuoteById("quote-b")!,
      pack_size: "100g",
      sku: "MC-LIME-100G",
    });
    expect(db.evaluateQuote("quote-b").total_demand_units).toBe(0);
  });
  it("uses exact offer deadline rather than end of the requested day", () => {
    fullCase();
    const o = db.offers[0];
    const tomorrow = getFutureDate(1);
    o.pickup_deadline = new Date(Date.parse(tomorrow) - 3600000).toISOString();
    expect(db.evaluateQuote("quote-b").arrives_in_time).toBe(false);
  });
  it("invalid or expired quote dates fail closed", () => {
    fullCase();
    for (const expiry of [
      "not-a-date",
      new Date(Date.now() - 1000).toISOString(),
    ]) {
      db.saveQuote({
        ...db.getQuoteById("quote-b")!,
        quote_expiry_date: expiry,
      });
      expect(db.evaluateQuote("quote-b").is_expired).toBe(true);
    }
  });
  it("confirmed retail price cannot exceed the original customer budget", () => {
    fullCase();
    db.reservations[0].confirmed_price_paise = 5100;
    expect(db.evaluateQuote("quote-b").is_eligible).toBe(false);
  });
  it("a confirmed retail price cannot be below the landed unit cost", () => {
    fullCase();
    db.reservations[0].confirmed_price_paise = 4000;
    expect(db.evaluateQuote("quote-b").is_eligible).toBe(false);
  });
  it("selects a fully backed 24-unit case and leaves excess demand waiting", () => {
    fullCase();
    const { request } = db.createDemandRequest({
      merchant_id: db.merchants[0].id,
      product_id: "prod-millet",
      quantity: 1,
      max_retail_price_paise: 5000,
      required_by_date: db.requests[0].required_by_date,
      reason_unavailable: "not_stocked",
      can_wait: true,
    });
    db.confirmCustomerOffer(request.request_token);
    expect(db.evaluateQuote("quote-b").total_demand_units).toBe(24);
    expect(db.evaluateQuote("quote-b").moq_met).toBe(true);
    expect(db.evaluateQuote("quote-b").selected_reservation_ids).toHaveLength(
      24,
    );
  });
  it("logistics allocation preserves total paise with unequal quantities and odd fees", () => {
    db.saveQuote({
      ...db.getQuoteById("quote-b")!,
      transport_cost_paise: 2401,
      handling_cost_paise: 101,
    });
    const ev = db.evaluateQuote("quote-b");
    expect(
      ev.allocations.reduce((s, a) => s + a.allocated_transport_paise, 0),
    ).toBe(2401);
    expect(
      ev.allocations.reduce((s, a) => s + a.allocated_handling_paise, 0),
    ).toBe(101);
    expect(ev.total_procurement_cost_paise).toBe(23 * 4200 + 2502);
  });
  it("expired offers cannot be newly confirmed", () => {
    db.offers.find((o) => o.request_token === "REQ-NML-8808")!.pickup_deadline =
      new Date(Date.now() - 1000).toISOString();
    expect(() => fullCase()).toThrow("expired");
  });
  it("records non-waiting requests without an offer or case backing", () => {
    const offers = db.offers.length;
    const { request, offer } = db.createDemandRequest({
      merchant_id: db.merchants[0].id,
      product_id: "prod-millet",
      quantity: 9,
      max_retail_price_paise: 0,
      required_by_date: "",
      reason_unavailable: "out_of_stock",
      can_wait: false,
    });
    expect(request.status).toBe("MISSED_DEMAND");
    expect(request.customer_name).toBe("Walk-in Customer");
    expect(request.required_by_date).toBe("");
    expect(offer).toBeNull();
    expect(db.offers.length).toBe(offers);
    expect(db.evaluateQuote("quote-b").total_demand_units).toBe(23);
    expect(() => db.confirmCustomerOffer(request.request_token)).toThrow();
    expect(db.reservations.length).toBe(23);
  });
  it("logging observed interest preserves approvals and excludes those units from commitment", async () => {
    fullCase();
    approve();
    const { request } = db.createDemandRequest({
      merchant_id: db.merchants[0].id,
      product_id: "prod-millet",
      quantity: 12,
      max_retail_price_paise: 0,
      required_by_date: "",
      reason_unavailable: "not_stocked",
      can_wait: false,
    });
    expect(
      db.getApprovalsForQuote("quote-b").every((a) => a.status === "APPROVED"),
    ).toBe(true);
    const order = await db.commitSupplierOrder("quote-b");
    expect(order.total_units).toBe(24);
    expect(request.status).toBe("MISSED_DEMAND");
    expect(db.reservations.some((r) => r.request_id === request.id)).toBe(
      false,
    );
  });
  it("rejects fractional quantity even for missed-demand signals", () => {
    expect(() =>
      db.createDemandRequest({
        merchant_id: db.merchants[0].id,
        product_id: "prod-millet",
        quantity: 1.5,
        max_retail_price_paise: 0,
        required_by_date: "",
        reason_unavailable: "not_stocked",
        can_wait: false,
      }),
    ).toThrow("Quantity");
  });
});
describe("Approvals, commitments and real cash outcomes", () => {
  it("cannot approve an ineligible case or a stale quoted exposure", () => {
    expect(() => approve()).toThrow("order changed");
    fullCase();
    expect(() =>
      db.recordMerchantApproval({
        merchant_id: db.merchants[0].id,
        quote_id: "quote-b",
        quote_version: 1,
        exposure_paise: 1,
        approved: true,
      }),
    ).toThrow("order changed");
  });
  it("all three shops must approve before commitment", async () => {
    fullCase();
    await expect(db.commitSupplierOrder("quote-b")).rejects.toThrow("approval");
  });
  it("pre-commit cancellation lowers demand to 23 and clears approvals; reconfirmation needs fresh approval", async () => {
    fullCase();
    approve();
    db.cancelCustomerReservation("REQ-NML-8808");
    expect(db.evaluateQuote("quote-b").is_eligible).toBe(false);
    expect(
      db
        .getApprovalsForQuote("quote-b")
        .every((a) => a.status === "INVALIDATED"),
    ).toBe(true);
    fullCase();
    await expect(db.commitSupplierOrder("quote-b")).rejects.toThrow(
      "Stale approval",
    );
    approve();
    expect((await db.commitSupplierOrder("quote-b")).total_units).toBe(24);
  });
  it("changing quote logistics invalidates previously approved cash exposure", async () => {
    fullCase();
    approve();
    db.saveQuote({
      ...db.getQuoteById("quote-b")!,
      transport_cost_paise: 2401,
    });
    await expect(db.commitSupplierOrder("quote-b")).rejects.toThrow("approval");
  });
  it("changing a cash cap requires that shop to reapprove", async () => {
    fullCase();
    approve();
    db.updateMerchantCashCap(db.merchants[0].id, 36000);
    await expect(db.commitSupplierOrder("quote-b")).rejects.toThrow(
      "Stale approval",
    );
  });
  it("concurrent duplicate commitment produces exactly one order", async () => {
    fullCase();
    approve();
    const orders = await Promise.all([
      db.commitSupplierOrder("quote-b"),
      db.commitSupplierOrder("quote-b"),
    ]);
    expect(orders[0].id).toBe(orders[1].id);
    expect(db.orders).toHaveLength(1);
    expect(
      db.reservations.filter((r) => r.status === "COMMITTED"),
    ).toHaveLength(24);
  });
  it("pending unrelated offer is never silently committed", async () => {
    fullCase();
    const pending = db.createDemandRequest({
      merchant_id: db.merchants[0].id,
      product_id: "prod-millet",
      quantity: 1,
      max_retail_price_paise: 5000,
      required_by_date: db.requests[0].required_by_date,
      reason_unavailable: "not_stocked",
      can_wait: true,
    });
    approve();
    await db.commitSupplierOrder("quote-b");
    expect(pending.request.status).toBe("OFFER_CREATED");
  });
  it("cannot record pickup before supplier cost is committed", async () => {
    await expect(
      db.recordPickup({
        reservation_id: db.reservations[0].id,
        outcome: "COLLECTED",
      }),
    ).rejects.toThrow("commitment");
  });
  it("six collections + two no-shows retain 344 cost, collect 300 and leave two units with 44 shortfall", async () => {
    fullCase();
    approve();
    await db.commitSupplierOrder("quote-b");
    const reservations = db.reservations.filter(
      (r) => r.merchant_id === db.merchants[0].id,
    );
    for (let i = 0; i < 8; i++)
      await db.recordPickup({
        reservation_id: reservations[i].id,
        outcome: i < 6 ? "COLLECTED" : "NO_SHOW",
      });
    const a = db.getNoShowAnalysis();
    expect(a.total_procurement_cost_paise).toBe(34400);
    expect(a.collected_cash_paise).toBe(30000);
    expect(a.current_cash_shortfall_paise).toBe(4400);
    expect(a.uncollected_units).toBe(2);
  });
  it("duplicate pickup is idempotent; conflicting outcome cannot overwrite collection", async () => {
    fullCase();
    approve();
    await db.commitSupplierOrder("quote-b");
    const r = db.reservations[0];
    const [one, two] = await Promise.all([
      db.recordPickup({ reservation_id: r.id, outcome: "COLLECTED" }),
      db.recordPickup({ reservation_id: r.id, outcome: "COLLECTED" }),
    ]);
    expect(one.id).toBe(two.id);
    expect(db.pickups).toHaveLength(1);
    await expect(
      db.recordPickup({ reservation_id: r.id, outcome: "NO_SHOW" }),
    ).rejects.toThrow("already recorded");
  });
  it("post-commit cancellation cannot erase procurement cost", async () => {
    fullCase();
    approve();
    await db.commitSupplierOrder("quote-b");
    expect(() => db.cancelCustomerReservation("REQ-NML-8801")).toThrow();
    expect(db.orders[0].total_cost_paise).toBe(103200);
  });
  it("ledger has zero committed cost before procurement; export/restore preserves approvals", () => {
    expect(db.getNoShowAnalysis().total_procurement_cost_paise).toBe(0);
    fullCase();
    approve();
    const restored = new MemoryStore();
    restored.hydrate(JSON.parse(JSON.stringify(db.exportState())));
    expect(restored.getApprovalsForQuote("quote-b")).toHaveLength(3);
    expect(
      restored
        .evaluateQuote("quote-b")
        .allocations.every((a) => a.approval_status === "APPROVED"),
    ).toBe(true);
  });
});

describe("Offer lifecycle validity", () => {
  it("expired active confirmations cannot back supplier cases", () => {
    fullCase();
    db.offers[0].pickup_deadline = new Date(Date.now() - 1000).toISOString();
    const e = db.evaluateQuote("quote-b");
    expect(e.total_demand_units).toBe(23);
    expect(e.is_eligible).toBe(false);
  });
  it("replaying a collected customer confirmation cannot create another reservation", async () => {
    fullCase();
    approve();
    await db.commitSupplierOrder("quote-b");
    const r = db.reservations[0];
    await db.recordPickup({ reservation_id: r.id, outcome: "COLLECTED" });
    const count = db.reservations.length;
    expect(db.confirmCustomerOffer(r.request_token).isDuplicate).toBe(true);
    expect(db.reservations).toHaveLength(count);
  });
});

describe("Committed economic snapshot", () => {
  it("later quote/cap edits cannot rewrite the recorded supplier obligation", async () => {
    fullCase();
    approve();
    const order = await db.commitSupplierOrder("quote-b");
    db.saveQuote({ ...db.getQuoteById("quote-b")!, unit_cost_paise: 1000 });
    db.updateMerchantCashCap(db.merchants[0].id, 0);
    expect(order.total_cost_paise).toBe(103200);
    expect(order.evaluation?.allocations[0].total_exposure_paise).toBe(34400);
    expect(order.supplier_quote?.unit_cost_paise).toBe(4200);
    expect(db.getNoShowAnalysis().total_procurement_cost_paise).toBe(34400);
  });
});
