import { describe, it, expect, vi } from "vitest";
import {
  itemDescription,
  reviewEditedItem,
} from "../src/lib/product/item-review";
import { manualDraft } from "../src/lib/product/intent";
import { saveRequest, seedNetwork, storeFor } from "../src/lib/product/network";

describe("Simple item review", () => {
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
