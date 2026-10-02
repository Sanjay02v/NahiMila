import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  seedNetwork,
  storeFor,
  merchantView,
  type Network,
} from "../src/lib/product/network";
let network: Network, user: string | null;
let queue: Promise<unknown> = Promise.resolve();
vi.mock("../src/lib/product/auth", () => ({
  actor: async () => {
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
          area: "Bengaluru",
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
          area: "Bengaluru",
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
          area: "Bengaluru",
          locale: "en",
          latitude: 12.9,
          longitude: 77.6,
        })
      ).status,
    ).toBe(400);
    expect(network.shops.filter((s) => s.user_id === user)).toHaveLength(1);
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
  it("prepares a request draft without creating demand, reservation or order", async () => {
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
                    draft_text:
                      "Two Coke Zero 500ml bottles; customer cannot wait.",
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
          question: "Record two Coke Zero 500ml bottles; customer cannot wait.",
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
      expect(network.state.requests).toEqual(before.requests);
      expect(network.state.reservations).toEqual(before.reservations);
      expect(network.state.orders).toEqual(before.orders);
      const outbound = JSON.parse(fetch.mock.calls[0][1].body);
      const prompt = outbound.systemInstruction.parts[0].text;
      expect(prompt).not.toContain(network.shops[1].user_id);
      expect(prompt).not.toContain(network.state.requests[0].request_token);
      expect(prompt).not.toContain("latitude");
      expect(prompt).toContain("25–29");
      expect(outbound.contents[0].parts[0].text).toContain(
        "Tell me the product.",
      );
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
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
