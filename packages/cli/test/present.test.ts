import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { loadApp } from "@fishtea/spec";
import { present } from "../src/present.ts";

const DIR = resolve(import.meta.dir, "../../../templates/portfolio");

describe("fishtea present", () => {
  test("prints every read shape's layout and exits 0 when rules.present agrees with the spec", async () => {
    const out: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => out.push(a.join(" "));
    try {
      const code = await present(loadApp(DIR), DIR, { shapes: [], live: false, core: "http://127.0.0.1:9", args: {} });
      expect(code).toBe(0);
    } finally { console.log = log; }
    const text = out.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    expect(text).toContain("skills  derived");
    expect(text).toContain("molecule chip (derived) → projects");
    expect(text).toContain("rules.present is consistent with the spec");
    expect(text).not.toContain("getInTouch  "); // a write shape has no answer layout to show
  });
});
