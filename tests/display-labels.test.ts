import { describe, expect, it } from "vitest";
import { validatedLabels } from "../src/lib/product/display-labels";
import { orderGroups, nearbyList } from "../src/lib/product/list-view";
import { seedJudgeDemo } from "../src/lib/product/demo";
import { merchantView } from "../src/lib/product/network";
import { groupDemand } from "../src/lib/product/demand-book";
describe("Display translations keep product identity intact", () => {
  it("rejects unknown labels or changed identifying numbers", () => {
    expect(
      validatedLabels(
        {
          translations: [
            { source: "Moto G86", label: "मोटो G85" },
            { source: "Other", label: "अन्य" },
            { source: "Millet Crunch · Lime", label: "मिलेट क्रंच · नींबू" },
          ],
        },
        ["Moto G86", "Millet Crunch · Lime"],
        "hi",
      ),
    ).toEqual({ "Millet Crunch · Lime": "मिलेट क्रंच · नींबू" });
  });
  it("localized search uses the same product/group keys without mutating records", () => {
    const n = seedJudgeDemo(),
      v = merchantView(n, n.shops[0].id),
      before = JSON.stringify(n),
      label = (s: string) => s.replace("Millet Crunch", "मिलेट क्रंच");
    const groups = orderGroups(v.orders, v.quotes, "मिलेट", label);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.map((g) => g.key)).toEqual(
      orderGroups(v.orders, v.quotes, "Millet", label).map((g) => g.key),
    );
    expect(nearbyList(v.nearby, "मिलेट", label).length).toBeGreaterThan(0);
    expect(
      groupDemand(v.requests, "मिलेट", "all", undefined, label).length,
    ).toBeGreaterThan(0);
    expect(JSON.stringify(n)).toBe(before);
  });
});
