/**
 * The form vessel's flatten/unflatten pair.
 *
 * This is where a shape's input schema becomes inputs and back again, and it is the one piece of the UI
 * with real logic rather than markup — so it is the piece worth testing without a browser.
 *
 * The case that motivated these: react-hook-form treats a dot in a field name as a *path*, so registering
 * "shipTo.line1" produces nested state `{ shipTo: { line1 } }`, not a flat key. unflatten() read
 * `values["shipTo.line1"]`, found undefined, and silently dropped every address line — the order went out
 * with a country and nothing else. Both shapes are asserted here so it cannot regress in either direction.
 */
import { describe, expect, test } from "bun:test";
import { flatten, unflatten } from "./form.tsx";
import type { Field as FieldDef } from "../lib/client";

const field = (over: Partial<FieldDef> & { name: string }): FieldDef => ({
  label: over.name, type: "string", required: false, array: false, ...over,
});

const SHIP = field({ name: "shipTo", label: "Ship To", type: "json", required: true });
const EMAIL = field({ name: "email", label: "Email", type: "email", required: true });

describe("flatten", () => {
  test("an address with no known value still offers every line", () => {
    const { fields, defaults } = flatten([SHIP, EMAIL], {});
    expect(fields.map((f) => f.key)).toEqual([
      "shipTo.name", "shipTo.line1", "shipTo.city", "shipTo.region", "shipTo.postal", "shipTo.country", "email",
    ]);
    expect(defaults["shipTo.country"]).toBe("US");
    expect(defaults["shipTo.city"]).toBe("");
  });

  test("a partially filled address still offers the missing lines", () => {
    // The regression: the server drops empty values, so a submit with no city came back as
    // { country: "US" } — and the form rendered only that, leaving no way to ever supply a city.
    const { fields, defaults } = flatten([SHIP], { shipTo: { country: "GB", line1: "12 Example Way" } });
    expect(fields.map((f) => f.key)).toContain("shipTo.city");
    expect(fields.map((f) => f.key)).toHaveLength(6);
    expect(defaults["shipTo.line1"]).toBe("12 Example Way");
    expect(defaults["shipTo.country"]).toBe("GB");      // the known value wins over the US default
    expect(defaults["shipTo.city"]).toBe("");
  });

  test("a non-address json object offers exactly the keys it has", () => {
    const meta = field({ name: "meta", label: "Meta", type: "json" });
    const { fields } = flatten([meta], { meta: { a: 1, b: 2 } });
    expect(fields.map((f) => f.key)).toEqual(["meta.a", "meta.b"]);
  });

  test("an empty json object with no canonical keys stays one textarea", () => {
    const meta = field({ name: "meta", label: "Meta", type: "json" });
    const { fields } = flatten([meta], {});
    expect(fields.map((f) => f.key)).toEqual(["meta"]);
    expect(fields[0].type).toBe("json");
  });

  test("sub-field labels are human, not raw keys", () => {
    const { fields } = flatten([SHIP], {});
    expect(fields.find((f) => f.key === "shipTo.line1")!.label).toBe("Ship To · Line 1");
    expect(fields.find((f) => f.key === "shipTo.postal")!.label).toBe("Ship To · Postal");
  });

  test("knowns are pre-filled, and arrays and objects are made editable as text", () => {
    const tags = field({ name: "tags", label: "Tags", array: true });
    const { defaults } = flatten([tags, EMAIL], { tags: ["a", "b"], email: "x@example.com" });
    expect(defaults.tags).toBe("a, b");
    expect(defaults.email).toBe("x@example.com");
  });
});

describe("unflatten", () => {
  const flat = flatten([SHIP, EMAIL], {}).fields;

  test("flat dotted values rebuild the nested object", () => {
    const out = unflatten({
      "shipTo.name": "Review Person", "shipTo.line1": "12 Example Way", "shipTo.city": "Leeds",
      "shipTo.region": "West Yorkshire", "shipTo.postal": "LS1 1AA", "shipTo.country": "GB",
      email: "review@example.com",
    }, flat);
    expect(out).toEqual({
      shipTo: { name: "Review Person", line1: "12 Example Way", city: "Leeds", region: "West Yorkshire", postal: "LS1 1AA", country: "GB" },
      email: "review@example.com",
    });
  });

  test("NESTED values rebuild the same object — react-hook-form nests dotted names", () => {
    // The bug: this shape produced { shipTo: { country: "US" } } and nothing else, because every
    // lookup of values["shipTo.<k>"] was undefined and got skipped as empty.
    const out = unflatten({
      shipTo: { name: "Review Person", line1: "12 Example Way", city: "Leeds", region: "West Yorkshire", postal: "LS1 1AA", country: "GB" },
      email: "review@example.com",
    } as any, flat);
    expect(out).toEqual({
      shipTo: { name: "Review Person", line1: "12 Example Way", city: "Leeds", region: "West Yorkshire", postal: "LS1 1AA", country: "GB" },
      email: "review@example.com",
    });
  });

  test("HYBRID values: the live nested value beats the stale flat default", () => {
    // This is what react-hook-form actually submits. defaultValues is stored flat as given, while
    // register() writes to the path — so both keys exist and only one of them is current. Reading the
    // flat one first silently dropped everything the visitor typed.
    const out = unflatten({
      "shipTo.name": "", "shipTo.line1": "", "shipTo.city": "", "shipTo.region": "",
      "shipTo.postal": "", "shipTo.country": "US",
      shipTo: { name: "Review Person", line1: "12 Example Way", city: "Leeds", region: "West Yorkshire", postal: "LS1 1AA", country: "US" },
      email: "review@example.com",
    } as any, flat);
    expect(out).toEqual({
      shipTo: { name: "Review Person", line1: "12 Example Way", city: "Leeds", region: "West Yorkshire", postal: "LS1 1AA", country: "US" },
      email: "review@example.com",
    });
  });

  test("a flat default still applies when the path holds nothing", () => {
    const out = unflatten({ "shipTo.country": "US", shipTo: { country: "" }, email: "e@x.com" } as any, flat);
    expect(out).toEqual({ shipTo: { country: "US" }, email: "e@x.com" });
  });

  test("empty values are dropped rather than sent as blanks", () => {
    const out = unflatten({ "shipTo.name": "", "shipTo.city": "Leeds", email: "" }, flat);
    expect(out).toEqual({ shipTo: { city: "Leeds" } });
  });

  test("types are coerced by the field's declared type", () => {
    const fields = flatten([
      field({ name: "qty", type: "int" }),
      field({ name: "price", type: "money" }),
      field({ name: "gift", type: "boolean" }),
      field({ name: "tags", array: true }),
    ], {}).fields;
    expect(unflatten({ qty: "3", price: "12.50", gift: true, tags: "a, b ,c" }, fields))
      .toEqual({ qty: 3, price: 12.5, gift: true, tags: ["a", "b", "c"] });
  });

  test("a full round trip through both halves preserves what was entered", () => {
    const known = { shipTo: { name: "A", line1: "B", city: "C", region: "D", postal: "E", country: "F" }, email: "e@x.com" };
    const { fields, defaults } = flatten([SHIP, EMAIL], known);
    expect(unflatten(defaults, fields)).toEqual(known);
  });
});
