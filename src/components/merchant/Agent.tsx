"use client";
import { useProductLabels } from "./useProductLabels";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowUp,
  ArrowUpRight,
  Sparkles,
  LoaderCircle,
  ClipboardCheck,
  Mic,
  Square,
  Minus,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import type { AssistantResult, ReadTool } from "@/lib/product/assistant";

const mobileQuery = "(max-width: 640px)";
const subscribeMobile = (notify: () => void) => {
  const query = window.matchMedia(mobileQuery);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
const mobileSnapshot = () => window.matchMedia(mobileQuery).matches;
type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  result?: AssistantResult;
};
export default function Agent({
  open,
  configured,
  voice,
  close,
  onDraft,
  navigate,
}: {
  open: boolean;
  configured: boolean;
  voice: boolean;
  close: () => void;
  onDraft: (draft: { raw: string; can_wait: boolean | null }) => void;
  navigate: (screen: "requests" | "nearby" | "orders") => void;
}) {
  const label = useProductLabels();
  const mobile = useSyncExternalStore(
    subscribeMobile,
    mobileSnapshot,
    () => false,
  );
  const dismiss = () => {
    close();
    document.querySelector<HTMLButtonElement>(".ask-button")?.focus();
  };
  const t = useTranslations(),
    [question, setQuestion] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [messages, setMessages] = useState<Message[]>([]),
    [expanded, setExpanded] = useState(false),
    [starterTool, setStarterTool] = useState<ReadTool | null>(null);
  const tail = useRef<HTMLDivElement>(null),
    abort = useRef<AbortController | null>(null),
    panel = useRef<HTMLElement>(null),
    composer = useRef<HTMLTextAreaElement>(null),
    closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);
  useEffect(() => {
    if (!open) return;
    const focus = setTimeout(() => composer.current?.focus(), 0);
    const overflow = document.body.style.overflow;
    if (mobile) document.body.style.overflow = "hidden";
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeRef.current();
        document.querySelector<HTMLButtonElement>(".ask-button")?.focus();
      }
      if (mobile && event.key === "Tab") {
        const nodes = Array.from(
          panel.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),textarea",
          ) || [],
        );
        const first = nodes[0],
          last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      clearTimeout(focus);
      document.removeEventListener("keydown", key);
      if (mobile) document.body.style.overflow = overflow;
    };
  }, [open, mobile]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    tail.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy, open]);
  const recording = useVoiceRecording(
    (value) => {
      setQuestion(value);
      setStarterTool(null);
      setError("");
    },
    { enabled: open },
  );
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
      setStarterTool(null);
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
    <section
      id="merchant-assistant"
      hidden={!open}
      ref={panel}
      className={`assistant-panel ${expanded ? "expanded" : ""}`}
      role="dialog"
      aria-label={t("ask")}
      aria-modal={mobile || undefined}
    >
      <header className="assistant-panel-header">
        <span className="assistant-emblem">
          <Sparkles size={18} />
        </span>
        <div>
          <h2>{t("ask")}</h2>
          <small>{t("agentWelcome")}</small>
        </div>
        <div className="assistant-panel-actions">
          <button
            className="icon-button assistant-expand"
            aria-label={t(expanded ? "agentCollapse" : "agentExpand")}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
          <button
            className="icon-button"
            aria-label={t("agentMinimize")}
            onClick={dismiss}
          >
            <Minus size={18} />
          </button>
          <button
            className="icon-button"
            aria-label={t("close")}
            onClick={dismiss}
          >
            <X size={18} />
          </button>
        </div>
      </header>
      <div className="assistant-shell">
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
              <p>{t("agentCompactHint")}</p>
              <span className="assistant-try">{t("agentTry")}</span>
              <div className="assistant-starters">
                {(
                  [
                    { key: "agentStarterRequests", tool: "requests" },
                    { key: "agentStarterQuotes", tool: "quotes" },
                    { key: "agentStarterCapture", tool: null },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.key}
                    disabled={disabled || (!configured && !item.tool)}
                    onClick={() => {
                      setQuestion(t(item.key));
                      setStarterTool(item.tool);
                      composer.current?.focus();
                    }}
                  >
                    {t(item.key)}
                    <ArrowUpRight size={14} />
                  </button>
                ))}
              </div>
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
                        <strong>{label(r.title)}</strong>
                        <small>{label(r.detail)}</small>
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
            ref={composer}
            rows={2}
            value={question}
            maxLength={1200}
            readOnly={recording.recording || recording.working}
            onChange={(e) => {
              setQuestion(e.target.value);
              setStarterTool(null);
            }}
            placeholder={t("agentPlaceholder")}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                if (!disabled && (configured || starterTool))
                  void ask(
                    !configured && starterTool ? starterTool : undefined,
                  );
              }
            }}
          />
          <div className="assistant-input-actions">
            <button
              type="button"
              className={`assistant-mic ${recording.recording ? "recording" : ""}`}
              aria-label={t(recording.recording ? "voiceStop" : "voiceStart")}
              title={t(recording.recording ? "voiceStop" : "voiceStart")}
              disabled={
                !voice ||
                busy ||
                recording.working ||
                recording.requesting ||
                !!recording.support
              }
              onClick={recording.toggle}
            >
              {recording.recording ? (
                <Square size={17} />
              ) : recording.requesting || recording.working ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <Mic size={19} />
              )}
            </button>
            <button
              className="assistant-send"
              aria-label={t("send")}
              disabled={
                disabled || (!configured && !starterTool) || !question.trim()
              }
              onClick={() =>
                ask(!configured && starterTool ? starterTool : undefined)
              }
            >
              {busy ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <ArrowUp size={20} />
              )}
            </button>
          </div>
        </div>
        {recording.error && (
          <p className="error" role="alert">
            {t.has(`error.${recording.error}`)
              ? t(`error.${recording.error}`)
              : t("errorGeneric")}
          </p>
        )}
        {voice && recording.support && !recording.error && (
          <p className="fine">{t(`error.${recording.support}`)}</p>
        )}
        <p
          className="fine assistant-voice-status"
          role={
            recording.recording || recording.working || recording.requesting
              ? "status"
              : undefined
          }
        >
          {t(
            recording.recording
              ? "voiceLive"
              : recording.working
                ? "transcribing"
                : recording.requesting
                  ? "voicePermissionPending"
                  : voice
                    ? "agentVoiceHint"
                    : "voiceOff",
          )}
        </p>
        {!configured && <p className="fine">{t("agentOff")}</p>}
        <p className="fine assistant-footnote">{t("agentReadOnly")}</p>
      </div>
    </section>
  );
}
