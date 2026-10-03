import { isDemoShop } from "@/lib/product/demo-identity";
import { cookies } from "next/headers";
import { actor, login, register, logout } from "@/lib/product/auth";
import { withNetwork } from "@/lib/product/repository";
import { body, failure, ok, text, throttle } from "@/lib/product/http";
export const runtime = "nodejs";
export async function GET() {
  try {
    const id = await actor();
    const profile = await withNetwork((n) =>
      n.shops.find((s) => s.user_id === id),
    );
    if (profile)
      (await cookies()).set("nml_locale", profile.locale, {
        path: "/",
        sameSite: "lax",
        maxAge: 31536000,
      });
    return ok({ onboarded: !!profile, locale: profile?.locale });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    const b = await body(req);
    if (b.action === "logout") {
      await logout();
      return ok({ ok: true });
    }
    throttle("login:" + req.headers.get("x-forwarded-for"), 6);
    if (b.action === "demo") {
      if (b.email !== undefined || b.password !== undefined)
        throw new Error("INVALID_REQUEST");
      const demo = await withNetwork((n) =>
        n.shops.find((s) => s.id === "m-sharma-001" && isDemoShop(s.id)),
      );
      if (!demo) throw new Error("DEMO_NOT_CONFIGURED");
      await login(
        "sharma@demo.nahimila.local",
        process.env.NML_DEMO_PASSWORD || "NahiMila-demo-2026",
      );
      if ((await actor()) !== demo.user_id) {
        await logout();
        throw new Error("FORBIDDEN");
      }
      (await cookies()).set("nml_locale", demo.locale, {
        path: "/",
        sameSite: "lax",
        maxAge: 31536000,
      });
      return ok({ onboarded: true, locale: demo.locale });
    }
    const email = text(b.email, 160),
      password = text(b.password, 120);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10)
      throw new Error("INVALID_CREDENTIALS");
    if (b.action === "register") {
      const result = await register(email, password);
      if (result.confirmationRequired)
        return ok({ check_email: true, onboarded: false });
    } else if (b.action === "login") await login(email, password);
    else throw new Error("INVALID_REQUEST");
    const id = await actor();
    const profile = await withNetwork((n) =>
      n.shops.find((s) => s.user_id === id),
    );
    if (profile)
      (await cookies()).set("nml_locale", profile.locale, {
        path: "/",
        sameSite: "lax",
        maxAge: 31536000,
      });
    return ok({ onboarded: !!profile, locale: profile?.locale });
  } catch (e) {
    return failure(e);
  }
}
