import { describe, it, expect, vi } from "vitest";
import {
  itemDescription,
  reviewEditedItem,
  itemFields,
  reviewItemFields,
} from "../src/lib/product/item-review";
import { manualDraft } from "../src/lib/product/intent";
import { saveRequest, seedNetwork, storeFor } from "../src/lib/product/network";

describe("Simple item review", () => {
  it.each(["100gm", "100 gms", "100 grams", "100G", "100 GM"])(
    "accepts the common gram spelling %s without asking Gemini",
    async (pack) => {
      const base = { ...manualDraft("Chocolate"), variant: "Capella Hazelnut" };
      const normalize = vi.fn();
      const result = await reviewItemFields(
        { ...itemFields(base), pack },
        base,
        normalize,
      );
      expect(result).toMatchObject({
        size: 100,
        unit: "g",
        variant: "Capella Hazelnut",
      });
      expect(normalize).not.toHaveBeenCalled();
      expect(manualDraft(`Chocolate ${pack}`)).toMatchObject({
        size: 100,
        unit: "g",
      });
    },
  );
  it.each([
    ["0.5 kgs", 500, "g"],
    ["1 ltr bottle", 1000, "ml"],
    ["1.5 ltrs", 1500, "ml"],
    ["1 pc", 1, "piece"],
    ["2 pcs", 2, "piece"],
  ])("accepts common pack abbreviation %s", async (pack, size, unit) => {
    const base = manualDraft("Product");
    expect(
      await reviewItemFields(
        { ...itemFields(base), pack: String(pack) },
        base,
        vi.fn(),
      ),
    ).toMatchObject({ size, unit });
  });
  it("splits an extracted item, variant and pack without duplicating flavour", () => {
    const base = {
      ...manualDraft("Coke Zero 500ml bottle"),
      product: "Cola",
      variant: "Diet",
    };
    expect(itemFields(base)).toEqual({
      item: "Coca-Cola · Cola",
      variant: "Diet",
      pack: "500ml bottle",
    });
  });
  it("can set a missing pack and edit flavour without AI or losing the brand", async () => {
    const base = {
      ...manualDraft("Coke Zero"),
      product: "Cola",
      variant: "Diet",
      size: null,
      unit: null,
    };
    const normalize = vi.fn().mockRejectedValue(new Error("AI_DAILY_LIMIT"));
    const result = await reviewItemFields(
      { ...itemFields(base), variant: "Zero Sugar", pack: "330ml can" },
      base,
      normalize,
    );
    expect(result).toMatchObject({
      product: "Cola",
      brand: "Coca-Cola",
      variant: "Zero Sugar",
      size: 330,
      unit: "ml",
      packaging: "can",
    });
    expect(normalize).not.toHaveBeenCalled();
  });
  it("known packs remain editable and optional fields can truly be cleared", async () => {
    const base = manualDraft("Coke Zero 500ml bottle"),
      normalize = vi.fn();
    expect(
      await reviewItemFields(
        { ...itemFields(base), pack: "1 litre bottle" },
        base,
        normalize,
      ),
    ).toMatchObject({ size: 1000, unit: "ml" });
    expect(
      await reviewItemFields(
        { ...itemFields(base), variant: "", pack: "" },
        base,
        normalize,
      ),
    ).toMatchObject({ variant: null, size: null, unit: null, packaging: null });
    expect(normalize).not.toHaveBeenCalled();
  });
  it("a new item stays saveable during an AI limit without retaining the previous brand", async () => {
    const base = {
      ...manualDraft("Coke Zero 500ml bottle"),
      source: "gemini" as const,
    };
    const result = await reviewItemFields(
      { item: "Vim bar", variant: "Lemon", pack: "100g" },
      base,
      async () => {
        throw new Error("AI_DAILY_LIMIT");
      },
    );
    expect(result).toMatchObject({
      product: "Vim bar",
      brand: null,
      variant: "Lemon",
      size: 100,
      unit: "g",
      packaging: null,
      source: "manual",
    });
  });
  it("rejects ambiguous edited pack text rather than hiding it or inventing a size", async () => {
    const base = manualDraft("Coke Zero 500ml bottle");
    await expect(
      reviewItemFields(
        { ...itemFields(base), pack: "large bottle" },
        base,
        vi.fn(),
      ),
    ).rejects.toThrow("PACK_INVALID");
  });
  it("retains reviewed identity and never calls AI when item text is unchanged", async () => {
    const base = manualDraft("Coke Zero 500ml bottle"),
      normalize = vi.fn();
    const result = await reviewEditedItem(
      itemDescription(base),
      base,
      normalize,
    );
    expect(result).toBe(base);
    expect(normalize).not.toHaveBeenCalled();
  });
  it("a changed item does not inherit an old brand, pack or flavour", async () => {
    const base = {
      ...manualDraft("Coke Zero 500ml bottle"),
      quantity: 2,
      budget_paise: 5000,
    };
    const changed = manualDraft("Vim bar");
    const result = await reviewEditedItem("Vim bar", base, async () => changed);
    expect(result.product).toBe("Vim bar");
    expect(result.brand).toBeNull();
    expect(result.size).toBeNull();
    expect(result.quantity).toBe(2);
    expect(result.budget_paise).toBe(5000);
  });
  it("rejects a blank item and failed normalization without silently saving a different identity", async () => {
    const base = {
      ...manualDraft("Coke Zero 500ml bottle"),
      source: "gemini" as const,
    };
    await expect(reviewEditedItem(" ", base, vi.fn())).rejects.toThrow(
      "ITEM_REQUIRED",
    );
    await expect(
      reviewEditedItem("Vim bar", base, async () => ({ product: "" })),
    ).rejects.toThrow();
  });
  it("manual review edits remain saveable without recontacting a rate-limited provider", async () => {
    const normalize = vi.fn().mockRejectedValue(new Error("AI_RATE_LIMIT"));
    const result = await reviewEditedItem(
      "Diet Coke can",
      manualDraft("diet cooke can customer number"),
      normalize,
    );
    expect(result.product).toBe("Diet Coke can");
    expect(result.source).toBe("manual");
    expect(result.brand).toBeNull();
    expect(normalize).not.toHaveBeenCalled();
  });
  it("recording complete extracted demand still creates no offer until actual terms are arranged", () => {
    const n = seedNetwork();
    const r = saveRequest(n, "m-sharma-001", {
      submission_key: crypto.randomUUID(),
      raw_text: "Coke Zero 500ml bottle, customer can wait",
      intent: {
        ...manualDraft("Coke Zero 500ml bottle"),
        quantity: 2,
        budget_paise: 5000,
        deadline: new Date(Date.now() + 86400000).toISOString(),
      },
      can_wait: true,
      customer_phone: "9876543210",
      contact_consent: true,
      offer_price_paise: null,
    });
    expect(r.status).toBe("WAITING_INTEREST");
    expect(n.state.offers.some((o) => o.request_id === r.id)).toBe(false);
    expect(storeFor(n).evaluateQuote("quote-b").total_demand_units).toBe(23);
  });
});
