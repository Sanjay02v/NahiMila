"use client";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  MAX_AUDIO_BYTES,
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
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
    return "MICROPHONE_UNSUPPORTED";
  return "";
}
type Session = {
  abort: AbortController;
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  bytes: number;
  timer: ReturnType<typeof setTimeout> | null;
};
export function useVoiceRecording(
  onTranscript: (value: string, final: boolean) => void,
  {
    enabled = true,
    autoStart = false,
  }: { enabled?: boolean; autoStart?: boolean } = {},
) {
  const support = useSyncExternalStore(subscribe, microphoneSupport, () => "");
  const [recording, setRecording] = useState(false),
    [working, setWorking] = useState(false),
    [requesting, setRequesting] = useState(false),
    [error, setError] = useState("");
  const active = useRef<Session | null>(null),
    callback = useRef(onTranscript),
    mounted = useRef(true);
  useEffect(() => {
    callback.current = onTranscript;
  }, [onTranscript]);
  const audioOff = useCallback((s: Session) => {
    if (s.timer) clearTimeout(s.timer);
    s.stream?.getTracks().forEach((t) => t.stop());
    s.stream = null;
  }, []);
  const cancel = useCallback(() => {
    const s = active.current;
    active.current = null;
    if (!s) return;
    s.abort.abort();
    if (s.recorder && s.recorder.state !== "inactive") s.recorder.stop();
    audioOff(s);
    s.chunks = [];
  }, [audioOff]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel();
    };
  }, [cancel]);
  const fail = useCallback(
    (code: string) => {
      cancel();
      if (mounted.current) {
        setError(code);
        setWorking(false);
        setRequesting(false);
        setRecording(false);
      }
    },
    [cancel],
  );
  async function finish(s: Session) {
    if (active.current !== s || s.abort.signal.aborted) return;
    audioOff(s);
    setRecording(false);
    setWorking(true);
    const type = s.recorder?.mimeType || s.chunks[0]?.type || "audio/webm";
    const file = new Blob(s.chunks, { type });
    s.chunks = [];
    const timeout = setTimeout(() => {
      if (active.current === s) fail("VOICE_TIMEOUT");
    }, 35_000);
    try {
      const text = await transcribeAudio(
        file,
        recordingFilename(type),
        s.abort.signal,
      );
      if (active.current !== s || s.abort.signal.aborted || !mounted.current)
        return;
      callback.current(text, true);
      active.current = null;
      setWorking(false);
    } catch (e) {
      if (!s.abort.signal.aborted)
        fail(e instanceof Error ? e.message : "VOICE_NETWORK");
    } finally {
      clearTimeout(timeout);
    }
  }
  function stop() {
    const s = active.current;
    if (!s?.recorder || s.recorder.state !== "recording") return;
    if (s.timer) clearTimeout(s.timer);
    setRecording(false);
    setWorking(true);
    s.recorder.stop(); // The final dataavailable event precedes onstop.
  }
  async function toggle() {
    if (active.current) {
      if (recording) stop();
      return;
    }
    setError("");
    if (support) {
      setError(support);
      return;
    }
    const s: Session = {
      abort: new AbortController(),
      stream: null,
      recorder: null,
      chunks: [],
      bytes: 0,
      timer: null,
    };
    active.current = s;
    setRequesting(true);
    try {
      s.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (s.abort.signal.aborted) {
        audioOff(s);
        return;
      }
      const type = preferredAudioType(MediaRecorder);
      s.recorder = new MediaRecorder(
        s.stream,
        type ? { mimeType: type } : undefined,
      );
      s.recorder.ondataavailable = (event) => {
        if (active.current !== s || s.abort.signal.aborted || !event.data.size)
          return;
        s.bytes += event.data.size;
        if (s.bytes > MAX_AUDIO_BYTES) {
          fail("VOICE_FILE_TOO_LARGE");
          return;
        }
        s.chunks.push(event.data);
      };
      s.recorder.onerror = () => {
        if (active.current === s) fail("MICROPHONE_FAILED");
      };
      s.recorder.onstop = () => {
        void finish(s);
      };
      s.recorder.start(200);
      setRequesting(false);
      setRecording(true);
      s.timer = setTimeout(stop, MAX_RECORDING_MS);
    } catch (e) {
      if (!s.abort.signal.aborted) fail(microphoneError(e));
    }
  }
  const automaticStart = useEffectEvent(() => {
    void toggle();
  });
  const pause = useEffectEvent(() => {
    cancel();
    setRecording(false);
    setWorking(false);
    setRequesting(false);
  });
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!enabled) {
      cancel();
      const timer = setTimeout(() => pause(), 0);
      return () => clearTimeout(timer);
    }
    if (!autoStart || autoStarted.current) return;
    const timer = setTimeout(() => {
      autoStarted.current = true;
      automaticStart();
    }, 0);
    return () => clearTimeout(timer);
  }, [enabled, autoStart, cancel]);
  return {
    recording,
    working,
    requesting,
    error,
    support,
    toggle,
    clearError: () => setError(""),
  };
}
