import { describe, expect, it } from "vitest";
import {
  captureHints,
  deadlineFromDay,
  dayFromDeadline,
  detailsText,
  phoneFromText,
  withDetails,
  groundedCustomerName,
  customerNameFromText,
} from "../src/lib/product/capture-fields";
import { manualDraft, parseIntent } from "../src/lib/product/intent";
import {
  seedNetwork,
  saveRequest,
  storeFor,
  merchantView,
} from "../src/lib/product/network";
import { groupDemand } from "../src/lib/product/demand-book";
const shop = "m-sharma-001";
describe("Simple capture fields preserve exact specifications", () => {
  it("autofills only explicitly stated customer names even without AI", () => {
    expect(
      customerNameFromText(
        "Two bottles. Customer name: Ravi Kumar. Phone 9000000001, can wait.",
      ),
    ).toBe("Ravi Kumar");
    expect(
      customerNameFromText("His name is Ravi and he can wait until tomorrow."),
    ).toBe("Ravi");
    expect(customerNameFromText("ग्राहक का नाम है राहुल।")).toBe("राहुल");
    expect(
      customerNameFromText("Motorola Sky blue, phone 9000000001"),
    ).toBeNull();
    expect(
      groundedCustomerName(
        "Customer NAME: Ravi",
        "Ravi",
        "customer name: Ravi",
      ),
    ).toBe("Ravi");
  });
  it("manual fallback removes contact labels without erasing mobile-phone products", () => {
    expect(
      manualDraft("diet cooke can customer number 9876543210").product,
    ).toBe("diet cooke can");
    expect(
      manualDraft("Moto mobile phone, customer number 9876543210").product,
    ).toBe("Moto mobile phone");
    expect(
      manualDraft("Diet Coke can. Customer name: Ravi. Phone +44 7700 900123.")
        .product,
    ).toBe("Diet Coke can");
    expect(manualDraft("Water 0.5L").product).toBe("Water 0.5L");
  });
  it("name suggestions require verbatim customer evidence, never an inferred brand name", () => {
    expect(
      groundedCustomerName(
        "Customer name: Ravi. Cola",
        "Ravi",
        "Customer name: Ravi",
      ),
    ).toBe("Ravi");
    expect(
      groundedCustomerName("ग्राहक का नाम: राहुल", "राहुल", "नाम: राहुल"),
    ).toBe("राहुल");
    expect(
      groundedCustomerName(
        "Feastables chocolate",
        "Ravi",
        "Customer name: Ravi",
      ),
    ).toBeNull();
    expect(
      groundedCustomerName(
        "Product name: Feastables",
        "Feastables",
        "Product name: Feastables",
      ),
    ).toBeNull();
    expect(
      groundedCustomerName(
        "Customer name: Ravi",
        "Rahul",
        "Customer name: Ravi",
      ),
    ).toBeNull();
    expect(
      groundedCustomerName("Customer name: Ravi", "Ravi", undefined),
    ).toBeNull();
  });
  it("one details field retains variant, size and packaging without conflating packs", () => {
    const i = manualDraft("Millet Crunch Masala 100g");
    const small = withDetails(i, "Masala, 100g pouch"),
      large = withDetails(i, "Masala, 1kg pouch");
    expect(small).toMatchObject({
      variant: "Masala",
      size: 100,
      unit: "g",
      packaging: "pouch",
    });
    expect(large.size).toBe(1000);
    expect(withDetails(small, detailsText(small))).toEqual(small);
    expect(withDetails(i, "")).toMatchObject({
      variant: null,
      size: null,
      unit: null,
      packaging: null,
    });
    expect(withDetails(i, "Black XL, 1 piece")).toMatchObject({
      variant: "Black XL",
      size: 1,
      unit: "piece",
    });
    expect(withDetails(i, "Peanut butter, 60g bar")).toMatchObject({
      variant: "Peanut butter",
      size: 60,
      unit: "g",
      packaging: null,
    });
  });
  it("a phone prefills contact but never implies willingness or confirmation", () => {
    expect(
      captureHints("Coke Zero 500ml, 2 bottles under ₹50, phone 9000000001"),
    ).toMatchObject({ phone: "919000000001", can_wait: null });
    expect(captureHints("Can wait, +91 90000 00001, 2 bottles")).toMatchObject({
      phone: "919000000001",
      can_wait: true,
    });
    expect(
      captureHints("Customer cannot wait. Phone 9000000001").can_wait,
    ).toBe(false);
    expect(phoneFromText("2 bottles, 500ml, budget ₹50")).toBeNull();
    expect(phoneFromText("budget ₹9000000001")).toBeNull();
    expect(phoneFromText("9000000001 or 9876543210")).toBeNull();
    expect(
      manualDraft("charger customer phone 9000000001").product,
    ).not.toContain("9000000001");
  });
  it("unknowns do not become unlimited willingness, price or dates", () => {
    expect(
      captureHints("Customer is not sure if they can wait").can_wait,
    ).toBeNull();
    expect(captureHints("Customer might wait").can_wait).toBeNull();
    expect(captureHints("Customer doesn't want to wait").can_wait).toBe(false);
    expect(captureHints("a bottle")).toMatchObject({
      can_wait: null,
      flexible_price: false,
      no_rush: false,
    });
    expect(captureHints("Any price, no rush")).toMatchObject({
      flexible_price: true,
      no_rush: true,
      can_wait: true,
    });
    expect(
      captureHints("a bottle", {
        ...manualDraft("a bottle"),
        can_wait: true,
        evidence: {},
      }).can_wait,
    ).toBeNull();
  });
  it("date-only deadlines use the end of the stated day in India and reject invalid dates", () => {
    expect(dayFromDeadline(deadlineFromDay("2027-02-01"))).toBe("2027-02-01");
    expect(deadlineFromDay("2027-02-01")).toBe("2027-02-01T18:29:59.000Z");
    expect(deadlineFromDay("")).toBeNull();
    expect(() => deadlineFromDay("2027-02-30")).toThrow("INVALID_DEADLINE");
    expect(manualDraft("Needed by 04/10/2027").deadline).toBe(
      "2027-10-04T18:29:59.000Z",
    );
  });
  it("blank model product is rejected rather than displayed as a valid extraction", () => {
    expect(() =>
      parseIntent({ ...manualDraft("anything"), product: "   " }),
    ).toThrow();
  });
});
describe("Optional means optional at the backend", () => {
  const payload = () => ({
    submission_key: crypto.randomUUID(),
    raw_text: "some snacks",
    intent: manualDraft("some snacks"),
    can_wait: true,
    customer_phone: "9876543210",
    contact_consent: true,
    offer_price_paise: null,
    flexible_price: true,
    no_rush: true,
  });
  it("saves blank brand, details, budget, price and date as pending interest with no invented offer", () => {
    const n = seedNetwork(),
      b = payload(),
      r = saveRequest(n, shop, b);
    expect(r.status).toBe("WAITING_INTEREST");
    expect(r.customer_phone).toBe("919876543210");
    expect(n.details[r.id]).toMatchObject({
      flexible_price: true,
      no_rush: true,
      confirmation: null,
    });
    expect(n.details[r.id].intent).toMatchObject({
      budget_paise: null,
      deadline: null,
      size: null,
    });
    expect(n.state.offers.some((o) => o.request_id === r.id)).toBe(false);
    expect(() => storeFor(n).confirmCustomerOffer(r.request_token)).toThrow();
    expect(storeFor(n).evaluateQuote("quote-b").total_demand_units).toBe(23);
    expect(
      groupDemand(merchantView(n, shop).requests, "some snacks", "pending")[0]
        .pending,
    ).toBe(1);
    expect(saveRequest(n, shop, b).id).toBe(r.id);
  });
  it("known details and budget alone never pretend an actual offer price was supplied", () => {
    const n = seedNetwork(),
      b = payload();
    b.intent = {
      ...manualDraft("Coke Zero 500ml"),
      budget_paise: 5000,
      deadline: deadlineFromDay("2027-02-01"),
    };
    expect(saveRequest(n, shop, b).status).toBe("WAITING_INTEREST");
    expect(
      saveRequest(n, shop, {
        ...b,
        submission_key: crypto.randomUUID(),
        offer_price_paise: undefined,
      }).status,
    ).toBe("WAITING_INTEREST");
  });
  it("an actual price can be confirmed with no preferred budget", () => {
    const n = seedNetwork(),
      b = {
        ...payload(),
        intent: {
          ...manualDraft("Coke Zero 500ml"),
          budget_paise: null,
          deadline: deadlineFromDay("2027-02-01"),
        },
        offer_price_paise: 5000,
        confirm_in_store: true,
        terms_accepted: true,
      };
    const r = saveRequest(n, shop, b);
    expect(r.status).toBe("CUSTOMER_CONFIRMED");
    expect(
      n.state.reservations.find((x) => x.request_id === r.id)
        ?.confirmed_price_paise,
    ).toBe(5000);
  });
});
