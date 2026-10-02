"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { PrivateRequest } from "@/lib/product/types";
import { manualDraft } from "@/lib/product/intent";
import {
  dayFromDeadline,
  deadlineFromDay,
  detailsText,
  withDetails,
} from "@/lib/product/capture-fields";
import { Modal } from "./common";
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
    [error, setError] = useState(false);
  const preparing = request.status === "WAITING_INTEREST",
    base = request.detail?.intent || manualDraft(request.product.name);
  return (
    <Modal title={t(preparing ? "prepareOffer" : "reviseTerms")} close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            deadline = deadlineFromDay(String(f.get("deadline"))),
            quantity = Number(f.get("quantity")),
            budget = String(f.get("budget") || "")
              ? Math.round(Number(f.get("budget")) * 100)
              : null;
          const i = withDetails(
            {
              ...base,
              product: String(f.get("product")),
              brand: String(f.get("brand") || "") || null,
              quantity,
              budget_paise: budget,
              deadline,
            },
            String(f.get("details") || ""),
          );
          const result = await mutate({
            action: preparing ? "prepare_offer" : "revise_offer",
            request_id: request.id,
            token: request.request_token,
            quantity,
            price_paise: Math.round(Number(f.get("price")) * 100),
            budget_paise: budget,
            deadline,
            intent: i,
            customer_phone: f.get("phone"),
            contact_consent: true,
          });
          if (result) close();
          else setError(true);
        }}
      >
        {error && (
          <p className="error" role="alert">
            {t("offerReviewFailure")}
          </p>
        )}
        <p className="note">
          {t(preparing ? "prepareOfferHint" : "reconfirmHint")}
        </p>
        <div className="form-grid">
          <label className="span-two">
            {t("product")}
            <input
              name="product"
              defaultValue={base.product}
              maxLength={160}
              required
            />
          </label>
          <label>
            {t("brandName")}
            <input
              name="brand"
              defaultValue={base.brand || ""}
              maxLength={120}
            />
          </label>
          <label>
            {t("variantDetails")}
            <input
              name="details"
              defaultValue={detailsText(base)}
              placeholder={t("variantExample")}
              maxLength={120}
            />
          </label>
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
            {t("offerPrice")}
            <input
              name="price"
              type="number"
              min="0.01"
              step="0.01"
              defaultValue={request.offer ? request.offer.price / 100 : ""}
              required
            />
          </label>
          <label>
            {t("preferredBudget")}
            <input
              name="budget"
              type="number"
              min="0.01"
              step="0.01"
              defaultValue={base.budget_paise ? base.budget_paise / 100 : ""}
            />
          </label>
          <label>
            {t("offerPickupDate")}
            <input
              name="deadline"
              type="date"
              defaultValue={dayFromDeadline(
                request.offer?.deadline || base.deadline,
              )}
              required
            />
          </label>
        </div>
        <p className="fine">{t("offerSpecHint")}</p>
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
        <button className="button full" disabled={busy}>
          {t(preparing ? "prepareOffer" : "saveNewTerms")}
        </button>
      </form>
    </Modal>
  );
}
