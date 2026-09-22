/**
 * Field treatments and ranking.
 *
 * The UI has no knowledge of any entity (§10), so which fields a card shows has to be decided from names
 * and value shapes alone. The case that motivated these tests: a product card took the first six fields in
 * *object key order* and so showed `vendorId`, `sourceId` and a raw jsonb blob — while never showing the
 * price, which is the tenth key on the entity and the first thing a shopper looks for.
 */
import { describe, expect, test } from "bun:test";
import { fieldScore, isHidden, labelOf, rankFields, columnsFor } from "./fields";

/** The ecommerce product, in its declared key order — the order that used to decide the card. */
const product = {
  id: "p_coral_hoops", vendorId: "v_local", sourceId: "p_coral_hoops",
  name: "Coral Enamel Hoops", description: "Chunky enamel hoops…",
  brand: "Example Store", category: "earrings", tags: ["bold", "brunch"],
  attributes: { colors: ["coral"], energy: 8 },
  price: 42, currency: "USD", compareAtPrice: null, stock: 12,
  imageUrl: "https://example.com/a.jpg", affiliateUrl: null,
  fulfilment: "stock", status: "active", updatedAt: "2026-09-22T10:00:00Z",
};

describe("labelOf", () => {
  test("camelCase and trailing digits become words", () => {
    expect(labelOf("compareAtPrice")).toBe("Compare At Price");
    expect(labelOf("line1")).toBe("Line 1");
    expect(labelOf("shipTo")).toBe("Ship To");
    expect(labelOf("postal")).toBe("Postal");
  });
});

describe("fieldScore", () => {
  test("a price outranks everything but the name", () => {
    expect(fieldScore("price", 42)).toBeLessThan(fieldScore("category", "earrings"));
    expect(fieldScore("price", 42)).toBeLessThan(fieldScore("brand", "x"));
    expect(fieldScore("name", "x")).toBeLessThan(fieldScore("price", 42));
  });

  test("the framework's own bookkeeping sorts to the bottom", () => {
    const price = fieldScore("price", 42);
    for (const [k, v] of [["vendorId", "v1"], ["updatedAt", "2026-01-01"], ["attributes", { a: 1 }]] as const) {
      expect({ key: k, belowPrice: fieldScore(k, v) > price }).toEqual({ key: k, belowPrice: true });
    }
  });

  test("a description is not a field, it is the card's own text", () => {
    expect(fieldScore("description", "x")).toBeGreaterThan(fieldScore("attributes", {}));
  });
});

describe("rankFields", () => {
  test("a product card shows the price, not the vendor id or the raw jsonb", () => {
    const shown = rankFields([product], 4, ["name", "title", "question", "description", "answer", "doc", "imageUrl"]);
    expect(shown).toContain("price");
    expect(shown).not.toContain("vendorId");
    expect(shown).not.toContain("sourceId");
    expect(shown).not.toContain("attributes");
    expect(shown).not.toContain("updatedAt");
  });

  test("the cap is honoured and the skip list is respected", () => {
    const shown = rankFields([product], 3, ["name", "description", "imageUrl"]);
    expect(shown).toHaveLength(3);
    for (const k of ["name", "description", "imageUrl"]) expect(shown).not.toContain(k);
  });

  test("hidden keys never appear", () => {
    expect(isHidden("id")).toBe(true);
    expect(rankFields([product], 10)).not.toContain("id");
  });

  test("a record with nothing but ids still shows them, rather than nothing at all", () => {
    // An order confirmation whose only useful field is an identifier must not render empty.
    const shown = rankFields([{ orderId: "o_1", trackingId: "t_9" }], 4);
    expect(shown).toEqual(["orderId", "trackingId"]);
  });

  test("ranking is stable for equally interesting fields", () => {
    const rows = [{ alpha: "a", beta: "b", gamma: "c" }];
    expect(rankFields(rows, 3)).toEqual(["alpha", "beta", "gamma"]);
  });

  test("a key absent from the first row is still ranked by a later row's value", () => {
    const rows = [{ name: "a" }, { name: "b", price: 10 }];
    expect(rankFields(rows, 2)).toEqual(["name", "price"]);
  });

  test("columnsFor is the same ranking at table width", () => {
    expect(columnsFor([product], 6)[0]).toBe("name");
    expect(columnsFor([product], 6)).toContain("price");
  });
});
