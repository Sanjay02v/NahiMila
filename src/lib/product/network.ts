import { randomUUID, createHash } from "node:crypto";
import { MemoryStore, type SeedDataPayload } from "@/lib/db/store";
import { getFutureDateString } from "@/lib/constants";
import type {
  Intent,
  Shop,
  RequestDetail,
  MerchantView,
  CustomerView,
  QuoteView,
  OrderView,
} from "./types";
import { distanceMeters, pack, productKey, parseIntent } from "./intent";
import {
  canonicalIdentity,
  identityKey,
  productLabel,
  type ProductIdentity,
} from "./canonical";
export interface Network {
  revision: number;
  state: SeedDataPayload;
  shops: Shop[];
  details: Record<string, RequestDetail>;
  receipts: string[];
  submissions: Record<string, string>;
}
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function productIdentity(
  n: Network,
  id: string,
): ProductIdentity | null {
  const p = n.state.products.find((p) => p.id === id);
  const stored =
    p?.canonical_identity ||
    n.details[
      n.state.requests.find((r) => r.product_id === id && n.details[r.id])
        ?.id || ""
    ]?.intent;
  return stored ? canonicalIdentity(stored) : null;
}
// Only reviewed product specifications are projected; no requests, customers or shop identifiers.
export function productCatalog(n: Network): ProductIdentity[] {
  return n.state.products.flatMap((p) => {
    const i = productIdentity(n, p.id);
    return i
      ? [
          {
            product: i.product,
            brand: i.brand,
            variant: i.variant,
            size: i.size,
            unit: i.unit,
            packaging: i.packaging,
            hard_constraints: [...i.hard_constraints],
          },
        ]
      : [];
  });
}
export function seedNetwork(): Network {
  const s = new MemoryStore();
  const shops: Shop[] = s.merchants.map((m, i) => ({
    ...m,
    user_id: randomUUID(),
    locale: "en" as const,
    latitude: 12.9716 + i * 0.001,
    longitude: 77.6412 + i * 0.001,
    location_accuracy: "confirmed" as const,
    sharing: true,
  }));
  const details: Record<string, RequestDetail> = {};
  const intent: Intent = {
    product: "Millet Crunch",
    category: "Snacks",
    brand: "Millet Crunch",
    variant: "Masala",
    size: 100,
    unit: "g",
    packaging: null,
    quantity: 1,
    budget_paise: 5000,
    deadline: null,
    substitutions: false,
    hard_constraints: [],
    preferences: [],
    missing: [],
    evidence: {},
    source: "manual",
  };
  for (const req of s.requests) {
    const old = req.request_token,
      token = `NML-${randomUUID()}`;
    req.request_token = token;
    for (const o of s.offers)
      if (o.request_token === old) o.request_token = token;
    for (const r of s.reservations)
      if (r.request_token === old) r.request_token = token;
    details[req.id] = {
      raw_text: iName(req.product_id),
      intent: { ...intent },
      revision: 1,
      submission_key: randomUUID(),
    };
  }
  for (let i = 3; i < 6; i++) {
    const shop: Shop = {
      ...shops[0],
      id: `m-neighbor-${i}`,
      name: ["", "", "", "Corner Foods", "Daily Needs", "Annapurna Stores"][i],
      user_id: randomUUID(),
      latitude: 12.9716 + i * 0.001,
      longitude: 77.6412,
      owner_name: "Demo merchant",
    };
    shops.push(shop);
    s.merchants.push(shop);
    for (let n = 0; n < 3; n++) {
      const { request } = s.createDemandRequest({
        merchant_id: shop.id,
        product_id: "prod-millet",
        quantity: 1,
        max_retail_price_paise: 0,
        required_by_date: "",
        reason_unavailable: "not_stocked",
        can_wait: false,
      });
      details[request.id] = {
        raw_text:
          n % 2 ? "100 gram Masala Millet Crunch" : "Millet Crunch Masala 100g",
        intent: { ...intent, budget_paise: null },
        revision: 1,
        submission_key: randomUUID(),
      };
    }
  }
  for (const q of s.quotes) q.created_by_shop = "m-sharma-001";
  s.auditEvents = [];
  s.merchants = shops;
  return {
    revision: 0,
    state: s.exportState(),
    shops,
    details,
    receipts: [],
    submissions: {},
  };
}
function iName(id: string) {
  return id === "prod-millet" ? "Millet Crunch Masala 100g" : id;
}
export function storeFor(n: Network) {
  const s = new MemoryStore(false);
  s.hydrate(n.state);
  s.merchants = n.shops;
  s.eligibleMerchantIdsForQuote = (q) => {
    const origin = n.shops.find(
      (m) => m.id === (q.created_by_shop || "m-sharma-001"),
    );
    return new Set(
      n.shops
        .filter(
          (m) =>
            m.id === origin?.id ||
            (origin &&
              origin.sharing &&
              m.sharing &&
              origin.location_accuracy === "confirmed" &&
              m.location_accuracy === "confirmed" &&
              distanceMeters(origin, m) <= 1500),
        )
        .map((m) => m.id),
    );
  };
  return s;
}
export function ownRequest(s: MemoryStore, shopId: string, id: string) {
  const r = s.requests.find((r) => r.id === id && r.merchant_id === shopId);
  if (!r) throw new Error("NOT_FOUND");
  return r;
}
export function fingerprint(s: MemoryStore, id: string) {
  const q = s.getQuoteById(id);
  const e = s.evaluateQuote(id);
  return hash(
    JSON.stringify({
      q,
      selected: [...(e.selected_reservation_ids || [])].sort(),
      alloc: e.allocations
        .map((a) => [
          a.merchant_id,
          a.allocated_units,
          a.total_exposure_paise,
          a.cash_cap_paise,
        ])
        .sort(),
      participants: s.merchants
        .filter((m) => e.allocations.some((a) => a.merchant_id === m.id))
        .map((m) => [m.id, [...m.allowed_suppliers].sort()])
        .sort(),
      reservations: s.reservations
        .filter((r) => e.selected_reservation_ids?.includes(r.id))
        .map((r) => [
          r.id,
          r.quantity,
          r.confirmed_price_paise,
          s.offers.find((o) => o.id === r.offer_id)?.pickup_deadline,
          s.requests.find((q) => q.id === r.request_id)?.max_retail_price_paise,
        ])
        .sort(),
    }),
  );
}
export function merchantView(n: Network, shopId: string): MerchantView {
  const s = storeFor(n),
    shop = n.shops.find((m) => m.id === shopId);
  if (!shop) throw new Error("NOT_FOUND");
  const mine = s.requests.filter((r) => r.merchant_id === shopId);
  const requests = mine.map((r) => ({
    ...r,
    product: s.products.find((p) => p.id === r.product_id)!,
    detail: n.details[r.id] || null,
    offer: s.offers.find((o) => o.request_token === r.request_token)
      ? {
          token: r.request_token,
          price: s.offers.find((o) => o.request_token === r.request_token)!
            .proposed_price_paise,
          deadline: s.offers.find((o) => o.request_token === r.request_token)!
            .pickup_deadline,
        }
      : null,
  }));
  const productGroups = new Map<
    string,
    { product: (typeof s.products)[number]; ids: Set<string> }
  >();
  for (const p of s.products) {
    const identity = productIdentity(n, p.id);
    const key = identity ? identityKey(identity) : p.id;
    const group = productGroups.get(key);
    if (group) group.ids.add(p.id);
    else productGroups.set(key, { product: p, ids: new Set([p.id]) });
  }
  const nearby = [...productGroups.values()].flatMap(({ product: p, ids }) => {
    const recent = s.requests.filter(
      (r) =>
        ids.has(r.product_id) &&
        Date.parse(r.created_at) > Date.now() - 7 * 86400000,
    );
    const own = recent.filter((r) => r.merchant_id === shopId);
    const peers = recent.filter((r) => {
      const m = n.shops.find((m) => m.id === r.merchant_id);
      return (
        m &&
        m.id !== shopId &&
        m.sharing &&
        m.location_accuracy === "confirmed" &&
        shop.location_accuracy === "confirmed" &&
        distanceMeters(shop, m) <= 1500
      );
    });
    const shops = new Set(peers.map((r) => r.merchant_id)).size;
    if (!own.length && !peers.length) return [];
    if (shops < 3 && !own.length) return [];
    const count = peers.length,
      low = Math.floor(count / 5) * 5;
    return [
      {
        key: p.id,
        name: p.name,
        pack: p.pack_size,
        own_requests: own.length,
        own_units: own.reduce((a, r) => a + r.quantity, 0),
        peer_band: shops >= 3 ? `${low}–${low + 4}` : null,
        shops: shops >= 3 ? shops : 0,
        radius: 1500,
        window_days: 7,
        suppressed: shops < 3,
      },
    ];
  });
  const quotes: QuoteView[] = s.quotes
    .filter(
      (q) =>
        mine.some(
          (r) => r.sku === q.sku && r.pack_size === q.pack_size && r.can_wait,
        ) && s.eligibleMerchantIdsForQuote!(q).has(shopId),
    )
    .map((q) => {
      const e = s.evaluateQuote(q.id),
        own = e.allocations.find((a) => a.merchant_id === shopId) || null;
      const current = fingerprint(s, q.id);
      for (const a of e.allocations) {
        const approval = s
          .getApprovalsForQuote(q.id)
          .find(
            (x) => x.merchant_id === a.merchant_id && x.status === "APPROVED",
          );
        if (approval && approval.allocation_fingerprint !== current)
          a.approval_status = "INVALIDATED";
      }
      return {
        quote: { ...q, created_by_shop: undefined },
        can_edit: q.created_by_shop === shopId,
        product: s.products.find((p) => p.sku === q.sku)!,
        own,
        total_units: e.total_demand_units,
        eligible: e.is_eligible,
        checks: [
          { code: "cases", passed: e.moq_met },
          { code: "deadline", passed: e.arrives_in_time },
          { code: "expiry", passed: !e.is_expired },
          {
            code: "price",
            passed:
              e.rule_checks.find(
                (c) => c.rule === "Exact confirmed retail price",
              )?.passed === true,
          },
          {
            code: "group",
            passed: e.all_merchants_within_cap && e.all_suppliers_permitted,
          },
        ],
        fingerprint: current,
        approval_count: e.allocations.filter(
          (a) => a.approval_status === "APPROVED",
        ).length,
        participant_count: e.allocations.length,
        committed: s.orders.some((o) => o.quote_id === q.id),
      };
    });
  const orders: OrderView[] = s.orders
    .filter((o) => o.merchant_allocations.some((a) => a.merchant_id === shopId))
    .map((o) => {
      const a = o.merchant_allocations.find((a) => a.merchant_id === shopId)!,
        rs = s.reservations.filter(
          (r) =>
            r.merchant_id === shopId &&
            (o.selected_reservation_ids?.includes(r.id) ??
              (r.sku === o.supplier_quote?.sku &&
                r.status !== "ACTIVE" &&
                r.status !== "CANCELLED")),
        );
      const collected = s.pickups.filter(
        (p) =>
          rs.some((r) => r.id === p.reservation_id) &&
          p.outcome === "COLLECTED",
      );
      const units = collected.reduce((v, p) => v + p.quantity, 0);
      return {
        id: o.id,
        reference: o.tracking_reference,
        product: s.products.find((p) => p.sku === o.supplier_quote?.sku)!,
        quantity: a.units,
        exposure: a.exposure_paise,
        collected_units: units,
        collected_cash: collected.reduce(
          (v, p) => v + p.total_collected_paise,
          0,
        ),
        remaining: a.units - units,
        received: n.receipts.includes(`${o.id}:${shopId}`),
        pickups: rs.map((r) => ({
          id: r.id,
          name:
            mine.find((q) => q.id === r.request_id)?.customer_name ||
            "Customer",
          phone:
            mine.find((q) => q.id === r.request_id)?.customer_phone || null,
          token: r.request_token,
          deadline: s.offers.find((o) => o.id === r.offer_id)!.pickup_deadline,
          quantity: r.quantity,
          price: r.confirmed_price_paise,
          can_no_show:
            Date.parse(
              s.offers.find((o) => o.id === r.offer_id)!.pickup_deadline,
            ) <= Date.now(),
          outcome:
            s.pickups.find((p) => p.reservation_id === r.id)?.outcome || null,
        })),
      };
    });
  return {
    shop,
    requests,
    nearby,
    quotes,
    orders,
    voice: !!process.env.SARVAM_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
    storage:
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
        ? "supabase"
        : "local",
  };
}
export function customerView(n: Network, token: string): CustomerView {
  const s = storeFor(n),
    data = s.getRequestByToken(token);
  if (!data) throw new Error("NOT_FOUND");
  const { request: r, offer: o, product: p, merchant: m } = data;
  const reserved = s.reservations.find(
    (x) => x.request_token === token && x.status !== "CANCELLED",
  );
  return {
    product: p.name,
    pack: p.pack_size,
    quantity: r.quantity,
    price: o.proposed_price_paise,
    shop: m.name,
    area: m.neighborhood,
    deadline: o.pickup_deadline,
    status: reserved?.status || r.status,
    can_confirm:
      !reserved &&
      r.status === "OFFER_CREATED" &&
      Date.parse(o.pickup_deadline) > Date.now(),
    can_cancel: reserved?.status === "ACTIVE",
  };
}
export function saveRequest(
  n: Network,
  shopId: string,
  body: Record<string, unknown>,
) {
  const s = storeFor(n),
    key = String(body.submission_key || "");
  if (!/^[a-f0-9-]{36}$/i.test(key)) throw new Error("INVALID_REQUEST");
  const previous = n.submissions[`${shopId}:${key}`];
  if (previous) return ownRequest(s, shopId, previous);
  const raw = String(body.raw_text || "").trim();
  if (!raw || raw.length > 1200) throw new Error("INVALID_REQUEST");
  const i = canonicalIdentity(parseIntent(body.intent));
  const qty = i.quantity ?? 1;
  if (typeof body.can_wait !== "boolean") throw new Error("INVALID_REQUEST");
  const willing = body.can_wait === true;
  const phone = normalizePhone(body.customer_phone);
  const canWait = willing && !!phone;
  if (phone && (!willing || body.contact_consent !== true))
    throw new Error("CONTACT_CONSENT_REQUIRED");
  if (
    body.confirm_in_store === true &&
    (!canWait || body.terms_accepted !== true)
  )
    throw new Error("CONFIRMATION_REQUIRED");
  if (canWait && (!i.size || !i.unit || !i.budget_paise || !i.deadline))
    throw new Error("OFFER_DETAILS_REQUIRED");
  const identity = productKey(i);
  let p = s.products.find((p) => {
    const stored = productIdentity(n, p.id);
    return stored
      ? identityKey(stored) === identity
      : p.intent_key === identity;
  });
  if (!p) {
    p = {
      id: `prod-${hash(identity).slice(0, 24)}`,
      sku: `INT-${hash(identity).slice(0, 24)}`,
      name: productLabel(i),
      category: i.category,
      pack_size: pack(i),
      standard_mrp_paise: 0,
      shelf_stable: false,
      created_at: new Date().toISOString(),
      intent_key: identity,
      canonical_identity: {
        product: i.product,
        brand: i.brand,
        variant: i.variant,
        size: i.size,
        unit: i.unit,
        packaging: i.packaging,
        hard_constraints: [...i.hard_constraints],
      },
    };
    s.products.push(p);
  }
  const deadline = i.deadline
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
        new Date(i.deadline),
      )
    : getFutureDateString(2);
  const { request, offer } = s.createDemandRequest({
    merchant_id: shopId,
    product_id: p.id,
    quantity: qty,
    max_retail_price_paise: i.budget_paise || 0,
    required_by_date: deadline,
    reason_unavailable: "not_stocked",
    can_wait: canWait,
    pickup_deadline: canWait ? i.deadline! : undefined,
    customer_name: String(body.customer_name || "").slice(0, 80) || undefined,
    customer_phone: canWait ? phone! : undefined,
  });
  if (offer) {
    if (Date.parse(i.deadline!) <= Date.now())
      throw new Error("INVALID_DEADLINE");
    offer.pickup_deadline = i.deadline!;
    const price =
      body.offer_price_paise === undefined
        ? i.budget_paise!
        : body.offer_price_paise;
    if (
      typeof price !== "number" ||
      !Number.isSafeInteger(price) ||
      price < 1 ||
      price > i.budget_paise!
    )
      throw new Error("INVALID_REQUEST");
    offer.proposed_price_paise = price;
  }
  n.details[request.id] = {
    raw_text: raw,
    intent: i,
    revision: 1,
    submission_key: key,
    willing_to_wait: willing,
    contact_consent: canWait,
    confirmation: null,
  };
  if (canWait && body.confirm_in_store === true) {
    s.confirmCustomerOffer(request.request_token);
    n.details[request.id].confirmation = {
      method: "in_store",
      at: new Date().toISOString(),
    };
    s.logAudit("RESERVATION", request.id, "IN_STORE_CONFIRMATION", {
      merchant_id: shopId,
      quantity: qty,
      price: offer!.proposed_price_paise,
      deadline: offer!.pickup_deadline,
    });
  }
  n.submissions[`${shopId}:${key}`] = request.id;
  n.state = s.exportState();
  return request;
}

export function normalizePhone(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    value.length > 30 ||
    !/^[+\d\s()-]+$/.test(value)
  )
    throw new Error("INVALID_PHONE");
  let digits = value.replace(/\D/g, "");
  if (digits.length === 10 && /^[6-9]/.test(digits)) digits = "91" + digits;
  else if (
    !value.trim().startsWith("+") &&
    !(digits.length === 12 && digits.startsWith("91"))
  )
    throw new Error("INVALID_PHONE");
  if (!/^[1-9]\d{7,14}$/.test(digits)) throw new Error("INVALID_PHONE");
  return digits;
}
