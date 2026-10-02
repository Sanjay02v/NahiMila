import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalIdentity,
  identityKey,
  sameSpecifications,
} from "../src/lib/product/canonical";
import { resolveProduct } from "../src/lib/product/matching";
import { manualDraft } from "../src/lib/product/intent";
import {
  merchantView,
  saveRequest,
  seedNetwork,
  storeFor,
  productCatalog,
} from "../src/lib/product/network";
import { quoteActions, quoteBlockers } from "../src/lib/product/quote-actions";
import type { Intent } from "../src/lib/product/types";
const coke = (changes: Partial<Intent> = {}): Intent => ({
  ...manualDraft("Coke Zero half litre bottle"),
  ...changes,
});
const response = (decision: unknown) =>
  Response.json({
    candidates: [{ content: { parts: [{ text: JSON.stringify(decision) }] } }],
  });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("Shared reviewed product identities", () => {
  it("generic names do not invent a brand or override a conflicting variant", () => {
    expect(
      canonicalIdentity(coke({ product: "Zero", brand: null, variant: null }))
        .brand,
    ).toBeNull();
    expect(
      canonicalIdentity(
        coke({ product: "Millet snacks", brand: null, variant: null }),
      ).brand,
    ).toBeNull();
    expect(
      identityKey(coke({ product: "Coke Zero", variant: "Classic" })),
    ).not.toBe(identityKey(coke({ product: "Cola", variant: "Classic" })));
  });
  it("groups English, Hindi and variant wording without dropping the original text", () => {
    const n = seedNetwork();
    const entries = [
      coke({ product: "Coke Zero", brand: "Coke", variant: "Zero" }),
      coke({
        product: "कोक ज़ीरो",
        brand: "कोक",
        variant: "ज़ीरो",
        packaging: "बोतल",
      }),
      coke({ product: "Cola", brand: "Coca-Cola", variant: "Zero Sugar" }),
      coke({
        product: "Coca-Cola Zero Sugar",
        hard_constraints: ["No substitutions", "bottle only", "Brand Coke"],
      }),
    ];
    const saved = entries.map((intent, i) =>
      saveRequest(n, n.shops[i].id, {
        submission_key: crypto.randomUUID(),
        raw_text: [
          "Coke Zero half litre bottle",
          "कोक ज़ीरो 500ml बोतल",
          "Coca-Cola Zero Sugar 500ml bottle",
          "zero coke bottle 500ml",
        ][i],
        intent,
        can_wait: false,
      }),
    );
    expect(new Set(saved.map((r) => r.product_id)).size).toBe(1);
    expect(n.details[saved[1].id].raw_text).toBe("कोक ज़ीरो 500ml बोतल");
    expect(n.details[saved[3].id].intent.hard_constraints).toContain(
      "No substitutions",
    );
    const signal = merchantView(n, n.shops[0].id).nearby.find(
      (p) => p.key === saved[0].product_id,
    )!;
    expect(signal.shops).toBe(3);
    expect(signal.own_requests).toBe(1);
    expect(signal.suppressed).toBe(false);
    expect(JSON.stringify(signal)).not.toContain("Customer");
    expect(
      n.state.offers.filter((o) => saved.some((r) => r.id === o.request_id)),
    ).toHaveLength(0);
  });
  it("different sizes, brands, variants, packaging and meaningful restrictions stay separate", () => {
    const original = identityKey(coke());
    for (const change of [
      { size: 2000 },
      { brand: "Pepsi" },
      { variant: "Classic" },
      { variant: "Diet" },
      { variant: "Sugar free" },
      { packaging: "can" },
      { packaging: null },
      { hard_constraints: ["caffeine-free"] },
    ])
      expect(identityKey(coke(change))).not.toBe(original);
    expect(sameSpecifications(coke({ size: null }), coke())).toBe(false);
  });
  it("existing equivalent products aggregate interest without rewriting issued offers or orders", () => {
    const n = seedNetwork();
    const r = saveRequest(n, n.shops[0].id, {
      submission_key: crypto.randomUUID(),
      raw_text: "Coke Zero bottle",
      intent: coke(),
      can_wait: false,
    });
    const original = n.state.products.find((p) => p.id === r.product_id)!;
    const duplicate = {
      ...original,
      id: "legacy-alias",
      sku: "legacy-alias-sku",
      canonical_identity: {
        ...original.canonical_identity!,
        product: "Coca-Cola Zero Sugar",
        brand: "Coke",
        variant: "Zero",
      },
    };
    n.state.products.push(duplicate);
    for (const shop of n.shops.slice(1, 4)) {
      const s = storeFor(n);
      const { request } = s.createDemandRequest({
        merchant_id: shop.id,
        product_id: duplicate.id,
        quantity: 1,
        max_retail_price_paise: 0,
        required_by_date: "",
        reason_unavailable: "not_stocked",
        can_wait: false,
      });
      n.state = s.exportState();
      n.details[request.id] = {
        raw_text: "legacy original",
        intent: coke(),
        revision: 1,
        submission_key: crypto.randomUUID(),
      };
    }
    const snapshot = JSON.stringify(n.state.requests);
    const signal = merchantView(n, n.shops[0].id).nearby.find(
      (p) => p.key === original.id,
    )!;
    expect(signal.shops).toBe(3);
    expect(JSON.stringify(n.state.requests)).toBe(snapshot);
  });
  it("24 confirmations from different names share one supplier case; observation alone never funds it", () => {
    const n = seedNetwork();
    const deadline = new Date(Date.now() + 3 * 86400000).toISOString();
    const aliases = [
      coke(),
      coke({ product: "कोक ज़ीरो", brand: "कोक", variant: "ज़ीरो" }),
      coke({ product: "Cola", brand: "Coca-Cola", variant: "Zero Sugar" }),
    ];
    const saved = aliases.map((intent, i) =>
      saveRequest(n, n.shops[i].id, {
        submission_key: crypto.randomUUID(),
        raw_text: "Fictional alias " + i,
        intent: { ...intent, quantity: 8, budget_paise: 5000, deadline },
        can_wait: true,
      }),
    );
    expect(new Set(saved.map((r) => r.product_id)).size).toBe(1);
    const product = n.state.products.find((p) => p.id === saved[0].product_id)!;
    const quote = n.state.quotes.find((q) => q.id === "quote-b")!;
    quote.sku = product.sku;
    quote.pack_size = product.pack_size;
    const s = storeFor(n);
    expect(s.evaluateQuote("quote-b").total_demand_units).toBe(0);
    saved.forEach((r) => s.confirmCustomerOffer(r.request_token));
    expect(s.evaluateQuote("quote-b").is_eligible).toBe(true);
    expect(s.evaluateQuote("quote-b").total_demand_units).toBe(24);
    expect(
      s.evaluateQuote("quote-b").allocations.map((a) => a.total_exposure_paise),
    ).toEqual([34400, 34400, 34400]);
  });
  it("projects product metadata without private shop, customer, raw text or commercial offer fields", () => {
    const catalog = productCatalog(seedNetwork());
    expect(catalog.length).toBeGreaterThan(0);
    for (const i of catalog)
      expect(Object.keys(i).sort()).toEqual([
        "brand",
        "hard_constraints",
        "packaging",
        "product",
        "size",
        "unit",
        "variant",
      ]);
  });
});
describe("Gemini resolves arbitrary family synonyms with deterministic specification guards", () => {
  it("maps compatible family synonyms through the provider and keeps price, deadlines and constraints intact", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const fetch = vi
      .fn()
      .mockResolvedValue(response({ candidate: 0, certainty: "same_product" }));
    vi.stubGlobal("fetch", fetch);
    const query = coke({
      product: "Wireless earphones",
      brand: "Example Audio",
      variant: "Model X",
      size: 1,
      unit: "piece",
      packaging: "box",
      budget_paise: 150000,
      hard_constraints: ["black only"],
    });
    const catalog = [
      canonicalIdentity({ ...query, product: "True wireless earbuds" }),
    ];
    const result = await resolveProduct(query, catalog);
    expect(result.intent).toEqual({
      ...query,
      product: "True wireless earbuds",
    });
    expect(result.match.kind).toBe("matched");
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.generationConfig.responseMimeType).toBe("application/json");
    expect(JSON.stringify(payload)).not.toContain("150000");
    expect(JSON.stringify(payload)).not.toContain("customer_name");
  });
  it("never calls a model for incompatible commercial specs or incomplete packs", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      (
        await resolveProduct(coke({ product: "some cola", brand: "Pepsi" }), [
          coke(),
        ])
      ).match.kind,
    ).toBe("new");
    expect(
      (await resolveProduct(coke({ size: null }), [coke()])).match.kind,
    ).toBe("uncertain");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("a missing key, uncertain or invalid provider choice cannot merge products", async () => {
    const query = coke({ product: "A different family" });
    vi.stubEnv("GEMINI_API_KEY", "");
    expect((await resolveProduct(query, [coke()])).intent.product).toBe(
      query.product,
    );
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ candidate: 0, certainty: "uncertain" }))
      .mockResolvedValueOnce(
        response({ candidate: 99, certainty: "same_product" }),
      )
      .mockResolvedValueOnce(new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    for (let i = 0; i < 3; i++) {
      const result = await resolveProduct(query, [coke()]);
      expect(result.intent.product).toBe(query.product);
      expect(result.match.kind).toBe("uncertain");
    }
  });
});
describe("Explain order blockers without blocking an estimate", () => {
  it("the 23-of-24 case has an accessible preview but approval and commitment remain blocked", () => {
    const q = merchantView(seedNetwork(), "m-sharma-001").quotes.find(
      (q) => q.quote.id === "quote-b",
    )!;
    expect(quoteActions(q)).toEqual({
      canReview: true,
      canApprove: false,
      canCommit: false,
    });
    expect(quoteBlockers(q)).toContainEqual({ key: "blockedUnits", count: 1 });
  });
  it("after the last confirmation, approvals unlock and commitment waits for every shop", () => {
    const n = seedNetwork(),
      s = storeFor(n);
    s.confirmCustomerOffer(
      s.requests.find((r) => r.status === "OFFER_CREATED")!.request_token,
    );
    n.state = s.exportState();
    const q = merchantView(n, "m-sharma-001").quotes.find(
      (q) => q.quote.id === "quote-b",
    )!;
    expect(quoteActions(q)).toEqual({
      canReview: true,
      canApprove: true,
      canCommit: false,
    });
    expect(quoteBlockers(q)).toContainEqual({
      key: "blockedApprovals",
      count: 3,
    });
    expect(
      quoteActions({ ...q, approval_count: q.participant_count }).canCommit,
    ).toBe(true);
    expect(quoteActions({ ...q, own: null }).canCommit).toBe(false);
  });
});
