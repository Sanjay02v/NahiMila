"use client";
import { useEffect, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import { ShoppingBag, X, Copy, MessageCircle } from "lucide-react";
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
export function WhatsAppAction({
  phone,
  message,
  label,
}: {
  phone: string;
  message: () => string;
  label: string;
}) {
  return (
    <button
      className="button secondary small"
      onClick={() =>
        window.open(
          `https://wa.me/${phone}?text=${encodeURIComponent(message())}`,
          "_blank",
          "noopener,noreferrer",
        )
      }
    >
      <MessageCircle size={15} />
      {label}
    </button>
  );
}
export function OfferActions({
  token,
  phone,
  pending,
  message,
  onNotice,
}: {
  token: string;
  phone?: string;
  pending: boolean;
  message: (link: string) => string;
  onNotice: (s: string) => void;
}) {
  const t = useTranslations();
  return (
    <div className="demand-share">
      <button
        className="button secondary small"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(
              `${window.location.origin}/confirm/${token}`,
            );
            onNotice(t("copied"));
          } catch {
            onNotice(t("copyFailed"));
          }
        }}
      >
        <Copy size={15} />
        {t(pending ? "copyConfirmation" : "copyDetails")}
      </button>
      {phone && (
        <WhatsAppAction
          phone={phone}
          label={t("shareWhatsApp")}
          message={() => message(`${window.location.origin}/confirm/${token}`)}
        />
      )}
    </div>
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
