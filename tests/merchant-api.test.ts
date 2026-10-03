import { seedJudgeDemo } from "../src/lib/product/demo";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { manualDraft } from "../src/lib/product/intent";
import { itemFields, reviewItemFields } from "../src/lib/product/item-review";
import {
  seedNetwork,
  storeFor,
  merchantView,
  type Network,
} from "../src/lib/product/network";
let network: Network, user: string | null;
let queue: Promise<unknown> = Promise.resolve();
vi.mock("../src/lib/product/location", async (original) => {
  const real = await original<typeof import("../src/lib/product/location")>();
  return {
    ...real,
    assertIndianLocation: async (b: Record<string, unknown>) =>
      real.verifiedLocation(b),
  };
});
vi.mock("../src/lib/product/auth", () => ({
  actor: async () => {
    if (!user) throw new Error("UNAUTHENTICATED");
    return user;
  },
  voiceActor: async () => {
    if (!user) throw new Error("UNAUTHENTICATED");
    return user;
  },
  shopActor: async () => {
    if (!user) throw new Error("UNAUTHENTICATED");
    const shop = network.shops.find((s) => s.user_id === user);
    if (!shop) throw new Error("ONBOARDING_REQUIRED");
    return shop;
  },
}));
vi.mock("../src/lib/product/repository", () => ({
  remote: null,
  withNetwork: async (fn: (n: Network) => unknown, write = false) => {
    const run = async () => {
      const copy = structuredClone(network);
      const result = await fn(copy);
      if (write) network = copy;
      return result;
    };
    const next = queue.then(run, run);
    queue = next.catch(() => {});
    return next;
  },
}));
import { GET, POST } from "../src/app/api/merchant/route";
import {
  GET as customerGET,
  POST as customerPOST,
} from "../src/app/api/customer/[token]/route";
import { POST as agentPOST } from "../src/app/api/agent/route";
import { POST as voicePOST } from "../src/app/api/voice/transcribe/route";
import {
  POST as livePOST,
  PUT as livePUT,
} from "../src/app/api/voice/live/route";
const as = (id: string) =>
  (user = network.shops.find((s) => s.id === id)!.user_id);
const request = (b: unknown) =>
  new Request("http://localhost/api/merchant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(b),
  });
const post = (b: unknown) => POST(request(b));
const pending = () =>
  network.state.requests.find((r) => r.status === "OFFER_CREATED")!;
