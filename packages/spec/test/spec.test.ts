import { describe, expect, test } from "bun:test";
import { loadApp, deriveDDL, deriveTools, deriveTables, inferVessel, vesselFor, renderPhrase, parseTypeString, topo, validateSpec, SpecError, deriveForm, inputSchema, answerSchema, shapes, getShape, bumpVersion } from "../src/index.ts";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");
const chic = loadApp(resolve(ROOT, "templates/ecommerce"));
const camp = loadApp(resolve(ROOT, "templates/program"));

describe("type vocabulary", () => {
  test("parses suffixes", () => {
    expect(parseTypeString("string[]?")).toMatchObject({ base: "string", array: true, optional: true });
    expect(parseTypeString("int=12")).toMatchObject({ base: "int", optional: true, default: 12 });
    expect(parseTypeString("enum:a|b=a")).toMatchObject({ base: "enum", enumValues: ["a", "b"], default: "a" });
    expect(parseTypeString("product[]")).toMatchObject({ base: "product", entity: true, array: true });
  });
});

describe("ecommerce template", () => {
  test("derives DDL for every entity", () => {
    const ddl = deriveDDL(chic.spec);
    expect(deriveTables(chic.spec).length).toBe(6);
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS business."product"');
    expect(ddl).toContain(`"tags" text[] NOT NULL DEFAULT '{}'`);
    expect(ddl).toContain(`"adapter" text NOT NULL CHECK ("adapter" IN ('local'`);
    expect(ddl).toContain("embedding halfvec(3072)");
    expect(ddl).toContain("fts tsvector GENERATED ALWAYS");
    expect(ddl).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "customer_email_uniq"');
  });
  test("derives one tool per consumer shape, operator shapes excluded", () => {
    const tools = deriveTools(chic.spec);
    expect(tools.length).toBe(shapes(chic.spec).length);
    expect(tools.map((t) => t.name)).not.toContain("op.unmetReport");
    const cmp = tools.find((t) => t.name === "compareProducts")!;
    expect(cmp.parameters.required).toEqual(["leftId", "rightId"]);
    expect(tools.find((t) => t.name === "findProducts")!.parameters.properties.maxPrice).toMatchObject({ type: "number" });
  });
  test("vessels are inferred from the answer shape", () => {
    expect(vesselFor(getShape(chic.spec, "findProducts")!, chic.spec)).toBe("list");
    expect(vesselFor(getShape(chic.spec, "relatedProducts")!, chic.spec)).toBe("detail");
    expect(vesselFor(getShape(chic.spec, "compareProducts")!, chic.spec)).toBe("compare");
    expect(vesselFor(getShape(chic.spec, "orderStatus")!, chic.spec)).toBe("timeline");
    expect(vesselFor(getShape(chic.spec, "becomeKnown")!, chic.spec)).toBe("confirm");
    expect(inferVessel("cart", chic.spec)).toBe("card");
    expect(inferVessel("product", chic.spec)).toBe("detail");
  });
  test("plan topology: dependent steps run after their inputs", () => {
    expect(topo(getShape(chic.spec, "compareProducts")!)).toEqual([["p"], ["c"]]);
    expect(topo(getShape(chic.spec, "checkout")!)).toEqual([["c"], ["t"], ["o"]]);
    expect(topo(getShape(chic.spec, "relatedProducts")!)).toEqual([["s", "r"]]);
  });
  test("phrase rendering drops empty groups", () => {
    const s = getShape(chic.spec, "findProducts")!;
    expect(renderPhrase(s.phrase, { tag: "bold", maxPrice: 60 }, "x")).toBe("Products tagged bold under $60");
    expect(renderPhrase(s.phrase, {}, "x")).toBe("Products");
  });
  test("forms and input schemas", () => {
    const f = deriveForm(getShape(chic.spec, "checkout")!);
    expect(f.map((x) => x.name)).toEqual(["shipTo", "email"]);
    const schema = inputSchema(getShape(chic.spec, "addToCart")!, chic.spec);
    expect(schema.parse({ productId: "p_1" })).toEqual({ productId: "p_1", qty: 1 });
    expect(() => schema.parse({})).toThrow();
    const a = answerSchema(getShape(chic.spec, "relatedProducts")!, chic.spec);
    expect(a.safeParse({ seed: [], related: [] }).success).toBe(true);
    expect(a.safeParse({ seed: "no", related: [] }).success).toBe(false);
  });
});

describe("program template derives with zero code changes", () => {
  test("DDL + tools", () => {
    expect(deriveTables(camp.spec).length).toBe(9);
    expect(deriveTools(camp.spec).length).toBe(shapes(camp.spec).length);
    expect(topo(getShape(camp.spec, "registerCamper")!)).toEqual([["fam", "s"], ["n"], ["chk"], ["c"], ["r"]]);
    expect(vesselFor(getShape(camp.spec, "sessionSchedule")!, camp.spec)).toBe("timeline");
    expect(vesselFor(getShape(camp.spec, "quotePrice")!, camp.spec)).toBe("card");
  });
});

describe("validation refuses bad specs", () => {
  const base = () => JSON.parse(JSON.stringify(chic.spec));
  test("unknown call in plan", () => {
    const s = base(); s.shapes.findProducts.plan[0].call = "nope";
    expect(() => validateSpec(s)).toThrow(/unknown call "nope"/);
  });
  test("dependency cycle", () => {
    const s = base(); s.shapes.compareProducts.plan[0].after = ["c"];
    expect(() => validateSpec(s)).toThrow(/cycle/);
  });
  test("read shape running a mutation", () => {
    const s = base(); s.shapes.viewCart.plan[0].call = "cart.add";
    expect(() => validateSpec(s)).toThrow(/read shape runs mutation/);
  });
  test("schema-level: missing asks", () => {
    const s = base(); delete s.shapes.trending.asks;
    try { validateSpec(s); throw new Error("no"); } catch (e) { expect(e).toBeInstanceOf(SpecError); expect((e as Error).message).toContain("asks"); }
  });
  test("bumpVersion", () => {
    expect(bumpVersion("2026.09.21-1", new Date("2026-09-21T12:00:00Z"))).toBe("2026.09.21-2");
    expect(bumpVersion("2026.09.20-4", new Date("2026-09-21T12:00:00Z"))).toBe("2026.09.21-1");
  });
});
