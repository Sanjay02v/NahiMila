import { describe, it, expect } from "vitest";
import { nearbyList, orderGroups } from "../src/lib/product/list-view";
import { seedJudgeDemo } from "../src/lib/product/demo";
import { merchantView } from "../src/lib/product/network";
describe("large merchant lists", () => {
  it("searches all 120 results, ranks own demand first and permits successive pages", () => {
    const base = merchantView(seedJudgeDemo(), "m-sharma-001").nearby[0];
    const rows = Array.from({ length: 120 }, (_, i) => ({
      ...base,
      key: String(i),
      name: `Item ${i}`,
      own_units: i,
      shops: 3,
    }));
    const result = nearbyList(rows, "");
    expect(result).toHaveLength(120);
    expect(result[0].key).toBe("119");
    expect(result.slice(0, 10)).toHaveLength(10);
    expect(result.slice(0, 20)).toHaveLength(20);
    expect(nearbyList(rows, " ITEM 119 ").map((r) => r.key)).toEqual(["119"]);
    expect(nearbyList(rows, "not stocked here")).toEqual([]);
  });
  it("groups supplier choices by exact product without merging flavour or pack", () => {
    const v = merchantView(seedJudgeDemo(), "m-sharma-001"),
      groups = orderGroups(v.orders, v.quotes, "");
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.key === "prod-millet")!.quotes).toHaveLength(3);
    expect(
      groups.find((g) => g.key === "prod-millet-lime")!.quotes,
    ).toHaveLength(2);
    expect(orderGroups([], v.quotes, "lime")).toHaveLength(1);
    const big = v.quotes.map((q) => ({
      ...q,
      product: { ...q.product, id: q.product.id + "-200", pack_size: "200g" },
    }));
    expect(orderGroups([], [...v.quotes, ...big], "")).toHaveLength(4);
    expect(orderGroups([], [...v.quotes, ...big], "200g")).toHaveLength(2);
  });
});
