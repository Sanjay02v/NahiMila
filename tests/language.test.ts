import { afterEach, describe, expect, it, vi } from "vitest";
import { normalize } from "../src/lib/product/normalize";
import { manualDraft, parseIntent } from "../src/lib/product/intent";
import { en, hi, kn } from "../src/i18n/messages";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Language services remain evidence-limited", () => {
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
      vi.fn().mockResolvedValue(new Response("", { status: 503 })),
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
