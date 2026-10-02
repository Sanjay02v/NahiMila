import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { withWorkspace } from "../src/lib/db/workspace";
import { GET, POST } from "../src/app/api/workspace/route";
const ids: string[] = [];
const id = () => {
  const v = crypto.randomUUID();
  ids.push(v);
  return v;
};
afterEach(async () => {
  await Promise.all(
    ids
      .splice(0)
      .map((i) =>
        rm(path.join(process.cwd(), ".data", `${i}.json`), { force: true }),
      ),
  );
});
describe("Retired anonymous API and legacy persistence", () => {
  it("never exposes shared shop data through the retired API", async () => {
    expect((await GET()).status).toBe(410);
    expect((await POST()).status).toBe(410);
  });
  it("independent state loads retain customer confirmation and merchant approvals", async () => {
    const workspace = id();
    await withWorkspace(
      workspace,
      (s) => s.confirmCustomerOffer("REQ-NML-8808"),
      true,
    );
    expect(
      (await withWorkspace(workspace, (s) => s.evaluateQuote("quote-b")))
        .is_eligible,
    ).toBe(true);
    await withWorkspace(
      workspace,
      (s) => {
        const a = s.evaluateQuote("quote-b").allocations[0];
        s.recordMerchantApproval({
          merchant_id: a.merchant_id,
          quote_id: "quote-b",
          quote_version: 1,
          exposure_paise: a.total_exposure_paise,
          approved: true,
        });
      },
      true,
    );
    expect(
      (
        await withWorkspace(workspace, (s) => s.getApprovalsForQuote("quote-b"))
      )[0].status,
    ).toBe("APPROVED");
  });
  it("concurrent independent confirmations cannot duplicate demand", async () => {
    const workspace = id();
    await Promise.all(
      Array.from({ length: 6 }, () =>
        withWorkspace(
          workspace,
          (s) => s.confirmCustomerOffer("REQ-NML-8808"),
          true,
        ),
      ),
    );
    expect(
      await withWorkspace(
        workspace,
        (s) => s.reservations.filter((r) => r.status === "ACTIVE").length,
      ),
    ).toBe(24);
  });
  it("isolates state and rejects path traversal", async () => {
    const a = id(),
      b = id();
    await withWorkspace(a, (s) => s.confirmCustomerOffer("REQ-NML-8808"), true);
    expect(
      await withWorkspace(
        b,
        (s) => s.evaluateQuote("quote-b").total_demand_units,
      ),
    ).toBe(23);
    await expect(
      withWorkspace("../../secret", (s) => s.requests),
    ).rejects.toThrow("Invalid demo workspace");
  });
});

import { suggestVoiceFields } from "../src/lib/voice-fields";
describe("Voice review suggestions", () => {
  it("does not fabricate missing product, quantity, price or deadline", () => {
    expect(suggestVoiceFields("some snacks please")).toEqual({});
    expect(suggestVoiceFields("millet crunch masala")).toEqual({});
  });
  it("uses exact pack, explicit quantity, budget and wait date as suggestions", () => {
    expect(
      suggestVoiceFields(
        "Millet Crunch Masala 100 gram, 2 packets, budget 50 rupees, tomorrow",
      ),
    ).toMatchObject({ productId: "prod-millet", quantity: 2, price: 50 });
  });
  it("does not mistake pack weight for order quantity or silently swap variants", () => {
    expect(
      suggestVoiceFields("millet masala 200 gram under 90").productId,
    ).toBe("prod-millet-200");
    expect(
      suggestVoiceFields("millet masala 200 gram under 90").quantity,
    ).toBeUndefined();
    expect(suggestVoiceFields("millet lime 100 gram").productId).toBe(
      "prod-millet-lime",
    );
  });
});

import { assertSameOrigin } from "../src/lib/same-origin";
describe("Browser and reverse-proxy origin handling", () => {
  it("accepts the browser host when Request.url uses the dev bind address", () => {
    expect(() =>
      assertSameOrigin(
        new Request("http://0.0.0.0:3001/api/workspace", {
          headers: { host: "localhost:3001", origin: "http://localhost:3001" },
        }),
      ),
    ).not.toThrow();
  });
  it("accepts the forwarded TLS scheme but rejects an unrelated origin", () => {
    expect(() =>
      assertSameOrigin(
        new Request("http://internal/api/workspace", {
          headers: {
            host: "demo.example",
            "x-forwarded-proto": "https",
            origin: "https://demo.example",
          },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertSameOrigin(
        new Request("https://demo.example/api/workspace", {
          headers: { host: "demo.example", origin: "https://attacker.example" },
        }),
      ),
    ).toThrow("Cross-origin");
  });
});