const context = (token: string) => ({ params: Promise.resolve({ token }) });
const confirm = async () => {
  const token = pending().request_token;
  return customerPOST(request({ action: "confirm" }), context(token));
};
beforeEach(() => {
  network = seedNetwork();
  queue = Promise.resolve();
  as("m-sharma-001");
});
describe("Server-enforced account boundaries", () => {
  it("persists and shows the owner's supplier quote before any customer is ready to order", async () => {
    const captured = await post({
      action: "create",
      raw_text: "Chocolate 100g, customer cannot wait",
      intent: { ...manualDraft("Chocolate 100g"), quantity: 1 },
      can_wait: false,
      submission_key: crypto.randomUUID(),
    });
    expect(captured.status).toBe(200);
    const created = network.state.requests.find(
      (r) =>
        network.details[r.id]?.raw_text ===
        "Chocolate 100g, customer cannot wait",
    )!;
    const product = network.state.products.find(
      (p) => p.id === created.product_id,
    )!;
    const response = await post({
      action: "quote",
      product_id: product.id,
      supplier: "Test supplier",
      unit_paise: 3000,
      moq: 12,
      transport_paise: 500,
      handling_paise: 0,
      delivery: new Date(Date.now() + 86400000).toISOString(),
      expiry: new Date(Date.now() + 172800000).toISOString(),
    });
    expect(response.status).toBe(200);
    const saved = (await response.json()).quotes.find(
      (q: { product: { id: string } }) => q.product.id === product.id,
    );
    expect(saved).toMatchObject({
      can_edit: true,
      total_units: 0,
      eligible: false,
      own: null,
    });
    const reload = await (await GET()).json();
    expect(
      reload.quotes.some(
        (q: { quote: { id: string } }) => q.quote.id === saved.quote.id,
      ),
    ).toBe(true);
    expect(
      (
        await post({
          action: "commit",
          quote_id: saved.quote.id,
          fingerprint: saved.fingerprint,
        })
      ).status,
    ).not.toBe(200);
    as("m-gupta-002");
    expect(
      (await (await GET()).json()).quotes.some(
        (q: { quote: { id: string } }) => q.quote.id === saved.quote.id,
      ),
    ).toBe(false);
  });
  it("requires authentication, even for the speech endpoint", async () => {
    user = null;
    expect((await GET()).status).toBe(401);
    expect((await post({ action: "settings", cap_paise: 1 })).status).toBe(401);
    expect((await voicePOST(request({}))).status).toBe(401);
    expect((await livePOST(request({}))).status).toBe(401);
    expect(
      (await livePUT(request({ session: "forged", action: "end" }))).status,
    ).toBe(401);
  });
  it("returns a private snapshot and rejects a client-supplied shop identity", async () => {
    const v = await (await GET()).json();
    expect(
      v.requests.every(
        (r: { merchant_id: string }) => r.merchant_id === "m-sharma-001",
      ),
    ).toBe(true);
    expect(
      (
        await post({
          action: "settings",
          merchant_id: "m-gupta-002",
          cap_paise: 1,
        })
      ).status,
    ).toBe(403);
    expect(network.shops[1].cash_cap_paise).toBe(35000);
  });
  it("cannot cancel, receive or pick up another shop records by guessing IDs", async () => {
    const r = network.state.requests.find(
      (r) => r.merchant_id === "m-gupta-002",
    )!;
    expect((await post({ action: "cancel", request_id: r.id })).status).toBe(
      404,
    );
    expect(
      (await post({ action: "receive", order_id: "unknown" })).status,
    ).toBe(404);
    expect(
      (
        await post({
          action: "pickup",
          reservation_id: network.state.reservations.find(
            (r) => r.merchant_id === "m-gupta-002",
          )!.id,
          outcome: "COLLECTED",
        })
      ).status,
    ).toBe(404);
  });
  it("customer confirmation returns no merchant state and repeat clicks count once", async () => {
    const token = pending().request_token;
    const view = await (await customerGET(request({}), context(token))).json();
    expect(view).not.toHaveProperty("quotes");
    await Promise.all([confirm(), confirm()]);
    expect(storeFor(network).evaluateQuote("quote-b").total_demand_units).toBe(
      24,
    );
    expect(
      network.state.reservations.filter((r) => r.request_token === token),
    ).toHaveLength(1);
  });
  it("one account creates only one shop, with strictly numeric coordinates", async () => {
    user = crypto.randomUUID();
    expect(
      (
        await post({
          action: "onboard",
          name: "Test",
          address: "Test shop, Bengaluru",
          owner_name: "Ravi",
          location_confirmed: true,
          locale: "en",
          latitude: null,
          longitude: 77,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post({
          action: "onboard",
          name: "Test",
          address: "Test shop, Bengaluru",
          owner_name: "Ravi",
          location_confirmed: true,
          locale: "en",
          latitude: 12.9,
          longitude: 77.6,
          sharing: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post({
          action: "onboard",
          name: "Other",
          address: "Test shop, Bengaluru",
          owner_name: "Ravi",
          location_confirmed: true,
          locale: "en",
          latitude: 12.9,
          longitude: 77.6,
        })
      ).status,
    ).toBe(400);
    expect(network.shops.filter((s) => s.user_id === user)).toHaveLength(1);
  });
  it("shop setup requires a name and confirmed pin; profile changes remain account-scoped", async () => {
    const old = user;
    user = crypto.randomUUID();
    const setup = {
      action: "onboard",
      name: "Ravi Stores",
      owner_name: "Ravi",
      address: "12 Test Street, Bengaluru",
      latitude: 12.97,
      longitude: 77.64,
      locale: "en",
      sharing: true,
    };
    expect((await post(setup)).status).toBe(400);
    expect(network.shops.some((s) => s.user_id === user)).toBe(false);
    const result = await post({ ...setup, location_confirmed: true });
    expect(result.status).toBe(200);
    const v = await result.json();
    expect(v.shop.owner_name).toBe("Ravi");
    expect(v.shop.address).toBe(setup.address);
    expect(v.requests).toHaveLength(0);
    const others = JSON.stringify(
      network.shops.filter((s) => s.user_id !== user),
    );
    expect(
      (
        await post({
          ...setup,
          action: "profile",
          owner_name: "Ravi Kumar",
          latitude: 12.9701,
          location_confirmed: true,
        })
      ).status,
    ).toBe(200);
    expect(network.shops.find((s) => s.user_id === user)?.owner_name).toBe(
      "Ravi Kumar",
    );
    expect(
      JSON.stringify(network.shops.filter((s) => s.user_id !== user)),
    ).toBe(others);
    user = old;
  });
  it("read tools inherit session context and cannot accept another shop ID or write tool", async () => {
    const v = await (await agentPOST(request({ tool: "requests" }))).json();
    expect(v.rows).toHaveLength(8);
    expect(network.state.auditEvents.at(-1)?.payload.actor).toBe(user);
    expect(
      (await agentPOST(request({ tool: "requests", shop_id: "m-gupta-002" })))
        .status,
    ).toBe(403);
    vi.stubEnv("GEMINI_API_KEY", "");
    expect((await agentPOST(request({ tool: "approve" }))).status).toBe(403);
    vi.unstubAllEnvs();
  });
  it("grounds conversational replies in own records and explains denied actions", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"tool":"requests","answer":"Your shop has eight requests.","draft_text":null,"can_wait":null}',
                },
              ],
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    try {
      const response = await agentPOST(
        request({ question: "Show my requests" }),
      );
      expect(response.status).toBe(200);
      expect((await response.json()).rows).toHaveLength(8);
      expect(
        JSON.parse(fetch.mock.calls[0][1].body).generationConfig
          .responseMimeType,
      ).toBe("application/json");
      fetch.mockResolvedValueOnce(
        Response.json({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '{"tool":"denied","answer":"Please review and approve orders yourself.","draft_text":null,"can_wait":null}',
                  },
                ],
              },
            },
          ],
        }),
      );
      const denied = await (
        await agentPOST(request({ question: "Approve a purchase for me" }))
      ).json();
      expect(denied.tool).toBe("denied");
      expect(denied.draft).toBeNull();
      expect(network.state.orders).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
