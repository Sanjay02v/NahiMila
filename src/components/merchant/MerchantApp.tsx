"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  ClipboardList,
  Home,
  MapPin,
  Mic,
  Package,
  Plus,
  Settings,
  ShieldCheck,
  ShoppingBag,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import { nearbyList, orderGroups } from "@/lib/product/list-view";
import type {
  MerchantView,
  QuoteView,
  NearbySignal,
} from "@/lib/product/types";
import { api, Brand, Language, Modal, Money, WhatsAppAction } from "./common";
import Access from "./Access";
import Capture from "./Capture";
import QuoteForm from "./QuoteForm";
import Agent from "./Agent";
import DemandBook from "./DemandBook";
import { quoteActions, quoteBlockers } from "@/lib/product/quote-actions";
type View = "home" | "requests" | "nearby" | "orders" | "settings";
const navigation = [
  { key: "home", icon: Home },
  { key: "requests", icon: ClipboardList },
  { key: "nearby", icon: MapPin },
  { key: "orders", icon: Package },
] as const;
function ProgressiveRows<T>({
  rows,
  render,
  step,
}: {
  rows: T[];
  render: (rows: T[]) => React.ReactNode;
  step: number;
}) {
  const [limit, setLimit] = useState(step),
    t = useTranslations();
  return (
    <>
      {render(rows.slice(0, limit))}
      {rows.length > limit && (
        <button
          className="button secondary list-more"
          onClick={() => setLimit((n) => n + step)}
        >
          {t("showMore")}
        </button>
      )}
    </>
  );
}
export default function MerchantApp() {
  const t = useTranslations(),
    locale = useLocale();
  const [data, setData] = useState<MerchantView | null>(null),
    [access, setAccess] = useState<"login" | "onboard" | null>(null),
    [nearbySearch, setNearbySearch] = useState(""),
    [orderSearch, setOrderSearch] = useState(""),
    [nearbyLimit, setNearbyLimit] = useState(10),
    [orderLimit, setOrderLimit] = useState(10),
    [view, setView] = useState<View>("home"),
    [capture, setCapture] = useState(false),
    [captureMode, setCaptureMode] = useState<"type" | "voice">("type"),
    [captureDraft, setCaptureDraft] = useState<{
      raw: string;
      can_wait: boolean | null;
    } | null>(null),
    [quote, setQuote] = useState(false),
    [editQuote, setEditQuote] = useState<QuoteView | null>(null),
    [selectedProduct, setSelectedProduct] = useState<string | null>(null),
    [selectedQuote, setSelectedQuote] = useState<string | null>(null),
    [agent, setAgent] = useState(false),
    [approval, setApproval] = useState<QuoteView | null>(null),
    [resetConfirm, setResetConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const mutating = useRef(false),
    refreshing = useRef(false),
    generation = useRef(0),
    refreshSequence = useRef(0);
  const err = useCallback(
    (e: unknown) => {
      const code = e instanceof Error ? e.message : "UNKNOWN";
      setError(t.has(`error.${code}`) ? t(`error.${code}`) : t("errorGeneric"));
    },
    [t],
  );
  const applySnapshot = useCallback((result: MerchantView) => {
    setData(result);
    setApproval((previous) =>
      previous
        ? result.quotes.find((q) => q.quote.id === previous.quote.id) || null
        : null,
    );
  }, []);
  const refresh = useCallback(async () => {
    if (mutating.current || refreshing.current) return;
    refreshing.current = true;
    const version = generation.current,
      sequence = ++refreshSequence.current;
    try {
      const result = await api("/api/merchant");
      if (
        version !== generation.current ||
        sequence !== refreshSequence.current ||
        mutating.current
      )
        return;
      applySnapshot(result);
      setAccess(null);
    } catch (e) {
      if (
        version !== generation.current ||
        sequence !== refreshSequence.current ||
        mutating.current
      )
        return;
      const code = e instanceof Error ? e.message : "";
      if (code === "UNAUTHENTICATED") {
        setData(null);
        setAccess("login");
      } else if (code === "ONBOARDING_REQUIRED") setAccess("onboard");
      else err(e);
    } finally {
      refreshing.current = false;
    }
  }, [err, applySnapshot]);
  useEffect(() => {
    const initial = setTimeout(refresh, 0);
    return () => clearTimeout(initial);
  }, [refresh]);
  useEffect(() => {
    if (!data) return;
    window.scrollTo({ top: 0 });
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 3000);
    const onFocus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel("nahimila-updates");
    if (channel) channel.onmessage = onFocus;
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      channel?.close();
    };
  }, [data?.shop.id, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const mutate = async (b: Record<string, unknown>) => {
    if (mutating.current) return false;
    mutating.current = true;
    generation.current++;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result: MerchantView = await api("/api/merchant", b);
      applySnapshot(result);
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel("nahimila-updates");
        channel.postMessage("changed");
        channel.close();
      }
      if (b.action === "quote") {
        const saved = result.quotes.find((q) =>
          b.quote_id
            ? q.quote.id === b.quote_id
            : q.can_edit &&
              !data?.quotes.some((old) => old.quote.id === q.quote.id),
        );
        setView("orders");
        setOrderSearch("");
        setOrderLimit(10);
        setSelectedProduct(saved?.product.id || String(b.product_id));
        setSelectedQuote(saved?.quote.id || null);
      }
      setNotice(
        t(
          b.action === "create"
            ? "saved"
            : b.action === "quote"
              ? "quoteSaved"
              : b.action === "settings"
                ? "settingsSaved"
                : b.action === "approve"
                  ? "approved"
                  : "checksPassed",
        ),
      );
      return true;
    } catch (e) {
      err(e);
      return false;
    } finally {
      mutating.current = false;
      generation.current++;
      setBusy(false);
    }
  };
  const navigate = (next: View) => {
    setView(next);
    setError("");
    setNotice("");
    window.scrollTo({ top: 0 });
    void refresh();
  };
  if (access)
    return (
      <Access
        onboard={access === "onboard"}
        ready={refresh}
        local={!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}
      />
    );
  if (!data)
    return (
      <div className="loading">
        <Brand />
        <LoaderCircle className="spin" />
        <p>{error || t("loading")}</p>
        {error && (
          <button className="button" onClick={refresh}>
            {t("view")}
          </button>
        )}
      </div>
    );
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date());
  const requestToday = data.requests.filter(
    (r) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
        new Date(r.created_at),
      ) === today,
  ).length;
  const waiting = data.orders.reduce(
    (n, o) => n + o.pickups.filter((p) => !p.outcome).length,
    0,
  );
  const date = (s: string) =>
    new Intl.DateTimeFormat(`${locale}-IN`, {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    }).format(new Date(s));
  const displayPack = (s: string) =>
    s === "Unspecified pack" ? t("unknownPack") : s;
  const renderSignals = (rows: NearbySignal[]) => (
    <div className="compact-list">
      {rows.map((n) => (
        <article className="compact-signal" key={n.key}>
          <div>
            <h3>{n.name}</h3>
            <p>{displayPack(n.pack)}</p>
            <span className="fine">
              {n.suppressed
                ? t("limited")
                : t("nearbyShops", { count: n.shops })}
            </span>
          </div>
          <div className="compact-counts">
            <span>
              <strong>{n.own_requests}</strong>
              {t("yourRequests")}
            </span>
            <span>
              <strong>{n.peer_band || "—"}</strong>
              {t("nearbyRequests")}
            </span>
          </div>
          <button
            className="icon-button"
            aria-label={t("reviewProduct", { product: n.name })}
            onClick={() => {
              setOrderSearch(n.name);
              setOrderLimit(10);
              navigate("orders");
            }}
          >
            <ArrowRight size={20} />
          </button>
        </article>
      ))}
      {!rows.length && <p className="empty">{t("noResults")}</p>}
    </div>
  );
  const nearbyRows = nearbyList(data.nearby, nearbySearch);
  const pendingQuotes = data.quotes.filter(
    (q) =>
      !q.committed &&
      (q.can_edit ||
        q.total_units > 0 ||
        !data.orders.some((o) => o.product.id === q.product.id)),
  );
  const nextStep = (q: QuoteView) => {
    if (quoteActions(q).canCommit) return t("readyToOrder");
    if (quoteActions(q).canApprove) return t("reviewNext");
    const blocker = quoteBlockers(q)[0];
    return blocker
      ? t(blocker.key, { count: blocker.count ?? 0 })
      : t("waitingNext");
  };
  const renderQuote = (q: QuoteView) => (
    <article className="supplier-detail" key={q.quote.id}>
      <div className="supplier-detail-heading">
        <span className="eyebrow">{t("supplier")}</span>
        <h3>{q.quote.supplier_name}</h3>
        <p className="order-next-step" role="status">
          {nextStep(q)}
        </p>
      </div>
      <div className="case-progress">
        <span>
          {t("confirmed")} / {t("caseSize")}
        </span>
        <strong>
          {q.total_units} / {q.quote.moq} {t("units")}
        </strong>
      </div>
      {q.own ? (
        <div className="cost-overview">
          <div>
            <span>{t("yourShare")}</span>
            <strong>
              {q.own.allocated_units} <small>{t("units")}</small>
            </strong>
          </div>
          <div>
            <span>{t("totalCost")}</span>
            <strong>
              <Money value={q.own.total_exposure_paise} />
            </strong>
          </div>
        </div>
      ) : (
        <p className="fine">{t("awaiting")}</p>
      )}
      <p className="fine">
        {q.approval_count} / {q.participant_count} {t("approvals")}
      </p>
      {q.own?.approval_status === "INVALIDATED" && (
        <p className="note">{t("changed")}</p>
      )}
      {quoteActions(q).canCommit ? (
        <button
          className="button full"
          disabled={busy}
          onClick={() =>
            mutate({
              action: "commit",
              quote_id: q.quote.id,
              fingerprint: q.fingerprint,
            })
          }
        >
          {t("commit")}
          <ArrowRight size={16} />
        </button>
      ) : quoteActions(q).canApprove ? (
        <button
          className="button full"
          disabled={busy}
          onClick={() => setApproval(q)}
        >
          <ShieldCheck size={18} />
          {t("approve")}
        </button>
      ) : q.own?.approval_status === "APPROVED" ? (
        <p className="approved-note">
          <Check size={16} />
          {t("approved")}
        </p>
      ) : null}
      {quoteBlockers(q).length > 0 && (
        <div className="order-blockers">
          <strong>{t("beforeOrdering")}</strong>
          <ul>
            {quoteBlockers(q).map((b, index) => (
              <li key={`${b.key}-${index}`}>
                {t(b.key, { count: b.count ?? 0 })}
              </li>
            ))}
          </ul>
          {!q.checks.find((c) => c.code === "cases")?.passed &&
            data.requests.some(
              (r) =>
                r.product.id === q.product.id && r.status === "OFFER_CREATED",
            ) && (
              <button
                className="text-button small"
                onClick={() => {
                  setSelectedProduct(null);
                  navigate("requests");
                }}
              >
                {t("viewWaitingOffers")}
                <ArrowRight size={14} />
              </button>
            )}
        </div>
      )}
      <details className="details supplier-more">
        <summary>
          {t("moreDetails")}
          <ChevronRight size={16} />
        </summary>
        {q.own && (
          <dl className="cost-detail">
            <div>
              <dt>{t("limit")}</dt>
              <dd>
                <Money value={q.own.cash_cap_paise} />
              </dd>
            </div>
            <div>
              <dt>{t(q.own.within_cap ? "buffer" : "over")}</dt>
              <dd>
                <Money value={Math.abs(q.own.cash_cap_headroom_paise)} />
              </dd>
            </div>
          </dl>
        )}
        <div className="checks">
          {q.checks.map((c) => (
            <p key={c.code}>
              <span className={c.passed ? "good" : "warn"}>
                {c.passed ? "✓" : "○"}
              </span>
              {t(
                (
                  {
                    cases: "cases",
                    deadline: "deliveryRule",
                    expiry: "expiryRule",
                    price: "priceRule",
                    group: "groupRule",
                  } as Record<string, string>
                )[c.code],
              )}
            </p>
          ))}
        </div>
        <dl className="cost-detail">
          <div>
            <dt>{t("unitCost")}</dt>
            <dd>
              <Money value={q.quote.unit_cost_paise} />
            </dd>
          </div>
          <div>
            <dt>{t("delivery")}</dt>
            <dd>{date(q.quote.expected_delivery_date)}</dd>
          </div>
          <div>
            <dt>{t("expiry")}</dt>
            <dd>{date(q.quote.quote_expiry_date)}</dd>
          </div>
        </dl>
        <label className="check">
          <input
            type="checkbox"
            checked={data.shop.allowed_suppliers.includes(q.quote.supplier_id)}
            disabled={busy}
            onChange={(e) =>
              mutate({
                action: "permission",
                supplier_id: q.quote.supplier_id,
                allowed: e.target.checked,
              })
            }
          />
          {t("allowSupplier")}
        </label>
        <p className="fine">{t("groupHint")}</p>
      </details>
      {q.can_edit && (
        <button
          className="text-button small"
          disabled={busy}
          onClick={() => {
            setEditQuote(q);
            setQuote(true);
          }}
        >
          {t("editQuote")}
        </button>
      )}
    </article>
  );
  const groups = orderGroups(data.orders, pendingQuotes, orderSearch);
  const selectedGroup = orderGroups(data.orders, pendingQuotes, "").find(
    (g) => g.key === selectedProduct,
  );
  const activeQuote = selectedGroup?.quotes.find(
    (q) => q.quote.id === selectedQuote,
  );
  const renderOrders = (rows: MerchantView["orders"]) =>
    rows.map((o) => (
      <article className="order-card" key={o.id}>
        <div className="order-heading">
          <span className="card-symbol">
            <Package size={26} />
          </span>
          <div>
            <h2>{o.product.name}</h2>
            <p>{o.product.pack_size}</p>
          </div>
          <span className="status positive">
            {t(o.received ? "received" : "ordered")}
          </span>
        </div>
        <div className="order-counts">
          <div>
            <strong>{o.quantity}</strong>
            <span>{t("ordered")}</span>
          </div>
          <div>
            <strong>{o.collected_units}</strong>
            <span>{t("collected")}</span>
          </div>
          <div>
            <strong>{o.remaining}</strong>
            <span>{t("residual")}</span>
          </div>
        </div>
        <dl className="cost-detail">
          <div>
            <dt>{t("supplierCost")}</dt>
            <dd>
              <Money value={o.exposure} />
            </dd>
          </div>
          <div>
            <dt>{t("cash")}</dt>
            <dd>
              <Money value={o.collected_cash} />
            </dd>
          </div>
          <div>
            <dt>{t("shortfall")}</dt>
            <dd>
              <Money value={Math.max(0, o.exposure - o.collected_cash)} />
            </dd>
          </div>
        </dl>
        <p className="fine">{t("shortfallNote")}</p>
        {!o.received ? (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => mutate({ action: "receive", order_id: o.id })}
          >
            {t("receipt")}
          </button>
        ) : (
          <div className="pickup-list">
            {o.pickups.map((p) => (
              <div className="pickup-row" key={p.id}>
                <div>
                  <b>{p.name}</b>
                  <span>
                    {p.quantity} × <Money value={p.price} />
                  </span>
                </div>
                {p.outcome ? (
                  <span className="status">
                    {t(p.outcome === "COLLECTED" ? "collected" : "noShow")}
                  </span>
                ) : (
                  <div>
                    {p.phone && !p.can_no_show && (
                      <WhatsAppAction
                        phone={p.phone}
                        label={t("notifyWhatsApp")}
                        message={() =>
                          t("pickupMessage", {
                            shop: data.shop.name,
                            product: o.product.name,
                            pack: o.product.pack_size,
                            quantity: p.quantity,
                            price: new Intl.NumberFormat(`${locale}-IN`, {
                              style: "currency",
                              currency: "INR",
                            }).format(p.price / 100),
                            deadline: new Intl.DateTimeFormat(`${locale}-IN`, {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                              timeZone: "Asia/Kolkata",
                            }).format(new Date(p.deadline)),
                            link: `${window.location.origin}/confirm/${p.token}`,
                          })
                        }
                      />
                    )}
                    <button
                      className="button secondary small"
                      disabled={busy}
                      onClick={() =>
                        mutate({
                          action: "pickup",
                          reservation_id: p.id,
                          outcome: "COLLECTED",
                        })
                      }
                    >
                      <Check size={15} />
                      {t("markCollected")}
                    </button>
                    <button
                      className="text-button small"
                      disabled={busy || !p.can_no_show}
                      onClick={() =>
                        mutate({
                          action: "pickup",
                          reservation_id: p.id,
                          outcome: "NO_SHOW",
                        })
                      }
                    >
                      {t("markNoShow")}
                    </button>
                  </div>
                )}
              </div>
            ))}
            <p className="fine">{t("noShowHint")}</p>
          </div>
        )}
      </article>
    ));
  return (
    <div className="merchant">
      <aside className="desktop-nav">
        <Brand />
        <div className="shop-identity">
          <span>{data.shop.name.slice(0, 1)}</span>
          <div>
            <b>{data.shop.name}</b>
            <small>{data.shop.neighborhood}</small>
          </div>
        </div>
        <nav>
          {navigation.map((n) => (
            <button
              key={n.key}
              className={view === n.key ? "active" : ""}
              onClick={() => navigate(n.key)}
            >
              <n.icon size={20} />
              {t(n.key)}
            </button>
          ))}
        </nav>
        <div className="nav-bottom">
          <button onClick={() => navigate("settings")}>
            <Settings size={20} />
            {t("settings")}
          </button>
          <span className="private-note">
            <ShieldCheck size={15} />
            {t("private")}
          </span>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div className="mobile-brand">
            <Brand />
          </div>
          <span className="desktop-page-name">{t(view)}</span>
          <div>
            <Language persistShop />

            <button
              className="icon-button"
              onClick={() => navigate("settings")}
              aria-label={t("settings")}
            >
              <Settings size={19} />
            </button>
            <button
              className="button small"
              onClick={() => {
                setCaptureMode("type");
                setCapture(true);
              }}
            >
              <Plus size={17} />
              {t("recordRequest")}
            </button>
            {data.demo && (
              <button
                className="button secondary small demo-reset-top"
                disabled={busy}
                onClick={() => {
                  setAgent(false);
                  setResetConfirm(true);
                }}
              >
                <RotateCcw size={16} />
                <span>{t("demoReset")}</span>
              </button>
            )}
          </div>
        </header>
        <nav className="mobile-nav">
          {navigation.map((n) => (
            <button
              key={n.key}
              className={view === n.key ? "active" : ""}
              onClick={() => navigate(n.key)}
            >
              <n.icon size={20} />
              {t(n.key)}
            </button>
          ))}
        </nav>
        <main className="content">
          {error && (
            <div className="flash error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="flash success" role="status">
              {notice}
            </div>
          )}
          {view === "home" && (
            <>
              <div className="greeting">
                <span className="eyebrow">{data.shop.neighborhood}</span>
                <p>
                  {t("welcome")} {data.shop.name}
                </p>
              </div>
              <section className="home-hero">
                <div>
                  <h1>{t("what")}</h1>
                  <p>{t("intro")}</p>
                  <div className="hero-actions">
                    <button
                      className="speak-button"
                      onClick={() => {
                        setCaptureMode("voice");
                        setCapture(true);
                      }}
                    >
                      <Mic size={31} />
                      <span>{t("speak")}</span>
                    </button>
                    <button
                      className="text-button"
                      onClick={() => {
                        setCaptureMode("type");
                        setCapture(true);
                      }}
                    >
                      {t("type")}
                      <ArrowRight size={17} />
                    </button>
                  </div>
                </div>
                <div className="request-art" aria-hidden="true">
                  <div className="art-note">
                    <span />
                    <span />
                    <span />
                    <i>+</i>
                  </div>
                  <div className="art-bag">
                    <ShoppingBag size={86} strokeWidth={0.9} />
                  </div>
                  <span className="art-circle" />
                  <span className="art-dot" />
                </div>
              </section>
              <div className="home-counts">
                <button onClick={() => navigate("requests")}>
                  <strong>{requestToday}</strong>
                  <span>{t("today")}</span>
                  <ArrowUpRight size={18} />
                </button>
                <button onClick={() => navigate("orders")}>
                  <strong>{waiting}</strong>
                  <span>{t("pickupToday")}</span>
                  <ArrowUpRight size={18} />
                </button>
              </div>
              <div className="section-heading">
                <div>
                  <span className="eyebrow">{t("nearby")}</span>
                  <h2>{t("nearbyTitle")}</h2>
                </div>
                <button
                  className="text-button"
                  onClick={() => navigate("nearby")}
                >
                  {t("view")}
                  <ArrowRight size={17} />
                </button>
              </div>
              {renderSignals(nearbyList(data.nearby, "").slice(0, 3))}
              <p className="fine">{t("signalNote")}</p>
            </>
          )}
          {view === "requests" && (
            <DemandBook
              requests={data.requests}
              shop={data.shop.name}
              busy={busy}
              mutate={mutate}
              onNotice={setNotice}
              onRecord={() => {
                setCaptureMode("type");
                setCapture(true);
              }}
            />
          )}
          {view === "nearby" && (
            <>
              <div className="page-heading">
                <div>
                  <h1>{t("nearbyTitle")}</h1>
                  <p>{t("nearbyHint")}</p>
                </div>
              </div>
              <label className="list-search">
                {t("findProduct")}
                <input
                  type="search"
                  value={nearbySearch}
                  onChange={(e) => {
                    setNearbySearch(e.target.value);
                    setNearbyLimit(10);
                  }}
                  placeholder={t("searchProduct")}
                />
              </label>
              {renderSignals(nearbyRows.slice(0, nearbyLimit))}
              {nearbyRows.length > nearbyLimit && (
                <button
                  className="button secondary list-more"
                  onClick={() => setNearbyLimit((n) => n + 10)}
                >
                  {t("showMore")}
                </button>
              )}
              <div className="privacy-banner">
                <ShieldCheck size={21} />
                <p>{t("signalNote")}</p>
              </div>
            </>
          )}
          {view === "orders" && (
            <>
              <div className="page-heading">
                <div>
                  <h1>{t("orders")}</h1>
                  <p>{t("orderHint")}</p>
                </div>
                <button
                  className="button secondary"
                  disabled={!data.requests.length}
                  onClick={() => {
                    setEditQuote(null);
                    setQuote(true);
                  }}
                >
                  <Plus size={18} />
                  {t("addQuote")}
                </button>
              </div>
              <label className="list-search">
                {t("findProduct")}
                <input
                  type="search"
                  value={orderSearch}
                  onChange={(e) => {
                    setOrderSearch(e.target.value);
                    setOrderLimit(10);
                  }}
                  placeholder={t("searchProduct")}
                />
              </label>
              <div className="compact-list">
                {groups.slice(0, orderLimit).map((g) => (
                  <button
                    className="order-product-row"
                    key={g.key}
                    onClick={() => {
                      setSelectedProduct(g.key);
                      setSelectedQuote(null);
                    }}
                  >
                    <span>
                      <strong>{g.name}</strong>
                      <small>{displayPack(g.pack)}</small>
                      <span className="order-next-step">
                        {g.orders.some((o) => o.remaining > 0)
                          ? t("pickupNext")
                          : g.quotes.length
                            ? nextStep(g.quotes[0])
                            : t("completedNext")}
                      </span>
                    </span>
                    <span className="order-row-action">
                      {t("viewItem")}
                      <ChevronRight size={18} />
                    </span>
                  </button>
                ))}
              </div>
              {groups.length > orderLimit && (
                <button
                  className="button secondary list-more"
                  onClick={() => setOrderLimit((n) => n + 10)}
                >
                  {t("showMore")}
                </button>
              )}
              {!groups.length &&
                (pendingQuotes.length > 0 || data.orders.length > 0) && (
                  <p className="empty">{t("noResults")}</p>
                )}
              {!pendingQuotes.length && !data.orders.length && (
                <div className="empty">
                  <Package size={38} />
                  <p>{t("noQuotes")}</p>
                </div>
              )}
            </>
          )}
          {view === "settings" && (
            <>
              <div className="page-heading">
                <div>
                  <h1>{t("settings")}</h1>
                  <p>{data.shop.name}</p>
                </div>
              </div>
              <section className="settings-card">
                <label>
                  {t("language")}
                  <Language persistShop />
                </label>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    await mutate({
                      action: "settings",
                      cap_paise: Math.round(Number(f.get("cap")) * 100),
                      sharing: f.get("sharing") === "on",
                      locale,
                    });
                  }}
                >
                  <label>
                    {t("cap")}
                    <input
                      key={data.shop.cash_cap_paise}
                      type="number"
                      name="cap"
                      min="0"
                      step="0.01"
                      defaultValue={data.shop.cash_cap_paise / 100}
                      required
                    />
                  </label>
                  <label className="check">
                    <input
                      name="sharing"
                      type="checkbox"
                      defaultChecked={data.shop.sharing}
                    />
                    {t("shareDemand")}
                  </label>
                  <button className="button" disabled={busy}>
                    {t("saveSettings")}
                  </button>
                </form>
                <div className="settings-location">
                  <MapPin size={19} />
                  {data.shop.neighborhood}
                </div>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={async () => {
                    if (mutating.current) return;
                    mutating.current = true;
                    generation.current++;
                    setBusy(true);
                    try {
                      await api("/api/auth", { action: "logout" });
                      setData(null);
                      setView("home");
                      setCapture(false);
                      setAgent(false);
                      setApproval(null);
                      setQuote(false);
                      setEditQuote(null);
                      setSelectedProduct(null);
                      setSelectedQuote(null);
                      setOrderSearch("");
                      setNearbySearch("");
                      setAccess("login");
                    } catch (e) {
                      err(e);
                    } finally {
                      mutating.current = false;
                      generation.current++;
                      setBusy(false);
                    }
                  }}
                >
                  {t("logout")}
                </button>
              </section>
            </>
          )}
          <footer className="app-footer">
            <ShieldCheck size={13} />
            <span>{t("demo")}</span>
          </footer>
        </main>
        <button
          className="ask-button"
          aria-expanded={agent}
          aria-controls="merchant-assistant"
          onClick={() => setAgent((open) => !open)}
        >
          <Mic size={19} />
          <span>{t("ask")}</span>
        </button>
      </div>
      {selectedProduct && !capture && !quote && !approval && !resetConfirm && (
        <Modal
          title={selectedGroup?.name || t("orders")}
          className="item-order-panel"
          close={() => {
            setSelectedProduct(null);
            setSelectedQuote(null);
          }}
        >
          {selectedGroup ? (
            <>
              <p className="fine">{displayPack(selectedGroup.pack)}</p>
              {activeQuote ? (
                <>
                  <button
                    className="text-button small"
                    onClick={() => setSelectedQuote(null)}
                  >
                    {t("allSuppliers")}
                  </button>
                  {renderQuote(activeQuote)}
                </>
              ) : (
                <>
                  <ProgressiveRows
                    rows={selectedGroup.orders}
                    render={renderOrders}
                    step={5}
                  />
                  {!!selectedGroup.quotes.length && (
                    <>
                      <h3>{t("chooseSupplier")}</h3>
                      <ProgressiveRows
                        step={5}
                        rows={selectedGroup.quotes}
                        render={(rows) => (
                          <div className="compact-list">
                            {rows.map((q) => (
                              <button
                                key={q.quote.id}
                                className="supplier-option-row"
                                onClick={() => setSelectedQuote(q.quote.id)}
                              >
                                <span>
                                  <strong>{q.quote.supplier_name}</strong>
                                  <small>
                                    <Money value={q.quote.unit_cost_paise} /> ·{" "}
                                    {t("caseSize")} {q.quote.moq}
                                  </small>
                                  <span className="order-next-step">
                                    {nextStep(q)}
                                  </span>
                                </span>
                                <ChevronRight size={18} />
                              </button>
                            ))}
                          </div>
                        )}
                      />
                    </>
                  )}
                </>
              )}
            </>
          ) : (
            <p className="note">{t("itemNoLongerPending")}</p>
          )}
        </Modal>
      )}
      {capture && (
        <Capture
          mode={captureMode}
          voice={data.voice}
          initial={captureDraft?.raw || ""}
          initialWait={captureDraft?.can_wait === true}
          close={() => {
            setCapture(false);
            setCaptureDraft(null);
          }}
          saved={mutate}
        />
      )}{" "}
      {quote && (
        <QuoteForm
          data={data}
          initial={editQuote}
          close={() => setQuote(false)}
          save={mutate}
        />
      )}{" "}
      <Agent
        open={
          agent &&
          !capture &&
          !quote &&
          !approval &&
          !resetConfirm &&
          !selectedProduct
        }
        configured={data.gemini}
        voice={data.voice}
        close={() => setAgent(false)}
        onDraft={(draft) => {
          setCaptureDraft(draft);
          setCaptureMode("type");
          setAgent(false);
          setCapture(true);
        }}
        navigate={(screen) => {
          navigate(screen);
          setAgent(false);
        }}
      />
      {resetConfirm && (
        <Modal
          title={t("demoResetTitle")}
          close={() => {
            if (!busy) setResetConfirm(false);
          }}
        >
          <p>{t("demoResetWarning")}</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button
              className="btn outline"
              disabled={busy}
              onClick={() => setResetConfirm(false)}
            >
              {t("back")}
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                if (await mutate({ action: "reset_demo", confirm: true })) {
                  setResetConfirm(false);
                  setCapture(false);
                  setCaptureDraft(null);
                  setQuote(false);
                  setEditQuote(null);
                  setAgent(false);
                  setApproval(null);
                  setSelectedProduct(null);
                  setSelectedQuote(null);
                  setNearbySearch("");
                  setOrderSearch("");
                  setNearbyLimit(10);
                  setOrderLimit(10);
                  setView("home");
                  setNotice(t("demoResetDone"));
                }
              }}
            >
              <RotateCcw size={16} />
              {t("demoReset")}
            </button>
          </div>
        </Modal>
      )}
      {approval?.own && (
        <Modal
          title={t(approval.eligible ? "approveTitle" : "previewShareTitle")}
          close={() => setApproval(null)}
        >
          <>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </>
          <p className="note">
            {approval.product.name} · {approval.quote.pack_size}
          </p>
          <div className="approval-total">
            <strong>
              <Money value={approval.own.total_exposure_paise} />
            </strong>
            <span>
              {approval.own.allocated_units} {t("units")} · {t("totalCost")}
            </span>
          </div>
          {!approval.eligible && (
            <p className="note">{t("provisionalShare")}</p>
          )}
          {quoteBlockers(approval).length > 0 && (
            <div className="order-blockers">
              <strong>{t("beforeOrdering")}</strong>
              <ul>
                {quoteBlockers(approval).map((b, index) => (
                  <li key={`${b.key}-${index}`}>
                    {t(b.key, { count: b.count ?? 0 })}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="fine">{t("groupHint")}</p>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setApproval(null)}
            >
              {t("cancel")}
            </button>
            <button
              className="button"
              disabled={!quoteActions(approval, busy).canApprove}
              onClick={async () => {
                if (
                  await mutate({
                    action: "approve",
                    quote_id: approval.quote.id,
                    fingerprint: approval.fingerprint,
                  })
                )
                  setApproval(null);
              }}
            >
              <Check size={18} />
              {t("approveConfirm")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
