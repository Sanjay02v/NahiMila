"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { ShoppingBag, X, ArrowUpRight } from "lucide-react";
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-icon">
        <ShoppingBag size={22} />
      </span>
      Nahi<span>Mila</span>
      <i />
    </span>
  );
}
export function Money({ value }: { value: number }) {
  const locale = useLocale();
  return (
    <>
      {new Intl.NumberFormat(`${locale}-IN`, {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
      }).format(value / 100)}
    </>
  );
}
export function Modal({
  title,
  children,
  close,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
  className?: string;
}) {
  const t = useTranslations(),
    ref = useRef<HTMLDivElement>(null),
    closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const nodes = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),textarea,select,a[href]",
          ) || [],
        );
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        tabIndex={-1}
      >
        <header>
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label={t("close")}
            onClick={close}
          >
            <X />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export async function api(url: string, payload?: unknown) {
  const r = await fetch(url, {
    method: payload ? "POST" : "GET",
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
    cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "UNKNOWN");
  return j;
}
function OfferQr({ token }: { token: string }) {
  const ref = useRef<HTMLCanvasElement>(null),
    [error, setError] = useState(false),
    t = useTranslations();
  useEffect(() => {
    let active = true;
    import("qrcode")
      .then((q) =>
        q.toCanvas(ref.current!, `${window.location.origin}/confirm/${token}`, {
          width: 240,
          margin: 2,
          errorCorrectionLevel: "M",
        }),
      )
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [token]);
  return (
    <div className="offer-qr">
      <canvas ref={ref} role="img" aria-label={t("showQr")} />
      {error && <p className="error">{t("errorGeneric")}</p>}
      <p>{t("offerHint")}</p>
    </div>
  );
}
export function OfferActions({
  token,
  onNotice,
}: {
  token: string;
  onNotice: (s: string) => void;
}) {
  const t = useTranslations(),
    [qr, setQr] = useState(false);
  return (
    <>
      <div className="offer-actions">
        <span>{t("offerReady")}</span>
        <div>
          <button
            className="button secondary small"
            onClick={() => setQr(true)}
          >
            {t("showQr")}
          </button>
          <button
            className="button secondary small"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  `${window.location.origin}/confirm/${token}`,
                );
                onNotice(t("copied"));
              } catch {
                window.open(
                  `/confirm/${token}`,
                  "_blank",
                  "noopener,noreferrer",
                );
              }
            }}
          >
            {t("copy")}
          </button>
          <a
            className="button secondary small"
            href={`/confirm/${token}`}
            target="_blank"
            rel="noreferrer"
          >
            {t("preview")}
            <ArrowUpRight size={14} />
          </a>
        </div>
      </div>
      {qr && (
        <Modal title={t("offerReady")} close={() => setQr(false)}>
          <OfferQr token={token} />
        </Modal>
      )}
    </>
  );
}
export function Language({ persistShop = false }: { persistShop?: boolean }) {
  const t = useTranslations(),
    locale = useLocale();
  return (
    <label className="language-control">
      <span className="sr-only">{t("language")}</span>
      <select
        value={locale}
        onChange={async (e) => {
          await api("/api/locale", {
            locale: e.target.value,
            persist_shop: persistShop,
          });
          window.location.reload();
        }}
      >
        <option value="en">English</option>
        <option value="kn">ಕನ್ನಡ</option>
        <option value="hi">हिन्दी</option>
      </select>
    </label>
  );
}
