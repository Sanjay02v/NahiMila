import type { Intent } from "./types";
export type ProductIdentity = Pick<
  Intent,
  | "product"
  | "brand"
  | "variant"
  | "size"
  | "unit"
  | "packaging"
  | "hard_constraints"
>;
export const identityText = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
const aliases: Record<string, string> = {
  coke: "Coca-Cola",
  "coca cola": "Coca-Cola",
  कोक: "Coca-Cola",
  "कोका कोला": "Coca-Cola",
  ಕೋಕ್: "Coca-Cola",
  "ಕೋಕಾ ಕೋಲಾ": "Coca-Cola",
  "millet crunch": "Millet Crunch",
  "मिलेट क्रंच": "Millet Crunch",
  "ಮಿಲ್ಲೆಟ್ ಕ್ರಂಚ್": "Millet Crunch",
};
const variants: Record<string, string> = {
  zero: "Zero Sugar",
  "zero sugar": "Zero Sugar",
  ज़ीरो: "Zero Sugar",
  जीरो: "Zero Sugar",
  "ಶೂನ್ಯ ಸಕ್ಕರೆ": "Zero Sugar",
  masala: "Masala",
  मसाला: "Masala",
  ಮಸಾಲಾ: "Masala",
  lime: "Lime",
};
const packaging: Record<string, string> = {
  bottle: "bottle",
  bottles: "bottle",
  बोतल: "bottle",
  ಬಾಟಲಿ: "bottle",
  can: "can",
  cans: "can",
  tin: "can",
  packet: "packet",
  packets: "packet",
  pouch: "pouch",
  pouches: "pouch",
  pack: "pack",
};
// Known family wording only; never fuzzy-match models, brands, flavours or sizes.
const families: Record<string, string> = {
  chocolate: "Chocolate",
  chocolates: "Chocolate",
  "chocolate bar": "Chocolate",
  "chocolate bars": "Chocolate",
  "mobile phone": "Mobile phone",
  "mobile phones": "Mobile phone",
  smartphone: "Mobile phone",
  smartphones: "Mobile phone",
};
export function canonicalIdentity<T extends ProductIdentity>(value: T): T {
  const i = { ...value };
  const brand = identityText(i.brand || "");
  i.brand = aliases[brand] || i.brand;
  i.variant = i.variant ? variants[identityText(i.variant)] || i.variant : null;
  i.packaging = i.packaging
    ? packaging[identityText(i.packaging)] || i.packaging
    : null;
  let product = identityText(i.product);
  // The extractor can repeat structured specifications in the family name.
  // Remove only the exact recorded words; the original commercial fields remain.
  for (const spec of [i.variant, i.brand]) {
    const words = identityText(spec || "");
    if (!words) continue;
    const reduced = ` ${product} `.replace(` ${words} `, " ").trim();
    if (reduced && reduced !== product) {
      product = reduced;
      i.product = reduced;
    }
  }
  // Registered, explicit aliases only. Never infer a pack or override a conflicting brand.
  if (
    (i.brand === "Coca-Cola" ||
      (!i.brand &&
        /coca cola|coke|कोक|कोका कोला|ಕೋಕ್|ಕೋಕಾ ಕೋಲಾ/.test(product))) &&
    (!i.variant || i.variant === "Zero Sugar") &&
    /^(?:(?:coca cola|coke|कोक|कोका कोला|ಕೋಕ್|ಕೋಕಾ ಕೋಲಾ)\s*)?(?:zero(?: sugar)?|ज़ीरो|जीरो|ಶೂನ್ಯ ಸಕ್ಕರೆ)(?:\s*(?:cola|coke))?$/.test(
      product,
    )
  ) {
    i.brand = "Coca-Cola";
    i.product = "Cola";
    i.variant = i.variant || "Zero Sugar";
  } else if (
    i.brand === "Coca-Cola" &&
    [
      "coca cola",
      "coke",
      "cola",
      "soft drink",
      "soft drinks",
      "carbonated soft drink",
      "carbonated beverage",
      "कोला",
    ].includes(product)
  )
    i.product = "Cola";
  if (
    (i.brand === "Millet Crunch" ||
      (!i.brand &&
        ["millet crunch", "मिलेट क्रंच", "ಮಿಲ್ಲೆಟ್ ಕ್ರಂಚ್"].includes(
          product,
        ))) &&
    [
      "millet crunch",
      "millet crunch snacks",
      "millet snack",
      "millet snacks",
      "मिलेट क्रंच",
      "ಮಿಲ್ಲೆಟ್ ಕ್ರಂಚ್",
    ].includes(product)
  ) {
    i.brand = "Millet Crunch";
    i.product = "Millet Crunch";
  }
  i.product = families[identityText(i.product)] || i.product;
  return i;
}
// A display grouping, never a supplier SKU or procurement identity.
export function familyKey(value: ProductIdentity) {
  const i = canonicalIdentity(value);
  return JSON.stringify([identityText(i.brand || ""), identityText(i.product)]);
}
export function familyLabel(value: ProductIdentity) {
  const i = canonicalIdentity(value);
  return productLabel({ ...i, variant: null });
}
function constraints(i: ProductIdentity) {
  const brand = identityText(i.brand || ""),
    pack = identityText(i.packaging || "");
  return [
    ...new Set(
      i.hard_constraints.map(identityText).filter((c) => {
        // These restrictions remain on the request but add no new product specification.
        // Quantity and willingness describe this customer, never the supplier SKU.
        if (/^(?:quantity|qty)\s+/.test(c)) return false;
        if (
          /^(?:can wait|cannot wait|can not wait|cant wait|willing to wait|not willing to wait|no rush|can_wait)$/.test(
            c,
          ) ||
          /^(?:can wait|customer can wait|customer cannot wait|can_wait)\s+(?:true|false|yes|no)$/.test(
            c,
          )
        )
          return false;
        const packDetail = c.replace(/^(?:packaging|package)\s+/, "");
        if (pack && (packaging[packDetail] || packDetail) === pack)
          return false;
        // Ignore a labelled size only when it is exactly the structured size.
        // Conflicts and additional requirements (e.g. glass only) stay separate.
        if (/^(?:size|pack size)\s+/.test(c)) {
          const sizeText = c.replace(/^(?:size|pack size)\s+/, "");
          const measured = sizeText.match(
            /^(\d+(?: \d+)?)\s*(g|grams?|gms?|kg|kilograms?|ml|millilitres?|milliliters?|l|litres?|liters?|pieces?)$/,
          );
          const halfLitre = /^half (?:litre|liter)$/.test(sizeText);
          if (halfLitre && i.unit === "ml" && i.size === 500) return false;
          if (measured) {
            const u = measured[2];
            const unit = /^(?:kg|kilogram|g|gram)/.test(u)
              ? "g"
              : /^piece/.test(u)
                ? "piece"
                : "ml";
            const amount =
              Number(measured[1].replace(" ", ".")) *
              (/^(?:kg|kilogram|l$|litre|liter)/.test(u) ? 1000 : 1);
            if (unit === i.unit && amount === i.size) return false;
          }
        }
        if (
          [
            "no substitutions",
            "no substitution",
            "no other brand",
            "same brand only",
            "exact brand only",
          ].includes(c)
        )
          return false;
        if (pack && [pack + " only", "only " + pack].includes(c)) return false;
        const named = c.replace(/^(?:brand|brand only|only brand)\s+/, "");
        if (brand && identityText(aliases[named] || named) === brand)
          return false;
        return true;
      }),
    ),
  ].sort();
}
export function identityKey(value: ProductIdentity) {
  const i = canonicalIdentity(value);
  return JSON.stringify([
    identityText(i.product),
    identityText(i.brand || ""),
    identityText(i.variant || ""),
    i.size,
    i.unit,
    identityText(i.packaging || ""),
    constraints(i),
  ]);
}
export function specificationKey(value: ProductIdentity) {
  const i = canonicalIdentity(value);
  return JSON.stringify([
    identityText(i.brand || ""),
    identityText(i.variant || ""),
    i.size,
    i.unit,
    identityText(i.packaging || ""),
    constraints(i),
  ]);
}
export function sameSpecifications(a: ProductIdentity, b: ProductIdentity) {
  // Unknown may match unknown, but never a specified pack. This resolves labels,
  // not permission to purchase: confirmation still requires actual item terms.
  return specificationKey(a) === specificationKey(b);
}
export function productLabel(i: ProductIdentity) {
  return [
    i.brand && identityText(i.brand) !== identityText(i.product) ? i.brand : "",
    i.product,
    i.variant,
  ]
    .filter(Boolean)
    .join(" · ");
}
