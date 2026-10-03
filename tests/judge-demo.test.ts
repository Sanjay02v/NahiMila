import { describe, expect, it } from "vitest";
import { seedJudgeDemo, resetJudgeDemo } from "../src/lib/product/demo";
import {
  storeFor,
  fingerprint,
  merchantView,
} from "../src/lib/product/network";
import { isDemoShop } from "../src/lib/product/demo-identity";
import { orderGroups } from "../src/lib/product/list-view";
import { quoteActions, quoteBlockers } from "../src/lib/product/quote-actions";

function approve(s: ReturnType<typeof storeFor>, id: string) {
  const e = s.evaluateQuote(id),
    hash = fingerprint(s, id);
  for (const a of e.allocations)
    s.recordMerchantApproval({
      merchant_id: a.merchant_id,
      quote_id: id,
      quote_version: e.quote_version,
      allocation_version: parseInt(hash.slice(0, 8), 16),
      allocation_fingerprint: hash,
      exposure_paise: a.total_exposure_paise,
      approved: true,
    });
}

describe("judge demo: real calculations, fictional inputs", () => {
  it("shows a cheaper late quote without allowing it to replace the feasible case", async () => {
    const n = seedJudgeDemo();
    const view = merchantView(n, "m-sharma-001");
    const choices = orderGroups(view.orders, view.quotes, "lime")[0].quotes;
    expect(choices.map((q) => q.quote.id)).toEqual([
      "demo-quote-lime",
      "demo-quote-lime-late",
    ]);
    const [onTime, late] = choices;
    expect(onTime.own?.total_exposure_paise).toBe(14800);
    expect(late.own?.total_exposure_paise).toBe(13600);
    expect(late.total_units).toBe(12);
    expect(late.checks.filter((c) => !c.passed).map((c) => c.code)).toEqual([
      "deadline",
    ]);
    expect(quoteBlockers(late)).toContainEqual({ key: "blockedDelivery" });
    expect(quoteActions(late)).toMatchObject({
      canApprove: false,
      canCommit: false,
    });
    await expect(
      storeFor(n).commitSupplierOrder(late.quote.id),
    ).rejects.toThrow();
    resetJudgeDemo(n);
    const reset = merchantView(n, "m-sharma-001");
    expect(
      reset.quotes.find((q) => q.quote.id === late.quote.id)?.eligible,
    ).toBe(false);
    expect(
      reset.quotes.find((q) => q.quote.id === onTime.quote.id)?.approval_count,
    ).toBe(2);
  });
  it("keeps approval fingerprints stable through JSONB key reordering", () => {
    const n = seedJudgeDemo();
    const jsonb = JSON.parse(
      JSON.stringify(n, (_key, value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(
              Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
            )
          : value,
      ),
    );
    expect(fingerprint(storeFor(n), "demo-quote-lime")).toBe(
      fingerprint(storeFor(jsonb), "demo-quote-lime"),
    );
    expect(
      storeFor(jsonb)
        .getApprovalsForQuote("demo-quote-lime")
        .every(
          (a) =>
            a.allocation_fingerprint ===
            fingerprint(storeFor(jsonb), "demo-quote-lime"),
        ),
    ).toBe(true);
  });

  it("starts one unit short; confirms once; rejects late and undersized cases", () => {
    const n = seedJudgeDemo(),
      s = storeFor(n);
    expect(s.evaluateQuote("quote-b").total_demand_units).toBe(23);
    expect(s.evaluateQuote("quote-b").is_eligible).toBe(false);
    const pending = s.requests.find((r) => r.status === "OFFER_CREATED")!;
    expect(pending.customer_name).toBe("Asha");
    s.confirmCustomerOffer(pending.request_token);
    expect(s.confirmCustomerOffer(pending.request_token).isDuplicate).toBe(
      true,
    );
    expect(s.evaluateQuote("quote-b").total_demand_units).toBe(24);
    expect(s.evaluateQuote("quote-b").is_eligible).toBe(true);
    expect(s.evaluateQuote("quote-a").is_eligible).toBe(false);
    expect(s.evaluateQuote("quote-c").is_eligible).toBe(false);
    expect(
      s
        .getApprovalsForQuote("demo-quote-lime")
        .filter((a) => a.status === "APPROVED"),
    ).toHaveLength(2);
    approve(s, "quote-b");
    s.cancelCustomerReservation(pending.request_token);
    expect(s.evaluateQuote("quote-b").is_eligible).toBe(false);
    expect(
      s
        .getApprovalsForQuote("quote-b")
        .every((a) => a.status === "INVALIDATED"),
    ).toBe(true);
    expect(
      s
        .getApprovalsForQuote("demo-quote-lime")
        .filter((a) => a.status === "APPROVED"),
    ).toHaveLength(2);
  });
  it("blocks the same eligible case when a merchant cannot afford their share", () => {
    const n = seedJudgeDemo(),
      s = storeFor(n);
    s.confirmCustomerOffer(
      s.requests.find((r) => r.status === "OFFER_CREATED")!.request_token,
    );
    s.updateMerchantCashCap("m-sharma-001", 33000);
    expect(s.evaluateQuote("quote-b").is_eligible).toBe(false);
  });
  it("keeps pack, flavour and no-wait interest out of the Masala case", () => {
    const n = seedJudgeDemo(),
      s = storeFor(n),
      v = merchantView(n, "m-sharma-001");
    expect(s.evaluateQuote("quote-b").total_demand_units).toBe(23);
    expect(s.evaluateQuote("demo-quote-lime").total_demand_units).toBe(12);
    const coke = n.state.requests.filter(
      (r) => r.product_id === "demo-coke-zero",
    );
    expect(coke).toHaveLength(6);
    expect(new Set(coke.map((r) => n.details[r.id].raw_text)).size).toBe(3);
    expect(coke.every((r) => !r.can_wait)).toBe(true);
    expect(v.nearby.find((p) => p.key === "demo-coke-zero")).toBeDefined();
    expect(v.demo).toBe(true);
  });
  it("runs a shared order and counts pickup once, then resets all progress and links", async () => {
    const n = seedJudgeDemo(),
      s = storeFor(n),
      beforeTokens = n.state.requests.map((r) => r.request_token);
    const shopUsers = n.shops.map((s) => s.user_id);
    n.gemini_usage = {
      project: {
        day: "2026-10-03",
        requests: 37,
        recent: [{ at: Date.now(), tokens: 700 }],
        cooldown_until: Date.now() + 60000,
        daily_blocked: false,
      },
    };
    const usage = structuredClone(n.gemini_usage);
    approve(s, "demo-quote-lime");
    const order = await s.commitSupplierOrder("demo-quote-lime");
    expect(order.total_cost_paise).toBe(44400);
    expect(await s.commitSupplierOrder("demo-quote-lime")).toEqual(order);
    const res = s.reservations.find(
      (r) => r.status === "COMMITTED" && r.merchant_id === "m-sharma-001",
    )!;
    const pickup = await s.recordPickup({
      reservation_id: res.id,
      outcome: "COLLECTED",
    });
    expect(pickup.total_collected_paise).toBe(20000);
    expect(
      await s.recordPickup({ reservation_id: res.id, outcome: "COLLECTED" }),
    ).toEqual(pickup);
    expect(s.pickups).toHaveLength(1);
    n.state = s.exportState();
    n.receipts = [`${order.id}:m-sharma-001`];
    n.submissions = { "m-sharma-001:old": n.state.requests[0].id };
    resetJudgeDemo(n);
    expect(n.state.orders).toHaveLength(0);
    expect(n.state.pickups).toHaveLength(0);
    expect(n.receipts).toHaveLength(0);
    expect(n.submissions).toEqual({});
    expect(n.shops.map((s) => s.user_id)).toEqual(shopUsers);
    expect(n.gemini_usage).toEqual(usage);
    expect(
      n.state.requests.some((r) => beforeTokens.includes(r.request_token)),
    ).toBe(false);
    expect(storeFor(n).evaluateQuote("quote-b").total_demand_units).toBe(23);
    const count = n.state.requests.length;
    resetJudgeDemo(n);
    expect(n.state.requests).toHaveLength(count);
  });
  it("isolates real accounts and preserves their records during reset", () => {
    const n = seedJudgeDemo();
    const real = {
      ...n.shops[0],
      id: "real-shop",
      user_id: crypto.randomUUID(),
    };
    n.shops.push(real);
    n.state.merchants = n.shops;
    const request = {
      ...n.state.requests[0],
      id: "real-request",
      merchant_id: real.id,
      request_token: crypto.randomUUID(),
      can_wait: false,
    };
    n.state.requests.push(request);
    n.details[request.id] = structuredClone(n.details[n.state.requests[0].id]);
    const before = structuredClone(request);
    const v = merchantView(n, real.id);
    expect(isDemoShop(real.id)).toBe(false);
    expect(v.demo).toBe(false);
    expect(v.nearby.every((p) => p.shops === 0 && p.peer_band === null)).toBe(
      true,
    );
    expect(
      storeFor(n).eligibleMerchantIdsForQuote!(n.state.quotes[0]).has(real.id),
    ).toBe(false);
    resetJudgeDemo(n);
    expect(n.state.requests.find((r) => r.id === request.id)).toEqual(before);
    expect(n.shops.find((s) => s.id === real.id)).toEqual(real);
  });
});
