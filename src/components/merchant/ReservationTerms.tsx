"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { PrivateRequest } from "@/lib/product/types";
import { manualDraft } from "@/lib/product/intent";
import {
  dayFromDeadline,
  deadlineFromDay,
  phoneNumber,
} from "@/lib/product/capture-fields";
import { itemFields, reviewItemFields } from "@/lib/product/item-review";
import { api, Modal } from "./common";
export default function ReservationTerms({
  request,
  close,
  busy,
  mutate,
}: {
  request: PrivateRequest;
  close: () => void;
  busy: boolean;
  mutate: (b: Record<string, unknown>) => Promise<boolean>;
}) {
  const t = useTranslations(),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false);
  const preparing = ["WAITING_INTEREST", "MISSED_DEMAND"].includes(
      request.status,
    ),
    base = request.detail?.intent || manualDraft(request.product.name);
  const initial = itemFields(base);
  const [item, setItem] = useState(initial.item),
    [variant, setVariant] = useState(initial.variant),
    [pack, setPack] = useState(initial.pack);
  return (
    <Modal title={t(preparing ? "prepareOffer" : "reviseTerms")} close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setWorking(true);
          const f = new FormData(e.currentTarget);
          let failure = "itemReviewRetry";
          try {
            const i = await reviewItemFields(
              { item, variant, pack },
              base,
              async (value) =>
                (await api("/api/intent", { raw_text: value })).intent,
            );
            if (!i.size || !i.unit) throw new Error("ITEM_DETAILS");
            const price = Math.round(Number(f.get("price")) * 100);
            if (!Number.isSafeInteger(price) || price < 1)
              throw new Error("PRICE");
            const budget = String(f.get("budget") || "")
              ? Math.round(Number(f.get("budget")) * 100)
              : null;
            if (budget && price > budget) throw new Error("BUDGET");
            failure = "pickupDateFix";
            const deadline = deadlineFromDay(String(f.get("deadline") || ""));
            if (!deadline || Date.parse(deadline) <= Date.now())
              throw new Error("DATE");
            failure = "phoneFix";
            if (!phoneNumber(String(f.get("phone") || "")))
              throw new Error("PHONE");
            failure = "reviewFailure";
            const quantity = Number(f.get("quantity"));
            const result = await mutate({
              action: preparing ? "prepare_offer" : "revise_offer",
              request_id: request.id,
              token: request.request_token,
              quantity,
              price_paise: price,
              budget_paise: budget,
              deadline,
              intent: { ...i, quantity, budget_paise: budget, deadline },
              customer_phone: f.get("phone"),
              contact_consent: true,
            });
            if (result) close();
            else setError(t("reviewFailure"));
          } catch (e) {
            const code = e instanceof Error ? e.message : "";
            setError(
              t(
                code === "PACK_INVALID"
                  ? "packFix"
                  : code === "ITEM_DETAILS"
                    ? "whichPackHint"
                    : code === "PRICE"
                      ? "priceFix"
                      : code === "BUDGET"
                        ? "budgetFix"
                        : failure,
              ),
            );
          } finally {
            setWorking(false);
          }
        }}
      >
        <p className="fine">{t("simpleOfferHint")}</p>
        <label>
          {t("itemLabel")}
          <input
            value={item}
            onChange={(e) => setItem(e.target.value)}
            maxLength={300}
            required
          />
        </label>
        <label>
          {t("variant")}
          <input
            value={variant}
            onChange={(e) => setVariant(e.target.value)}
            maxLength={120}
            placeholder={t("simpleVariantExample")}
          />
        </label>
        <label>
          {t("packLabel")}
          <input
            value={pack}
            onChange={(e) => setPack(e.target.value)}
            maxLength={120}
            placeholder={t("whichPackExample")}
            required
            aria-describedby="pack-hint"
          />
          <small id="pack-hint" className="fine">
            {t("whichPackHint")}
          </small>
        </label>
        <div className="form-grid">
          <label>
            {t("quantity")}
            <input
              name="quantity"
              type="number"
              min="1"
              max="100"
              defaultValue={request.quantity}
              required
            />
          </label>
          <label>
            {t("sellingPrice")}
            <input
              name="price"
              type="number"
              min="0.01"
              step="0.01"
              defaultValue={request.offer ? request.offer.price / 100 : ""}
              required
            />
          </label>
        </div>
        <label>
          {t("expectedPickupDate")}
          <input
            name="deadline"
            type="date"
            defaultValue={dayFromDeadline(
              request.offer?.deadline || base.deadline,
            )}
            required
          />
        </label>
        <label>
          {t("customerPhoneRequired")}
          <input
            name="phone"
            type="tel"
            defaultValue={
              request.customer_phone ? `+${request.customer_phone}` : ""
            }
            maxLength={30}
            required
          />
        </label>
        <p className="fine">{t("contactUseNote")}</p>
        {base.budget_paise && (
          <details className="details">
            <summary>
              {t("customerBudget", { price: base.budget_paise / 100 })}
            </summary>
            <label>
              {t("preferredBudget")}
              <input
                name="budget"
                type="number"
                min="0.01"
                step="0.01"
                defaultValue={base.budget_paise / 100}
              />
            </label>
          </details>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="note">{t("offerNextHint")}</p>
        <button className="button full" disabled={busy || working}>
          {t("saveOffer")}
        </button>
      </form>
    </Modal>
  );
}
