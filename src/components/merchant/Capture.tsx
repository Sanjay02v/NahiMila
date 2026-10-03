"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, LoaderCircle } from "lucide-react";
import type { Intent } from "@/lib/product/types";
import { manualDraft, parseIntent } from "@/lib/product/intent";
import {
  captureHints,
  phoneNumber,
  customerNameFromText,
} from "@/lib/product/capture-fields";
import {
  combinedItemFields,
  reviewCombinedItemFields,
} from "@/lib/product/item-review";
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
    [item, setItem] = useState(""),
    [variant, setVariant] = useState("");
  const [wait, setWait] = useState<boolean | null>(initialWait ? true : null),
    [phone, setPhone] = useState(""),
    [customer, setCustomer] = useState(""),
    [quantity, setQuantity] = useState("1");
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
  async function interpret() {
    setBusy(true);
    setError("");
    setNotice("");
    let next: Intent;
    let customerName = customerNameFromText(raw) || "";
    try {
      const j = await api("/api/intent", { raw_text: raw });
      next = parseIntent(j.intent);
      customerName =
        typeof j.capture?.customer_name === "string"
          ? j.capture.customer_name
          : customerName;
    } catch (e) {
      next = manualDraft(raw);
      setNotice(
        t(
          e instanceof Error && e.message === "AI_DAILY_LIMIT"
            ? "aiDailyLimit"
            : e instanceof Error && e.message === "AI_RATE_LIMIT"
              ? "aiLimited"
              : "aiFailed",
        ),
      );
    }
    const hints = captureHints(raw, next);
    const nextIntent = {
      ...next,
      budget_paise: hints.flexible_price ? null : next.budget_paise,
      deadline: hints.no_rush ? null : next.deadline,
      flexible_price: hints.flexible_price,
      no_rush: hints.no_rush,
    };
    setIntent(nextIntent);
    const fields = combinedItemFields(nextIntent);
    setItem(fields.item);
    setVariant(fields.details);
    setQuantity(String(next.quantity ?? 1));
    setWait(hints.can_wait ?? (initialWait ? true : null));
    setPhone(hints.phone ? `+${hints.phone}` : "");
    setCustomer(customerName);
    setBusy(false);
  }
  const save = async () => {
    if (!intent) return;
    setBusy(true);
    setError("");
    try {
      const contact = wait === true ? phone.trim() : "";
      try {
        phoneNumber(contact);
      } catch {
        throw new Error("INVALID_PHONE");
      }
      const reviewed = await reviewCombinedItemFields(
        { item, details: variant },
        intent,
        async (value) => {
          const j = await api("/api/intent", { raw_text: value });
          return j.intent;
        },
      );
      const result = await saved({
        action: "create",
        raw_text: raw,
        intent: { ...reviewed, quantity: Number(quantity), can_wait: wait },
        can_wait: wait === true,
        customer_name: wait === true ? customer : "",
        customer_phone: contact,
        contact_consent: !!contact,
        // Capture always records interest. Actual offers are a later, explicit step.
        offer_price_paise: null,
        flexible_price: intent.flexible_price === true,
        no_rush: intent.no_rush === true,
        submission_key: submission.current,
      });
      if (result) close();
      else setError(t("reviewFailure"));
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setError(
        t(
          code === "INVALID_PHONE"
            ? "phoneFix"
            : code === "PACK_INVALID"
              ? "packFix"
              : "itemReviewRetry",
        ),
      );
    } finally {
      setBusy(false);
    }
  };
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
            {t(busy ? "understandingRequest" : "interpret")}
          </button>
        </>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await save();
          }}
          className="simple-capture"
        >
          <p className="fine">
            {t(
              intent.source === "gemini" ? "aiFilledHint" : "simpleReviewHint",
            )}
          </p>
          <label>
            {t("itemLabel")}
            <input
              value={item}
              onChange={(e) => setItem(e.target.value)}
              required
              maxLength={300}
            />
          </label>
          <label>
            {t("itemDetailsOptional")}
            <input
              value={variant}
              onChange={(e) => setVariant(e.target.value)}
              maxLength={220}
              placeholder={t("combinedDetailsExample")}
            />
          </label>
          <label>
            {t("quantity")}
            <input
              type="number"
              min="1"
              max="100"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
          </label>
          <fieldset className="wait-choices">
            <legend>{t("canCustomerWait")}</legend>
            <div className="wait-options">
              {([true, false] as const).map((choice) => (
                <label
                  className={`wait-choice ${wait === choice ? "selected" : ""}`}
                  key={String(choice)}
                >
                  <input
                    type="radio"
                    name="wait"
                    checked={wait === choice}
                    onChange={() => setWait(choice)}
                  />
                  {t(choice ? "waitYes" : "waitNo")}
                </label>
              ))}
            </div>
          </fieldset>
          {wait === true && (
            <>
              <p className="fine">{t("contactOptionalHint")}</p>
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
                  <input
                    value={customer}
                    onChange={(e) => setCustomer(e.target.value)}
                    maxLength={80}
                  />
                </label>
              </div>
              {!!phone.trim() && <p className="fine">{t("contactUseNote")}</p>}
            </>
          )}
          <p className="note">{t("simpleSaveHint")}</p>
          <div className="modal-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setIntent(null)}
            >
              {t("back")}
            </button>
            <button className="button" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <ArrowRight size={18} />
              )}
              {t("save")}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
