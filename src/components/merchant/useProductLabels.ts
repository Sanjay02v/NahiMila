"use client";
import { useEffect, useSyncExternalStore } from "react";
import { useLocale } from "next-intl";
import { api } from "./common";
const caches = new Map<string, Record<string, string>>(),
  inFlight = new Set<string>(),
  attempted = new Set<string>(),
  listeners = new Set<() => void>();
let version = 0;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => version;
export function useProductLabels(sources: string[] = [], token?: string) {
  const locale = useLocale();
  useSyncExternalStore(subscribe, snapshot, () => 0);
  const signature = JSON.stringify(
    [...new Set(sources)].filter(Boolean).sort(),
  );
  useEffect(() => {
    if (locale === "en") return;
    const labels: string[] = JSON.parse(signature),
      cache = caches.get(locale) || {};
    const missing = labels.filter(
      (s) =>
        !cache[s] &&
        !inFlight.has(`${locale}:${s}`) &&
        !attempted.has(`${locale}:${s}`),
    );
    let cancelled = false;
    const fetchLabels = async () => {
      for (let i = 0; i < missing.length; i += 30) {
        if (cancelled) break;
        const batch = missing.slice(i, i + 30);
        batch.forEach((s) => {
          inFlight.add(`${locale}:${s}`);
          attempted.add(`${locale}:${s}`);
        });
        try {
          const result = await api("/api/product-labels", {
            locale,
            labels: batch,
            ...(token ? { token } : {}),
          });
          caches.set(locale, { ...caches.get(locale), ...result.labels });
          version++;
          listeners.forEach((fn) => fn());
        } catch {
          /* Preserve original labels when translation is unavailable. A reload permits retry. */
        } finally {
          batch.forEach((s) => inFlight.delete(`${locale}:${s}`));
        }
      }
    };
    void fetchLabels();
    return () => {
      cancelled = true;
    };
  }, [locale, signature, token]);
  return (source: string) => {
    const labels = caches.get(locale) || {};
    if (labels[source]) return labels[source];
    // Agent evidence may include a product label plus untouched supplier/specifications.
    let result = source;
    for (const original of Object.keys(labels).sort(
      (a, b) => b.length - a.length,
    ))
      if (result.includes(original))
        result = result.replaceAll(original, labels[original]);
    return result;
  };
}
