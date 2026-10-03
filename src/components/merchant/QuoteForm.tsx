"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { MerchantView, QuoteView } from "@/lib/product/types";
import { Modal } from "./common";
export default function QuoteForm({
  data,
  initial,
  close,
  save,
}: {
  data: MerchantView;
  initial: QuoteView | null;
  close: () => void;
  save: (b: Record<string, unknown>) => Promise<boolean>;
}) {
  const t = useTranslations(),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  const q = initial?.quote;
  const products = Array.from(
    new Map(data.requests.map((r) => [r.product.id, r.product])).values(),
  );
  const localDate = (s?: string) =>
    s
      ? new Date(Date.parse(s) - new Date(s).getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16)
      : "";
  return (
    <Modal title={t(q ? "editQuote" : "addQuote")} close={close}>
      {error && (
        <p className="error" role="alert">
          {t("errorGeneric")}
        </p>
      )}
      <p className="note">{t("quoteHint")}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(false);
          const f = new FormData(e.currentTarget);
          const cents = (key: string) => Math.round(Number(f.get(key)) * 100);
          try {
            const result = await save({
              action: "quote",
              quote_id: q?.id,
              product_id: f.get("product"),
              supplier: f.get("supplier"),
              unit_paise: cents("cost"),
              moq: Number(f.get("moq")),
              transport_paise: cents("transport"),
              handling_paise: cents("handling"),
              delivery: new Date(String(f.get("delivery"))).toISOString(),
              expiry: new Date(String(f.get("expiry"))).toISOString(),
            });
            if (result) close();
            else setError(true);
          } catch {
            setError(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          {t("quoteProduct")}
          <select name="product" defaultValue={initial?.product.id} required>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.pack_size}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("supplier")}
          <input
            name="supplier"
            defaultValue={q?.supplier_name}
            required
            maxLength={100}
          />
        </label>
        <div className="form-grid">
          <label>
            {t("unitCost")}
            <input
              name="cost"
              type="number"
              min="0.01"
              step="0.01"
              defaultValue={q ? q.unit_cost_paise / 100 : undefined}
              required
            />
          </label>
          <label>
            {t("caseSize")}
            <input
              name="moq"
              type="number"
              min="1"
              max="10000"
              defaultValue={q?.moq}
              required
            />
          </label>
          <label>
            {t("transport")}
            <input
              name="transport"
              type="number"
              min="0"
              step="0.01"
              defaultValue={q ? q.transport_cost_paise / 100 : 0}
              required
            />
          </label>
          <label>
            {t("handling")}
            <input
              name="handling"
              type="number"
              min="0"
              step="0.01"
              defaultValue={q ? q.handling_cost_paise / 100 : 0}
              required
            />
          </label>
          <label>
            {t("delivery")}
            <input
              name="delivery"
              type="datetime-local"
              defaultValue={localDate(q?.expected_delivery_date)}
              required
            />
          </label>
          <label>
            {t("expiry")}
            <input
              name="expiry"
              type="datetime-local"
              defaultValue={localDate(q?.quote_expiry_date)}
              required
            />
          </label>
        </div>
        <button className="button full" disabled={busy}>
          {t("saveQuote")}
        </button>
      </form>
    </Modal>
  );
}
