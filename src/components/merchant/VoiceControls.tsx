"use client";
import { Mic, Square, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import type { useVoiceRecording } from "@/hooks/useVoiceRecording";
export default function VoiceControls({
  voice,
  configured,
  disabled = false,
}: {
  voice: ReturnType<typeof useVoiceRecording>;
  configured: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations();
  return (
    <div className="voice-section">
      {voice.error && (
        <p className="error" role="alert">
          {t.has(`error.${voice.error}`)
            ? t(`error.${voice.error}`)
            : t("errorGeneric")}
        </p>
      )}
      <div className="voice-controls">
        <button
          type="button"
          className={`button secondary small ${voice.recording ? "recording" : ""}`}
          disabled={
            !configured ||
            disabled ||
            voice.working ||
            voice.requesting ||
            !!voice.support
          }
          onClick={voice.toggle}
        >
          {voice.recording ? (
            <Square size={16} />
          ) : voice.requesting || voice.working ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Mic size={16} />
          )}{" "}
          {t(voice.recording ? "listen" : "speak")}
        </button>
        {voice.recording && (
          <span className="live-voice" role="status">
            <span className="voice-wave" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            {t("voiceLive")}
          </span>
        )}
      </div>
      <p className="fine voice-hint">
        {t(
          !configured
            ? "voiceOff"
            : voice.requesting
              ? "voicePermissionPending"
              : voice.working
                ? "transcribing"
                : "voiceConsent",
        )}
      </p>
      {configured && voice.support && !voice.error && (
        <p className="note">{t(`error.${voice.support}`)}</p>
      )}
    </div>
  );
}
