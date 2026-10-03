import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { seedJudgeDemo, resetJudgeDemo } from "../src/lib/product/demo";
import type { Network } from "../src/lib/product/network";
try {
  process.loadEnvFile(".env.local");
} catch {}
if (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.RENDER ||
  process.env.VERCEL
)
  throw new Error("For hosted data use demo:reset:hosted -- --confirm.");
if (!process.argv.includes("--confirm"))
  throw new Error(
    "Pass --confirm to restore fictional demo data and preserve real accounts.",
  );
const folder = path.join(process.cwd(), ".data"),
  file = path.join(folder, "product-network.json");
await mkdir(path.join(folder, "backups"), { recursive: true });
let n: Network;
try {
  const raw = await readFile(file, "utf8");
  n = JSON.parse(raw);
  await writeFile(
    path.join(folder, "backups", `network-${Date.now()}.json`),
    raw,
    { mode: 0o600 },
  );
  resetJudgeDemo(n);
  n.revision++;
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  n = seedJudgeDemo();
}
const temp = file + ".tmp";
await writeFile(temp, JSON.stringify(n), { mode: 0o600 });
await rename(temp, file);
console.log(
  "Fictional demo restored. Real profiles, authentication and AI usage preserved. Previous state backed up.",
);
