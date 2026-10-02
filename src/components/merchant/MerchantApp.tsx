"use client";
import { useCallback, useEffect, useState } from "react";
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
} from "lucide-react";
import type { MerchantView, QuoteView } from "@/lib/product/types";
import { api, Brand, Language, Modal, Money, OfferActions } from "./common";
import Access from "./Access";
import Capture from "./Capture";
import QuoteForm from "./QuoteForm";
import Agent from "./Agent";
type View = "home" | "requests" | "nearby" | "orders" | "settings";
const navigation = [
  { key: "home", icon: Home },
  { key: "requests", icon: ClipboardList },
  { key: "nearby", icon: MapPin },
  { key: "orders", icon: Package },
] as const;
export default function MerchantApp() {
  const t = useTranslations(),
    locale = useLocale();
  const [data, setData] = useState<MerchantView | null>(null),
    [access, setAccess] = useState<"login" | "onboard" | null>(null),
    [view, setView] = useState<View>("home"),
    [capture, setCapture] = useState(false),
    [quote, setQuote] = useState(false),
    [editQuote, setEditQuote] = useState<QuoteView | null>(null),
    [agent, setAgent] = useState(false),
    [approval, setApproval] = useState<QuoteView | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const err = useCallback(
    (e: unknown) => {
      const code = e instanceof Error ? e.message : "UNKNOWN";
      setError(t.has(`error.${code}`) ? t(`error.${code}`) : t("errorGeneric"));
    },
    [t],
  );
  const refresh = useCallback(async () => {
    try {
      const result = await api("/api/merchant");
      setData(result);
      setAccess(null);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (code === "UNAUTHENTICATED") {
        setData(null);
        setAccess("login");
      } else if (code === "ONBOARDING_REQUIRED") setAccess("onboard");
      else err(e);
    }
  }, [err]);
  useEffect(() => {
    const initial = setTimeout(refresh, 0);
    return () => clearTimeout(initial);
  }, [refresh]);
  useEffect(() => {
    if (!data) return;
    window.scrollTo({ top: 0 });
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5000);
    return () => clearInterval(interval);
  }, [data?.shop.id, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const mutate = async (b: Record<string, unknown>) => {
    if (busy) return false;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setData(await api("/api/merchant", b));
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
  const status = (s: string) =>
    (
      ({
        MISSED_DEMAND: "observed",
        OFFER_CREATED: "awaiting",
        CUSTOMER_CONFIRMED: "confirmed",
        CANCELLED: "withdrawn",
        READY_FOR_PICKUP: "committed",
        PICKED_UP: "collected",
        NO_SHOW: "noShow",
      }) as Record<string, string>
    )[s] || "observed";
  const date = (s: string) =>
    new Intl.DateTimeFormat(`${locale}-IN`, {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    }).format(new Date(s));
  const grouped = Array.from(
    new Map(data.requests.map((r) => [r.product.id, r.product])).values(),
  ).map((p) => ({
    product: p,
    rows: data.requests.filter((r) => r.product.id === p.id),
  }));
  const displayPack = (s: string) =>
    s === "Unspecified pack" ? t("unknownPack") : s;
  const signals = (
    <div className="signal-grid">
      {data.nearby.map((n) => (
        <article className="signal-card" key={n.key}>
          <span className="card-symbol">
            <ShoppingBag size={25} />
          </span>
          <h3>{n.name}</h3>
          <p>{displayPack(n.pack)}</p>
          <div className="signal-numbers">
            <div>
              <strong>{n.own_requests}</strong>
              <span>{t("yourRequests")}</span>
            </div>
            <div>
              <strong>{n.peer_band || "—"}</strong>
              <span>{t("nearbyRequests")}</span>
            </div>
          </div>
          {n.suppressed ? (
            <p className="fine">{t("limited")}</p>
          ) : (
            <p className="fine">
              {n.shops} · {t("participating")}
            </p>
          )}
          <div className="signal-bottom">
            <span>{t("radius")}</span>
            <button
              className="icon-button"
              aria-label={t("reviewOrder")}
              onClick={() => navigate("orders")}
            >
              <ArrowUpRight size={20} />
            </button>
          </div>
        </article>
      ))}
    </div>
  );
  const pendingQuotes = data.quotes.filter(
    (q) =>
      !q.committed &&
      (q.total_units > 0 ||
        !data.orders.some((o) => o.product.id === q.product.id)),
  );
  const quotes = (
    <div className="quote-list">
      {pendingQuotes.map((q) => (
        <article className="quote-review" key={q.quote.id}>
          <div className="quote-header">
            <div>
              <span className="eyebrow">{t("supplier")}</span>
              <h3>{q.quote.supplier_name}</h3>
              <p>
                {q.product?.name} · {q.quote.pack_size}
              </p>
            </div>
            <span className={`status ${q.eligible ? "positive" : ""}`}>
              {t(q.eligible ? "checksPassed" : "notYet")}
            </span>
          </div>
          <div className="case-progress">
            <span>
              {t("confirmed")} · {t("caseSize")} {q.quote.moq}
            </span>
            <strong>
              {q.total_units} {t("units")}
            </strong>
          </div>
          {q.own ? (
            <>
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
              <dl className="cost-detail">
                <div>
                  <dt>{t("limit")}</dt>
                  <dd>
                    <Money value={q.own.cash_cap_paise} />
                  </dd>
                </div>
                <div>
                  <dt>{t(q.own.within_cap ? "buffer" : "over")}</dt>
                  <dd className={q.own.within_cap ? "good" : "warn"}>
                    <Money value={Math.abs(q.own.cash_cap_headroom_paise)} />
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="note">{t("awaiting")}</p>
          )}
          <details className="details">
            <summary>
              {t("reviewOrder")}
              <ChevronRight size={16} />
            </summary>
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
                <dt>{t("caseSize")}</dt>
                <dd>{q.quote.moq}</dd>
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
                checked={data.shop.allowed_suppliers.includes(
                  q.quote.supplier_id,
                )}
                disabled={busy}
                onChange={(e) =>
                  mutate({
                    action: "permission",
                    supplier_id: q.quote.supplier_id,
                    allowed: e.target.checked,
                  })
                }
              />
              {t("supplier")}
            </label>
          </details>
          {q.can_edit && (
            <button
              className="text-button small"
              onClick={() => {
                setEditQuote(q);
                setQuote(true);
              }}
            >
              {t("editQuote")}
            </button>
          )}
          <div className="approval-line">
            <span>
              {q.approval_count} / {q.participant_count} {t("approvals")}
            </span>
            {q.own?.approval_status === "INVALIDATED" && (
              <span className="warn">{t("changed")}</span>
            )}
          </div>
          <div className="quote-actions">
            <button
              className={`button ${q.own?.approval_status === "APPROVED" ? "secondary" : ""}`}
              disabled={
                busy ||
                !q.eligible ||
                !q.own ||
                q.own.approval_status === "APPROVED"
              }
              onClick={() => setApproval(q)}
            >
              {q.own?.approval_status === "APPROVED" ? (
                <Check size={18} />
              ) : (
                <ShieldCheck size={18} />
              )}{" "}
              {t(
                q.own?.approval_status === "APPROVED" ? "approved" : "approve",
              )}
            </button>
            <button
              className="button secondary"
              disabled={
                busy ||
                !q.eligible ||
                !q.participant_count ||
                q.approval_count !== q.participant_count
              }
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
          </div>
          <p className="fine">{t("groupHint")}</p>
        </article>
      ))}
    </div>
  );
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
          <button onClick={() => setAgent(true)}>
            <Mic size={20} />
            {t("ask")}
          </button>
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
            <button className="button small" onClick={() => setCapture(true)}>
              <Plus size={17} />
              {t("newRequest")}
            </button>
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
                      onClick={() => setCapture(true)}
                    >
                      <Mic size={31} />
                      <span>{t("speak")}</span>
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setCapture(true)}
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
              {signals}
              <p className="fine">{t("signalNote")}</p>
            </>
          )}
          {view === "requests" && (
            <>
              <div className="page-heading">
                <div>
                  <h1>{t("privateBook")}</h1>
                  <p>{t("bookHint")}</p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => setCapture(true)}
                >
                  <Plus size={18} />
                  {t("newRequest")}
                </button>
              </div>
              {!data.requests.length ? (
                <div className="empty">
                  <ClipboardList size={38} />
                  <h2>{t("emptyRequests")}</h2>
                  <p>{t("emptyHint")}</p>
                </div>
              ) : (
                <>
                  <h2 className="book-label">{t("groupedTitle")}</h2>
                  <div className="book-summary">
                    {grouped.map((g) => (
                      <article key={g.product.id}>
                        <strong>{g.rows.length}</strong>
                        <div>
                          <b>{g.product.name}</b>
                          <p>{displayPack(g.product.pack_size)}</p>
                          <small>
                            {
                              g.rows.filter((r) => r.status === "MISSED_DEMAND")
                                .length
                            }{" "}
                            {t("observed")} ·{" "}
                            {
                              g.rows.filter((r) =>
                                [
                                  "CUSTOMER_CONFIRMED",
                                  "READY_FOR_PICKUP",
                                  "PICKED_UP",
                                  "NO_SHOW",
                                ].includes(r.status),
                              ).length
                            }{" "}
                            {t("confirmed")}
                          </small>
                        </div>
                      </article>
                    ))}
                  </div>
                  <div className="request-list">
                    {[...data.requests].reverse().map((r) => (
                      <article className="request-row" key={r.id}>
                        <div className="request-row-main">
                          <span className="card-symbol">
                            <ShoppingBag size={23} />
                          </span>
                          <div>
                            <h3>{r.product.name}</h3>
                            <p>
                              {displayPack(r.product.pack_size)} · {r.quantity}{" "}
                              {t("units")} ·{" "}
                              {r.customer_name === "Walk-in Customer"
                                ? ""
                                : r.customer_name}
                            </p>
                            <small>{date(r.created_at)}</small>
                          </div>
                          <span
                            className={`status ${r.status === "CUSTOMER_CONFIRMED" ? "positive" : ""}`}
                          >
                            {t(status(r.status))}
                          </span>
                        </div>
                        {r.detail && (
                          <details className="details">
                            <summary>
                              {t("view")}
                              <ChevronRight size={16} />
                            </summary>
                            <p>“{r.detail.raw_text}”</p>
                            {r.detail.intent.hard_constraints.length > 0 && (
                              <p>
                                {r.detail.intent.hard_constraints.join(" · ")}
                              </p>
                            )}
                          </details>
                        )}
                        {r.offer && (
                          <OfferActions
                            token={r.offer.token}
                            onNotice={setNotice}
                          />
                        )}
                      </article>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          {view === "nearby" && (
            <>
              <div className="page-heading">
                <div>
                  <h1>{t("nearbyTitle")}</h1>
                  <p>{t("nearbyHint")}</p>
                </div>
              </div>
              {signals}
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
              {data.orders.map((o) => (
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
                        <Money
                          value={Math.max(0, o.exposure - o.collected_cash)}
                        />
                      </dd>
                    </div>
                  </dl>
                  <p className="fine">{t("shortfallNote")}</p>
                  {!o.received ? (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() =>
                        mutate({ action: "receive", order_id: o.id })
                      }
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
                              {t(
                                p.outcome === "COLLECTED"
                                  ? "collected"
                                  : "noShow",
                              )}
                            </span>
                          ) : (
                            <div>
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
              ))}
              {pendingQuotes.length > 0 && (
                <div className="section-heading">
                  <h2>{t("reviewOrder")}</h2>
                </div>
              )}
              {quotes}
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
                  onClick={async () => {
                    await api("/api/auth", { action: "logout" });
                    setData(null);
                    setView("home");
                    setCapture(false);
                    setAgent(false);
                    setApproval(null);
                    setAccess("login");
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
        <button className="ask-button" onClick={() => setAgent(true)}>
          <Mic size={19} />
          <span>{t("ask")}</span>
        </button>
      </div>
      {capture && (
        <Capture
          voice={data.voice}
          close={() => setCapture(false)}
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
      {agent && (
        <Agent
          configured={data.gemini}
          voice={data.voice}
          close={() => setAgent(false)}
        />
      )}{" "}
      {approval?.own && (
        <Modal title={t("approveTitle")} close={() => setApproval(null)}>
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
              disabled={busy}
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
