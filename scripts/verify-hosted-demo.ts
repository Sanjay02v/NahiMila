import assert from "node:assert/strict";
try {
  process.loadEnvFile(".env.local");
} catch {}
if (!process.argv.includes("--confirm"))
  throw new Error(
    "Pass --confirm: this exercises and resets the shared fictional demo.",
  );
const base = process.env.NML_VERIFY_URL || "https://nahimila.onrender.com";
let cookies = "";
async function call(path: string, body?: unknown, expected = 200) {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      ...(cookies ? { Cookie: cookies } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const set = response.headers.getSetCookie();
  if (set.length) cookies = set.map((c) => c.split(";")[0]).join("; ");
  assert.equal(
    response.status,
    expected,
    `${path}: expected ${expected}, got ${response.status}`,
  );
  return response.json();
}
await call("/api/merchant", { action: "reset_demo", confirm: true }, 401);
await call("/api/auth", {
  action: "login",
  email: "sharma@demo.nahimila.local",
  password: process.env.NML_DEMO_PASSWORD || "NahiMila-demo-2026",
});
const initial = await call("/api/merchant");
assert.equal(initial.demo, true, "New deployment is not live yet.");
let changed = false;
try {
  let v = await call("/api/merchant", { action: "reset_demo", confirm: true });
  changed = true;
  const q = (id: string) =>
    v.quotes.find((q: { quote: { id: string } }) => q.quote.id === id);
  assert.equal(q("quote-b").total_units, 23);
  assert.equal(q("demo-quote-lime").approval_count, 2);
  const pending = v.requests.find(
    (r: { status: string }) => r.status === "OFFER_CREATED",
  );
  assert.ok(pending);
  const customer = "/api/customer/" + encodeURIComponent(pending.request_token);
  await call(customer, { action: "confirm" });
  await call(customer, { action: "confirm" });
  v = await call("/api/merchant");
  assert.equal(q("quote-b").total_units, 24);
  assert.equal(q("quote-b").eligible, true);
  assert.equal(q("quote-a").eligible, false);
  assert.equal(q("quote-c").eligible, false);
  v = await call("/api/merchant", {
    action: "approve",
    quote_id: "quote-b",
    fingerprint: q("quote-b").fingerprint,
  });
  await call(customer, { action: "cancel" });
  v = await call("/api/merchant");
  assert.equal(q("quote-b").total_units, 23);
  assert.equal(q("quote-b").eligible, false);
  assert.equal(q("demo-quote-lime").approval_count, 2);
  v = await call("/api/merchant", {
    action: "approve",
    quote_id: "demo-quote-lime",
    fingerprint: q("demo-quote-lime").fingerprint,
  });
  assert.equal(q("demo-quote-lime").approval_count, 3);
  v = await call("/api/merchant", {
    action: "commit",
    quote_id: "demo-quote-lime",
    fingerprint: q("demo-quote-lime").fingerprint,
  });
  assert.equal(v.orders.length, 1);
  const order = v.orders[0];
  assert.equal(order.exposure, 14800);
  v = await call("/api/merchant", { action: "receive", order_id: order.id });
  const pickup = v.orders[0].pickups[0].id;
  await call("/api/merchant", {
    action: "pickup",
    reservation_id: pickup,
    outcome: "COLLECTED",
  });
  v = await call("/api/merchant", {
    action: "pickup",
    reservation_id: pickup,
    outcome: "COLLECTED",
  });
  assert.equal(v.orders[0].collected_cash, 20000);
  assert.equal(v.orders[0].collected_units, 4);
  v = await call("/api/merchant", { action: "reset_demo", confirm: true });
  assert.equal(v.orders.length, 0);
  assert.equal(q("quote-b").total_units, 23);
  assert.equal(q("demo-quote-lime").approval_count, 2);
  await call(customer, undefined, 404);
  console.log(
    "Live demo verified: confirmation, duplicate protection, MOQ/delivery blockers, cancellation, independent approvals, shared order, pickup accounting and reset. Restored baseline for judges.",
  );
} finally {
  if (changed)
    await call("/api/merchant", { action: "reset_demo", confirm: true });
  await call("/api/auth", { action: "logout" });
}
