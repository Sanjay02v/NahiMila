import { actor, shopActor } from "@/lib/product/auth";
import { withNetwork } from "@/lib/product/repository";
import {
  merchantView,
  storeFor,
  saveRequest,
  ownRequest,
  fingerprint,
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
          const latitude = b.latitude as number,
            longitude = b.longitude as number;
          if (
            typeof latitude !== "number" ||
            typeof longitude !== "number" ||
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            latitude < -90 ||
            latitude > 90 ||
            longitude < -180 ||
            longitude > 180
          )
            throw new Error("INVALID_LOCATION");
          if (!locales.includes(b.locale as Locale))
            throw new Error("INVALID_REQUEST");
          shop = {
            id: crypto.randomUUID(),
            user_id: user,
            name: text(b.name, 100),
            owner_name: "",
            neighborhood: text(b.area, 100),
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
        const s = storeFor(n);
        switch (b.action) {
          case "create":
            saveRequest(n, shop.id, b);
            break;
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
              shop.sharing = b.sharing;
            }
            n.state = s.exportState();
            break;
          }
          case "cancel": {
            const r = ownRequest(s, shop.id, text(b.request_id, 100));
            s.cancelCustomerReservation(r.request_token);
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
      }, true),
    );
  } catch (e) {
    return failure(e);
  }
}
