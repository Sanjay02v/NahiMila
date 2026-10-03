import type { Locale, MerchantView, QuoteView } from "./types";
import { quoteActions, quoteBlockers } from "./quote-actions";
export type QuoteTopic = "approvals" | "units" | "cost" | "readiness";
export function quoteStatus(q: QuoteView) {
  return {
    missing_approvals: Math.max(0, q.participant_count - q.approval_count),
    missing_units:
      q.total_units === 0
        ? q.quote.moq
        : (q.quote.moq - (q.total_units % q.quote.moq)) % q.quote.moq,
    can_order: !q.committed && quoteActions(q).canCommit,
    own_approval_status: q.own?.approval_status ?? null,
    blockers: quoteBlockers(q),
  };
}
export function operationAnswer(
  q: QuoteView,
  topic: QuoteTopic,
  locale: Locale,
) {
  const s = quoteStatus(q),
    name = `${q.product.localized_labels?.[locale]?.[q.product.name] || q.product.name} (${q.product.pack_size})`,
    money = new Intl.NumberFormat(`${locale}-IN`, {
      style: "currency",
      currency: "INR",
    }).format((q.own?.total_exposure_paise || 0) / 100);
  const copy = {
    en: {
      approvals: s.missing_approvals
        ? `${s.missing_approvals} more shop${s.missing_approvals === 1 ? "" : "s"} must approve their share. ${q.approval_count} of ${q.participant_count} have approved.`
        : `No more shop approvals are needed. ${q.approval_count} of ${q.participant_count} have approved.`,
      units: s.missing_units
        ? `${s.missing_units} more confirmed units are needed to fill complete supplier cases. There are ${q.total_units} confirmed units; each case holds ${q.quote.moq}.`
        : `The ${q.total_units} confirmed units fill complete supplier cases of ${q.quote.moq}.`,
      cost: q.own
        ? `Your ${q.own.allocated_units} units currently cost ${money}.${q.eligible ? "" : " This is a provisional estimate and may change."}`
        : "You do not have an allocated share yet.",
      ready:
        "All checks and shop approvals have passed. Review the order in Orders.",
      blocked: "The order is not ready yet.",
      committed: "This shared order has already been placed in the simulation.",
      checks:
        "Supplier checks still need to pass. Open Orders to see the remaining steps.",
      own: "Your shop still needs to approve its share.",
    },
    hi: {
      approvals: s.missing_approvals
        ? `अभी ${s.missing_approvals} और दुकानों को अपना हिस्सा मंज़ूर करना है। ${q.participant_count} में से ${q.approval_count} ने मंज़ूरी दी है।`
        : `अब किसी और दुकान की मंज़ूरी बाकी नहीं है। ${q.participant_count} में से ${q.approval_count} ने मंज़ूरी दी है।`,
      units: s.missing_units
        ? `पूरे सप्लायर केस भरने के लिए ${s.missing_units} और पक्की इकाइयाँ चाहिए। अभी ${q.total_units} हैं; हर केस में ${q.quote.moq} हैं।`
        : `${q.total_units} पक्की इकाइयाँ ${q.quote.moq} के पूरे केस भरती हैं।`,
      cost: q.own
        ? `आपकी ${q.own.allocated_units} इकाइयों की अभी लागत ${money} है।${q.eligible ? "" : " यह अस्थायी अनुमान है और बदल सकता है।"}`
        : "आपका हिस्सा अभी तय नहीं हुआ है।",
      ready: "सभी जाँच और दुकानों की मंज़ूरी पूरी है। ऑर्डर में समीक्षा करें।",
      blocked: "ऑर्डर अभी तैयार नहीं है।",
      committed: "यह साझा ऑर्डर नमूने में पहले ही किया गया है।",
      checks: "सप्लायर की जाँच बाकी है। बाकी चरण ऑर्डर में देखें।",
      own: "आपकी दुकान को अभी अपना हिस्सा मंज़ूर करना है।",
    },
    kn: {
      approvals: s.missing_approvals
        ? `ಇನ್ನೂ ${s.missing_approvals} ಅಂಗಡಿಗಳು ತಮ್ಮ ಪಾಲಿಗೆ ಅನುಮೋದನೆ ನೀಡಬೇಕು. ${q.participant_count}ರಲ್ಲಿ ${q.approval_count} ಅನುಮೋದಿಸಿವೆ.`
        : `ಇನ್ನಷ್ಟು ಅಂಗಡಿ ಅನುಮೋದನೆ ಬೇಕಿಲ್ಲ. ${q.participant_count}ರಲ್ಲಿ ${q.approval_count} ಅನುಮೋದಿಸಿವೆ.`,
      units: s.missing_units
        ? `ಪೂರ್ಣ ಪೂರೈಕೆದಾರರ ಕೇಸ್ ತುಂಬಲು ಇನ್ನೂ ${s.missing_units} ಖಚಿತ ಘಟಕಗಳು ಬೇಕು. ಈಗ ${q.total_units} ಇವೆ; ಪ್ರತಿ ಕೇಸ್‌ನಲ್ಲಿ ${q.quote.moq}.`
        : `${q.total_units} ಖಚಿತ ಘಟಕಗಳು ${q.quote.moq}ರ ಪೂರ್ಣ ಕೇಸ್‌ಗಳನ್ನು ತುಂಬುತ್ತವೆ.`,
      cost: q.own
        ? `ನಿಮ್ಮ ${q.own.allocated_units} ಘಟಕಗಳ ಈಗಿನ ವೆಚ್ಚ ${money}.${q.eligible ? "" : " ಇದು ತಾತ್ಕಾಲಿಕ ಅಂದಾಜು; ಬದಲಾಗಬಹುದು."}`
        : "ನಿಮ್ಮ ಪಾಲು ಇನ್ನೂ ಹಂಚಿಕೆಯಾಗಿಲ್ಲ.",
      ready:
        "ಎಲ್ಲಾ ಪರಿಶೀಲನೆ ಮತ್ತು ಅಂಗಡಿಗಳ ಅನುಮೋದನೆ ಪೂರ್ಣವಾಗಿದೆ. ಆರ್ಡರ್‌ನಲ್ಲಿ ಪರಿಶೀಲಿಸಿ.",
      blocked: "ಆರ್ಡರ್ ಇನ್ನೂ ಸಿದ್ಧವಾಗಿಲ್ಲ.",
      committed: "ಈ ಹಂಚಿದ ಆರ್ಡರ್ ಮಾದರಿಯಲ್ಲಿ ಈಗಾಗಲೇ ಮಾಡಲಾಗಿದೆ.",
      checks: "ಪೂರೈಕೆದಾರರ ಪರಿಶೀಲನೆ ಬಾಕಿಯಿದೆ. ಉಳಿದ ಹಂತಗಳನ್ನು ಆರ್ಡರ್‌ನಲ್ಲಿ ನೋಡಿ.",
      own: "ನಿಮ್ಮ ಅಂಗಡಿ ತನ್ನ ಪಾಲನ್ನು ಅನುಮೋದಿಸಬೇಕು.",
    },
  }[locale];
  if (q.committed) return `${name}: ${copy.committed}`;
  const first =
    topic === "approvals"
      ? copy.approvals
      : topic === "units"
        ? copy.units
        : topic === "cost"
          ? copy.cost
          : s.can_order
            ? copy.ready
            : copy.blocked;
  const tail =
    topic === "readiness"
      ? `${s.missing_units ? copy.units + " " : ""}${s.missing_approvals ? copy.approvals + " " : ""}`
      : "";
  return `${first} ${name} · ${q.quote.supplier_name}. ${tail}${!q.eligible ? copy.checks : !q.own ? copy.cost : q.own.approval_status !== "APPROVED" ? copy.own : s.can_order && topic !== "readiness" ? copy.ready : ""}`.trim();
}
// A conservative fallback for explicit English operational questions; Gemini handles other wording.
export function explicitOperation(
  v: MerchantView,
  question: string,
  history: { text: string }[],
) {
  const topic: QuoteTopic | null =
    /\b(shop|shops|approval|approvals|accept)\b/i.test(question) &&
    /\b(more|need|left|remaining|approve|accept)\b/i.test(question)
      ? "approvals"
      : /\b(units|quantity|case)\b/i.test(question) &&
          /\b(more|need|left|remaining)\b/i.test(question)
        ? "units"
        : /\b(cost|spend|my share)\b/i.test(question)
          ? "cost"
          : /\b(ready|blocked|why.*order)\b/i.test(question)
            ? "readiness"
            : null;
  if (!topic) return null;
  const matches = (text: string) =>
    v.quotes.filter((q) => {
      const words = q.product.name
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 2);
      return (
        words.length > 0 && words.every((w) => text.toLowerCase().includes(w))
      );
    });
  let choices = matches(question);
  if (!choices.length && /\b(this|it|more|left|remaining)\b/i.test(question))
    for (const h of [...history].reverse()) {
      choices = matches(h.text);
      if (choices.length) break;
    }
  if (!choices.length && v.quotes.length === 1) choices = v.quotes;
  if (choices.length > 1) {
    const supplier = choices.filter((q) =>
      question.toLowerCase().includes(q.quote.supplier_name.toLowerCase()),
    );
    if (supplier.length) choices = supplier;
  }
  // For a product-only question, use the sole feasible uncommitted quote.
  // An explicitly named supplier above still takes precedence, even if blocked.
  if (choices.length > 1) {
    const feasible = choices.filter((q) => q.eligible && !q.committed);
    if (feasible.length === 1) choices = feasible;
  }
  return choices.length === 1 ? { quote: choices[0], topic } : null;
}
