"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Mic, Square, ArrowRight, LoaderCircle } from "lucide-react";
import type { Intent } from "@/lib/product/types";
import { manualDraft } from "@/lib/product/intent";
import { api, Modal } from "./common";
export default function Capture({
  voice,
  initial = "",
  close,
  saved,
}: {
  voice: boolean;
  initial?: string;
  close: () => void;
  saved: (b: Record<string, unknown>) => Promise<boolean>;
}) {
  const t = useTranslations(),
    [raw, setRaw] = useState(initial),
    [intent, setIntent] = useState<Intent | null>(null),
    [wait, setWait] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [recording, setRecording] = useState(false),
    [notice, setNotice] = useState("");
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    submission = useRef(crypto.randomUUID());
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  const update = (field: keyof Intent, value: unknown) =>
    setIntent((i) => (i ? { ...i, [field]: value } : i));
  async function interpret() {
    setBusy(true);
    setError("");
    try {
      const j = await api("/api/intent", { raw_text: raw });
      setIntent(j.intent);
    } catch {
      setIntent(manualDraft(raw));
      setNotice(t("aiFailed"));
    } finally {
      setBusy(false);
    }
  }
  async function record() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    setError("");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const r = new MediaRecorder(stream.current);
      recorder.current = r;
      const chunks: BlobPart[] = [];
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r.onstop = async () => {
        setRecording(false);
        stream.current?.getTracks().forEach((t) => t.stop());
        setBusy(true);
        try {
          const f = new FormData();
          f.append(
            "file",
            new Blob(chunks, { type: r.mimeType }),
            "request.webm",
          );
          const response = await fetch("/api/voice/transcribe", {
            method: "POST",
            body: f,
          });
          const j = await response.json();
          if (!response.ok) throw new Error("AI_UNAVAILABLE");
          setRaw(j.transcript);
          setNotice(t("recorded"));
        } catch {
          setError(t("voiceOff"));
        } finally {
          setBusy(false);
        }
      };
      r.start();
      setRecording(true);
      timer.current = setTimeout(() => {
        if (r.state === "recording") r.stop();
      }, 20000);
    } catch {
      stream.current?.getTracks().forEach((t) => t.stop());
      setError(t("voiceOff"));
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
              autoFocus
              rows={4}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={t("rawPlaceholder")}
              maxLength={1200}
            />
          </label>
          <div className="voice-controls">
            <button
              className={`button secondary ${recording ? "recording" : ""}`}
              disabled={!voice || busy}
              onClick={record}
            >
              {recording ? <Square size={18} /> : <Mic size={18} />}{" "}
              {recording ? t("listen") : t("speak")}
            </button>
            <p>{voice ? t("voiceConsent") : t("voiceOff")}</p>
          </div>
          <button
            className="button full"
            disabled={busy || !raw.trim()}
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
