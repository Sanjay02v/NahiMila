import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedJudgeDemo } from "../src/lib/product/demo";
import type { Network } from "../src/lib/product/network";
let network: Network,
  authenticated = true;
const translation = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../src/lib/product/auth", () => ({
  shopActor: async () => {
    if (!authenticated) throw new Error("UNAUTHENTICATED");
    return network.shops[0];
  },
}));
vi.mock("../src/lib/product/repository", () => ({
  withNetwork: async (fn: (n: Network) => unknown) => fn(network),
}));
vi.mock("../src/lib/product/display-labels", async (original) => ({
  ...(await original<typeof import("../src/lib/product/display-labels")>()),
  translateLabels: translation.fn,
}));
import { POST } from "../src/app/api/product-labels/route";
const req = (b: unknown) =>
  new Request("http://localhost/api/product-labels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(b),
  });
beforeEach(() => {
  network = seedJudgeDemo();
  authenticated = true;
  translation.fn
    .mockReset()
    .mockImplementation(async (labels: string[]) =>
      Object.fromEntries(labels.map((s) => [s, "हिंदी " + s])),
    );
});
describe("Authorized display-label cache", () => {
  it("persists translations and uses cached labels without extra AI calls", async () => {
    const p = network.state.products.find((p) =>
      network.state.requests.some(
        (r) => r.merchant_id === network.shops[0].id && r.product_id === p.id,
      ),
    )!;
    const original = {
      name: p.name,
      sku: p.sku,
      identity: structuredClone(p.canonical_identity),
    };
    expect((await POST(req({ locale: "hi", labels: [p.name] }))).status).toBe(
      200,
    );
    expect(p.localized_labels?.hi?.[p.name]).toBe("हिंदी " + p.name);
    expect((await POST(req({ locale: "hi", labels: [p.name] }))).status).toBe(
      200,
    );
    expect(translation.fn).toHaveBeenCalledTimes(1);
    expect({
      name: p.name,
      sku: p.sku,
      identity: p.canonical_identity,
    }).toEqual(original);
  });
  it("rejects unauthorized label text and unauthenticated requests", async () => {
    expect(
      (await POST(req({ locale: "hi", labels: ["Private invented product"] })))
        .status,
    ).toBe(403);
    expect(translation.fn).not.toHaveBeenCalled();
    authenticated = false;
    expect(
      (await POST(req({ locale: "hi", labels: ["Millet Crunch"] }))).status,
    ).toBe(401);
  });
  it("customer tokens authorize only the product on that link", async () => {
    authenticated = false;
    const r = network.state.requests.find((r) => r.status === "OFFER_CREATED")!,
      p = network.state.products.find((p) => p.id === r.product_id)!;
    expect(
      (
        await POST(
          req({ locale: "kn", labels: [p.name], token: r.request_token }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await POST(
          req({ locale: "kn", labels: ["Other item"], token: r.request_token }),
        )
      ).status,
    ).toBe(403);
    expect(
      (await POST(req({ locale: "kn", labels: [p.name], token: "invalid" })))
        .status,
    ).toBe(404);
  });
});
