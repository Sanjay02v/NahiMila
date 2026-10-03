import type { Intent } from "./types";
export function phoneNumber(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    value.length > 30 ||
    !/^[+\d\s()-]+$/.test(value)
  )
    throw new Error("INVALID_PHONE");
  let digits = value.replace(/\D/g, "");
  if (digits.length === 10 && /^[6-9]/.test(digits)) digits = "91" + digits;
  else if (
    !value.trim().startsWith("+") &&
    !(digits.length === 12 && digits.startsWith("91"))
  )
    throw new Error("INVALID_PHONE");
  if (
    !/^[1-9]\d{7,14}$/.test(digits) ||
    (digits.startsWith("91") &&
      (digits.length !== 12 || !/^91[6-9]/.test(digits)))
  )
    throw new Error("INVALID_PHONE");
  return digits;
}
const phonePattern =
  /(?<!\d)(?:\+?91[\s()-]*[6-9](?:[\s()-]*\d){9}|[6-9](?:[\s()-]*\d){9}|\+\d[\d ()-]{7,25}\d)(?!\d)/g;
function phoneCandidates(raw: string) {
  return [...raw.matchAll(phonePattern)].flatMap((match) => {
    if (
      /(?:₹|rs\.?|price|budget|under|quantity|qty)\s*[:=]?\s*$/i.test(
        raw.slice(Math.max(0, match.index! - 25), match.index),
      )
    )
      return [];
    try {
      const phone = phoneNumber(match[0].trim());
      return phone ? [{ phone, text: match[0] }] : [];
    } catch {
      return [];
    }
  });
}
export function withoutPhones(raw: string): string {
  let value = raw;
  for (const candidate of phoneCandidates(raw))
    value = value.replace(candidate.text, "");
  return value.trim();
}
export function phoneFromText(raw: string): string | null {
  const valid = new Set(phoneCandidates(raw).map((v) => v.phone));
  return valid.size === 1 ? [...valid][0] : null;
}
export function groundedCustomerName(
  raw: string,
  name: unknown,
  evidence: unknown,
): string | null {
  if (typeof name !== "string" || typeof evidence !== "string") return null;
  const value = name.trim();
  if (!value || value.length > 80 || !/^[\p{L}\p{M} .'-]+$/u.test(value))
    return null;
  // Verbatim evidence must explicitly identify a customer, never a brand/item name.
  if (
    !raw
      .toLocaleLowerCase()
      .replace(/\s+/g, " ")
      .includes(evidence.toLocaleLowerCase().replace(/\s+/g, " ")) ||
    !evidence.toLocaleLowerCase().includes(value.toLocaleLowerCase()) ||
    !/(?:\b(?:customer|client)\b|\bname\s*(?:is|:)|नाम|ಹೆಸರು|ग्राहक|ಗ್ರಾಹಕ|(?:को|ने|ಅವರಿಗೆ)|\b(?:asked for|wants?|needs?|requested|ko|ne|avarige|avarge)\b)/i.test(
      evidence,
    ) ||
    /\b(?:product|brand|item)\s+name\b/i.test(evidence)
  )
    return null;
  const identified = customerNameFromText(evidence);
  if (
    identified?.toLocaleLowerCase() !== value.toLocaleLowerCase() &&
    !/(?:\bcustomer(?:'s)?\s+(?:name\b|is\b|called\b|named\b)|\bname\s*(?:is|:)|नाम|ಹೆಸರು)/i.test(
      evidence,
    )
  )
    return null;
  return value;
}
export function customerNameFromText(raw: string): string | null {
  // Explicit identity phrases only. Never look up a person from their phone.
  const match =
    raw.match(
      /(?:\b(?:customer|client)(?:'s)?\s+name\s*(?:is|:|=)?|\b(?:his|her|their)\s+name\s+is|ग्राहक\s+का\s+नाम\s*(?:है|[:=])?|ಗ್ರಾಹಕರ\s+ಹೆಸರು\s*[:=]?)\s*([\p{L}\p{M}][\p{L}\p{M} .'-]{0,79})/iu,
    ) ||
    raw.match(
      /(?:\b(?:customer|client)(?:'s)?\s+name\s*(?:is|:|=)?|\b(?:his|her|their)\s+name\s+is|\b(?:customer|client)\s+(?:is\s+(?:called|named)\s+|is\s+|called\s+|named\s+)?|ग्राहक\s+का\s+नाम\s*(?:है|[:=])?|ग्राहक\s+|ಗ್ರಾಹಕರ\s+ಹೆಸರು\s*[:=]?|ಗ್ರಾಹಕ(?:ರು|ರ)?\s+)\s*([\p{L}\p{M}][\p{L}\p{M} .'-]{0,79})/iu,
    ) ||
    raw.match(
      /(?:^|[.!?;\n]\s*)([\p{Lu}][\p{L}\p{M}'-]*(?:\s+[\p{Lu}][\p{L}\p{M}'-]*){0,2})\s+(?:asked for|wants?|needs?|requested|ko|ne|avarige|avarge)\b/u,
    ) ||
    raw.match(
      /(?:^|[.!?;।\n]\s*)([\u0900-\u097f][\p{L}\p{M}'-]*(?:\s+[\u0900-\u097f][\p{L}\p{M}'-]*){0,2})\s+(?:को|ने)\s/u,
    ) ||
    raw.match(
      /(?:^|[.!?;\n]\s*)([\u0c80-\u0cff][\p{L}\p{M}'-]*(?:\s+[\u0c80-\u0cff][\p{L}\p{M}'-]*){0,2})\s+ಅವರಿಗೆ\s/u,
    );
  if (!match) return null;
  const name = match[1]
    .split(/[.!?;,\n।]/)[0]
    .split(
      /\s+(?:(?:and|can|cannot|will|phone|mobile|number|wants?|needs?|asked|requested|is willing)\b|को\s|ने\s|है(?:\s|$)|और(?:\s|$)|ಗೆ\s|ಅವರಿಗೆ\s|ಅವರು\s|ಮತ್ತು\s|ಕಾಯಲು\s)/i,
    )[0]
    .replace(/[ .'-]+$/, "")
    .trim();
  return name &&
    name.length <= 80 &&
    !/^(?:name|is|can|cannot|will|wants?|needs?|asked|requested|का नाम|ಹೆಸರು)(?:\s|$)/i.test(
      name,
    )
    ? name
    : null;
}

export function preserveDraftContacts(raw: string, draft: string): string {
  const name = customerNameFromText(raw);
  const phone = phoneFromText(raw);
  return [
    draft,
    name && customerNameFromText(draft) !== name
      ? `Customer name: ${name}.`
      : "",
    phone && phoneFromText(draft) !== phone ? `Customer phone: +${phone}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
export function dayFromDeadline(value: string | null): string {
  return value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
        new Date(value),
      )
    : "";
}
export function deadlineFromDay(day: string): string | null {
  if (!day) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("INVALID_DEADLINE");
  const value = `${day}T23:59:59+05:30`;
  if (!Number.isFinite(Date.parse(value)) || dayFromDeadline(value) !== day)
    throw new Error("INVALID_DEADLINE");
  return new Date(value).toISOString();
}
export function detailsText(i: Intent): string {
  return [
    i.variant,
    i.size && i.unit ? `${i.size}${i.unit}` : null,
    i.packaging,
  ]
    .filter(Boolean)
    .join(", ");
}
export function withDetails(i: Intent, value: string): Intent {
  const match = value.match(
    /(\d+(?:\.\d+)?)\s*(kgs?\b|grams?\b|gms?\b|g\b|ml\b|litres?\b|liters?\b|ltrs?\b|l\b|pieces?\b|pcs?\b)/i,
  );
  let size: number | null = match ? Number(match[1]) : null;
  let unit: Intent["unit"] = match
    ? /kg|gram|^gms?$|^g$/i.test(match[2])
      ? "g"
      : /piece|^pcs?$/i.test(match[2])
        ? "piece"
        : "ml"
    : null;
  if (match && /kg|lit|ltr|^l$/i.test(match[2])) size = size! * 1000;
  const half = /half[ -]?lit(?:re|er)/i;
  if (half.test(value)) {
    size = 500;
    unit = "ml";
  }
  const packaging =
    value.match(/\b(bottle|can|pouch|packet|pack)\b/i)?.[1].toLowerCase() ||
    null;
  const variant = value
    .replace(match?.[0] || /$^/, "")
    .replace(half, "")
    .replace(/\b(bottle|can|pouch|packet|pack)\b/gi, "")
    .replace(/\bbars?\b/gi, "")
    .replace(/^[\s,;·-]+|[\s,;·-]+$/g, "")
    .replace(/\s*[,;·]\s*/g, " ")
    .trim();
  return { ...i, variant: variant || null, size, unit, packaging };
}
export function captureHints(raw: string, i?: Intent) {
  const unable =
    /(?:can(?:not|'t|’t)|won(?:'t|’t)|will not|not willing to|unable to|(?:does|do)(?: not|n't|n’t) want to)\s+wait|नहीं.*इंतज़ार|इंतज़ार.*नहीं|ಕಾಯಲು ಸಾಧ್ಯವಿಲ್ಲ/i.test(
      raw,
    );
  const uncertain =
    /(?:not sure|unsure|maybe|might)\b[^.!?]{0,50}\bwait|पता नहीं|ಗೊತ್ತಿಲ್ಲ/i.test(
      raw,
    );
  const willing =
    /(?:willing to|can|will|happy to)\s+wait|इंतज़ार.*(?:कर|तैयार)|करेगा|ಕಾಯಲು ಸಿದ್ಧ|ಕಾಯುತ್ತಾರೆ/i.test(
      raw,
    );
  const flexible =
    /flexible (?:on|with) price|any price|no (?:price|budget) limit|कोई भी कीमत|ಬೆಲೆ.*ಪರವಾಗಿಲ್ಲ/i.test(
      raw,
    );
  const noRush =
    /no rush|no deadline|any (?:amount of )?time|कभी भी|समय की जल्दी नहीं|ತುರ್ತು ಇಲ್ಲ/i.test(
      raw,
    );
  const grounded = (field: string) =>
    !!i?.evidence[field] && raw.includes(i.evidence[field]);
  return {
    phone: phoneFromText(raw),
    can_wait: unable
      ? false
      : uncertain
        ? null
        : willing || noRush
          ? true
          : grounded("can_wait")
            ? (i?.can_wait ?? null)
            : null,
    flexible_price:
      flexible || (!!i?.flexible_price && grounded("flexible_price")),
    no_rush: noRush || (!!i?.no_rush && grounded("no_rush")),
  };
}
export function manualDay(raw: string): string | null {
  const iso = raw.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const local = raw.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  const day =
    iso?.[1] ||
    (local
      ? `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`
      : "");
  try {
    return deadlineFromDay(day);
  } catch {
    return null;
  }
}
