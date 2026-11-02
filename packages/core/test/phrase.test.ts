/** An answer's phrase may name what it found ($answer…), falling back to the shape's description. */
import { describe, expect, test } from "bun:test";
import { phraseFor } from "../src/pour.ts";

const shape = { asks: "A product", phrase: "$answer.product.0.name", allow: [] } as any;
describe("phraseFor", () => {
  test("names the answer's lead record", () => {
    expect(phraseFor(shape, { productId: "p1" }, { product: [{ name: "Gold hoops" }] })).toBe("Gold hoops");
  });
  test("nothing found, or no answer yet (a form, the classifier's guess): the description", () => {
    expect(phraseFor(shape, { productId: "p1" }, { product: [] })).toBe("A product");
    expect(phraseFor(shape, { productId: "p1" })).toBe("A product");
  });
  test("phrases of arguments alone are unchanged", () => {
    expect(phraseFor({ asks: "x", phrase: "Feeling $mood", allow: [] } as any, { mood: "bold" }, { rows: [] })).toBe("Feeling bold");
  });
});
