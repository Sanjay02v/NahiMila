import { mkdir, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { resetJudgeDemo } from "../src/lib/product/demo";
import { DEMO_ACCOUNTS, isDemoShop } from "../src/lib/product/demo-identity";
import type { Network } from "../src/lib/product/network";
try {
  process.loadEnvFile(".env.local");
} catch {}
if (!process.argv.includes("--confirm"))
  throw new Error(
    "Pass --confirm to reset ONLY the six fictional hosted demo accounts.",
  );
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase server credentials required.");
const c = createClient(url, key, { auth: { persistSession: false } });
const loaded = await c.rpc("load_nahimila_network");
if (loaded.error || !loaded.data) throw new Error("Could not load database.");
const old = loaded.data as Network;
// Do not confuse a real auth identity with a fictional seed shop.
const { data: users, error } = await c.auth.admin.listUsers({ perPage: 1000 });
if (error) throw new Error("Could not verify demo identities.");
for (const [id, email] of DEMO_ACCOUNTS) {
  const shop = old.shops.find((s) => s.id === id);
  if (
    !shop ||
    !users.users.some(
      (u) =>
        u.id === shop.user_id && u.email === `${email}@demo.nahimila.local`,
    )
  )
    throw new Error("Demo identity mismatch; refusing reset.");
}
await mkdir(".data/backups", { recursive: true });
await writeFile(
  `.data/backups/hosted-before-reset-${Date.now()}.json`,
  JSON.stringify(old),
  { mode: 0o600 },
);
const fresh = structuredClone(old);
resetJudgeDemo(fresh);
fresh.revision = old.revision + 1;
const saved = await c.rpc("reset_nahimila_demo", {
  expected_revision: old.revision,
  network: fresh,
});
if (saved.error)
  throw new Error(
    `Reset failed: ${saved.error.code}. Install the reset_judge_demo migration; backup retained.`,
  );
if (saved.data !== true)
  throw new Error(
    "Database changed during reset. No reset committed; run again.",
  );
const result = await c.rpc("load_nahimila_network");
if (result.error) throw new Error("Reset committed but readback unavailable.");
const after = result.data as Network;
const nonDemo = (n: Network) => ({
  shops: n.shops
    .filter((s) => !isDemoShop(s.id))
    .sort((a, b) => a.id.localeCompare(b.id)),
  requests: n.state.requests
    .filter((r) => !isDemoShop(r.merchant_id))
    .sort((a, b) => a.id.localeCompare(b.id)),
});
if (
  JSON.stringify(nonDemo(old)) !== JSON.stringify(nonDemo(after)) ||
  JSON.stringify(old.gemini_usage) !== JSON.stringify(after.gemini_usage)
)
  throw new Error("Reset preservation check failed; inspect backup.");
const oldTokens = new Set(
  old.state.requests
    .filter((r) => isDemoShop(r.merchant_id))
    .map((r) => r.request_token),
);
if (after.state.requests.some((r) => oldTokens.has(r.request_token)))
  throw new Error("Old demo links remain after reset.");
console.log(
  JSON.stringify({
    reset: "verified",
    demoShops: 6,
    demoRequests: after.state.requests.filter((r) => isDemoShop(r.merchant_id))
      .length,
    demoOrders: after.state.orders.filter((o) =>
      o.merchant_allocations.some((a) => isDemoShop(a.merchant_id)),
    ).length,
    realAccountsPreserved: true,
    quotaPreserved: true,
    oldLinksRemoved: true,
  }),
);
