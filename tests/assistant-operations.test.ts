import { describe, expect, it } from "vitest";
import { seedJudgeDemo } from "../src/lib/product/demo";
import { merchantView, storeFor } from "../src/lib/product/network";
import {
  operationAnswer,
  explicitOperation,
  quoteStatus,
} from "../src/lib/product/assistant-operations";
import { assistantFacts } from "../src/lib/product/assistant";
describe("Exact operational shop answers", () => {
  it("names the feasible quote for a product question and respects an explicitly named late supplier", () => {
    const n = seedJudgeDemo();
    const view = merchantView(n, n.shops[0].id);
    expect(
      explicitOperation(
        view,
        "How much does my share of Millet Crunch Lime cost?",
        [],
      )?.quote.quote.id,
    ).toBe("demo-quote-lime");
    const late = explicitOperation(
      view,
      "Why is Millet Crunch Lime blocked with Community Supply (demo)?",
      [],
    );
    expect(late?.quote.quote.id).toBe("demo-quote-lime-late");
    expect(operationAnswer(late!.quote, "readiness", "en")).toContain(
      "not ready",
    );
  });
  it("says one more approval, not merely eligible, and uses fresh state for follow-ups", () => {
    const n = seedJudgeDemo();
    const v = merchantView(n, n.shops[0].id);
    const q = v.quotes.find((q) => /Lime/.test(q.product.name))!;
    const changed = {
      ...q,
      approval_count: 2,
      participant_count: 3,
      eligible: true,
      own: q.own ? { ...q.own, approval_status: "APPROVED" as const } : null,
    };
    const view = {
      ...v,
      quotes: [changed, ...v.quotes.filter((x) => x !== q)],
    };
    const focus = explicitOperation(
      view,
      "how much more shops need to accept for Millet Crunch Lime?",
      [],
    );
    expect(focus?.quote.product.id).toBe(q.product.id);
    expect(operationAnswer(changed, "approvals", "en")).toMatch(
      /^1 more shop must approve/,
    );
    expect(quoteStatus(changed).can_order).toBe(false);
    expect(
      assistantFacts(view).quotes.find((x) => /Lime/.test(x.product))
        ?.missing_approvals,
    ).toBe(1);
    const latest = {
      ...view,
      quotes: view.quotes.map((x) =>
        x === changed ? { ...x, approval_count: 1 } : x,
      ),
    };
    const follow = explicitOperation(latest, "how many more shops are left?", [
      { text: "For Millet Crunch Lime" },
    ]);
    expect(operationAnswer(follow!.quote, "approvals", "en")).toMatch(
      /^2 more shops/,
    );
    expect(storeFor(n).products.length).toBeGreaterThan(0);
  });
  it("does not guess between supplier choices or claim readiness for failed checks", () => {
    const n = seedJudgeDemo(),
      v = merchantView(n, n.shops[0].id),
      q = v.quotes[0];
    expect(
      explicitOperation(
        {
          ...v,
          quotes: [
            q,
            {
              ...q,
              quote: {
                ...q.quote,
                id: "another",
                supplier_name: "Other supplier",
              },
            },
          ],
        },
        `How many more shops must approve ${q.product.name}?`,
        [],
      ),
    ).toBeNull();
    expect(
      operationAnswer(
        { ...q, eligible: false, approval_count: 3, participant_count: 3 },
        "readiness",
        "en",
      ),
    ).toContain("not ready");
  });
});
