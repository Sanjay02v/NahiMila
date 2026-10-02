import { mkdir, readFile, writeFile, copyFile, rename } from "node:fs/promises";
import path from "node:path";
import { seedNetwork } from "../src/lib/product/network";
try {
  process.loadEnvFile(".env.local");
} catch {}
if (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VERCEL
)
  throw new Error("This reset works only with local fictional demo data.");
if (!process.argv.includes("--confirm"))
  throw new Error(
    "This restores the fictional demo and backs up local state/auth. Run with --confirm to proceed.",
  );
const folder = path.join(process.cwd(), ".data"),
  stamp = Date.now();
await mkdir(path.join(folder, "backups"), { recursive: true });
const n = seedNetwork();
try {
  const old = JSON.parse(
    await readFile(path.join(folder, "product-network.json"), "utf8"),
  );
  for (const shop of n.shops) {
    const previous = old.shops.find(
      (s: { id: string; user_id: string }) => s.id === shop.id,
    );
    if (previous) shop.user_id = previous.user_id;
  }
  await copyFile(
    path.join(folder, "product-network.json"),
    path.join(folder, "backups", `network-${stamp}.json`),
  );
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}
n.state.merchants = n.shops;
await writeFile(path.join(folder, "product-network.json"), JSON.stringify(n));
// Keep existing seeded account sessions; back up auth if there are extra registered accounts.
try {
  const file = path.join(folder, "product-auth.json"),
    a = JSON.parse(await readFile(file, "utf8"));
  if (
    a.accounts.some(
      (u: { user_id: string }) => !n.shops.some((s) => s.user_id === u.user_id),
    )
  )
    await rename(file, path.join(folder, "backups", `auth-${stamp}.json`));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}
console.log(
  "Fictional demo restored. Previous state is in .data/backups. Reload the browser.",
);
