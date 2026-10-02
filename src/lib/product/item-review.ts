import type { Intent } from "./types";
import { productLabel } from "./canonical";
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
