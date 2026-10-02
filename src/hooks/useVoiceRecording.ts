"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  MAX_RECORDING_MS,
  microphoneError,
  preferredAudioType,
  recordingFilename,
  transcribeAudio,
} from "@/lib/voice/audio";
const subscribe = () => () => {};
function microphoneSupport() {
  if (typeof window === "undefined") return "";
  if (!window.isSecureContext) return "MICROPHONE_INSECURE";
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === "undefined"
  )
    return "MICROPHONE_UNSUPPORTED";
  return "";
}
export function useVoiceRecording(onTranscript: (value: string) => void) {
  const support = useSyncExternalStore(subscribe, microphoneSupport, () => "");
  const [recording, setRecording] = useState(false),
    [working, setWorking] = useState(false),
    [requesting, setRequesting] = useState(false),
    [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    mounted = useRef(true),
    abort = useRef<AbortController | null>(null),
    callback = useRef(onTranscript),
    failed = useRef(false);
  useEffect(() => {
    callback.current = onTranscript;
  }, [onTranscript]);
  const release = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
      if (recorder.current) {
        recorder.current.onstop = null;
        recorder.current.ondataavailable = null;
        if (recorder.current.state === "recording") recorder.current.stop();
      }
      release();
    };
  }, [release]);
  const upload = useCallback(async (file: Blob, name: string) => {
    if (!mounted.current) return;
    setError("");
    setWorking(true);
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    try {
      const value = await transcribeAudio(file, name, controller.signal);
      if (mounted.current && !controller.signal.aborted)
        callback.current(value);
    } catch (e) {
      if (mounted.current && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : "VOICE_UNAVAILABLE");
    } finally {
      if (mounted.current) setWorking(false);
    }
  }, []);
  async function toggle() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    setError("");
    if (!window.isSecureContext) {
      setError("MICROPHONE_INSECURE");
      return;
    }
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError("MICROPHONE_UNSUPPORTED");
      return;
    }
    setRequesting(true);
    try {
      const tracks = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        tracks.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = tracks;
      const mimeType = preferredAudioType(MediaRecorder);
      const r = new MediaRecorder(tracks, mimeType ? { mimeType } : undefined);
      recorder.current = r;
      const chunks: Blob[] = [];
      failed.current = false;
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r.onerror = () => {
        failed.current = true;
        release();
        if (mounted.current) {
          setError("MICROPHONE_FAILED");
          setRecording(false);
        }
      };
      r.onstop = () => {
        release();
        if (!mounted.current || failed.current) return;
        setRecording(false);
        const type = r.mimeType || chunks[0]?.type || mimeType;
        void upload(new Blob(chunks, { type }), recordingFilename(type));
      };
      r.start();
      setRecording(true);
      timer.current = setTimeout(() => {
        if (r.state === "recording") r.stop();
      }, MAX_RECORDING_MS);
    } catch (e) {
      release();
      if (mounted.current) {
        setRecording(false);
        setError(microphoneError(e));
      }
    } finally {
      if (mounted.current) setRequesting(false);
    }
  }
  return {
    recording,
    working,
    requesting,
    error,
    support,
    toggle,
    upload,
    clearError: () => setError(""),
  };
}
