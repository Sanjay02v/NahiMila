"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Shop } from "@/lib/product/types";
import LocationPicker, { type ShopLocation } from "./LocationPicker";
export default function ProfileForm({
  shop,
  busy,
  error,
  save,
}: {
  shop: Shop;
  busy: boolean;
  error?: string;
  save: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const t = useTranslations(),
    initial =
      shop.latitude !== null && shop.longitude !== null
        ? {
            latitude: shop.latitude,
            longitude: shop.longitude,
            address: shop.address || shop.neighborhood,
          }
        : undefined;
  const [location, setLocation] = useState<ShopLocation | null>(
    initial || null,
  );
  return (
    <form
      className="profile-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await save({
          action: "profile",
          owner_name: f.get("owner_name"),
          name: f.get("name"),
          ...location,
          location_confirmed: !!location,
        });
      }}
    >
      <label>
        {t("merchantName")}
        <input
          name="owner_name"
          defaultValue={shop.owner_name}
          required
          maxLength={100}
          autoComplete="name"
        />
      </label>
      <label>
        {t("shopName")}
        <input
          name="name"
          defaultValue={shop.name}
          required
          maxLength={100}
          autoComplete="organization"
        />
      </label>
      <LocationPicker initial={initial} onChange={setLocation} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="button full" disabled={busy || !location}>
        {t("saveSettings")}
      </button>
    </form>
  );
}
