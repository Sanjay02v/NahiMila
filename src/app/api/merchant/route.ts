import { verifiedLocation } from "@/lib/product/location";
import { isDemoShop } from "@/lib/product/demo-identity";
import { resetJudgeDemo } from "@/lib/product/demo";
import { canonicalIdentity } from "@/lib/product/canonical";
import { parseIntent } from "@/lib/product/intent";
import { actor, shopActor } from "@/lib/product/auth";
import { withNetwork } from "@/lib/product/repository";
import {
  merchantView,
  storeFor,
  saveRequest,
  ownRequest,
  fingerprint,
  normalizePhone,
  ensureProduct,
} from "@/lib/product/network";
import { body, failure, ok, text, integer } from "@/lib/product/http";
import { locales, type Locale, type Shop } from "@/lib/product/types";
export const runtime = "nodejs";
export async function GET() {
  try {
    const shop = await shopActor();
    return ok(await withNetwork((n) => merchantView(n, shop.id)));
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    const b = await body(req);
    const user = await actor();
    return ok(
      await withNetwork(async (n) => {
        let shop = n.shops.find((s) => s.user_id === user);
        if (b.shop_id !== undefined || b.merchant_id !== undefined)
          throw new Error("FORBIDDEN");
        if (b.action === "onboard") {
          if (shop) throw new Error("ALREADY_ONBOARDED");
          const { latitude, longitude, address } = verifiedLocation(b);
          if (!locales.includes(b.locale as Locale))
            throw new Error("INVALID_REQUEST");
          shop = {
            id: crypto.randomUUID(),
            user_id: user,
            name: text(b.name, 100),
            owner_name: text(b.owner_name, 100),
            neighborhood: address.slice(0, 100),
            address,
            contact_phone: "",
            cash_cap_paise: 35000,
            allowed_suppliers: n.state.suppliers.map((s) => s.id),
            created_at: new Date().toISOString(),
            locale: b.locale as Locale,
            latitude,
            longitude,
            location_accuracy: "confirmed",
            sharing: b.sharing === true,
          } satisfies Shop;
          n.shops.push(shop);
          n.state.merchants = n.shops;
          return merchantView(n, shop.id);
        }
        if (!shop) throw new Error("ONBOARDING_REQUIRED");
        if (b.action === "reset_demo") {
          if (!isDemoShop(shop.id)) throw new Error("FORBIDDEN");
          if (b.confirm !== true) throw new Error("INVALID_REQUEST");
          resetJudgeDemo(n);
          return merchantView(n, shop.id);
        }
        const s = storeFor(n);
        switch (b.action) {
          case "create":
            saveRequest(n, shop.id, b);
            break;
          case "profile": {
            const location = verifiedLocation(b);
            shop.owner_name = text(b.owner_name, 100);
            shop.name = text(b.name, 100);
            const moved = shop.latitude !== location.latitude || shop.longitude !== location.longitude;
            Object.assign(shop, location, { neighborhood: location.address.slice(0, 100), location_accuracy: "confirmed" });
            if (moved) s.invalidateAllApprovals("Shop location changed");
            n.state = s.exportState();
            break;
          }
          case "settings": {
            if (b.locale !== undefined) {
              if (!locales.includes(b.locale as Locale))
                throw new Error("INVALID_REQUEST");
              shop.locale = b.locale as Locale;
            }
            if (b.cap_paise !== undefined)
              s.updateMerchantCashCap(shop.id, integer(b.cap_paise));
            if (b.sharing !== undefined) {
              if (typeof b.sharing !== "boolean")
                throw new Error("INVALID_REQUEST");
              if (shop.sharing !== b.sharing) s.invalidateAllApprovals("Shop sharing changed");
              shop.sharing = b.sharing;
            }
            n.state = s.exportState();
            break;
          }
          case "confirm_in_store": {
            const r = ownRequest(s, shop.id, text(b.request_id, 100));
            const o = s.offers.find((o) => o.request_token === r.request_token);
            if (
              !o ||
              !r.customer_phone ||
              n.details[r.id]?.contact_consent !== true ||
              b.terms_accepted !== true
            )
              throw new Error("CONFIRMATION_REQUIRED");
            if (
              b.quantity !== r.quantity ||
              b.price_paise !== o.proposed_price_paise ||
              b.deadline !== o.pickup_deadline
            )
              throw new Error("CONFLICT");
            if (
              r.status !== "OFFER_CREATED" &&
              r.status !== "CUSTOMER_CONFIRMED"
            )
              throw new Error("INVALID_REQUEST");
            const result = s.confirmCustomerOffer(r.request_token);
            if (!result.isDuplicate) {
              n.details[r.id].confirmation = {
                method: "in_store",
                at: new Date().toISOString(),
              };
              s.logAudit(
                "RESERVATION",
                result.reservation.id,
                "IN_STORE_CONFIRMATION",
                {
                  merchant_id: shop.id,
                  quantity: r.quantity,
                  price: o.proposed_price_paise,
                  deadline: o.pickup_deadline,
                },
              );
            }
            n.state = s.exportState();
            break;
          }
          case "add_contact": {
            const r = ownRequest(s, shop.id, text(b.request_id, 100));
            if (b.token !== r.request_token) throw new Error("CONFLICT");
            if (
              ![
                "OFFER_CREATED",
                "CUSTOMER_CONFIRMED",
                "READY_FOR_PICKUP",
                "SUPPLIER_COMMITTED",
              ].includes(r.status)
            )
              throw new Error("INVALID_REQUEST");
            const phone = normalizePhone(b.customer_phone);
            if (!phone || b.contact_consent !== true)
              throw new Error("CONTACT_CONSENT_REQUIRED");
            if (r.customer_phone && r.customer_phone !== phone)
              throw new Error("CONFLICT");
            const detail = n.details[r.id];
            if (!detail) throw new Error("INVALID_REQUEST");
            r.customer_phone = phone;
            detail.contact_consent = true;
            r.updated_at = new Date().toISOString();
            s.logAudit("REQUEST", r.id, "CONTACT_ADDED", {
              merchant_id: shop.id,
              contact_consent: true,
            });
            n.state = s.exportState();
            break;
          }
          case "prepare_offer":
          case "revise_offer": {
            const r = ownRequest(s, shop.id, text(b.request_id, 100));
            const old = s.offers.find(
              (o) => o.request_token === r.request_token,
            );
            const preparing = b.action === "prepare_offer";
            if (
              preparing
                ? !["WAITING_INTEREST", "MISSED_DEMAND"].includes(r.status)
                : !old ||
                  !["OFFER_CREATED", "CUSTOMER_CONFIRMED"].includes(r.status)
            )
              throw new Error("INVALID_REQUEST");
            if (b.token !== r.request_token) throw new Error("CONFLICT");
            const phone = normalizePhone(b.customer_phone ?? r.customer_phone);
            if (!phone || b.contact_consent !== true)
              throw new Error("CONTACT_CONSENT_REQUIRED");
            const quantity = integer(b.quantity, 1, 100),
              price = integer(b.price_paise, 1),
              budget =
                b.budget_paise === null || b.budget_paise === undefined
                  ? null
                  : integer(b.budget_paise, 1),
              deadline = text(b.deadline, 50);
            if (budget && price > budget) throw new Error("INVALID_REQUEST");
            if (
              !Number.isFinite(Date.parse(deadline)) ||
              Date.parse(deadline) <= Date.now()
            )
              throw new Error("INVALID_DEADLINE");
            const d = n.details[r.id];
            if (!d) throw new Error("INVALID_REQUEST");
            const i = canonicalIdentity(
              parseIntent(
                b.intent ?? {
                  ...d.intent,
                  quantity,
                  budget_paise: budget,
                  deadline,
                },
              ),
            );
            if (!i.size || !i.unit) throw new Error("OFFER_DETAILS_REQUIRED");
            const active = s.reservations.find(
              (x) =>
                x.request_token === r.request_token && x.status !== "CANCELLED",
            );
            if (active && active.status !== "ACTIVE")
              throw new Error("INVALID_REQUEST");
            if (active)
              s.cancelCustomerReservation(
                r.request_token,
                "Customer terms changed; confirmation required again",
              );
            s.invalidateAllApprovals("Customer terms changed");
            const product = ensureProduct(n, s, i),
              token = `NML-${crypto.randomUUID()}`;
            Object.assign(r, {
              product_id: product.id,
              sku: product.sku,
              pack_size: product.pack_size,
              quantity,
              max_retail_price_paise: budget || price,
              required_by_date: new Intl.DateTimeFormat("en-CA", {
                timeZone: "Asia/Kolkata",
              }).format(new Date(deadline)),
              customer_phone: phone,
              request_token: token,
              can_wait: true,
              status: "OFFER_CREATED",
              updated_at: new Date().toISOString(),
            });
            s.offers.push({
              id: `off-${crypto.randomUUID()}`,
              request_id: r.id,
              request_token: token,
              proposed_price_paise: price,
              pickup_merchant_id: shop.id,
              pickup_deadline: deadline,
              is_conditional: true,
              created_at: new Date().toISOString(),
            });
            d.revision += 1;
            d.confirmation = null;
            d.contact_consent = true;
            d.willing_to_wait = true;
            d.intent = { ...i, quantity, budget_paise: budget, deadline };
            s.logAudit(
              "REQUEST",
              r.id,
              preparing ? "OFFER_PREPARED" : "TERMS_REVISED",
              { merchant_id: shop.id, quantity, price, deadline },
            );
            n.state = s.exportState();
            break;
          }
          case "cancel": {
            const r = ownRequest(s, shop.id, text(b.request_id, 100));
            if (
              r.status === "OFFER_CREATED" ||
              r.status === "WAITING_INTEREST" ||
              r.status === "MISSED_DEMAND"
            ) {
              r.status = "CANCELLED";
              r.updated_at = new Date().toISOString();
              s.logAudit("REQUEST", r.id, "PENDING_WITHDRAWN", {
                merchant_id: shop.id,
              });
            } else s.cancelCustomerReservation(r.request_token);
            n.state = s.exportState();
            break;
          }
          case "approve": {
            const qid = text(b.quote_id, 100),
              e = s.evaluateQuote(qid);
            if (!e.allocations.some((a) => a.merchant_id === shop!.id))
              throw new Error("NOT_FOUND");
            if (b.fingerprint !== fingerprint(s, qid))
              throw new Error("CONFLICT");
            const own = e.allocations.find((a) => a.merchant_id === shop!.id)!;
            s.recordMerchantApproval({
              merchant_id: shop.id,
              quote_id: qid,
              quote_version: e.quote_version,
              allocation_version: parseInt(
                String(b.fingerprint).slice(0, 8),
                16,
              ),
              allocation_fingerprint: String(b.fingerprint),
              exposure_paise: own.total_exposure_paise,
              approved: true,
            });
            n.state = s.exportState();
            break;
          }
          case "commit": {
            const qid = text(b.quote_id, 100),
              e = s.evaluateQuote(qid);
            if (
              !e.allocations.some((a) => a.merchant_id === shop!.id) &&
              !s.orders.some(
                (o) =>
                  o.quote_id === qid &&
                  o.merchant_allocations.some(
                    (a) => a.merchant_id === shop!.id,
                  ),
              )
            )
              throw new Error("NOT_FOUND");
            const existing = s.orders.find((o) => o.quote_id === qid);
            if (!existing) {
              if (b.fingerprint !== fingerprint(s, qid))
                throw new Error("CONFLICT");
              const v = fingerprint(s, qid);
              if (
                s
                  .getApprovalsForQuote(qid)
                  .some(
                    (a) =>
                      a.status === "APPROVED" && a.allocation_fingerprint !== v,
                  )
              )
                throw new Error("CONFLICT");
            }
            const order = await s.commitSupplierOrder(qid);
            if (!existing) {
              for (const a of order.merchant_allocations) {
                const owner = n.shops.find((m) => m.id === a.merchant_id)!;
                s.updateMerchantCashCap(
                  owner.id,
                  owner.cash_cap_paise - a.exposure_paise,
                );
              }
            }
            n.state = s.exportState();
            break;
          }
          case "receive": {
            const id = text(b.order_id, 100);
            if (
              !s.orders.some(
                (o) =>
                  o.id === id &&
                  o.merchant_allocations.some(
                    (a) => a.merchant_id === shop!.id,
                  ),
              )
            )
              throw new Error("NOT_FOUND");
            n.receipts = [...new Set([...n.receipts, `${id}:${shop.id}`])];
            break;
          }
          case "pickup": {
            const id = text(b.reservation_id, 100),
              r = s.reservations.find(
                (r) => r.id === id && r.merchant_id === shop!.id,
              ),
              order = s.orders.find((o) =>
                o.selected_reservation_ids?.includes(id),
              );
            if (!r || !order) throw new Error("NOT_FOUND");
            if (!n.receipts.includes(`${order.id}:${shop.id}`))
              throw new Error("RECEIVE_FIRST");
            if (b.outcome !== "COLLECTED" && b.outcome !== "NO_SHOW")
              throw new Error("INVALID_REQUEST");
            if (
              b.outcome === "NO_SHOW" &&
              Date.parse(
                s.offers.find((o) => o.id === r.offer_id)!.pickup_deadline,
              ) > Date.now()
            )
              throw new Error("PICKUP_WINDOW_OPEN");
            await s.recordPickup({ reservation_id: id, outcome: b.outcome });
            n.state = s.exportState();
            break;
          }
          case "quote": {
            const product = s.products.find((p) => p.id === b.product_id);
            if (
              !product ||
              !s.requests.some(
                (r) =>
                  r.product_id === product.id && r.merchant_id === shop!.id,
              )
            )
              throw new Error("NOT_FOUND");
            const old = b.quote_id
              ? s.getQuoteById(text(b.quote_id, 100))
              : undefined;
            if (old && old.created_by_shop !== shop.id)
              throw new Error("FORBIDDEN");
            const delivery = text(b.delivery, 50),
              expiry = text(b.expiry, 50);
            if (
              !Number.isFinite(Date.parse(delivery)) ||
              !Number.isFinite(Date.parse(expiry))
            )
              throw new Error("INVALID_DEADLINE");
            const supplierId =
              old?.supplier_id || `supplier-${crypto.randomUUID()}`;
            if (!old) {
              s.suppliers.push({
                id: supplierId,
                name: text(b.supplier, 100),
                contact_email: "",
                is_verified: false,
              });
              shop.allowed_suppliers.push(supplierId);
            }
            s.saveQuote({
              id: old?.id || `quote-${crypto.randomUUID()}`,
              supplier_id: supplierId,
              supplier_name: text(b.supplier, 100),
              sku: product.sku,
              pack_size: product.pack_size,
              unit_cost_paise: integer(b.unit_paise, 1),
              moq: integer(b.moq, 1, 10000),
              transport_cost_paise: integer(b.transport_paise),
              handling_cost_paise: integer(b.handling_paise),
              expected_delivery_date: delivery,
              quote_expiry_date: expiry,
              version: old?.version || 1,
              created_at: old?.created_at || new Date().toISOString(),
              updated_at: new Date().toISOString(),
              created_by_shop: shop.id,
            });
            n.state = s.exportState();
            break;
          }
          case "permission": {
            const supplier = text(b.supplier_id, 100);
            if (!s.suppliers.some((p) => p.id === supplier))
              throw new Error("NOT_FOUND");
            shop.allowed_suppliers =
              b.allowed === true
                ? [...new Set([...shop.allowed_suppliers, supplier])]
                : shop.allowed_suppliers.filter((x) => x !== supplier);
            s.invalidateAllApprovals("Supplier permission changed");
            n.state = s.exportState();
            break;
          }
          default:
            throw new Error("INVALID_REQUEST");
        }
        return merchantView(n, shop.id);
      }, b.action === "reset_demo" ? "demo-reset" : true),
    );
  } catch (e) {
    return failure(e);
  }
}
