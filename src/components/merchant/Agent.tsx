"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowUp,
  ArrowUpRight,
  Sparkles,
  LoaderCircle,
  ClipboardCheck,
} from "lucide-react";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import type { AssistantResult, ReadTool } from "@/lib/product/assistant";
import VoiceControls from "./VoiceControls";
import { Modal } from "./common";
type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  result?: AssistantResult;
};
export default function Agent({
  configured,
  voice,
  close,
  onDraft,
  navigate,
}: {
  configured: boolean;
  voice: boolean;
  close: () => void;
  onDraft: (draft: { raw: string; can_wait: boolean | null }) => void;
  navigate: (screen: "requests" | "nearby" | "orders") => void;
}) {
  const t = useTranslations(),
    [question, setQuestion] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [messages, setMessages] = useState<Message[]>([]);
  const tail = useRef<HTMLDivElement>(null),
    abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    tail.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);
  const recording = useVoiceRecording((value) => {
    setQuestion(value);
    setError("");
  });
  const disabled =
    busy || recording.working || recording.requesting || recording.recording;
  const labels = {
    requests: "agentRequests",
    nearby: "agentNearby",
    orders: "agentOrders",
    pickups: "agentPickups",
    stock: "agentStock",
    quotes: "agentQuotes",
  } as const;
  async function ask(tool?: ReadTool) {
    if (disabled) return;
    const text = tool ? t(labels[tool]) : question.trim();
    if (!text) return;
    const history = messages
      .slice(-8)
      .map((m) => ({ role: m.role, text: m.text.slice(0, 2400) }));
    setBusy(true);
    setError("");
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", text }]);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tool ? { tool } : { question: text, history }),
        signal: controller.signal,
      });
      const j = await response.json();
      if (!response.ok) throw new Error(j.error || "UNKNOWN");
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: j.answer,
          result: j,
        },
      ]);
      setQuestion("");
    } catch (e) {
      if (!controller.signal.aborted) {
        const code = e instanceof Error ? e.message : "UNKNOWN";
        setError(
          t.has(`error.${code}`) ? t(`error.${code}`) : t("errorGeneric"),
        );
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <Modal title={t("ask")} close={close} className="assistant-modal">
      <div className="assistant-shell">
        <div className="assistant-intro">
          <span className="assistant-emblem">
            <Sparkles size={20} />
          </span>
          <div>
            <strong>{t("agentWelcome")}</strong>
            <p>{t("agentHint")}</p>
          </div>
        </div>
        <div
          className="assistant-thread"
          role="log"
          aria-label={t("agentConversation")}
          aria-live="polite"
          aria-relevant="additions"
        >
          {!messages.length && (
            <div className="assistant-welcome">
              <h3>{t("agentWelcomeQuestion")}</h3>
              <p>{t("agentWelcomeDetail")}</p>
              <button
                className="assistant-example"
                disabled={disabled || !configured}
                onClick={() => setQuestion(t("agentDraftExample"))}
              >
                <ClipboardCheck size={18} />
                <span>{t("agentDraftExample")}</span>
              </button>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`chat-message ${m.role}`}>
              <span className="chat-speaker">
                {t(m.role === "user" ? "agentYou" : "ask")}
              </span>
              <p>{m.text}</p>
              {m.result?.rows.length ? (
                <div className="assistant-evidence">
                  <span className="eyebrow">
                    {t(
                      m.result.tool === "nearby"
                        ? "agentNearbyEvidence"
                        : m.result.tool === "stock"
                          ? "agentStockEvidence"
                          : m.result.tool === "quotes"
                            ? "agentQuoteEvidence"
                            : "agentEvidence",
                    )}
                  </span>
                  {m.result.rows.slice(0, 8).map((r, i) => (
                    <div className="assistant-evidence-row" key={i}>
                      <span>
                        <strong>{r.title}</strong>
                        <small>{r.detail}</small>
                      </span>
                      <b>{r.count}</b>
                    </div>
                  ))}
                  {m.result.rows.length > 8 && (
                    <p className="fine">{t("agentMoreRecords")}</p>
                  )}
                </div>
              ) : null}
              {m.result?.draft && (
                <div className="assistant-draft">
                  <span className="eyebrow">{t("agentDraftLabel")}</span>
                  <p>{m.result.draft.raw}</p>
                  <small>{t("agentDraftNotice")}</small>
                  <button
                    className="button small"
                    disabled={disabled}
                    onClick={() => onDraft(m.result!.draft!)}
                  >
                    <ClipboardCheck size={16} />
                    {t("agentReviewDraft")}
                  </button>
                </div>
              )}
              {m.result?.screen && (
                <button
                  className="assistant-open"
                  disabled={disabled}
                  onClick={() => navigate(m.result!.screen!)}
                >
                  {t(
                    {
                      requests: "agentOpenRequests",
                      nearby: "agentOpenNearby",
                      orders: "agentOpenOrders",
                    }[m.result.screen],
                  )}
                  <ArrowUpRight size={15} />
                </button>
              )}
            </div>
          ))}
          {busy && (
            <div
              className="chat-message assistant assistant-thinking"
              role="status"
            >
              <LoaderCircle size={16} className="spin" />
              {t("agentThinking")}
            </div>
          )}
          <div ref={tail} />
        </div>
        <div className="agent-quick">
          {(["requests", "nearby", "stock", "quotes"] as const).map((tool) => (
            <button
              className="assistant-chip"
              disabled={disabled}
              key={tool}
              onClick={() => ask(tool)}
            >
              {t(labels[tool])}
            </button>
          ))}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="assistant-composer">
          <label className="sr-only" htmlFor="assistant-question">
            {t("agentConversation")}
          </label>
          <textarea
            id="assistant-question"
            rows={2}
            value={question}
            maxLength={1200}
            readOnly={recording.recording || recording.working}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t("agentPlaceholder")}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                if (!disabled && configured) void ask();
              }
            }}
          />
          <button
            className="assistant-send"
            aria-label={t("send")}
            disabled={disabled || !configured || !question.trim()}
            onClick={() => ask()}
          >
            {busy ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <ArrowUp size={20} />
            )}
          </button>
        </div>
        <VoiceControls voice={recording} configured={voice} disabled={busy} />
        {!configured && <p className="fine">{t("agentOff")}</p>}
        <p className="fine assistant-footnote">{t("agentReadOnly")}</p>
      </div>
    </Modal>
  );
}
