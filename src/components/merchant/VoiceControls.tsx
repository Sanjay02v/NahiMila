"use client";
import { Mic, Square, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";
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
  const input = useRef<HTMLInputElement>(null);
  const busy = disabled || voice.working || voice.requesting;
  return (
    <>
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
          className={`button secondary ${voice.recording ? "recording" : ""}`}
          disabled={!configured || busy || !!voice.support}
          onClick={voice.toggle}
        >
          {voice.recording ? <Square size={18} /> : <Mic size={18} />}{" "}
          {t(voice.recording ? "listen" : "speak")}
        </button>
        <button
          type="button"
          className="button secondary small"
          disabled={!configured || busy || voice.recording}
          onClick={() => input.current?.click()}
        >
          <Upload size={16} />
          {t("uploadAudio")}
        </button>
        <input
          ref={input}
          hidden
          type="file"
          disabled={!configured || busy || voice.recording}
          accept="audio/*,.m4a,.webm,.wav,.mp3,.ogg,.flac"
          aria-label={t("uploadAudio")}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void voice.upload(file, file.name);
            e.target.value = "";
          }}
        />
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
    </>
  );
}
