import { seedNetwork, storeFor, fingerprint, type Network } from "./network";
import { isDemoShop } from "./demo-identity";
import { canonicalIdentity, identityKey } from "./canonical";
import { getFutureDate, getFutureDateString } from "../constants";
import type { Intent } from "./types";

/** Small, fictional scenarios. No invented phone numbers or real messages. */
export function seedJudgeDemo(): Network {
  const n = seedNetwork(),
    s = storeFor(n);
  const names = [
    "Ravi",
    "Meera",
    "Kavya",
    "Imran",
    "Deepa",
    "Arjun",
    "Priya",
    "Asha",
  ];
  for (const r of s.requests) {
    if (r.product_id === "prod-millet" && r.can_wait) {
      const i = s.requests
        .filter((x) => x.merchant_id === r.merchant_id && x.can_wait)
        .indexOf(r);
      r.customer_name = names[i % names.length];
      n.details[r.id].confirmation =
        r.status === "CUSTOMER_CONFIRMED"
          ? { method: "link", at: r.created_at }
          : null;
    }
  }
  const base = n.details[s.requests[0].id].intent;
  function add(
    shopId: string,
    productId: string,
    intent: Intent,
    raw: string,
    quantity = 1,
    confirmed = false,
    name = "Walk-in customer",
  ) {
    const { request } = s.createDemandRequest({
      merchant_id: shopId,
      product_id: productId,
      quantity,
      max_retail_price_paise: confirmed ? 5000 : 0,
      required_by_date: confirmed ? getFutureDateString(2) : "",
      reason_unavailable: "not_stocked",
      can_wait: confirmed,
      customer_name: name,
    });
    n.details[request.id] = {
      raw_text: raw,
      intent: { ...intent, quantity },
      revision: 1,
      submission_key: crypto.randomUUID(),
      confirmation: confirmed
        ? { method: "link", at: request.created_at }
        : null,
    };
    if (confirmed) s.confirmCustomerOffer(request.request_token);
    return request;
  }
  // Same family, different pack/flavour: visible in demand, never mixed into the 24-case.
  add(
    "m-sharma-001",
    "prod-millet-200",
    { ...base, size: 200, budget_paise: null },
    "Millet Crunch Masala 200g, customer could not wait",
    2,
  );
  const lime = { ...base, variant: "Lime", budget_paise: null };
  for (const id of ["m-sharma-001", "m-gupta-002", "m-lakshmi-003"])
    add(
      id,
      "prod-millet-lime",
      lime,
      "Millet Crunch Lime 100g",
      4,
      true,
      "Demo customer",
    );
  const coke: Intent = {
    ...base,
    product: "Cola",
    brand: "Coca-Cola",
    category: "Drinks",
    variant: "Zero Sugar",
    size: 500,
    unit: "ml",
    packaging: "bottle",
    budget_paise: null,
  };
  const identity = canonicalIdentity(coke);
  s.products.push({
    id: "demo-coke-zero",
    sku: "DEMO-COKE-ZERO-500-BOTTLE",
    name: "Coca-Cola · Cola · Zero Sugar",
    category: "Drinks",
    pack_size: "500ml bottle",
    standard_mrp_paise: 0,
    shelf_stable: true,
    created_at: new Date().toISOString(),
    canonical_identity: identity,
    intent_key: identityKey(identity),
  });
  for (const [i, shop] of n.shops.entries())
    add(
      shop.id,
      "demo-coke-zero",
      coke,
      [
        "Coke Zero half-litre bottle",
        "500 ml Coca Cola Zero Sugar bottle",
        "Coke Zero 500ml bottle",
      ][i % 3],
      i === 0 ? 2 : 1,
    );
  s.quotes.push({
    ...s.quotes[1],
    id: "demo-quote-lime",
    sku: "MC-LIME-100G",
    pack_size: "100g",
    unit_cost_paise: 3500,
    moq: 12,
    expected_delivery_date: getFutureDate(1),
    quote_expiry_date: getFutureDate(2, 18),
    version: 1,
    supplier_name: "Local Distribution Co. (demo)",
    created_by_shop: "m-sharma-001",
  });
  // Every pack has its own reviewed canonical identity, including those with no previous request.
  for (const product of s.products) {
    const detail = s.requests.find(
      (r) => r.product_id === product.id && n.details[r.id],
    );
    if (detail) {
      product.canonical_identity = canonicalIdentity(
        n.details[detail.id].intent,
      );
      product.intent_key = identityKey(product.canonical_identity);
    }
  }
  n.state = s.exportState();
  const hash = fingerprint(s, "demo-quote-lime"),
    e = s.evaluateQuote("demo-quote-lime");
  for (const a of e.allocations.filter((a) => a.merchant_id !== "m-sharma-001"))
    s.recordMerchantApproval({
      merchant_id: a.merchant_id,
      quote_id: "demo-quote-lime",
      quote_version: 1,
      allocation_fingerprint: hash,
      allocation_version: parseInt(hash.slice(0, 8), 16),
      exposure_paise: a.total_exposure_paise,
      approved: true,
    });
  s.logAudit("SYSTEM", "JUDGE_DEMO", "FICTIONAL_SCENARIO", {
    note: "Seeded customer confirmations and two neighboring-shop approvals are fictional. No real messages, payments or procurement.",
  });
  n.state = s.exportState();
  return n;
}

