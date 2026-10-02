export const MAX_AUDIO_BYTES = 3_000_000;
export const MAX_RECORDING_MS = 20_000;
const mimeAliases: Record<string, string> = {
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/x-m4a": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/x-aiff": "audio/aiff",
  "audio/x-flac": "audio/flac",
  "audio/mp3": "audio/mpeg",
};
const accepted = new Set([
  "audio/webm",
  "audio/mp4",
  "video/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/mpeg",
  "audio/aac",
  "audio/aiff",
  "audio/flac",
  "audio/opus",
  "audio/amr",
  "audio/x-ms-wma",
]);
const extensions: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  webm: "audio/webm",
  ogg: "audio/ogg",
  opus: "audio/opus",
  aac: "audio/aac",
  aiff: "audio/aiff",
  aif: "audio/aiff",
  flac: "audio/flac",
  amr: "audio/amr",
  wma: "audio/x-ms-wma",
};
export function audioMime(type: string, name = "") {
  const base = type.toLowerCase().split(";")[0].trim();
  const normalized = mimeAliases[base] || base;
  if (accepted.has(normalized)) return normalized;
  // Infer only absent/generic browser MIME values, never disguise an explicit unsupported file type.
  if (!base || base === "application/octet-stream")
    return extensions[name.split(".").at(-1)?.toLowerCase() || ""] || null;
  return null;
}
export function validateAudio(file: Blob, name = "") {
  if (!file.size) throw new Error("VOICE_EMPTY_AUDIO");
  if (file.size > MAX_AUDIO_BYTES) throw new Error("VOICE_FILE_TOO_LARGE");
  const mime = audioMime(file.type, name);
  if (!mime) throw new Error("VOICE_UNSUPPORTED_FORMAT");
  return mime;
}
export function preferredAudioType(
  recorder: Pick<typeof MediaRecorder, "isTypeSupported">,
) {
  return (
    [
      "audio/webm;codecs=opus",
      "audio/mp4",
      "audio/webm",
      "audio/ogg;codecs=opus",
    ].find((t) => recorder.isTypeSupported(t)) || ""
  );
}
export function recordingFilename(type: string) {
  const mime = audioMime(type);
  return (
    "recording." +
    (
      {
        "audio/webm": "webm",
        "audio/mp4": "m4a",
        "audio/ogg": "ogg",
        "audio/wav": "wav",
        "audio/mpeg": "mp3",
        "video/mp4": "m4a",
        "audio/aac": "aac",
        "audio/aiff": "aiff",
        "audio/flac": "flac",
        "audio/opus": "opus",
        "audio/amr": "amr",
        "audio/x-ms-wma": "wma",
      } as Record<string, string>
    )[mime || "audio/webm"]
  );
}
export function microphoneError(e: unknown) {
  const name = e && typeof e === "object" && "name" in e ? String(e.name) : "";
  return (
    (
      {
        NotAllowedError: "MICROPHONE_PERMISSION",
        SecurityError: "MICROPHONE_PERMISSION",
        NotFoundError: "MICROPHONE_NOT_FOUND",
        NotReadableError: "MICROPHONE_BUSY",
        AbortError: "MICROPHONE_BUSY",
        NotSupportedError: "MICROPHONE_UNSUPPORTED",
      } as Record<string, string>
    )[name] || "MICROPHONE_FAILED"
  );
}
export async function transcribeAudio(
  file: Blob,
  name = "recording.webm",
  signal?: AbortSignal,
) {
  const mime = validateAudio(file, name);
  const form = new FormData();
  form.append("file", new Blob([file], { type: mime }), name);
  let response: Response;
  try {
    response = await fetch("/api/voice/transcribe", {
      method: "POST",
      body: form,
      signal,
    });
  } catch {
    throw new Error("VOICE_NETWORK");
  }
  let result: Record<string, unknown>;
  try {
    result = await response.json();
  } catch {
    throw new Error("VOICE_UNAVAILABLE");
  }
  if (!response.ok)
    throw new Error(
      typeof result.error === "string" ? result.error : "VOICE_UNAVAILABLE",
    );
  if (typeof result.transcript !== "string" || !result.transcript.trim())
    throw new Error("VOICE_NO_SPEECH");
  return result.transcript;
}
