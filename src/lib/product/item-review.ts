import type { Intent } from "./types";
import { productLabel } from "./canonical";
import { withDetails, detailsText } from "./capture-fields";
import { manualDraft, parseIntent } from "./intent";

export function itemDescription(i: Intent) {
  return [
    productLabel(i),
    i.size && i.unit ? `${i.size}${i.unit}` : null,
    i.packaging,
  ]
    .filter(Boolean)
    .join(" · ");
}

export async function reviewEditedItem(
  value: string,
  base: Intent,
  normalize: (text: string) => Promise<unknown>,
): Promise<Intent> {
  if (!value.trim()) throw new Error("ITEM_REQUIRED");
  if (value.trim() === itemDescription(base)) return base;
  // Re-extract changed item text, never attach the old pack/brand to a new item.
  const reviewed =
    base.source === "manual"
      ? manualDraft(value.trim())
      : parseIntent(await normalize(value.trim()));
  return {
    ...reviewed,
    quantity: base.quantity,
    budget_paise: base.budget_paise,
    deadline: base.deadline,
    can_wait: base.can_wait,
    flexible_price: base.flexible_price,
    no_rush: base.no_rush,
  };
}

export interface ItemFields {
  item: string;
  variant: string;
  pack: string;
}
export function combinedItemFields(i: Intent) {
  return { item: itemFields(i).item, details: detailsText(i) };
}
export async function reviewCombinedItemFields(
  fields: { item: string; details: string },
  base: Intent,
  normalize: (text: string) => Promise<unknown>,
): Promise<Intent> {
  const original = combinedItemFields(base);
  if (!fields.item.trim()) throw new Error("ITEM_REQUIRED");
  if (
    fields.item.trim() === original.item &&
    fields.details.trim() === original.details
  )
    return base;
  const reviewed = await reviewItemFields(
    { item: fields.item, variant: "", pack: "" },
    base,
    normalize,
  );
  // One visible details field; structured SKU fields are still kept separately.
  // Removing details clears old specs instead of silently retaining them.
  return parseIntent(withDetails(reviewed, fields.details.trim()));
}
export function itemFields(i: Intent): ItemFields {
  return {
    item: productLabel({ ...i, variant: null }),
    variant: i.variant || "",
    pack: [i.size && i.unit ? `${i.size}${i.unit}` : null, i.packaging]
      .filter(Boolean)
      .join(" "),
  };
}
// Structured edits are authoritative. Never ask AI to reinterpret a size/flavour correction.
export async function reviewItemFields(
  fields: ItemFields,
  base: Intent,
  normalize: (text: string) => Promise<unknown>,
): Promise<Intent> {
  if (!fields.item.trim()) throw new Error("ITEM_REQUIRED");
  const original = itemFields(base);
  let reviewed = base;
  if (fields.item.trim() !== original.item) {
    const identityBase = {
      ...base,
      variant: null,
      size: null,
      unit: null,
      packaging: null,
    };
    try {
      reviewed = await reviewEditedItem(fields.item, identityBase, normalize);
    } catch (e) {
      if (
        !(e instanceof Error) ||
        !["AI_RATE_LIMIT", "AI_DAILY_LIMIT", "AI_UNAVAILABLE"].includes(
          e.message,
        )
      )
        throw e;
      reviewed = await reviewEditedItem(
        fields.item,
        { ...identityBase, source: "manual" },
        normalize,
      );
    }
  }
  const packed = withDetails(reviewed, fields.pack.trim());
  if (
    fields.pack.trim() !== original.pack &&
    fields.pack.trim() &&
    (!packed.size || !packed.unit || packed.variant)
  )
    throw new Error("PACK_INVALID");
  // Preserve unchanged packs, including known packaging labels that the simple parser doesn't recognise.
  const samePack = fields.pack.trim() === original.pack;
  return parseIntent({
    ...reviewed,
    variant: fields.variant.trim() || null,
    size: samePack ? base.size : packed.size,
    unit: samePack ? base.unit : packed.unit,
    packaging: samePack ? base.packaging : packed.packaging,
  });
}
