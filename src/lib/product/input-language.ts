import { locales, type Locale } from "./types";

// The language of a request is independent of the shop's interface setting.
export function inputLanguage(raw: string, fallback: Locale): Locale {
  const hindi = raw.match(/[\u0900-\u097f]/g)?.length || 0;
  const kannada = raw.match(/[\u0c80-\u0cff]/g)?.length || 0;
  if (hindi || kannada) return kannada > hindi ? "kn" : "hi";
  return /[a-z]/i.test(raw) ? "en" : fallback;
}

export function resolvedInputLanguage(
  raw: string,
  fallback: Locale,
  detected?: unknown,
): Locale {
  // Keep native-script speech/text in its own language even if AI mislabels it.
  if (/[\u0900-\u097f\u0c80-\u0cff]/.test(raw))
    return inputLanguage(raw, fallback);
  return locales.includes(detected as Locale)
    ? (detected as Locale)
    : inputLanguage(raw, fallback);
}
