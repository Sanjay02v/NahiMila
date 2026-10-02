"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, LoaderCircle } from "lucide-react";
import type { Intent } from "@/lib/product/types";
import type { MatchReview } from "@/lib/product/matching";
import { manualDraft } from "@/lib/product/intent";
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
  const t = useTranslations(),
    [raw, setRaw] = useState(initial),
    [intent, setIntent] = useState<Intent | null>(null),
    [match, setMatch] = useState<MatchReview | null>(null),
    [wait, setWait] = useState(initialWait),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const submission = useRef(crypto.randomUUID());
  const textInput = useRef<HTMLTextAreaElement>(null);
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
  const update = (field: keyof Intent, value: unknown) => {
    if (
      [
        "product",
        "brand",
        "variant",
        "size",
        "unit",
        "packaging",
        "hard_constraints",
      ].includes(field)
    )
      setMatch(null);
    setIntent((i) => (i ? { ...i, [field]: value } : i));
  };
  async function interpret() {
    setBusy(true);
    setError("");
    try {
      const j = await api("/api/intent", { raw_text: raw });
      setIntent(j.intent);
      setMatch(j.match);
    } catch {
      setIntent(manualDraft(raw));
      setNotice(t("aiFailed"));
    } finally {
      setBusy(false);
    }
  }
  const localDate = (value: string | null) =>
    value
      ? new Date(
          Date.parse(value) - new Date(value).getTimezoneOffset() * 60000,
        )
          .toISOString()
          .slice(0, 16)
      : "";
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
            )}{" "}
            {t("interpret")}
          </button>
        </>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const f = new FormData(e.currentTarget);
            const result = await saved({
              action: "create",
              raw_text: raw,
              intent: { ...intent, quantity: intent.quantity ?? 1 },
              can_wait: wait,
              customer_name: f.get("customer"),
              submission_key: submission.current,
            });
            setBusy(false);
            if (result) close();
            else setError(t("errorGeneric"));
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
              />
            </label>
            <label>
              {t("variant")}
              <input
                value={intent.variant || ""}
                onChange={(e) => update("variant", e.target.value || null)}
              />
            </label>
            <label>
              {t("size")}
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={intent.size ?? ""}
                onChange={(e) =>
                  update("size", e.target.value ? Number(e.target.value) : null)
                }
                required={wait}
              />
            </label>
            <label>
              {t("unit")}
              <select
                value={intent.unit || ""}
                onChange={(e) => update("unit", e.target.value || null)}
                required={wait}
              >
                <option value="">—</option>
                <option value="g">g</option>
                <option value="ml">ml</option>
                <option value="piece">{t("units")}</option>
              </select>
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
                required={wait}
              />
            </label>
            <label>
              {t("budget")}
              <input
                type="number"
                min="0.01"
                step="0.01"
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
                required={wait}
              />
            </label>
            <details className="span-two details">
              <summary>{t("constraints")}</summary>
              <label>
                {t("packaging")}
                <input
                  value={intent.packaging || ""}
                  onChange={(e) => update("packaging", e.target.value || null)}
                />
              </label>
              <label>
                {t("constraints")}
                <input
                  value={intent.hard_constraints.join(", ")}
                  onChange={(e) =>
                    update(
                      "hard_constraints",
                      e.target.value
                        .split(",")
                        .map((s) => s.trim())
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
                        .map((s) => s.trim())
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
          </div>
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
          {wait && (
            <>
              <label>
                {t("deadline")}
                <input
                  type="datetime-local"
                  value={localDate(intent.deadline)}
                  onChange={(e) =>
                    update(
                      "deadline",
                      e.target.value
                        ? new Date(e.target.value).toISOString()
                        : null,
                    )
                  }
                  required
                />
              </label>
              <label>
                {t("customerName")}
                <input name="customer" maxLength={80} />
              </label>
              <p className="fine">{t("offerHint")}</p>
            </>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => setIntent(null)}
            >
              {t("back")}
            </button>
            <button className="button" disabled={busy}>
              {t("save")}
              <ArrowRight size={18} />
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
