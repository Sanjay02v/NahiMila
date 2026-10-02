"use client";
import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { ArrowRight, MapPin, LockKeyhole } from "lucide-react";
import { Brand, Language, api } from "./common";
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
    [error, setError] = useState(""),
    [lat, setLat] = useState(""),
    [lon, setLon] = useState("");
  async function gps() {
    setError("");
    if (!navigator.geolocation) {
      setError(t("locationFailed"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(String(p.coords.latitude));
        setLon(String(p.coords.longitude));
      },
      () => setError(t("locationFailed")),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }
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
                    area: f.get("area"),
                    latitude: Number(lat),
                    longitude: Number(lon),
                    locale,
                    sharing: f.get("sharing") === "on",
                  });
                else {
                  const result = await api("/api/auth", {
                    action: register ? "register" : "login",
                    email: f.get("email"),
                    password: f.get("password"),
                  });
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
                  {t("area")}
                  <input name="area" required maxLength={100} />
                </label>
                <button
                  className="button secondary full"
                  type="button"
                  onClick={gps}
                >
                  <MapPin size={18} />
                  {t("useLocation")}
                </button>
                <p className="fine">{t("locationHint")}</p>
                <div className="form-grid">
                  <label>
                    {t("latitude")}
                    <input
                      value={lat}
                      onChange={(e) => setLat(e.target.value)}
                      type="number"
                      step="any"
                      min="-90"
                      max="90"
                      required
                    />
                  </label>
                  <label>
                    {t("longitude")}
                    <input
                      value={lon}
                      onChange={(e) => setLon(e.target.value)}
                      type="number"
                      step="any"
                      min="-180"
                      max="180"
                      required
                    />
                  </label>
                </div>
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
            <button className="button full" disabled={busy}>
              {onboard ? t("finish") : register ? t("register") : t("login")}
              <ArrowRight size={18} />
            </button>
          </form>
          {!onboard && (
            <button
              className="text-button"
              onClick={() => setRegister(!register)}
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
