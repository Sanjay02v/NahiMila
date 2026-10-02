import { cookies } from "next/headers";
import { actor } from "@/lib/product/auth";
import { withNetwork } from "@/lib/product/repository";
import { locales, type Locale } from "@/lib/product/types";
import { body, failure, ok } from "@/lib/product/http";
export async function POST(req: Request) {
  try {
    const b = await body(req);
    if (!locales.includes(b.locale as Locale))
      throw new Error("INVALID_REQUEST");
    let user: string | null = null;
    try {
      if (b.persist_shop === true) user = await actor();
    } catch (e) {
      if (!(e instanceof Error) || e.message !== "UNAUTHENTICATED") throw e;
    }
    if (user)
      await withNetwork((n) => {
        const shop = n.shops.find((s) => s.user_id === user);
        if (shop) shop.locale = b.locale as Locale;
      }, true);
    (await cookies()).set("nml_locale", String(b.locale), {
      path: "/",
      sameSite: "lax",
      maxAge: 31536000,
    });
    return ok({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
