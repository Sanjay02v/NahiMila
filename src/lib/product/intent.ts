import { z } from "zod";
import type { Intent } from "./types";
import { manualDay, withoutPhones } from "./capture-fields";
import { identityKey } from "./canonical";
const nullableText = z.string().max(120).nullable();
export const intentSchema = z.object({
  product: z.string().trim().min(1).max(160),
  category: z.string().max(100),
  brand: nullableText,
  variant: nullableText,
  size: z.number().positive().max(100000).nullable(),
  unit: z.enum(["g", "ml", "piece"]).nullable(),
  packaging: nullableText,
  quantity: z.number().int().min(1).max(100).nullable(),
  budget_paise: z.number().int().positive().max(100000000).nullable(),
  deadline: z.string().max(40).nullable(),
  substitutions: z.boolean(),
  hard_constraints: z.array(z.string().max(120)).max(12),
  preferences: z.array(z.string().max(120)).max(12),
  missing: z.array(z.string().max(100)).max(12),
  evidence: z.record(z.string(), z.string().max(200)),
  source: z.enum(["gemini", "manual"]),
  can_wait: z.boolean().nullable().optional(),
  flexible_price: z.boolean().optional(),
  no_rush: z.boolean().optional(),
});
export function parseIntent(value: unknown): Intent {
  const i = intentSchema.parse(value);
  if (i.deadline && !Number.isFinite(Date.parse(i.deadline)))
    throw new Error("INVALID_DEADLINE");
  return i;
}
export function pack(i: Intent) {
  return i.size && i.unit ? `${i.size}${i.unit}` : "Unspecified pack";
}
export function productKey(i: Intent) {
  return identityKey(i);
}
export function manualDraft(raw: string): Intent {
  // Explicit aliases are suggestions, not a pretend AI response. All values require review.
  const lower = raw.toLowerCase(),
    weight = lower.match(
      /(\d+(?:\.\d+)?)\s*(kg|grams?|g\b|ml\b|litres?|liters?|l\b)/,
    );
  let size = weight ? Number(weight[1]) : null,
    unit: Intent["unit"] = weight
      ? /kg|gram|^g$/.test(weight[2])
        ? "g"
        : "ml"
      : null;
  if (weight && /kg|lit|^l$/.test(weight[2])) size = size! * 1000;
  if (/half[ -]?litre|half[ -]?liter/.test(lower)) {
    size = 500;
    unit = "ml";
  }
  const millet = /millet.*crunch|crunch.*millet/.test(lower),
    coke = /coke\s*zero|zero\s*coke/.test(lower);
  const qty =
      lower.match(/(?:quantity|qty)\s*[:=]?\s*(\d+)\b/) ||
      lower.match(/(\d+)\s*(packets?|packs?|bottles?|units?)\b/),
    price = lower.match(/(?:under|budget|₹|rs\.?|below)\s*(\d+(?:\.\d{1,2})?)/);
  return {
    product: millet
      ? "Millet Crunch"
      : coke
        ? "Coke Zero"
        : withoutPhones(raw)
            .split(/;|\.(?!\d)/)
            .filter(
              (part) =>
                !!part.trim() &&
                !/^\s*(?:customer(?:'s)?\s+name\b|(?:phone|mobile|contact)\s*(?:number)?\s*[:=]?\s*$)/i.test(
                  part,
                ),
            )
            .join(". ")
            .replace(
              /\b(?:customer(?:'s)?\s+(?:(?:phone|mobile|contact)\s+)?(?:number|phone)|(?:phone|mobile|contact)\s+(?:number|no\.?))\b\s*(?:is|:|=)?/gi,
              "",
            )
            .replace(/[\s,;:]+$/g, "")
            .trim()
            .slice(0, 160) || "",
    category: millet ? "Snacks" : coke ? "Soft drink" : "",
    brand: millet ? "Millet Crunch" : coke ? "Coca-Cola" : null,
    variant: millet
      ? /lime/.test(lower)
        ? "Lime"
        : /masala/.test(lower)
          ? "Masala"
          : null
      : coke
        ? "Zero sugar"
        : null,
    size,
    unit,
    packaging: coke && /bottle/.test(lower) ? "bottle" : null,
    quantity: qty ? Number(qty[1]) : null,
    budget_paise: price ? Math.round(Number(price[1]) * 100) : null,
    deadline: manualDay(raw),
    substitutions: false,
    hard_constraints: [],
    preferences: [],
    missing: !size ? ["pack"] : [],
    evidence: {},
    source: "manual",
  };
}
export function distanceMeters(
  a: { latitude: number | null; longitude: number | null },
  b: { latitude: number | null; longitude: number | null },
) {
  if (
    a.latitude === null ||
    a.longitude === null ||
    b.latitude === null ||
    b.longitude === null
  )
    return Infinity;
  const rad = (x: number) => (x * Math.PI) / 180,
    dlat = rad(b.latitude - a.latitude),
    dlon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(dlon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
