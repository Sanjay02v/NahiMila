import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { audioMime } from "../src/lib/voice/audio";
const base = process.env.NML_VERIFY_URL || "https://nahimila.onrender.com";
const filename = process.argv[2];
if (!filename) throw new Error("Provide a nonempty speech audio fixture.");
const audio = await readFile(filename);
assert(
  audio.length > 4096,
  "Audio fixture must contain actual recorded speech.",
);
const login = await fetch(base + "/api/auth", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: base },
  body: JSON.stringify({ action: "demo" }),
});
assert.equal(login.status, 200);
const headers = {
  Origin: base,
  Cookie: login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; "),
};
try {
  const form = new FormData();
  const mime = audioMime("", filename);
  assert(mime, "Unsupported audio fixture");
  form.append(
    "file",
    new File([audio], filename.split("/").at(-1)!, { type: mime }),
  );
  const response = await fetch(base + "/api/voice/transcribe", {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(40_000),
  });
  const result = await response.json();
  assert.equal(response.status, 200, `Transcription failed: ${result.error}`);
  assert.equal(result.provider, "Sarvam");
  assert.equal(result.requires_review, true);
  assert(result.transcript.trim().length > 10);
  console.log(
    JSON.stringify({
      transcription: "passed",
      transcript: result.transcript,
      requiresReview: result.requires_review,
    }),
  );
} finally {
  await fetch(base + "/api/auth", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "logout" }),
  });
}
