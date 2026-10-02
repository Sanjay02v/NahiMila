"use client";
import ReservationTerms from "./ReservationTerms";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ChevronDown,
  ClipboardList,
  Search,
  Check,
  Pencil,
  Plus,
} from "lucide-react";
import type { PrivateRequest } from "@/lib/product/types";
import {
  demandStatus,
  groupDemand,
  type DemandFilter,
} from "@/lib/product/demand-book";
import { Modal, Money, OfferActions } from "./common";
const statusKeys: Record<string, string> = {
  MISSED_DEMAND: "demandOnly",
  WAITING_INTEREST: "pendingInterest",
  OFFER_CREATED: "filter_pending",
  CUSTOMER_CONFIRMED: "confirmed",
  CANCELLED: "withdrawn",
  EXPIRED: "expired",
  READY_FOR_PICKUP: "committed",
  SUPPLIER_COMMITTED: "committed",
  PICKED_UP: "collected",
  NO_SHOW: "noShow",
};
export default function DemandBook({
  requests,
  shop,
  busy,
  mutate,
  onNotice,
  onRecord,
}: {
  requests: PrivateRequest[];
  shop: string;
  busy: boolean;
  mutate: (b: Record<string, unknown>) => Promise<boolean>;
  onNotice: (s: string) => void;
  onRecord: () => void;
}) {
  const t = useTranslations(),
    locale = useLocale();
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState<DemandFilter>("all"),
    [limit, setLimit] = useState(20);
  const [modalError, setModalError] = useState(false);
  const [contact, setContact] = useState<PrivateRequest | null>(null);
  const [confirm, setConfirm] = useState<PrivateRequest | null>(null),
    [revise, setRevise] = useState<PrivateRequest | null>(null);
  const groups = groupDemand(requests, search, filter);
  const date = (value: string) =>
    new Intl.DateTimeFormat(`${locale}-IN`, {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    }).format(new Date(value));
  const pack = (value: string) =>
    value === "Unspecified pack" ? t("unknownPack") : value;
  const price = (value: number) =>
    new Intl.NumberFormat(`${locale}-IN`, {
      style: "currency",
      currency: "INR",
    }).format(value / 100);
  const calendarDate = (value: string) =>
    new Intl.DateTimeFormat(`${locale}-IN`, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    }).format(new Date(value));
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t("privateBook")}</h1>
          <p>{t("demandBookHint")}</p>
        </div>
        <button className="button demand-mobile-record" onClick={onRecord}>
          <Plus size={17} />
          {t("recordRequest")}
        </button>
      </div>
      <div className="demand-toolbar">
        <label className="demand-search">
          <Search size={18} />
          <span className="sr-only">{t("searchDemand")}</span>
          <input
            value={search}
            placeholder={t("searchDemand")}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(20);
            }}
          />
        </label>
        <label className="demand-filter">
          <span className="sr-only">{t("filterDemand")}</span>
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as DemandFilter);
              setLimit(20);
            }}
          >
            {(
              ["all", "demand", "pending", "confirmed", "history"] as const
            ).map((key) => (
              <option key={key} value={key}>
                {t(`filter_${key}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="fine demand-book-rule">{t("demandRule")}</p>
      {!groups.length ? (
        <div className="empty">
          <ClipboardList size={32} />
          <h2>{t(requests.length ? "noMatchingDemand" : "emptyRequests")}</h2>
          <p>{t(requests.length ? "adjustFilters" : "emptyHint")}</p>
        </div>
      ) : (
        <div className="demand-groups">
          {groups.slice(0, limit).map((g) => (
            <details className="demand-group" key={g.key}>
              <summary>
                <div className="demand-product">
                  <h2>{g.product.name}</h2>
                  <p>
                    {pack(g.product.pack_size)} ·{" "}
                    {t("entryCount", { count: g.rows.length })}
                  </p>
                </div>
                <div className="demand-metrics">
                  <div>
                    <b>{g.total}</b>
                    <span>{t("requestedUnits")}</span>
                  </div>
                  <div>
                    <b>{g.demand}</b>
                    <span>{t("demandUnits")}</span>
                  </div>
                  <div>
                    <b>{g.pending}</b>
                    <span>{t("pendingUnits")}</span>
                  </div>
                  <div className="confirmed-metric">
                    <b>{g.confirmed}</b>
                    <span>{t("confirmedUnits")}</span>
                  </div>
                </div>
                <ChevronDown className="demand-chevron" size={18} />
              </summary>
              <DemandEntries
                rows={g.visible}
                render={(r) => {
                  const state = demandStatus(r),
                    pending = state === "OFFER_CREATED",
                    confirmed = state === "CUSTOMER_CONFIRMED",
                    share =
                      pending ||
                      confirmed ||
                      state === "READY_FOR_PICKUP" ||
                      state === "SUPPLIER_COMMITTED";
                  return (
                    <article className="demand-entry" key={r.id}>
                      <div className="demand-entry-heading">
                        <div>
                          <b>
                            {r.customer_name &&
                            r.customer_name !== "Walk-in Customer"
                              ? r.customer_name
                              : t("walkIn")}
                          </b>
                          <p>
                            {r.quantity} {t("units")} · {date(r.created_at)}
                          </p>
                        </div>
                        <span
                          className={`status ${confirmed ? "positive" : ""}`}
                        >
                          {t(statusKeys[state] || "demandOnly")}
                        </span>
                      </div>
                      {r.detail?.raw_text && (
                        <p className="demand-original">“{r.detail.raw_text}”</p>
                      )}
                      {state === "MISSED_DEMAND" && (
                        <p className="fine">
                          {t(
                            r.detail?.willing_to_wait
                              ? "waitNoContact"
                              : "demandSignalHint",
                          )}
                        </p>
                      )}
                      {r.offer && (
                        <div className="demand-terms">
                          <span>
                            {t(confirmed ? "acceptedPrice" : "offerPrice")}:{" "}
                            <Money value={r.offer.price} />
                          </span>
                          <span>
                            {t("pickupBy")}: {calendarDate(r.offer.deadline)}
                          </span>
                          {r.customer_phone && (
                            <span>
                              {t("contact")}: +{r.customer_phone}
                            </span>
                          )}
                        </div>
                      )}
                      {r.detail?.confirmation && (
                        <p className="fine">
                          {t(
                            r.detail.confirmation.method === "in_store"
                              ? "confirmedInStore"
                              : "confirmedByLink",
                          )}{" "}
                          · {date(r.detail.confirmation.at)}
                        </p>
                      )}
                      {!!r.detail?.intent.hard_constraints.length && (
                        <p className="fine">
                          {r.detail.intent.hard_constraints.join(" · ")}
                        </p>
                      )}
                      {share && r.offer && (
                        <OfferActions
                          token={r.offer.token}
                          phone={r.customer_phone}
                          pending={pending}
                          addContact={() => {
                            setModalError(false);
                            setContact(r);
                          }}
                          onNotice={onNotice}
                          message={(link) =>
                            t(
                              pending
                                ? "confirmationMessage"
                                : "reservationMessage",
                              {
                                shop,
                                product: r.product.name,
                                pack: pack(r.product.pack_size),
                                quantity: r.quantity,
                                price: price(r.offer!.price),
                                deadline: calendarDate(r.offer!.deadline),
                                link,
                              },
                            )
                          }
                        />
                      )}
                      {state === "WAITING_INTEREST" && (
                        <>
                          <p className="fine">{t("pendingInterestHint")}</p>
                          <div className="demand-terms">
                            <span>
                              {t("preferredBudget")}:{" "}
                              {r.detail?.flexible_price ? (
                                t("flexiblePrice")
                              ) : r.detail?.intent.budget_paise ? (
                                <Money value={r.detail.intent.budget_paise} />
                              ) : (
                                t("priceUnspecified")
                              )}
                            </span>
                            <span>
                              {t("dateOptional")}:{" "}
                              {r.detail?.no_rush
                                ? t("noRush")
                                : r.detail?.intent.deadline
                                  ? calendarDate(r.detail.intent.deadline)
                                  : t("dateUnspecified")}
                            </span>
                            {r.customer_phone && (
                              <span>
                                {t("contact")}: +{r.customer_phone}
                              </span>
                            )}
                          </div>
                          <div className="demand-entry-actions">
                            <button
                              className="button secondary small"
                              disabled={busy}
                              onClick={() => {
                                setModalError(false);
                                setRevise(r);
                              }}
                            >
                              {t("prepareOffer")}
                            </button>
                            <button
                              className="text-button small"
                              disabled={busy}
                              onClick={() =>
                                mutate({ action: "cancel", request_id: r.id })
                              }
                            >
                              {t("withdraw")}
                            </button>
                          </div>
                        </>
                      )}
                      {r.offer &&
                        ["OFFER_CREATED", "CUSTOMER_CONFIRMED"].includes(
                          r.status,
                        ) && (
                          <div className="demand-entry-actions">
                            {pending &&
                              r.customer_phone &&
                              r.detail?.contact_consent && (
                                <button
                                  className="button secondary small"
                                  disabled={busy}
                                  onClick={() => {
                                    setModalError(false);
                                    setConfirm(r);
                                  }}
                                >
                                  <Check size={15} />
                                  {t("confirmInStoreAction")}
                                </button>
                              )}
                            <button
                              className="text-button small"
                              disabled={busy}
                              onClick={() => {
                                setModalError(false);
                                setRevise(r);
                              }}
                            >
                              <Pencil size={14} />
                              {t("reviseTerms")}
                            </button>
                            <button
                              className="text-button small"
                              disabled={busy}
                              onClick={() =>
                                mutate({ action: "cancel", request_id: r.id })
                              }
                            >
                              {t("withdraw")}
                            </button>
                          </div>
                        )}
                    </article>
                  );
                }}
              />
            </details>
          ))}
          {groups.length > limit && (
            <button
              className="button secondary"
              onClick={() => setLimit(limit + 20)}
            >
              {t("showMoreProducts")}
            </button>
          )}
        </div>
      )}
      {contact && (
        <Modal title={t("addCustomerNumber")} close={() => setContact(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                await mutate({
                  action: "add_contact",
                  request_id: contact.id,
                  token: contact.request_token,
                  customer_phone: f.get("phone"),
                  contact_consent: true,
                })
              )
                setContact(null);
              else setModalError(true);
            }}
          >
            {modalError && (
              <p className="error" role="alert">
                {t("reviewFailure")}
              </p>
            )}
            <h3>
              {contact.product.name} · {pack(contact.product.pack_size)}
            </h3>
            <p>
              {contact.customer_name &&
              contact.customer_name !== "Walk-in Customer"
                ? contact.customer_name
                : t("walkIn")}
            </p>
            <p className="note">{t("contactOnlyHint")}</p>
            <label>
              {t("customerPhoneRequired")}
              <input
                name="phone"
                type="tel"
                placeholder="+91"
                maxLength={30}
                required
              />
            </label>
            <p className="fine">{t("contactUseNote")}</p>
            <p className="fine">{t("whatsAppSendHint")}</p>
            <button className="button full" disabled={busy}>
              {t("saveCustomerNumber")}
            </button>
          </form>
        </Modal>
      )}
      {confirm?.offer && (
        <Modal title={t("confirmedInStore")} close={() => setConfirm(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await mutate({
                  action: "confirm_in_store",
                  request_id: confirm.id,
                  terms_accepted: true,
                  quantity: confirm.quantity,
                  price_paise: confirm.offer!.price,
                  deadline: confirm.offer!.deadline,
                })
              )
                setConfirm(null);
              else setModalError(true);
            }}
          >
            {modalError && (
              <p className="error" role="alert">
                {t("reviewFailure")}
              </p>
            )}
            <h3>
              {confirm.product.name} · {pack(confirm.product.pack_size)}
            </h3>
            <p>
              {confirm.quantity} × <Money value={confirm.offer.price} />
            </p>
            <p>
              {t("pickupBy")}: {calendarDate(confirm.offer.deadline)}
            </p>
            <p className="fine">{t("confirmTermsHint")}</p>
            <p className="fine">{t("reservationRisk")}</p>
            <button className="button full" disabled={busy}>
              {t("confirmInStoreAction")}
            </button>
          </form>
        </Modal>
      )}
      {revise && (
        <ReservationTerms
          request={revise}
          close={() => setRevise(null)}
          busy={busy}
          mutate={mutate}
        />
      )}
    </>
  );
}
function DemandEntries({
  rows,
  render,
}: {
  rows: PrivateRequest[];
  render: (r: PrivateRequest) => React.ReactNode;
}) {
  const [limit, setLimit] = useState(20),
    t = useTranslations();
  return (
    <div className="demand-entries">
      {rows.slice(0, limit).map(render)}
      {rows.length > limit && (
        <button
          className="button secondary small"
          onClick={() => setLimit(limit + 20)}
        >
          {t("showMoreEntries")}
        </button>
      )}
    </div>
  );
}
