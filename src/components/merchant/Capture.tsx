"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, LoaderCircle } from "lucide-react";
import type { Intent } from "@/lib/product/types";
import type { MatchReview } from "@/lib/product/matching";
import { manualDraft, parseIntent } from "@/lib/product/intent";
import {
  captureHints,
  dayFromDeadline,
  deadlineFromDay,
  detailsText,
  withDetails,
} from "@/lib/product/capture-fields";
import { api, Modal } from "./common";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import VoiceControls from "./VoiceControls";
export default function Capture({
  voice,
  initial = "",
  initialWait = false,
  mode = "type",
  close,
  saved,
}: {
  voice: boolean;
  initial?: string;
  initialWait?: boolean;
  mode?: "type" | "voice";
  close: () => void;
  saved: (b: Record<string, unknown>) => Promise<boolean>;
}) {
  const t = useTranslations();
  const [raw, setRaw] = useState(initial),
    [intent, setIntent] = useState<Intent | null>(null),
    [match, setMatch] = useState<MatchReview | null>(null);
  const [wait, setWait] = useState(initialWait),
    [phone, setPhone] = useState(""),
    [details, setDetails] = useState(""),
    [flexible, setFlexible] = useState(false),
    [noRush, setNoRush] = useState(false),
    [offerPrice, setOfferPrice] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const submission = useRef(crypto.randomUUID()),
    textInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (mode !== "type" || intent) return;
    const timer = setTimeout(() => textInput.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [mode, intent]);
  const recording = useVoiceRecording(
    (value, final) => {
      setRaw(value);
      setNotice(final ? t("recorded") : "");
    },
    { autoStart: mode === "voice" && voice },
  );
  const reviewed = intent ? withDetails(intent, details) : null;
  const reserving = wait && !!phone.trim();
  const complete = !!(
    reserving &&
    reviewed?.size &&
    reviewed.unit &&
    offerPrice &&
    reviewed.deadline
  );
  const update = (field: keyof Intent, value: unknown) => {
    if (["product", "brand", "hard_constraints"].includes(field))
      setMatch(null);
    setIntent((i) => (i ? { ...i, [field]: value } : i));
  };
  async function interpret() {
    setBusy(true);
    setError("");
    setNotice("");
    let next: Intent,
      nextMatch: MatchReview | null = null;
    try {
      const j = await api("/api/intent", { raw_text: raw });
      next = parseIntent(j.intent);
      nextMatch = j.match;
    } catch {
      next = manualDraft(raw);
      setNotice(t("aiFailed"));
    }
    const hints = captureHints(raw, next);
    setIntent({
      ...next,
      budget_paise: hints.flexible_price ? null : next.budget_paise,
      deadline: hints.no_rush
        ? null
        : deadlineFromDay(dayFromDeadline(next.deadline)),
    });
    setDetails(detailsText(next));
    setMatch(nextMatch);
    setWait(hints.can_wait ?? initialWait);
    setPhone(hints.phone ? `+${hints.phone}` : "");
    setFlexible(hints.flexible_price);
    setNoRush(hints.no_rush);
    setOfferPrice("");
    setBusy(false);
  }
  const save = async (confirmInStore: boolean) => {
    if (!reviewed) return;
    setBusy(true);
    setError("");
    const result = await saved({
      action: "create",
      raw_text: raw,
      intent: {
        ...reviewed,
        quantity: reviewed.quantity ?? 1,
        budget_paise: flexible ? null : reviewed.budget_paise,
      },
      can_wait: wait,
      customer_name: customer.current?.value || "",
      customer_phone: phone.trim(),
      contact_consent: !!phone.trim(),
      confirm_in_store: confirmInStore,
      terms_accepted: confirmInStore,
      offer_price_paise: offerPrice
        ? Math.round(Number(offerPrice) * 100)
        : null,
      flexible_price: flexible,
      no_rush: noRush,
      submission_key: submission.current,
    });
    setBusy(false);
    if (result) close();
    else setError(t("errorGeneric"));
  };
  const customer = useRef<HTMLInputElement>(null);
  return (
    <Modal title={intent ? t("review") : t("recordRequest")} close={close}>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="note">
          {notice}
        </p>
      )}
      {!intent ? (
        <>
          <label>
            {t("rawLabel")}
            <textarea
              ref={textInput}
              autoFocus={mode === "type"}
              rows={4}
              readOnly={recording.recording || recording.working}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={t("rawPlaceholder")}
              maxLength={1200}
            />
          </label>
          <VoiceControls voice={recording} configured={voice} disabled={busy} />
          <button
            className="button full"
            disabled={
              busy ||
              recording.working ||
              recording.requesting ||
              recording.recording ||
              !raw.trim()
            }
            onClick={interpret}
          >
            {busy ? (
              <LoaderCircle className="spin" />
            ) : (
              <ArrowRight size={18} />
            )}
            {t("interpret")}
          </button>
        </>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await save(
              (e.nativeEvent as SubmitEvent).submitter?.getAttribute(
                "data-confirm",
              ) === "true",
            );
          }}
        >
          <p className="note">
            {intent.source === "gemini" ? t("aiReview") : t("manual")}
          </p>
          <p className="original-text">“{raw}”</p>
          {match && (
            <p className="match-review" role="status">
              {t(
                match.kind === "matched"
                  ? "matchFound"
                  : match.kind === "uncertain"
                    ? "matchUncertain"
                    : "matchNew",
                { product: match.label },
              )}
            </p>
          )}
          <div className="form-grid">
            <label className="span-two">
              {t("product")}
              <input
                value={intent.product}
                onChange={(e) => update("product", e.target.value)}
                required
                maxLength={160}
              />
            </label>
            <label>
              {t("brandName")}
              <input
                value={intent.brand || ""}
                onChange={(e) => update("brand", e.target.value || null)}
                maxLength={120}
              />
            </label>
            <label>
              {t("variantDetails")}
              <input
                value={details}
                onChange={(e) => {
                  setDetails(e.target.value);
                  setMatch(null);
                }}
                placeholder={t("variantExample")}
                maxLength={120}
              />
            </label>
            <label>
              {t("quantity")}
              <input
                type="number"
                min="1"
                max="100"
                value={intent.quantity ?? 1}
                onChange={(e) =>
                  update(
                    "quantity",
                    e.target.value ? Number(e.target.value) : null,
                  )
                }
                required
              />
            </label>
            <label>
              {t("preferredBudget")}
              <input
                type="number"
                min="0.01"
                step="0.01"
                disabled={flexible}
                value={
                  intent.budget_paise === null ? "" : intent.budget_paise / 100
                }
                onChange={(e) =>
                  update(
                    "budget_paise",
                    e.target.value
                      ? Math.round(Number(e.target.value) * 100)
                      : null,
                  )
                }
              />
            </label>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={flexible}
              onChange={(e) => {
                setFlexible(e.target.checked);
                if (e.target.checked) update("budget_paise", null);
              }}
            />
            {t("flexiblePrice")}
          </label>
          <details className="details">
            <summary>{t("extraPreferences")}</summary>
            <label>
              {t("constraints")}
              <input
                value={intent.hard_constraints.join(", ")}
                onChange={(e) =>
                  update(
                    "hard_constraints",
                    e.target.value
                      .split(",")
                      .map((v) => v.trim())
                      .filter(Boolean),
                  )
                }
              />
            </label>
            <label>
              {t("preferences")}
              <input
                value={intent.preferences.join(", ")}
                onChange={(e) =>
                  update(
                    "preferences",
                    e.target.value
                      .split(",")
                      .map((v) => v.trim())
                      .filter(Boolean),
                  )
                }
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={intent.substitutions}
                onChange={(e) => update("substitutions", e.target.checked)}
              />
              {t("substitutions")}
            </label>
          </details>
          <label className="check wait">
            <input
              type="checkbox"
              checked={wait}
              onChange={(e) => setWait(e.target.checked)}
            />
            <span>
              {t("wait")}
              <small>{t("waitHint")}</small>
            </span>
          </label>
          <div className="form-grid">
            <label>
              {t("customerPhoneOptional")}
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91"
                maxLength={30}
              />
            </label>
            <label>
              {t("customerName")}
              <input ref={customer} maxLength={80} />
            </label>
          </div>
          {!!phone.trim() && <p className="fine">{t("contactUseNote")}</p>}
          {wait && (
            <>
              <div className="form-grid">
                <label>
                  {t("exactPriceOptional")}
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    max={
                      !flexible && intent.budget_paise
                        ? intent.budget_paise / 100
                        : undefined
                    }
                    value={offerPrice}
                    onChange={(e) => setOfferPrice(e.target.value)}
                  />
                </label>
                <label>
                  {t("dateOptional")}
                  <input
                    type="date"
                    disabled={noRush}
                    value={dayFromDeadline(intent.deadline)}
                    onChange={(e) =>
                      update("deadline", deadlineFromDay(e.target.value))
                    }
                  />
                </label>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={noRush}
                  onChange={(e) => {
                    setNoRush(e.target.checked);
                    if (e.target.checked) update("deadline", null);
                  }}
                />
                {t("noRush")}
              </label>
              <p className="note">
                {t(
                  !reserving
                    ? "noContactHint"
                    : complete
                      ? "offerChoiceHint"
                      : "pendingInterestHint",
                )}
              </p>
              <p className="fine">{t("reservationRisk")}</p>
            </>
          )}
          <div className="modal-actions capture-save-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => setIntent(null)}
            >
              {t("back")}
            </button>
            <button className="button" disabled={busy}>
              {t("save")}
              {<ArrowRight size={18} />}
            </button>
            {complete && (
              <button
                className="button secondary"
                data-confirm="true"
                disabled={busy}
              >
                {t("confirmInStoreAction")}
              </button>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}
