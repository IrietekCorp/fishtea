/** The menu's trail (plugins/sections/trail.ts): one point per place, newest first, old points retired. */
import { describe, expect, test } from "bun:test";
import { tidy, type TrailPoint } from "../../../plugins/sections/trail";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60e3).toISOString();
const click = (id: string, shape: string, args: Record<string, unknown>, min: number): TrailPoint => ({ turnId: id, step: 0, typed: false, shape, at: ago(min), route: { shape, args } });
const typed = (id: string, said: string, min: number): TrailPoint => ({ turnId: id, step: 0, typed: true, said, at: ago(min), route: {} });

describe("tidy", () => {
  test("a place visited again moves to the front instead of appearing twice", () => {
    const t = tidy([click("a", "product", { productId: "p1" }, 30), click("b", "moods", {}, 20), click("c", "product", { productId: "p1" }, 10)], {}, NOW);
    expect(t.map((x) => x.turnId)).toEqual(["c", "b"]);
    expect(t.map((x) => x.step)).toEqual([1, 2]);
  });
  test("arguments in another order, or the same words typed differently, are the same place", () => {
    const t = tidy([
      click("a", "shopMood", { mood: "bold", occasion: "date" }, 5), click("b", "shopMood", { occasion: "date", mood: "bold" }, 4),
      typed("c", "Gold  earrings", 3), typed("d", "gold earrings", 2),
    ], {}, NOW);
    expect(t.map((x) => x.turnId)).toEqual(["d", "b"]);
  });
  test("different arguments are different places", () => {
    expect(tidy([click("a", "product", { productId: "p1" }, 2), click("b", "product", { productId: "p2" }, 1)], {}, NOW)).toHaveLength(2);
  });
  test("at most max points, and none older than its hours", () => {
    const many = Array.from({ length: 20 }, (_, i) => click(`x${i}`, "product", { productId: `p${i}` }, 20 - i));
    expect(tidy(many, { max: 5 }, NOW).map((x) => x.turnId)).toEqual(["x19", "x18", "x17", "x16", "x15"]);
    const t = tidy([click("old", "moods", {}, 26 * 60), click("new", "newIn", {}, 5)], { hours: 24 }, NOW);
    expect(t.map((x) => x.turnId)).toEqual(["new"]);
  });
  test("an old visit to a place does not bring it back once it is newer elsewhere", () => {
    const t = tidy([click("a", "moods", {}, 26 * 60), click("b", "moods", {}, 1)], {}, NOW);
    expect(t.map((x) => x.turnId)).toEqual(["b"]);
  });
});
