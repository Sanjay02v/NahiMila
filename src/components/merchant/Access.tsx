"use client";
import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { Brand, Language, api } from "./common";
import LocationPicker, { type ShopLocation } from "./LocationPicker";
export default function Access({
  onboard,
  ready,
  local,
}: {
  onboard: boolean;
  ready: () => void;
  local: boolean;
}) {
  const t = useTranslations(),
    locale = useLocale(),
    [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [checkEmail, setCheckEmail] = useState(false),
    [error, setError] = useState(""),
    [location, setLocation] = useState<ShopLocation | null>(null);
  return (
    <div className="access">
      <header>
        <Brand />
        <Language />
      </header>
      <main>
        <div className="access-story">
          <span className="eyebrow">NAHI MILA. AB MILEGA.</span>
          <h1>{onboard ? t("onboard") : t("loginTitle")}</h1>
          <p>{onboard ? t("onboardHint") : t("loginHint")}</p>
          <div className="access-art" aria-hidden="true">
            <div className="art-shop">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <i />
            <b>+</b>
          </div>
          <div className="privacy-line">
            <LockKeyhole size={16} />
            {t("private")}
          </div>
        </div>
        <section className="access-form">
          <h2>
            {onboard ? t("shopName") : register ? t("register") : t("login")}
          </h2>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {!onboard && !register && (
            <div className="demo-entry">
              <button
                className="button full"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const result = await api("/api/auth", { action: "demo" });
                    if (result.locale && result.locale !== locale) {
                      window.location.reload();
                      return;
                    }
                    ready();
                  } catch (e) {
                    const code = e instanceof Error ? e.message : "UNKNOWN";
                    setError(
                      t.has(`error.${code}`)
                        ? t(`error.${code}`)
                        : t("errorGeneric"),
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("exploreDemo")}
                <ArrowRight size={18} />
              </button>
              <p className="fine">{t("demoEntryHint")}</p>
            </div>
          )}
          {checkEmail && (
            <p className="flash success" role="status">
              {t("checkEmailSuccess")}
            </p>
          )}
          <details
            className="merchant-login"
            open={onboard || register || undefined}
          >
            <summary>
              {onboard
                ? t("shopName")
                : register
                  ? t("register")
                  : t("merchantSignIn")}
            </summary>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                const f = new FormData(e.currentTarget);
                try {
                  if (onboard)
                    await api("/api/merchant", {
                      action: "onboard",
                      name: f.get("name"),
                      owner_name: f.get("owner_name"),
                      ...location,
                      location_confirmed: !!location,
                      locale,
                      sharing: f.get("sharing") === "on",
                    });
                  else {
                    const result = await api("/api/auth", {
                      action: register ? "register" : "login",
                      email: f.get("email"),
                      password: f.get("password"),
                    });
                    if (result.check_email) {
                      setCheckEmail(true);
                      setRegister(false);
                      return;
                    }
                    if (result.locale && result.locale !== locale) {
                      window.location.reload();
                      return;
                    }
                  }
                  ready();
                } catch (e) {
                  const code = e instanceof Error ? e.message : "UNKNOWN";
                  setError(
                    t.has(`error.${code}`)
                      ? t(`error.${code}`)
                      : t("errorGeneric"),
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {onboard ? (
                <>
                  <label>
                    {t("shopName")}
                    <input
                      name="name"
                      required
                      maxLength={100}
                      autoComplete="organization"
                    />
                  </label>
                  <label>
                    {t("merchantName")}
                    <input
                      name="owner_name"
                      required
                      maxLength={100}
                      autoComplete="name"
                    />
                  </label>
                  <LocationPicker onChange={setLocation} />
                  <label className="check">
                    <input type="checkbox" name="sharing" />
                    {t("shareDemand")}
                  </label>
                </>
              ) : (
                <>
                  <label>
                    {t("email")}
                    <input
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                    />
                  </label>
                  <label>
                    {t("password")}
                    <input
                      name="password"
                      type="password"
                      minLength={10}
                      required
                      autoComplete={
                        register ? "new-password" : "current-password"
                      }
                    />
                  </label>
                </>
              )}
              <button
                className="button full"
                disabled={busy || (onboard && !location)}
              >
                {onboard ? t("finish") : register ? t("register") : t("login")}
                <ArrowRight size={18} />
              </button>
            </form>
          </details>
          {!onboard && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setCheckEmail(false);
                setRegister(!register);
                setError("");
              }}
            >
              {register ? t("haveAccount") : t("needAccount")}
            </button>
          )}
          {local && !onboard && <p className="local-login">{t("demoLogin")}</p>}
        </section>
      </main>
      <footer>{t("demo")}</footer>
    </div>
  );
}
