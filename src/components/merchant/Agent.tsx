"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import VoiceControls from "./VoiceControls";
import { api, Modal } from "./common";
export default function Agent({
  configured,
  voice,
  close,
}: {
  configured: boolean;
  voice: boolean;
  close: () => void;
}) {
  const t = useTranslations(),
    [question, setQuestion] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [rows, setRows] = useState<
      { title: string; detail: string; count: number | string }[] | null
    >(null);
  const recording = useVoiceRecording((value) => {
    setQuestion(value);
    setError("");
  });
  async function ask(tool?: string) {
    setBusy(true);
    setError("");
    try {
      setRows((await api("/api/agent", tool ? { tool } : { question })).rows);
    } catch (e) {
      const code = e instanceof Error ? e.message : "UNKNOWN";
      setError(t.has(`error.${code}`) ? t(`error.${code}`) : t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t("ask")} close={close}>
      <p className="note">{t("agentHint")}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <textarea
        rows={3}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder={t("agentPlaceholder")}
      />
      <VoiceControls voice={recording} configured={voice} disabled={busy} />
      <div className="modal-actions">
        <button
          className="button"
          disabled={
            busy ||
            recording.working ||
            recording.requesting ||
            recording.recording ||
            !configured ||
            !question.trim()
          }
          onClick={() => ask()}
        >
          {t("send")}
        </button>
      </div>
      {!configured && <p className="fine">{t("agentOff")}</p>}
      <div className="agent-quick">
        {(["requests", "nearby", "orders", "pickups"] as const).map((tool) => (
          <button
            className="button secondary small"
            disabled={
              busy ||
              recording.working ||
              recording.recording ||
              recording.requesting
            }
            key={tool}
            onClick={() => ask(tool)}
          >
            {t(
              {
                requests: "agentRequests",
                nearby: "agentNearby",
                orders: "agentOrders",
                pickups: "agentPickups",
              }[tool],
            )}
          </button>
        ))}
      </div>
      {rows && (
        <div className="agent-results" role="status">
          {rows.length ? (
            rows.map((r, i) => (
              <div key={i}>
                <span>
                  <b>{r.title}</b>
                  <small>{r.detail}</small>
                </span>
                <strong>{r.count}</strong>
              </div>
            ))
          ) : (
            <p>{t("emptyRequests")}</p>
          )}
        </div>
      )}
      <p className="fine">{t("agentReadOnly")}</p>
    </Modal>
  );
}
