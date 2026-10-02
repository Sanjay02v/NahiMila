import { createClient } from "@supabase/supabase-js";
import { seedNetwork } from "../src/lib/product/network";
try {
  process.loadEnvFile(".env.local");
} catch {}
if (!process.argv.includes("--confirm"))
  throw new Error(
    "Run with --confirm to create six fictional demo accounts and seed an EMPTY Supabase product database.",
  );
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key)
  throw new Error("Configure Supabase server credentials first.");
const c = createClient(url, key, { auth: { persistSession: false } });
const loaded = await c.rpc("load_nahimila_network");
if (loaded.error)
  throw new Error("Apply the merchant_product migration first.");
if (loaded.data.shops.length || loaded.data.state.products.length)
  throw new Error(
    "Database is not empty; refusing to overwrite existing data.",
  );
const n = seedNetwork(),
  emails = ["sharma", "gupta", "lakshmi", "corner", "daily", "annapurna"];
const { data, error } = await c.auth.admin.listUsers({ perPage: 1000 });
if (error) throw new Error("Could not inspect existing demo accounts.");
for (let i = 0; i < n.shops.length; i++) {
  const email = `${emails[i]}@demo.nahimila.local`,
    existing = data.users.find((u) => u.email === email);
  if (existing) n.shops[i].user_id = existing.id;
  else {
    const created = await c.auth.admin.createUser({
      email,
      password: process.env.NML_DEMO_PASSWORD || "NahiMila-demo-2026",
      email_confirm: true,
    });
    if (created.error || !created.data.user)
      throw new Error(`Could not create fictional ${emails[i]} account.`);
    n.shops[i].user_id = created.data.user.id;
  }
}
n.state.merchants = n.shops;
n.revision = loaded.data.revision + 1;
const saved = await c.rpc("save_nahimila_network", {
  expected_revision: loaded.data.revision,
  network: n,
});
if (saved.error || saved.data !== true)
  throw new Error(
    "Could not save demo state; no existing data was overwritten.",
  );
console.log(
  "Six fictional demo accounts and requests seeded. Existing account passwords were preserved.",
);