describe("Conversational assistant review boundaries", () => {
  it.each([
    [
      "Record two Coke Zero 500ml bottles; customer cannot wait. Customer name: Ravi. Phone 9000000001.",
      "Ravi",
      "Two Coke Zero 500ml bottles; customer cannot wait.",
      "en",
    ],
    [
      "ग्राहक का नाम राहुल। कोक ज़ीरो 500ml की दो बोतल चाहिए। फोन 9000000001।",
      "राहुल",
      "कोक ज़ीरो 500ml की दो बोतल चाहिए।",
      "hi",
    ],
    [
      "ಗ್ರಾಹಕರ ಹೆಸರು ರಮೇಶ್. ಕೋಕ್ ಝೀರೋ 500ml ಎರಡು ಬಾಟಲಿ ಬೇಕು. ಫೋನ್ 9000000001.",
      "ರಮೇಶ್",
      "ಕೋಕ್ ಝೀರೋ 500ml ಎರಡು ಬಾಟಲಿ ಬೇಕು.",
      "kn",
    ],
  ])(
    "prepares a %s draft with contacts without creating demand, reservation or order",
    async (question, name, draft, language) => {
      const before = structuredClone(network.state);
      vi.stubEnv("GEMINI_API_KEY", "test-key");
      const fetch = vi.fn().mockResolvedValue(
        Response.json({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      answer: "Review this draft before saving.",
                      tool: "draft",
                      draft_text: draft,
                      can_wait: false,
                    }),
                  },
                ],
              },
            },
          ],
        }),
      );
      vi.stubGlobal("fetch", fetch);
      try {
        const r = await agentPOST(
          request({
            question,
            history: [
              { role: "user", text: "Can you prepare a request?" },
              { role: "assistant", text: "Tell me the product." },
            ],
          }),
        );
        expect(r.status).toBe(200);
        const j = await r.json();
        expect(j.draft.can_wait).toBe(false);
        expect(j.draft.raw).toContain("500ml");
        expect(j.draft.raw).toContain(`Customer name: ${name}`);
        expect(j.draft.raw).toContain(draft);
        expect(j.draft.raw).toContain("+919000000001");
        expect(network.state.requests).toEqual(before.requests);
        expect(network.state.reservations).toEqual(before.reservations);
        expect(network.state.orders).toEqual(before.orders);
        const outbound = JSON.parse(fetch.mock.calls[0][1].body);
        const prompt = outbound.systemInstruction.parts[0].text;
        expect(prompt).not.toContain(network.shops[1].user_id);
        expect(prompt).not.toContain(network.state.requests[0].request_token);
        expect(prompt).not.toContain("latitude");
        expect(prompt).toContain("25–29");
        expect(prompt).toContain(`Detected language ${language}`);
        expect(prompt).toContain("Interface language does not override");
        expect(outbound.contents[0].parts[0].text).toContain(
          "Tell me the product.",
        );
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }
    },
  );
  it("rejects malformed model actions and forged identities instead of performing a write", async () => {
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
                      answer: "Approved",
                      tool: "approve",
                      draft_text: null,
                      can_wait: null,
                    }),
                  },
                ],
              },
            },
          ],
        }),
      ),
    );
    try {
      expect(
        (await agentPOST(request({ question: "Approve a supplier order" })))
          .status,
      ).toBe(503);
      expect(
        (
          await agentPOST(
            request({ tool: "quotes", merchant_id: "m-gupta-002" }),
          )
        ).status,
      ).toBe(403);
      expect(network.state.orders).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
describe("Approval, commitment and collection boundaries", () => {
  it("blocks a stale approval after cancellation and clears previous approvals", async () => {
    await confirm();
    const q = merchantView(network, "m-sharma-001").quotes.find(
      (q) => q.quote.id === "quote-b",
    )!;
    expect(
      (
        await post({
          action: "approve",
          quote_id: "quote-b",
          fingerprint: q.fingerprint,
        })
      ).status,
    ).toBe(200);
    const token = network.state.requests.find(
      (r) => r.merchant_id === "m-gupta-002",
    )!.request_token;
    expect(
      (await customerPOST(request({ action: "cancel" }), context(token)))
        .status,
    ).toBe(200);
    expect(
      (
        await post({
          action: "approve",
          quote_id: "quote-b",
          fingerprint: q.fingerprint,
        })
      ).status,
    ).toBe(409);
    expect(
      storeFor(network)
        .getApprovalsForQuote("quote-b")
        .every((a) => a.status === "INVALIDATED"),
    ).toBe(true);
  });
  it("requires each shop approval, debits each budget once, and keeps pickups private", async () => {
    await confirm();
    const q = merchantView(network, "m-sharma-001").quotes.find(
      (q) => q.quote.id === "quote-b",
    )!;
    expect(
      (
        await post({
          action: "commit",
          quote_id: "quote-b",
          fingerprint: q.fingerprint,
        })
      ).status,
    ).toBe(400);
    for (const id of ["m-sharma-001", "m-gupta-002", "m-lakshmi-003"]) {
      as(id);
      expect(
        (
          await post({
            action: "approve",
            quote_id: "quote-b",
            fingerprint: q.fingerprint,
          })
        ).status,
      ).toBe(200);
    }
    const result = await post({
      action: "commit",
      quote_id: "quote-b",
      fingerprint: q.fingerprint,
    });
    expect(result.status).toBe(200);
    expect(network.state.orders).toHaveLength(1);
    expect(network.shops.slice(0, 3).map((s) => s.cash_cap_paise)).toEqual([
      600, 600, 600,
    ]);
    expect(
      (
        await post({
          action: "commit",
          quote_id: "quote-b",
          fingerprint: q.fingerprint,
        })
      ).status,
    ).toBe(200);
    expect(network.shops[0].cash_cap_paise).toBe(600);
    const order = network.state.orders[0],
      own = network.state.reservations.find(
        (r) => r.merchant_id === "m-lakshmi-003",
      )!;
    expect(
      (
        await post({
          action: "pickup",
          reservation_id: own.id,
          outcome: "COLLECTED",
        })
      ).status,
    ).toBe(400);
    expect((await post({ action: "receive", order_id: order.id })).status).toBe(
      200,
    );
    expect(
      (
        await post({
          action: "pickup",
          reservation_id: own.id,
          outcome: "NO_SHOW",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post({
          action: "pickup",
          reservation_id: own.id,
          outcome: "COLLECTED",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post({
          action: "pickup",
          reservation_id: own.id,
          outcome: "COLLECTED",
        })
      ).status,
    ).toBe(200);
    expect(network.state.pickups).toHaveLength(1);
    const v = await (await GET()).json();
    expect(v.orders[0].pickups).toHaveLength(8);
    expect(v.orders[0].collected_cash).toBe(5000);
  });
});

describe("In-store confirmations and revised customer terms", () => {
  const payload = () => ({
    action: "create",
    submission_key: crypto.randomUUID(),
    raw_text: "Coke Zero 500ml",
    intent: {
      product: "Coke Zero",
      category: "Drinks",
      brand: "Coca-Cola",
      variant: "Zero",
      size: 500,
      unit: "ml",
      packaging: null,
      quantity: 2,
      budget_paise: 5000,
      deadline: new Date(Date.now() + 3 * 86400000).toISOString(),
      substitutions: false,
      hard_constraints: [],
      preferences: [],
      missing: [],
      evidence: {},
      source: "manual",
    },
    can_wait: true,
    offer_price_paise: 5000,
    customer_phone: "9876543210",
    contact_consent: true,
  });
  it("records exact in-store acceptance once and keeps the customer page already confirmed", async () => {
    await post({ ...payload(), confirm_in_store: true, terms_accepted: true });
    const r = network.state.requests.at(-1)!;
    expect(network.details[r.id].confirmation?.method).toBe("in_store");
    const v = await (
      await customerGET(request({}), context(r.request_token))
    ).json();
    expect(v.can_confirm).toBe(false);
    await customerPOST(
      request({ action: "confirm" }),
      context(r.request_token),
    );
    expect(
      network.state.reservations.filter((x) => x.request_id === r.id),
    ).toHaveLength(1);
    expect(network.details[r.id].confirmation?.method).toBe("in_store");
  });
  it("an owner can confirm a pending offer in-store only with current exact terms", async () => {
    await post(payload());
    const r = network.state.requests.at(-1)!,
      o = network.state.offers.at(-1)!;
    const b = {
      action: "confirm_in_store",
      request_id: r.id,
      quantity: r.quantity,
      price_paise: o.proposed_price_paise,
      deadline: o.pickup_deadline,
      terms_accepted: true,
    };
    as("m-gupta-002");
    expect((await post(b)).status).toBe(404);
    as("m-sharma-001");
    expect((await post({ ...b, price_paise: 1 })).status).toBe(409);
    expect((await post({ ...b, terms_accepted: false })).status).toBe(400);
    expect((await post(b)).status).toBe(200);
    expect((await post(b)).status).toBe(200);
    expect(
      network.state.reservations.filter((x) => x.request_id === r.id),
    ).toHaveLength(1);
  });
  it("changed terms remove confirmation, revoke the old link and require fresh acceptance", async () => {
    await post({ ...payload(), confirm_in_store: true, terms_accepted: true });
    const r = network.state.requests.at(-1)!,
      oldToken = r.request_token;
    const b = {
      action: "revise_offer",
      request_id: r.id,
      token: oldToken,
      quantity: 3,
      price_paise: 4500,
      budget_paise: 5000,
      deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
      contact_consent: true,
    };
    as("m-gupta-002");
    expect((await post(b)).status).toBe(404);
    as("m-sharma-001");
    expect((await post(b)).status).toBe(200);
    const updated = network.state.requests.find((x) => x.id === r.id)!;
    expect(updated.status).toBe("OFFER_CREATED");
    expect(network.details[r.id].confirmation).toBeNull();
    expect((await customerGET(request({}), context(oldToken))).status).toBe(
      404,
    );
    expect(
      (await customerPOST(request({ action: "confirm" }), context(oldToken)))
        .status,
    ).toBe(404);
    expect(
      network.state.reservations.filter(
        (x) => x.request_id === r.id && x.status === "ACTIVE",
      ),
    ).toHaveLength(0);
    expect((await post(b)).status).toBe(409);
    expect(
      (
        await customerPOST(
          request({ action: "confirm" }),
          context(updated.request_token),
        )
      ).status,
    ).toBe(200);
    expect(network.details[r.id].confirmation?.method).toBe("link");
    const reservation = network.state.reservations.find(
      (x) => x.request_id === r.id && x.status === "ACTIVE",
    )!;
    expect(reservation.quantity).toBe(3);
    expect(reservation.confirmed_price_paise).toBe(4500);
  });
  it("withdrawn pending offers cannot be confirmed by their old links", async () => {
    await post(payload());
    const r = network.state.requests.at(-1)!;
    expect((await post({ action: "cancel", request_id: r.id })).status).toBe(
      200,
    );
    expect(
      (
        await customerPOST(
          request({ action: "confirm" }),
          context(r.request_token),
        )
      ).status,
    ).toBe(400);
    expect(
      (await customerGET(request({}), context(r.request_token))).status,
    ).toBe(200);
    expect(
      network.state.reservations.filter((x) => x.request_id === r.id),
    ).toHaveLength(0);
  });
});

describe("Revised reservations preserve procurement safeguards", () => {
  it("changing a confirmed term invalidates approvals and removes that unit from readiness", async () => {
    await confirm();
    const q = merchantView(network, "m-sharma-001").quotes.find(
      (q) => q.quote.id === "quote-b",
    )!;
    await post({
      action: "approve",
      quote_id: "quote-b",
      fingerprint: q.fingerprint,
    });
    const r = network.state.requests.find(
      (r) =>
        r.merchant_id === "m-sharma-001" && r.status === "CUSTOMER_CONFIRMED",
    )!;
    const o = network.state.offers.find(
      (o) => o.request_token === r.request_token,
    )!;
    expect(
      (
        await post({
          action: "revise_offer",
          request_id: r.id,
          token: r.request_token,
          quantity: 1,
          price_paise: 4900,
          budget_paise: 5000,
          deadline: o.pickup_deadline,
          customer_phone: "9876543210",
          contact_consent: true,
        })
      ).status,
    ).toBe(200);
    expect(storeFor(network).evaluateQuote("quote-b").total_demand_units).toBe(
      23,
    );
    expect(
      storeFor(network)
        .getApprovalsForQuote("quote-b")
        .every((a) => a.status === "INVALIDATED"),
    ).toBe(true);
    expect(
      (
        await post({
          action: "approve",
          quote_id: "quote-b",
          fingerprint: q.fingerprint,
        })
      ).status,
    ).toBe(409);
  });
  it("cannot revise committed customer terms to erase supplier cost", async () => {
    await confirm();
    const q = merchantView(network, "m-sharma-001").quotes.find(
      (q) => q.quote.id === "quote-b",
    )!;
    for (const id of ["m-sharma-001", "m-gupta-002", "m-lakshmi-003"]) {
      as(id);
      await post({
        action: "approve",
        quote_id: "quote-b",
        fingerprint: q.fingerprint,
      });
    }
    await post({
      action: "commit",
      quote_id: "quote-b",
      fingerprint: q.fingerprint,
    });
    as("m-sharma-001");
    const r = network.state.requests.find(
      (r) => r.merchant_id === "m-sharma-001",
    )!;
    expect(
      (
        await post({
          action: "revise_offer",
          request_id: r.id,
          token: r.request_token,
          quantity: 1,
          price_paise: 4900,
          budget_paise: 5000,
          deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
          customer_phone: "9876543210",
          contact_consent: true,
        })
      ).status,
    ).toBe(400);
    expect(network.state.orders[0].total_cost_paise).toBe(103200);
    expect(
      network.state.reservations.filter((r) => r.status === "COMMITTED"),
    ).toHaveLength(24);
  });
});

describe("Adding missing customer contact preserves reservation terms", () => {
  it("adds an owner-scoped number without changing confirmation, token, quantity or readiness", async () => {
    const r = network.state.requests.find(
      (r) =>
        r.merchant_id === "m-sharma-001" && r.status === "CUSTOMER_CONFIRMED",
    )!;
    const before = structuredClone(network.state.reservations);
    const fingerprintBefore = merchantView(network, "m-sharma-001").quotes.find(
      (q) => q.quote.id === "quote-b",
    )!.fingerprint;
    const b = {
      action: "add_contact",
      request_id: r.id,
      token: r.request_token,
      customer_phone: "9876543210",
      contact_consent: true,
    };
    as("m-gupta-002");
    expect((await post(b)).status).toBe(404);
    as("m-sharma-001");
    expect((await post({ ...b, contact_consent: false })).status).toBe(400);
    expect((await post({ ...b, customer_phone: "bad-number" })).status).toBe(
      400,
    );
    expect((await post(b)).status).toBe(200);
    const updated = network.state.requests.find((x) => x.id === r.id)!;
    expect(updated.customer_phone).toBe("919876543210");
    expect(updated.request_token).toBe(r.request_token);
    expect(updated.status).toBe("CUSTOMER_CONFIRMED");
    expect(network.state.reservations).toEqual(before);
    expect(
      merchantView(network, "m-sharma-001").quotes.find(
        (q) => q.quote.id === "quote-b",
      )!.fingerprint,
    ).toBe(fingerprintBefore);
    expect((await post(b)).status).toBe(200);
    expect((await post({ ...b, customer_phone: "9876543211" })).status).toBe(
      409,
    );
    expect((await post({ ...b, token: "stale-token" })).status).toBe(409);
  });
  it("does not turn a demand-only record into a reservation by adding a number", async () => {
    const r = network.state.requests.find((r) => r.status === "MISSED_DEMAND")!;
    as(r.merchant_id);
    expect(
      (
        await post({
          action: "add_contact",
          request_id: r.id,
          token: r.request_token,
          customer_phone: "9876543210",
          contact_consent: true,
        })
      ).status,
    ).toBe(400);
  });
});

describe("Pending interest becomes an offer only after actual terms are set", () => {
  it("saves the pictured 100gm hazelnut offer as 100 grams", async () => {
    const intent = { ...manualDraft("Chocolate"), variant: "Capella Hazelnut" };
    await post({
      action: "create",
      submission_key: crypto.randomUUID(),
      raw_text: "Chocolate",
      intent,
      can_wait: true,
      customer_phone: "9876543210",
      contact_consent: true,
      offer_price_paise: null,
    });
    const r = network.state.requests.at(-1)!;
    const reviewed = await reviewItemFields(
      { ...itemFields(intent), pack: "100gm" },
      intent,
      vi.fn(),
    );
    const deadline = new Date(Date.now() + 18 * 86400000).toISOString();
    const response = await post({
      action: "prepare_offer",
      request_id: r.id,
      token: r.request_token,
      quantity: 1,
      price_paise: 50000,
      budget_paise: null,
      deadline,
      intent: reviewed,
      customer_phone: "9876543210",
      contact_consent: true,
    });
    expect(response.status).toBe(200);
    expect(network.details[r.id].intent).toMatchObject({
      size: 100,
      unit: "g",
      variant: "Capella Hazelnut",
    });
    expect(
      network.state.offers.find((o) => o.request_id === r.id)
        ?.proposed_price_paise,
    ).toBe(50000);
    expect(network.state.requests.find((x) => x.id === r.id)?.status).toBe(
      "OFFER_CREATED",
    );
  });
  it("arranges a missing-pack item using separate flavour/pack edits without another AI call", async () => {
    const intent = {
      ...manualDraft("Cola"),
      brand: "Coca-Cola",
      variant: "Diet",
    };
    expect(
      (
        await post({
          action: "create",
          submission_key: crypto.randomUUID(),
          raw_text: "Diet cola",
          intent,
          can_wait: true,
          customer_phone: "9876543210",
          contact_consent: true,
          offer_price_paise: null,
        })
      ).status,
    ).toBe(200);
    const r = network.state.requests.at(-1)!;
    const normalize = vi.fn();
    const reviewed = await reviewItemFields(
      { ...itemFields(intent), pack: "330ml can" },
      intent,
      normalize,
    );
    const deadline = new Date(Date.now() + 3 * 86400000).toISOString();
    expect(
      (
        await post({
          action: "prepare_offer",
          request_id: r.id,
          token: r.request_token,
          quantity: 1,
          price_paise: 5000,
          budget_paise: null,
          deadline,
          intent: reviewed,
          customer_phone: "9876543210",
          contact_consent: true,
        })
      ).status,
    ).toBe(200);
    expect(normalize).not.toHaveBeenCalled();
    expect(network.details[r.id].intent).toMatchObject({
      brand: "Coca-Cola",
      variant: "Diet",
      size: 330,
      unit: "ml",
      packaging: "can",
    });
    expect(network.state.requests.find((x) => x.id === r.id)?.status).toBe(
      "OFFER_CREATED",
    );
    expect(network.state.reservations.some((x) => x.request_id === r.id)).toBe(
      false,
    );
  });
  it("can arrange a previously recorded demand on the same entry, with fresh contact and explicit confirmation", async () => {
    const seed = network.state.requests.find(
      (r) => r.merchant_id === "m-sharma-001",
    )!;
    const intent = {
      ...network.details[seed.id].intent,
      budget_paise: null,
      deadline: null,
    };
    expect(
      (
        await post({
          action: "create",
          submission_key: crypto.randomUUID(),
          raw_text: "Millet Crunch, not sure if customer can wait",
          intent,
          can_wait: false,
          offer_price_paise: null,
        })
      ).status,
    ).toBe(200);
    const r = network.state.requests.at(-1)!,
      count = network.state.requests.length;
    const terms = {
      action: "prepare_offer",
      request_id: r.id,
      token: r.request_token,
      quantity: 1,
      price_paise: 5000,
      budget_paise: null,
      intent,
      deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
      contact_consent: true,
    };
    expect((await post(terms)).status).toBe(400);
    expect(
      (await post({ ...terms, customer_phone: "9876543210" })).status,
    ).toBe(200);
    const updated = network.state.requests.find((x) => x.id === r.id)!;
    expect(network.state.requests).toHaveLength(count);
    expect(updated.status).toBe("OFFER_CREATED");
    expect(network.state.reservations.some((x) => x.request_id === r.id)).toBe(
      false,
    );
    expect(network.details[r.id].willing_to_wait).toBe(true);
    expect(
      (
        await customerPOST(
          request({ action: "confirm" }),
          context(updated.request_token),
        )
      ).status,
    ).toBe(200);
  });
  it("withdraws demand without an offer, preserving it in history", async () => {
    const seed = network.state.requests.find(
      (r) => r.merchant_id === "m-sharma-001",
    )!;
    await post({
      action: "create",
      submission_key: crypto.randomUUID(),
      raw_text: "Millet Crunch",
      intent: network.details[seed.id].intent,
      can_wait: false,
    });
    const r = network.state.requests.at(-1)!;
    expect((await post({ action: "cancel", request_id: r.id })).status).toBe(
      200,
    );
    expect(network.state.requests.find((x) => x.id === r.id)?.status).toBe(
      "CANCELLED",
    );
  });
  it("keeps incomplete interest out of procurement, then prepares and confirms the same entry", async () => {
    const baseIntent = {
      product: "Coke Zero",
      category: "Drinks",
      brand: "Coca-Cola",
      variant: "Zero",
      size: null,
      unit: null,
      packaging: null,
      quantity: 2,
      budget_paise: null,
      deadline: null,
      substitutions: false,
      hard_constraints: [],
      preferences: [],
      missing: [],
      evidence: {},
      source: "manual",
    };
    expect(
      (
        await post({
          action: "create",
          submission_key: crypto.randomUUID(),
          raw_text: "Coke Zero, phone 9876543210, can wait",
          intent: baseIntent,
          can_wait: true,
          customer_phone: "9876543210",
          contact_consent: true,
          offer_price_paise: null,
        })
      ).status,
    ).toBe(200);
    const r = network.state.requests.at(-1)!,
      oldCount = network.state.requests.length;
    expect(r.status).toBe("WAITING_INTEREST");
    expect(
      (
        await customerPOST(
          request({ action: "confirm" }),
          context(r.request_token),
        )
      ).status,
    ).toBe(404);
    const deadline = new Date(Date.now() + 4 * 86400000).toISOString();
    const b = {
      action: "prepare_offer",
      request_id: r.id,
      token: r.request_token,
      quantity: 2,
      price_paise: 5000,
      budget_paise: null,
      deadline,
      intent: { ...baseIntent, size: 500, unit: "ml" },
      contact_consent: true,
    };
    as("m-gupta-002");
    expect((await post(b)).status).toBe(404);
    as("m-sharma-001");
    expect((await post({ ...b, intent: baseIntent })).status).toBe(400);
    expect((await post(b)).status).toBe(200);
    const updated = network.state.requests.find((x) => x.id === r.id)!;
    expect(network.state.requests).toHaveLength(oldCount);
    expect(updated.status).toBe("OFFER_CREATED");
    expect(network.state.reservations.some((x) => x.request_id === r.id)).toBe(
      false,
    );
    expect(
      (
        await customerPOST(
          request({ action: "confirm" }),
          context(updated.request_token),
        )
      ).status,
    ).toBe(200);
    expect(
      network.state.reservations.find((x) => x.request_id === r.id)
        ?.confirmed_price_paise,
    ).toBe(5000);
  });
  it("allows withdrawing incomplete interest without an active reservation", async () => {
    const seed = network.state.requests.find(
      (r) => r.merchant_id === "m-sharma-001",
    )!;
    await post({
      action: "create",
      submission_key: crypto.randomUUID(),
      raw_text: "Millet Crunch, can wait",
      intent: {
        ...network.details[seed.id].intent,
        budget_paise: null,
        deadline: null,
        size: null,
        unit: null,
      },
      can_wait: true,
      customer_phone: "9876543210",
      contact_consent: true,
    });
    const r = network.state.requests.at(-1)!;
    expect(r.status).toBe("WAITING_INTEREST");
    expect((await post({ action: "cancel", request_id: r.id })).status).toBe(
      200,
    );
    expect(network.state.requests.find((x) => x.id === r.id)?.status).toBe(
      "CANCELLED",
    );
  });
});

describe("Shared judge demo reset API", () => {
  it("requires authentication, confirmation and a fixed demo identity", async () => {
    user = null;
    expect((await post({ action: "reset_demo", confirm: true })).status).toBe(
      401,
    );
    network = seedJudgeDemo();
    as("m-sharma-001");
    expect((await post({ action: "reset_demo" })).status).toBe(400);
    const shop = {
      ...network.shops[0],
      id: "real-shop",
      user_id: crypto.randomUUID(),
    };
    network.shops.push(shop);
    network.state.merchants = network.shops;
    user = shop.user_id;
    const before = structuredClone(network);
    expect((await post({ action: "reset_demo", confirm: true })).status).toBe(
      403,
    );
    expect(network).toEqual(before);
  });
  it("rotates old customer links and returns fresh demo data without changing real profiles", async () => {
    network = seedJudgeDemo();
    as("m-sharma-001");
    const token = pending().request_token;
    expect((await customerGET(request({}), context(token))).status).toBe(200);
    const response = await post({ action: "reset_demo", confirm: true });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.demo).toBe(true);
    expect(data.orders).toHaveLength(0);
    expect((await customerGET(request({}), context(token))).status).toBe(404);
    expect(
      data.quotes.find(
        (q: { quote: { id: string } }) => q.quote.id === "quote-b",
      ).total_units,
    ).toBe(23);
  });
  it("rejects cross-site reset requests before touching data", async () => {
    const before = structuredClone(network);
    const response = await POST(
      new Request("http://localhost/api/merchant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://untrusted.example",
        },
        body: JSON.stringify({ action: "reset_demo", confirm: true }),
      }),
    );
    expect(response.status).toBe(400);
    expect(network).toEqual(before);
  });
});
