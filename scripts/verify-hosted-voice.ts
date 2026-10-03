import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { VoiceUploadQueue } from "../src/lib/voice/upload-queue";
import { readTranscript } from "../src/lib/voice/events";
try {
  process.loadEnvFile(".env.local");
} catch {}
const filename = process.argv[2];
if (!filename)
  throw new Error(
    "Provide a synthetic 16kHz mono PCM WAV file. This opens a paid Sarvam stream; no demand is saved.",
  );
const wav = await readFile(filename);
let pcm: Buffer | undefined;
for (let p = 12; p + 8 <= wav.length;) {
  const size = wav.readUInt32LE(p + 4),
    kind = wav.toString("ascii", p, p + 4);
  if (kind === "fmt ") {
    assert.equal(wav.readUInt16LE(p + 8), 1);
    assert.equal(wav.readUInt16LE(p + 10), 1);
    assert.equal(wav.readUInt32LE(p + 12), 16000);
    assert.equal(wav.readUInt16LE(p + 22), 16);
  }
  if (kind === "data") pcm = wav.subarray(p + 8, p + 8 + size);
  p += 8 + size + (size % 2);
}
assert.ok(pcm && pcm.length < 640000, "Use a short synthetic speech sample.");
const base = process.env.NML_VERIFY_URL || "https://nahimila.onrender.com";
const login = await fetch(base + "/api/auth", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: base },
  body: JSON.stringify({ action: "demo" }),
});
assert.equal(login.status, 200);
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");
const headers = {
  Cookie: cookie,
  Origin: base,
  "Content-Type": "application/json",
};
const abort = new AbortController(),
  timer = setTimeout(() => abort.abort(), 40000);
let session = "",
  partials = 0,
  final = "",
  done = false,
  upload: Promise<void> | null = null,
  queue: VoiceUploadQueue | null = null;
async function send(sequence: number, audio: string) {
  const r = await fetch(base + "/api/voice/live", {
    method: "PUT",
    headers,
    body: JSON.stringify({ session, action: "audio", sequence, audio }),
    signal: abort.signal,
  });
  assert.equal(r.status, 200, `Audio upload returned ${r.status}`);
}
try {
  const response = await fetch(base + "/api/voice/live", {
    method: "POST",
    headers,
    signal: abort.signal,
  });
  assert.equal(response.status, 200);
  assert.ok(response.body);
  await readTranscript(response.body, (event) => {
    if (event.event === "ready") {
      session = event.session!;
      queue = new VoiceUploadQueue(send, () => abort.abort());
      upload = (async () => {
        for (let p = 0; p < pcm!.length; p += 6400) {
          const chunk = new Uint8Array(pcm!.subarray(p, p + 6400));
          queue!.enqueue(chunk.buffer);
          await new Promise((r) => setTimeout(r, 200));
        }
        await queue!.finish();
        const r = await fetch(base + "/api/voice/live", {
          method: "PUT",
          headers,
          body: JSON.stringify({ session, action: "end" }),
          signal: abort.signal,
        });
        assert.equal(r.status, 200);
      })();
      void upload.catch(() => abort.abort());
    }
    if (event.event === "partial") partials++;
    if (event.event === "final")
      final = [final, event.text].filter(Boolean).join(" ");
    if (event.event === "error") throw new Error(event.error);
    if (event.event === "done") done = true;
  });
  await upload;
  assert.ok(done);
  assert.ok(partials > 0);
  assert.ok(final.trim());
  console.log(
    JSON.stringify({
      liveVoice: "verified",
      partials,
      finalTranscript: final,
      noDemandSaved: true,
    }),
  );
} finally {
  (queue as VoiceUploadQueue | null)?.cancel();
  clearTimeout(timer);
  abort.abort();
  if (session)
    await fetch(base + "/api/voice/live", {
      method: "PUT",
      headers,
      body: JSON.stringify({ session, action: "cancel" }),
    });
  await fetch(base + "/api/auth", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "logout" }),
  });
}