/** Reset only the fixed fictional cluster. Preserve all real accounts and their records. */
export function resetJudgeDemo(n: Network) {
  const old = n.state,
    demo = new Set(n.shops.filter((s) => isDemoShop(s.id)).map((s) => s.id));
  if (demo.size !== 6) throw new Error("DEMO_NOT_CONFIGURED");
  const requestIds = new Set(
    old.requests.filter((r) => demo.has(r.merchant_id)).map((r) => r.id),
  );
  const quoteIds = new Set(
    old.quotes
      .filter((q) => demo.has(q.created_by_shop || ""))
      .map((q) => q.id),
  );
  const orderIds = new Set(
    old.orders
      .filter((o) =>
        o.merchant_allocations.some((a) => demo.has(a.merchant_id)),
      )
      .map((o) => o.id),
  );
  if (
    old.orders.some(
      (o) =>
        (orderIds.has(o.id) || quoteIds.has(o.quote_id)) &&
        o.merchant_allocations.some((a) => !demo.has(a.merchant_id)),
    )
  )
    throw new Error("DEMO_RESET_BLOCKED");
  const reservationIds = new Set(
    old.reservations.filter((r) => demo.has(r.merchant_id)).map((r) => r.id),
  );
  const fresh = seedJudgeDemo();
  for (const shop of fresh.shops) {
    const prior = n.shops.find((s) => s.id === shop.id)!;
    shop.user_id = prior.user_id;
    shop.locale = prior.locale;
  }
  const requests = old.requests.filter((r) => !demo.has(r.merchant_id));
  const quotes = old.quotes.filter((q) => !quoteIds.has(q.id));
  const realProducts = new Set(requests.map((r) => r.product_id));
  const realSkus = new Set(quotes.map((q) => q.sku));
  const preservedProducts = old.products.filter(
    (p) => realProducts.has(p.id) || realSkus.has(p.sku),
  );
  const merge = <T extends { id: string }>(a: T[], b: T[]) => [
    ...a,
    ...b.filter((x) => !a.some((y) => y.id === x.id)),
  ];
  const shops = [...n.shops.filter((s) => !demo.has(s.id)), ...fresh.shops];
  const realSuppliers = new Set(quotes.map((q) => q.supplier_id));
  for (const shop of shops.filter((s) => !demo.has(s.id)))
    for (const id of shop.allowed_suppliers) realSuppliers.add(id);
  const keepApprovals = Object.fromEntries(
    Object.entries(old.approvalsByQuote || {})
      .filter(([id]) => !quoteIds.has(id))
      .map(([id, rows]) => [id, rows.filter((a) => !demo.has(a.merchant_id))]),
  );
  const demoUsers = new Set(
    n.shops.filter((s) => demo.has(s.id)).map((s) => s.user_id),
  );
  const entityIds = new Set([
    ...demo,
    ...Object.values(old.approvalsByQuote || {})
      .flat()
      .filter((a) => demo.has(a.merchant_id) || quoteIds.has(a.quote_id))
      .map((a) => a.id),
    ...requestIds,
    ...reservationIds,
    ...quoteIds,
    ...orderIds,
    ...old.offers.filter((o) => requestIds.has(o.request_id)).map((o) => o.id),
    ...old.pickups.filter((p) => demo.has(p.merchant_id)).map((p) => p.id),
  ]);
  n.shops = shops;
  n.state = {
    merchants: shops,
    products: merge(preservedProducts, fresh.state.products),
    suppliers: merge(
      old.suppliers.filter((s) => realSuppliers.has(s.id)),
      fresh.state.suppliers,
    ),
    requests: [...requests, ...fresh.state.requests],
    quotes: [...quotes, ...fresh.state.quotes],
    offers: [
      ...old.offers.filter((o) => !requestIds.has(o.request_id)),
      ...fresh.state.offers,
    ],
    reservations: [
      ...old.reservations.filter((r) => !demo.has(r.merchant_id)),
      ...fresh.state.reservations,
    ],
    orders: old.orders.filter((o) => !orderIds.has(o.id)),
    pickups: old.pickups.filter((p) => !demo.has(p.merchant_id)),
    approvalsByQuote: { ...keepApprovals, ...fresh.state.approvalsByQuote },
    auditEvents: [
      ...old.auditEvents.filter(
        (a) =>
          !entityIds.has(a.entity_id) &&
          !demo.has(String(a.payload.merchant_id)) &&
          !demoUsers.has(String(a.payload.actor)) &&
          a.entity_id !== "JUDGE_DEMO" &&
          a.entity_id !== "SEED",
      ),
      ...fresh.state.auditEvents,
    ],
  };
  n.details = {
    ...Object.fromEntries(
      Object.entries(n.details).filter(([id]) => !requestIds.has(id)),
    ),
    ...fresh.details,
  };
  n.submissions = Object.fromEntries(
    Object.entries(n.submissions).filter(
      ([key, value]) =>
        !requestIds.has(value) &&
        ![...demo].some((id) => key.startsWith(id + ":")),
    ),
  );
  n.receipts = n.receipts.filter(
    (r) => ![...orderIds].some((id) => r.startsWith(id + ":")),
  );
  // gemini_usage and revision are deliberately untouched. withNetwork commits by CAS.
}
