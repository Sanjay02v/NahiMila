import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { withNetwork, remote } from "./repository";
interface Account {
  user_id: string;
  email: string;
  salt: string;
  password: string;
}
interface AuthFile {
  accounts: Account[];
  sessions: Record<string, { user_id: string; expires: number }>;
}
const globals = globalThis as unknown as { authQueue?: Promise<unknown> };
const tokenHash = (s: string) => createHash("sha256").update(s).digest("hex");
export const authConfigured = () =>
  !!(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
async function supabase() {
  const jar = await cookies();
  return createServerClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (all) => {
          for (const c of all)
            jar.set(c.name, c.value, {
              ...c.options,
              httpOnly: true,
              sameSite: "lax",
              secure: process.env.NODE_ENV === "production",
            });
        },
      },
    },
  );
}
async function authFile<T>(fn: (a: AuthFile) => T | Promise<T>, save = false) {
  const run = async () => {
    if (process.env.VERCEL || process.env.RENDER || remote)
      throw new Error("AUTH_NOT_CONFIGURED");
    const file = path.join(process.cwd(), ".data", "product-auth.json");
    let a: AuthFile;
    try {
      a = JSON.parse(await readFile(file, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      const shops = await withNetwork((n) => n.shops);
      a = {
        accounts: shops.map((s, i) => {
          const salt = randomBytes(16).toString("hex");
          return {
            user_id: s.user_id,
            email:
              ["sharma", "gupta", "lakshmi", "corner", "daily", "annapurna"][
                i
              ] + "@demo.nahimila.local",
            salt,
            password: scryptSync("NahiMila-demo-2026", salt, 64).toString(
              "hex",
            ),
          };
        }),
        sessions: {},
      };
      save = true;
    }
    const result = await fn(a);
    if (save) {
      await mkdir(path.dirname(file), { recursive: true });
      const temp = file + "." + crypto.randomUUID() + ".tmp";
      await writeFile(temp, JSON.stringify(a), { mode: 0o600 });
      await rename(temp, file);
    }
    return result;
  };
  const next = (globals.authQueue || Promise.resolve()).then(run, run);
  globals.authQueue = next.catch(() => {});
  return next;
}
export async function actor() {
  if (authConfigured()) {
    const client = await supabase();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) throw new Error("UNAUTHENTICATED");
    return data.user.id;
  }
  const token = (await cookies()).get("nml_session")?.value;
  if (!token) throw new Error("UNAUTHENTICATED");
  return authFile((a) => {
    const session = a.sessions[tokenHash(token)];
    if (!session || session.expires < Date.now())
      throw new Error("UNAUTHENTICATED");
    return session.user_id;
  });
}
export async function shopActor() {
  const user = await actor();
  return withNetwork((n) => {
    const shop = n.shops.find((s) => s.user_id === user);
    if (!shop) throw new Error("ONBOARDING_REQUIRED");
    return shop;
  });
}
export async function login(email: string, password: string) {
  if (authConfigured()) {
    const c = await supabase();
    const { error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw new Error("LOGIN_FAILED");
    return;
  }
  const token = randomBytes(32).toString("base64url");
  await authFile((a) => {
    const account = a.accounts.find((a) => a.email === email.toLowerCase());
    const salt = account?.salt || "missing";
    const digest = scryptSync(password, salt, 64);
    if (
      !account ||
      !timingSafeEqual(digest, Buffer.from(account.password, "hex"))
    )
      throw new Error("LOGIN_FAILED");
    a.sessions[tokenHash(token)] = {
      user_id: account.user_id,
      expires: Date.now() + 7 * 86400000,
    };
  }, true);
  (await cookies()).set("nml_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 604800,
  });
}
export async function register(email: string, password: string) {
  if (authConfigured()) {
    const c = await supabase();
    const { data, error } = await c.auth.signUp({ email, password });
    if (error) throw new Error("REGISTER_FAILED");
    if (!data.session) throw new Error("CHECK_EMAIL");
    return;
  }
  const user_id = crypto.randomUUID(),
    salt = randomBytes(16).toString("hex");
  await authFile((a) => {
    if (a.accounts.some((a) => a.email === email.toLowerCase()))
      throw new Error("REGISTER_FAILED");
    a.accounts.push({
      user_id,
      email: email.toLowerCase(),
      salt,
      password: scryptSync(password, salt, 64).toString("hex"),
    });
  }, true);
  await login(email, password);
}
export async function logout() {
  if (authConfigured()) {
    await (await supabase()).auth.signOut();
    return;
  }
  const jar = await cookies(),
    token = jar.get("nml_session")?.value;
  if (token)
    await authFile((a) => {
      delete a.sessions[tokenHash(token)];
    }, true);
  jar.delete("nml_session");
}
