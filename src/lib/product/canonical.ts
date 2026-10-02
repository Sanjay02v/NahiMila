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
export function canonicalIdentity<T extends ProductIdentity>(value: T): T {
  const i = { ...value };
  const brand = identityText(i.brand || "");
  i.brand = aliases[brand] || i.brand;
  i.variant = i.variant ? variants[identityText(i.variant)] || i.variant : null;
  i.packaging = i.packaging
    ? packaging[identityText(i.packaging)] || i.packaging
    : null;
  const product = identityText(i.product);
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
  return i;
}
function constraints(i: ProductIdentity) {
  const brand = identityText(i.brand || ""),
    pack = identityText(i.packaging || "");
  return [
    ...new Set(
      i.hard_constraints.map(identityText).filter((c) => {
        // These restrictions remain on the request but add no new product specification.
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
  // Incomplete packs can be recorded, but cannot be resolved semantically to a catalog item.
  return !!a.size && !!a.unit && specificationKey(a) === specificationKey(b);
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
