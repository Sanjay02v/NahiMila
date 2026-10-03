import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const ledger = vi.hoisted(() => ({ network: { gemini_usage: {} } }));
vi.mock("../src/lib/product/repository", () => ({
  remote: null,
  withNetwork: async (fn: (n: typeof ledger.network) => unknown) =>
    fn(ledger.network),
}));
beforeEach(() => {
  ledger.network = { gemini_usage: {} };
  const g = globalThis as unknown as {
    geminiCache?: Map<string, unknown>;
    geminiFlights?: Map<string, unknown>;
  };
  g.geminiCache?.clear();
  g.geminiFlights?.clear();
});
import { normalize } from "../src/lib/product/normalize";
import { manualDraft, parseIntent } from "../src/lib/product/intent";
import { en, hi, kn } from "../src/i18n/messages";
import {
  inputLanguage,
  resolvedInputLanguage,
} from "../src/lib/product/input-language";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Language services remain evidence-limited", () => {
  it("suggests an explicitly stated name separately from product matching fields", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const raw = "Coke Zero bottle. Customer name: Ravi. Can wait.";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      ...manualDraft("Coke Zero bottle"),
                      source: "gemini",
                      customer_name: "Ravi",
                      customer_name_evidence: "Customer name: Ravi",
                    }),
                  },
                ],
              },
            },
          ],
        }),
      ),
    );
    const { capture, ...intent } = await normalize(raw, "en");
    expect(capture?.customer_name).toBe("Ravi");
    expect(JSON.stringify(intent)).not.toContain("Ravi");
    expect(Object.keys(parseIntent(intent))).not.toContain("customer_name");
  });
  it("returns localized review labels separately from canonical matching fields", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      ...manualDraft("Coke Zero 500ml bottle"),
                      display_item: "कोक",
                      display_details: "ज़ीरो, 500ml, बोतल",
                    }),
                  },
                ],
              },
            },
          ],
        }),
      ),
    );
    const normalized = await normalize("कोक ज़ीरो 500ml बोतल", "en");
    expect(normalized.capture?.display_item).toBe("कोक");
    expect(normalized.product).not.toMatch(/[\u0900-\u097f]/);
    expect(Object.keys(parseIntent(normalized))).not.toContain("display_item");
    expect(normalized.capture?.input_language).toBe("hi");
  });
  it("detects the request language independently of the interface", () => {
    expect(inputLanguage("ರಮೇಶ್ ಅವರಿಗೆ ಹಾಲು ಬೇಕು", "en")).toBe("kn");
    expect(inputLanguage("ग्राहक राहुल को दूध चाहिए", "kn")).toBe("hi");
    expect(inputLanguage("Ravi needs milk", "hi")).toBe("en");
    expect(resolvedInputLanguage("Rahul ko doodh chahiye", "en", "hi")).toBe(
      "hi",
    );
    expect(resolvedInputLanguage("दूध चाहिए", "en", "en")).toBe("hi");
  });
  it("keeps Kannada fields and names for a Kannada request in the English interface", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const raw = "ಗ್ರಾಹಕರ ಹೆಸರು ರಮೇಶ್. ಕೋಕ್ ಝೀರೋ 500ml ಬಾಟಲಿ ಬೇಕು.";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      ...manualDraft("Coke Zero 500ml bottle"),
                      source: "gemini",
                      input_language: "kn",
                      display_item: "ಕೋಕಾ ಕೋಲಾ",
                      display_details: "ಝೀರೋ ಶುಗರ್, 500ml ಬಾಟಲಿ",
                      customer_name: "ರಮೇಶ್",
                      customer_name_evidence: "ಗ್ರಾಹಕರ ಹೆಸರು ರಮೇಶ್",
                    }),
                  },
                ],
              },
            },
          ],
        }),
      ),
    );
    const result = await normalize(raw, "en");
    expect(result.capture).toMatchObject({
      input_language: "kn",
      customer_name: "ರಮೇಶ್",
      display_item: "ಕೋಕಾ ಕೋಲಾ",
      display_details: "ಝೀರೋ ಶುಗರ್, 500ml ಬಾಟಲಿ",
    });
    expect(result.product).not.toMatch(/[\u0c80-\u0cff]/);
  });
  it("reports provider quota/rate limits distinctly instead of claiming AI was removed", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("quota", { status: 429 }));
    vi.stubGlobal("fetch", fetch);
    await expect(normalize("Coke Zero", "en")).rejects.toThrow("AI_RATE_LIMIT");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("missing credentials produce explicit manual suggestions and no provider call", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await normalize("some snacks please", "hi")).source).toBe("manual");
    expect(fetch).not.toHaveBeenCalled();
    expect((await normalize("some snacks please", "hi")).quantity).toBeNull();
  });
  it("uses the real provider response and validates important commercial fields", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const result = {
      ...manualDraft("Coke Zero half litre bottle"),
      source: "gemini",
      hard_constraints: ["bottle only"],
      evidence: { size: "half litre" },
    };
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        candidates: [
          { content: { parts: [{ text: JSON.stringify(result) }] } },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const parsed = await normalize("Coke Zero half litre bottle", "kn");
    expect(parsed).toMatchObject({
      size: 500,
      unit: "ml",
      budget_paise: null,
      quantity: null,
      hard_constraints: ["bottle only"],
      source: "gemini",
    });
    expect(fetch.mock.calls[0][0]).toContain(
      "generativelanguage.googleapis.com",
    );
    expect(
      JSON.parse(fetch.mock.calls[0][1].body).contents[0].parts[0].text,
    ).toBe("Coke Zero half litre bottle");
    // Exercise the raw REST configuration, rather than the SDK-only format.
    expect(
      JSON.parse(fetch.mock.calls[0][1].body).generationConfig.responseMimeType,
    ).toBe("application/json");
  });
  it("provider failures and invalid numeric output never become fabricated valid intents", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => new Response("", { status: 503 })),
    );
    await expect(normalize("anything", "hi")).rejects.toThrow("AI_UNAVAILABLE");
    expect(() =>
      parseIntent({ ...manualDraft("charger"), quantity: 1.2 }),
    ).toThrow();
    expect(() =>
      parseIntent({ ...manualDraft("charger"), budget_paise: -100 }),
    ).toThrow();
    expect(() =>
      parseIntent({ ...manualDraft("charger"), deadline: "tomorrow" }),
    ).toThrow("INVALID_DEADLINE");
  });
  it("all initial languages cover every critical interface and error key", () => {
    for (const language of [hi, kn]) {
      expect(Object.keys(language).sort()).toEqual(Object.keys(en).sort());
      expect(Object.keys(language.error).sort()).toEqual(
        Object.keys(en.error).sort(),
      );
      for (const key of [
        "home",
        "save",
        "approve",
        "confirmOffer",
        "nearbyHint",
        "noShowHint",
        "quoteHint",
        "matchFound",
        "matchUncertain",
        "blockedUnits",
        "provisionalShare",
      ] as const)
        expect(language[key]).not.toBe(en[key]);
    }
  });
});
