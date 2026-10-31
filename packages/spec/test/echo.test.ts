/** Echoes in the spec: the shared rule (planEcho), what the loader refuses, and the 1.1 → 1.2 format step. */
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { loadApp, validateSpec, migrateSpec, hostMatches, isWebUrl, planEcho, echoes, SPEC_FORMAT, SUPPORTED_SPEC_FORMATS, sectionHashes } from "../src/index.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const chic = loadApp(resolve(ROOT, "templates/ecommerce"));
const base = () => JSON.parse(JSON.stringify(chic.spec));

const outbound = {
  doc: "a visitor followed a product to the shop that sells it",
  handler: "products.search",          // replaced per test; the loader judges it
  analytics: "outbound_click",
  cases: [
    { hosts: ["*.amazon.com"], via: "beacon", handler: false },
    { hosts: ["quiet.example"], analytics: false },
  ],
};

describe("the shared rule", () => {
  test("only http(s) is a web URL", () => {
    expect(isWebUrl("https://shop.example/p/1")).toBe(true);
    expect(isWebUrl("http://shop.example")).toBe(true);
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.example", "mailto:a@b.c", "", null, 42, `https://x.example/${"a".repeat(5000)}`]) {
      expect(isWebUrl(bad)).toBe(false);
    }
  });

  test("hosts: a bare host matches itself and its www; *. matches the domain and every subdomain", () => {
    expect(hostMatches("amazon.com", "*.amazon.com")).toBe(true);
    expect(hostMatches("www.amazon.com", "*.amazon.com")).toBe(true);
    expect(hostMatches("smile.amazon.com", "*.amazon.com")).toBe(true);
    expect(hostMatches("notamazon.com", "*.amazon.com")).toBe(false);
    expect(hostMatches("www.shop.example", "shop.example")).toBe(true);
    expect(hostMatches("cdn.shop.example", "shop.example")).toBe(false);
    expect(hostMatches("SHOP.EXAMPLE.", "shop.example")).toBe(true);
  });

  test("the first matching case decides transport, handler and analytics; otherwise the echo's own", () => {
    const def = { ...outbound, handler: "x.handle" } as any;
    expect(planEcho("outbound", def, "https://www.amazon.com/dp/B0")).toEqual({ via: "beacon", handler: null, analytics: "outbound_click", case: 0 });
    expect(planEcho("outbound", def, "https://quiet.example/a")).toEqual({ via: "redirect", handler: "x.handle", analytics: null, case: 1 });
    expect(planEcho("outbound", def, "https://shop.example/a")).toEqual({ via: "redirect", handler: "x.handle", analytics: "outbound_click", case: null });
    expect(planEcho("share", {}, "https://shop.example")).toEqual({ via: "redirect", handler: null, analytics: "share", case: null });
    expect(planEcho("share", { analytics: false }, "https://shop.example").analytics).toBeNull();
    expect(planEcho("share", {}, "not a url").case).toBeNull();
  });
});

describe("the loader", () => {
  const withEcho = (patch: Record<string, unknown>, name = "outbound") => {
    const s = base(); s.fishtea = "1.2";
    s.calls["echo.handle"] = { kind: "compute", in: { to: "string" }, out: "json", impl: { module: "echo_handle.ts" } };
    s.echoes = { version: s.business.version, [name]: { ...outbound, handler: "echo.handle", ...patch } };
    return s;
  };

  test("a well-formed echo loads, and is its own section with its own hash", () => {
    const s = withEcho({});
    expect(() => validateSpec(s)).not.toThrow();
    expect(echoes(s).map(([n]) => n)).toEqual(["outbound"]);
    expect(sectionHashes(s).echoes).toMatch(/^[0-9a-f]{16}$/);
  });
  test("a handler must exist", () => {
    expect(() => validateSpec(withEcho({ handler: "nope" }))).toThrow(/echoes.outbound.handler: unknown call "nope"/);
  });
  test("a handler must be compute — it decides, it does not read or write", () => {
    expect(() => validateSpec(withEcho({ handler: "products.search" }))).toThrow(/must be a compute call/);
    expect(() => validateSpec(withEcho({ cases: [{ hosts: ["a.example"], handler: "products.search" }] }))).toThrow(/cases\[0\]\.handler.*compute/);
  });
  test("allow names real personas", () => {
    expect(() => validateSpec(withEcho({ allow: ["customer", "ghost"] }))).toThrow(/unknown persona "ghost"/);
  });
  test("an echo's name is a URL parameter", () => {
    expect(() => validateSpec(withEcho({}, "Out Bound"))).toThrow();
  });
  test("the schema refuses a bad transport, host or analytics name", () => {
    expect(() => validateSpec(withEcho({ via: "teleport" }))).toThrow();
    expect(() => validateSpec(withEcho({ cases: [{ hosts: ["https://amazon.com/"] }] }))).toThrow();
    expect(() => validateSpec(withEcho({ cases: [{ hosts: [] }] }))).toThrow();
    expect(() => validateSpec(withEcho({ analytics: "has spaces" }))).toThrow();
    expect(() => validateSpec(withEcho({ surprise: true }))).toThrow();
  });
});

describe("format 1.2", () => {
  test("is the format this build writes, and 1.0/1.1 still load", () => {
    expect(SPEC_FORMAT).toBe("1.2");
    expect([...SUPPORTED_SPEC_FORMATS]).toEqual(["1.0", "1.1", "1.2"]);
  });
  test("1.1 → 1.2 is additive: only the marker moves", () => {
    const s = base(); s.fishtea = "1.1";
    const before = JSON.stringify({ ...s, fishtea: undefined });
    const r = migrateSpec(s, "1.2");
    expect(r.spec.fishtea).toBe("1.2");
    expect(JSON.stringify({ ...r.spec, fishtea: undefined })).toBe(before);
  });
});
