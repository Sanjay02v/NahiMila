"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
  const changing = useRef(false),
    refreshing = useRef(false),
    generation = useRef(0),
    sequence = useRef(0);
  const refresh = useCallback(async () => {
    if (changing.current || refreshing.current) return;
    refreshing.current = true;
    const version = generation.current,
      id = ++sequence.current;
    try {
      const result = await api(`/api/customer/${encodeURIComponent(token)}`);
      if (
        version !== generation.current ||
        id !== sequence.current ||
        changing.current
      )
        return;
      setData(result);
      setError("");
    } catch {
      if (
        version !== generation.current ||
        id !== sequence.current ||
        changing.current
      )
        return;
      setError(t("invalidOffer"));
    } finally {
      refreshing.current = false;
    }
  }, [token, t]);
  useEffect(() => {
    const timer = setTimeout(refresh, 0);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 3000);
    const focus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", focus);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);
  const act = async (action: string) => {
    if (changing.current) return;
    changing.current = true;
    generation.current++;
    setBusy(true);
    setError("");
    try {
      setData(
        await api(`/api/customer/${encodeURIComponent(token)}`, { action }),
      );
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel("nahimila-updates");
        channel.postMessage("changed");
        channel.close();
      }
    } catch {
      setError(t("errorGeneric"));
    } finally {
      changing.current = false;
      generation.current++;
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
