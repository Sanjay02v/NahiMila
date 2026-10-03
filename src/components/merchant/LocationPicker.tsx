"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MapPin, Search, LoaderCircle, Check } from "lucide-react";
import type { Map as LeafletMap, Marker } from "leaflet";
import { api } from "./common";
export type ShopLocation = {
  address: string;
  latitude: number;
  longitude: number;
};
export default function LocationPicker({
  initial,
  onChange,
}: {
  initial?: ShopLocation;
  onChange: (value: ShopLocation | null) => void;
}) {
  const t = useTranslations(),
    [address, setAddress] = useState(initial?.address || ""),
    [pin, setPin] = useState(initial || null),
    [confirmed, setConfirmed] = useState(!!initial),
    [results, setResults] = useState<ShopLocation[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [mapError, setMapError] = useState(false),
    [mapReady, setMapReady] = useState(false);
  const element = useRef<HTMLDivElement>(null),
    map = useRef<LeafletMap | null>(null),
    marker = useRef<Marker | null>(null),
    revision = useRef(0),
    pick = useRef<((latitude: number, longitude: number) => void) | null>(null);
  useEffect(() => {
    pick.current = (latitude, longitude) => {
      revision.current++;
      setPin({ latitude, longitude, address });
      setConfirmed(false);
      onChange(null);
    };
  }, [address, onChange]);
  useEffect(() => {
    if (!pin || !element.current || map.current) return;
    let cancelled = false;
    import("leaflet")
      .then((L) => {
        if (cancelled || !element.current) return;
        const m = L.map(element.current).setView(
          [pin.latitude, pin.longitude],
          17,
        );
        L.tileLayer(
          process.env.NEXT_PUBLIC_MAP_TILE_URL ||
            "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          {
            maxZoom: 19,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
          },
        ).addTo(m);
        const icon = L.divIcon({
          className: "shop-map-pin",
          html: '<span aria-hidden="true">●</span>',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        const mk = L.marker([pin.latitude, pin.longitude], {
          icon,
          draggable: true,
        }).addTo(m);
        mk.on("dragend", () => {
          const p = mk.getLatLng();
          pick.current?.(p.lat, p.lng);
        });
        m.on("click", (e) => {
          mk.setLatLng(e.latlng);
          pick.current?.(e.latlng.lat, e.latlng.lng);
        });
        map.current = m;
        marker.current = mk;
        m.invalidateSize();
        setMapReady(true);
      })
      .catch(() => setMapError(true));
    return () => {
      cancelled = true;
    };
  }, [pin]);
  useEffect(() => {
    if (pin && map.current) {
      marker.current?.setLatLng([pin.latitude, pin.longitude]);
      map.current.setView([pin.latitude, pin.longitude]);
    }
  }, [pin]);
  useEffect(
    () => () => {
      map.current?.remove();
      map.current = null;
    },
    [],
  );
  const choose = (value: ShopLocation) => {
    revision.current++;
    setPin(value);
    setAddress(value.address);
    setConfirmed(false);
    onChange(null);
    setResults([]);
    setError("");
  };
  const explain = (e: unknown) => {
    const code = e instanceof Error ? e.message : "MAP_UNAVAILABLE";
    setError(t.has(`error.${code}`) ? t(`error.${code}`) : t("mapUnavailable"));
  };
  async function search() {
    setBusy(true);
    setError("");
    try {
      const r = await api("/api/location", { action: "search", text: address });
      setResults(r.results);
      if (!r.results.length) setError(t("addressNotFound"));
    } catch (e) {
      explain(e);
    } finally {
      setBusy(false);
    }
  }
  async function gps() {
    if (!navigator.geolocation) {
      setError(t("locationFailed"));
      return;
    }
    setBusy(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const value = {
          address,
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
        };
        choose(value);
        const version = revision.current;
        try {
          const r = await api("/api/location", { action: "reverse", ...value });
          if (r.results[0] && revision.current === version)
            choose({ ...value, address: r.results[0].address });
        } catch (e) {
          explain(e);
        } finally {
          setBusy(false);
        }
      },
      () => {
        setBusy(false);
        setError(t("locationFailed"));
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }
  return (
    <div className="location-picker">
      <label>
        {t("shopAddress")}
        <input
          value={address}
          disabled={busy}
          maxLength={400}
          autoComplete="street-address"
          onChange={(e) => {
            revision.current++;
            setResults([]);
            setAddress(e.target.value);
            setConfirmed(false);
            onChange(null);
          }}
          placeholder={t("addressExample")}
          required
        />
      </label>
      <div className="location-actions">
        <button
          type="button"
          className="button secondary small"
          disabled={busy || !address.trim()}
          onClick={search}
        >
          <Search size={16} />
          {t("findAddress")}
        </button>
        <button
          type="button"
          className="button secondary small"
          disabled={busy}
          onClick={gps}
        >
          {busy ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <MapPin size={16} />
          )}
          {t("useLocation")}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {results.length > 0 && (
        <ul className="address-results">
          {results.map((r, index) => (
            <li key={index}>
              <button type="button" onClick={() => choose(r)}>
                {r.address}
              </button>
            </li>
          ))}
        </ul>
      )}
      {pin && (
        <>
          <p className="fine">{t("confirmPinHint")}</p>
          <div ref={element} className="shop-map" aria-label={t("shopMap")} />
          {mapError && <p className="error">{t("mapUnavailable")}</p>}
          <label className="check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={!address.trim() || mapError || !mapReady || busy}
              onChange={(e) => {
                setConfirmed(e.target.checked);
                onChange(
                  e.target.checked ? { ...pin, address: address.trim() } : null,
                );
              }}
            />
            <Check size={16} />
            {t("confirmShopPin")}
          </label>
        </>
      )}
      <p className="fine">{t("nearbyRadiusHint")}</p>
      <p className="map-attribution">
        {t("addressProvider")}{" "}
        <a
          href="https://www.geoapify.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Geoapify
        </a>
      </p>
    </div>
  );
}
