import assert from "node:assert/strict";
import type { MerchantView } from "../src/lib/product/types";
try {
  process.loadEnvFile(".env.local");
} catch {}
if (!process.argv.includes("--confirm"))
  throw new Error(
    "Pass --confirm to exercise and restore the shared fictional demo.",
  );
const base = process.env.NML_VERIFY_URL || "https://nahimila.onrender.com",
  cookies = new Map<string, string>();
async function call(
  path: string,
  payload?: unknown,
  expected = 200,
  anonymous = false,
) {
  const response = await fetch(base + path, {
    method: payload ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      ...(!anonymous && cookies.size
        ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") }
        : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(55000),
  });
  if (!anonymous)
    for (const c of response.headers.getSetCookie()) {
      const value = c.split(";")[0],
        equal = value.indexOf("=");
      cookies.set(value.slice(0, equal), value.slice(equal + 1));
    }
  const data = await response.json();
  assert.equal(
    response.status,
    expected,
    `${path}: ${response.status}, ${data.error || ""}`,
  );
  return data;
}
await call("/api/location", { action: "search", text: "Bengaluru" }, 401, true);
await call("/api/auth", { action: "demo" });
let changed = false;
try {
  let view: MerchantView = await call("/api/merchant", {
    action: "reset_demo",
    confirm: true,
  });
  changed = true;
  const lime = view.quotes.find((q) => /Lime/.test(q.product.name))!;
  assert.ok(lime);
  assert.equal(lime.approval_count, 2);
  const result = await call("/api/agent", {
    question: "How many more shops need to accept Millet Crunch Lime?",
    history: [],
  });
  assert.match(result.answer, /^1 more shop must approve/);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].title, lime.product.name);
  const address = await call("/api/location", {
    action: "search",
    text: "Indiranagar, Bengaluru, India",
  });
  assert.ok(address.results.length);
  const pin = address.results[0];
  assert.equal(typeof pin.latitude, "number");
  const reverse = await call("/api/location", {
    action: "reverse",
    latitude: pin.latitude,
    longitude: pin.longitude,
  });
  assert.ok(reverse.results[0]?.address);
  const product = lime.product;
  for (const locale of ["hi", "kn"] as const) {
    const translated = await call("/api/product-labels", {
      locale,
      labels: [product.name],
    });
    assert.ok(translated.labels[product.name]);
    assert.match(
      translated.labels[product.name],
      locale === "hi" ? /[\u0900-\u097f]/ : /[\u0c80-\u0cff]/,
    );
    const cached = await call("/api/product-labels", {
      locale,
      labels: [product.name],
    });
    assert.deepEqual(cached, translated);
  }
  view = await call("/api/merchant");
  const saved = view.quotes.find((q) => q.quote.id === lime.quote.id)!;
  assert.equal(saved.product.id, product.id);
  assert.equal(saved.product.name, product.name);
  assert.equal(saved.total_units, lime.total_units);
  assert.deepEqual(
    saved.product.canonical_identity,
    product.canonical_identity,
  );
  assert.ok(saved.product.localized_labels?.hi?.[product.name]);
  await call(
    "/api/product-labels",
    { locale: "hi", labels: ["Unauthorized product"] },
    403,
  );
  const offer = view.requests.find((r) => r.status === "OFFER_CREATED")!;
  const publicLabels = await call(
    "/api/product-labels",
    { locale: "hi", labels: [offer.product.name], token: offer.request_token },
    200,
    true,
  );
  assert.ok(publicLabels.labels[offer.product.name]);
  await call(
    "/api/product-labels",
    {
      locale: "hi",
      labels: ["Unauthorized product"],
      token: offer.request_token,
    },
    403,
    true,
  );
  await call("/api/merchant", {
    action: "approve",
    quote_id: saved.quote.id,
    fingerprint: saved.fingerprint,
  });
  const followup = await call("/api/agent", {
    question: "How many more shops are left?",
    history: [
      {
        role: "user",
        text: "How many more shops need to accept Millet Crunch Lime?",
      },
      { role: "assistant", text: result.answer },
    ],
  });
  assert.match(followup.answer, /^No more shop approvals/);
  assert.equal(followup.rows.length, 1);
  console.log(
    "Verified map search/reverse lookup, exact fresh assistant answers, Hindi/Kannada translation cache, stable grouping and scoped customer labels.",
  );
} finally {
  if (changed) {
    const restored: MerchantView = await call("/api/merchant", {
      action: "reset_demo",
      confirm: true,
    });
    assert.equal(
      restored.quotes.find((q) => /Lime/.test(q.product.name))?.approval_count,
      2,
    );
    console.log(
      "Fictional demo restored. Real merchant records were not changed.",
    );
  }
}
