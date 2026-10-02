"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Check, ShoppingBag, ShieldCheck } from "lucide-react";
import type { CustomerView } from "@/lib/product/types";
import { api, Brand, Language, Money } from "./common";
export default function Customer({ token }: { token: string }) {
  const t = useTranslations(),
    locale = useLocale(),
    [data, setData] = useState<CustomerView | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setData(await api(`/api/customer/${encodeURIComponent(token)}`));
    } catch {
      setError(t("invalidOffer"));
    }
  }, [token, t]);
  useEffect(() => {
    const timer = setTimeout(refresh, 0);
    return () => clearTimeout(timer);
  }, [refresh]);
  const act = async (action: string) => {
    setBusy(true);
    setError("");
    try {
      setData(
        await api(`/api/customer/${encodeURIComponent(token)}`, { action }),
      );
    } catch {
      setError(t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="customer-page">
      <header>
        <Brand />
        <Language />
      </header>
      <main>
        <div className="customer-symbol">
          <ShoppingBag size={38} />
        </div>
        <span className="eyebrow">{t("customerTitle")}</span>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {data ? (
          <>
            <h1>{data.product}</h1>
            <p className="customer-pack">
              {data.pack} · {data.quantity} {t("units")}
            </p>
            <dl className="customer-details">
              <div>
                <dt>{t("price")}</dt>
                <dd>
                  <Money value={data.price} />
                </dd>
              </div>
              <div>
                <dt>{t("pickupShop")}</dt>
                <dd>
                  {data.shop}
                  <small>{data.area}</small>
                </dd>
              </div>
              <div>
                <dt>{t("pickupBy")}</dt>
                <dd>
                  {new Intl.DateTimeFormat(`${locale}-IN`, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                    timeZone: "Asia/Kolkata",
                  }).format(new Date(data.deadline))}
                </dd>
              </div>
            </dl>
            <p className="note">
              <ShieldCheck size={19} />
              {t("conditional")}
            </p>
            {data.can_confirm ? (
              <button
                className="button full"
                disabled={busy}
                onClick={() => act("confirm")}
              >
                <Check size={19} />
                {t("confirmOffer")}
              </button>
            ) : (
              <p className="confirmation">
                <Check size={20} />
                {t(
                  data.status === "FULFILLED"
                    ? "collected"
                    : data.status === "NO_SHOW"
                      ? "noShow"
                      : data.status === "CANCELLED"
                        ? "withdrawn"
                        : data.status === "OFFER_CREATED"
                          ? "invalidOffer"
                          : "confirmationDone",
                )}
              </p>
            )}
            {data.can_cancel && (
              <button
                className="text-button full"
                disabled={busy}
                onClick={() => act("cancel")}
              >
                {t("withdraw")}
              </button>
            )}
          </>
        ) : (
          !error && <p>{t("loading")}</p>
        )}
        <footer>{t("customerDemo")}</footer>
      </main>
    </div>
  );
}
