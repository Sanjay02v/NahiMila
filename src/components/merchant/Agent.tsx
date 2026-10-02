"use client";
import { useRef, useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Mic, Square } from "lucide-react";
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
    >(null),
    [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      stream.current?.getTracks().forEach((t) => t.stop());
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
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
  async function record() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const r = new MediaRecorder(stream.current);
      recorder.current = r;
      const chunks: BlobPart[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = async () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setBusy(true);
        try {
          const form = new FormData();
          form.append(
            "file",
            new Blob(chunks, { type: r.mimeType }),
            "question.webm",
          );
          const response = await fetch("/api/voice/transcribe", {
            method: "POST",
            body: form,
          });
          const j = await response.json();
          if (!response.ok) throw new Error();
          setQuestion(j.transcript);
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
      setError(t("voiceOff"));
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
      <div className="modal-actions">
        <button
          className="button secondary"
          onClick={record}
          disabled={busy || !voice}
        >
          {recording ? <Square size={17} /> : <Mic size={17} />}{" "}
          {t(recording ? "listen" : "speak")}
        </button>
        <button
          className="button"
          disabled={busy || !configured || !question.trim()}
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
            disabled={busy}
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
