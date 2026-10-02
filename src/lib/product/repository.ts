import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { seedNetwork, type Network } from "./network";
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
export const remote =
  url && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;
const globals = globalThis as unknown as { productQueue?: Promise<unknown> };
const filename = () =>
  path.join(process.cwd(), ".data", "product-network.json");
export async function withNetwork<T>(
  fn: (n: Network) => T | Promise<T>,
  mutate = false,
): Promise<T> {
  const run = async () => {
    if (url && !remote) throw new Error("DATABASE_REQUIRED");
    for (let i = 0; i < 8; i++) {
      let n: Network | null = null;
      if (remote) {
        const { data, error } = await remote.rpc("load_nahimila_network");
        if (error) throw new Error("DATABASE_UNAVAILABLE");
        n = data as Network | null;
      } else {
        if (process.env.VERCEL) throw new Error("DATABASE_REQUIRED");
        try {
          n = JSON.parse(await readFile(filename(), "utf8"));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
      }
      if (!n && remote) throw new Error("DATABASE_NOT_INITIALIZED");
      const fresh = !n;
      n = n || seedNetwork();
      const revision = n.revision;
      const result = await fn(n);
      if (!mutate && !fresh) return result;
      n.revision = revision + 1;
      if (remote) {
        const { data, error } = await remote.rpc("save_nahimila_network", {
          expected_revision: revision,
          network: n,
        });
        if (error) throw new Error("DATABASE_UNAVAILABLE");
        if (data !== true) continue;
      } else {
        await mkdir(path.dirname(filename()), { recursive: true });
        const temp = filename() + "." + crypto.randomUUID() + ".tmp";
        await writeFile(temp, JSON.stringify(n), { mode: 0o600 });
        await rename(temp, filename());
      }
      return result;
    }
    throw new Error("CONFLICT");
  };
  if (remote) return run();
  const next = (globals.productQueue || Promise.resolve()).then(run, run);
  globals.productQueue = next.catch(() => {});
  return next;
}
