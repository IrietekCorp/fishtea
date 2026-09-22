/**
 * The console is driven through a real pty, because the bug it was rebuilt for only appears with a tty:
 * under Bun, `node:readline` echoes every keystroke, so a prompt library rendered "hheelllloo".
 * These tests type into the console and assert the screen shows what was typed, once.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");
const DRIVER = resolve(import.meta.dir, "pty-drive.py");
const APP = resolve(ROOT, "templates/ecommerce");

type Step = { wait: number } | { keys: string; after?: number } | { snap: string };

async function driveCmd(script: Step[], cmd: string[], env: Record<string, string> = {}): Promise<{ snaps: Record<string, string>; final: string }> {
  const file = `/tmp/fishtea-tui-${Math.random().toString(36).slice(2)}.json`;
  await Bun.write(file, JSON.stringify(script));
  const proc = Bun.spawn(["python3", DRIVER, file, "--", ...cmd], {
    env: { ...process.env, FISHTEA_HOME: ROOT, FISHTEA_APP: APP, NO_COLOR: "1", ...env },
    stdout: "pipe", stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return JSON.parse(out);
}
const drive = (script: Step[]) => driveCmd(script, ["bun", resolve(ROOT, "packages/cli/src/index.ts"), "tui", "--app", APP]);

const boot: Step[] = [{ wait: 2500 }];
const quit: Step[] = [{ keys: "q" }, { wait: 300 }];

describe("spec editing writes through the console", () => {
  let scratch = "";
  let editor = "";
  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), "fishtea-edit-"));
    await Bun.spawn(["bun", resolve(ROOT, "packages/cli/src/index.ts"), "new", "edittest", "--template", "blank", "--dir", join(scratch, "app"), "--force"], { env: { ...process.env, FISHTEA_HOME: ROOT }, stdout: "ignore", stderr: "ignore" }).exited;
    editor = join(scratch, "editor.sh");
    writeFileSync(editor, `#!/bin/bash\npython3 -c "\nimport json,sys\nf=sys.argv[1]; s=json.load(open(f)); s['classify']={'budgetMs':1234,'floor':0.5,'contextTurns':6}\njson.dump(s,open(f,'w'),indent=2)\n" "$1"\n`);
    chmodSync(editor, 0o755);
  });
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  const driveApp = (script: Step[], env: Record<string, string> = {}) =>
    driveCmd(script, ["bun", resolve(ROOT, "packages/cli/src/index.ts"), "tui", "--app", join(scratch, "app")], env);

  test("$EDITOR on a section validates, bumps the section version and writes", async () => {
    const { snaps } = await driveApp([
      { wait: 2200 }, { keys: "2", after: 500 }, { keys: "e", after: 500 },
      { keys: "jjj\r", after: 2500 }, { snap: "done" }, { keys: "q" }, { wait: 300 },
    ], { EDITOR: editor });
    expect(snaps.done).toContain("rules → v");
    const spec = await Bun.file(join(scratch, "app", "spec.json")).json();
    expect(spec.rules.classify.budgetMs).toBe(1234);
    expect(spec.rules.version).not.toBe("2026.09.21-1");
    expect(spec.rules.writes.confirmAlways).toBe(true); // the rest of the section survived
  }, 90000);

  test("an edit that breaks the spec is refused and nothing is written", async () => {
    const bad = join(scratch, "bad.sh");
    writeFileSync(bad, `#!/bin/bash\necho '{"nope": true}' > "$1"\n`);
    chmodSync(bad, 0o755);
    const before = await Bun.file(join(scratch, "app", "spec.json")).text();
    const { snaps } = await driveApp([
      { wait: 2200 }, { keys: "2", after: 500 }, { keys: "e", after: 500 },
      { keys: "j\r", after: 2500 }, { snap: "refused" }, { keys: "q" }, { wait: 300 },
    ], { EDITOR: bad });
    expect(snaps.refused).toContain("refused");
    expect(await Bun.file(join(scratch, "app", "spec.json")).text()).toBe(before);
  }, 90000);
});

describe("operator console", () => {
  test("renders the header, the nav and the application", async () => {
    const { snaps } = await drive([...boot, { snap: "home" }, ...quit]);
    const s = snaps.home;
    expect(s).toContain("fishtea · Example Store");
    expect(s).toContain("1 Dashboard");
    expect(s).toContain("5 Onboard");
    expect(s).toContain("6 entities · 17 calls · 11 shapes");
    expect(s).toMatch(/core (down|:\d+)/);
  }, 60000);

  test("number keys switch screens and esc walks back out", async () => {
    const { snaps } = await drive([
      ...boot, { keys: "4", after: 400 }, { snap: "run" },
      { keys: "2", after: 400 }, { keys: "\r", after: 400 }, { snap: "section" },
      { keys: "\u001b", after: 300 }, { snap: "back" }, ...quit,
    ]);
    expect(snaps.run).toContain("Compose up");
    expect(snaps.section).toContain("spec › business");
    expect(snaps.back).toContain("entities");
    expect(snaps.back).toContain("notifications");
  }, 60000);

  test("typing is not duplicated and the value is kept (the bug this console replaced)", async () => {
    const { snaps } = await drive([
      ...boot,
      { keys: "5", after: 600 },          // Onboard
      { keys: "\r", after: 500 },          // first archetype (blank)
      { keys: "my-tea-shop", after: 500 }, // into the id field
      { snap: "typed" },
      { keys: "\u001b", after: 300 },
      ...quit,
    ]);
    expect(snaps.typed).toContain("my-tea-shop");
    expect(snaps.typed).not.toContain("mmyy");
    expect(snaps.typed).not.toContain("--tteeaa");
  }, 60000);

  test("a text field's characters do not reach the global shortcuts", async () => {
    // "4" and "q" inside a field must not switch screens or quit
    const { snaps, final } = await drive([
      ...boot, { keys: "5", after: 600 }, { keys: "\r", after: 500 },
      { keys: "q4q4", after: 500 }, { snap: "locked" },
      { keys: "\u001b", after: 300 }, ...quit,
    ]);
    expect(snaps.locked).toContain("q4q4");
    expect(snaps.locked).not.toContain("Compose up");
    expect(final.length).toBeGreaterThan(0);
  }, 60000);

  test("the onboarding interview substitutes the name, keeps defaults on ⏎, and scaffolds", async () => {
    const dir = `/tmp/fishtea-interview-${Math.random().toString(36).slice(2)}`;
    const script: Step[] = [
      { wait: 1800 }, { snap: "first" },
      { keys: "Tea Room\r", after: 500 },
      { keys: "Loose-leaf tea and teaware.\r", after: 500 }, { snap: "third" },
      ...Array.from({ length: 14 }, () => ({ keys: "\r", after: 420 })),
      { wait: 2000 },
    ];
    const { snaps } = await driveCmd(script, ["bun", resolve(ROOT, "packages/cli/src/index.ts"), "new", "tea-room", "--template", "ecommerce", "--dir", dir, "--interactive"]);
    expect(snaps.first).toContain("1/13");
    expect(snaps.first).toContain("Tea Room");        // {{name}} resolved from the id
    expect(snaps.first).not.toContain("{{name}}");
    expect(snaps.third).toContain("Tea Room");        // and typing replaced the default rather than appending
    expect(snaps.third).not.toContain("Tea RoomLoose-leaf");
    const spec = await Bun.file(`${dir}/spec.json`).json();
    expect(spec.business.name).toBe("Tea Room");
    expect(spec.business.doc).toBe("Loose-leaf tea and teaware.");
    expect(spec.business.currency).toBe("USD");       // ⏎ kept the default
    await Bun.$`rm -rf ${dir}`.quiet();
  }, 90000);

  test("the conversations screen reads the trail store and the unmet channel", async () => {
    const { snaps } = await drive([...boot, { keys: "3", after: 1200 }, { snap: "conv" }, { keys: "\t", after: 800 }, { snap: "unmet" }, ...quit]);
    expect(snaps.conv).toContain("visitors");
    expect(snaps.unmet).toContain("unmet");
  }, 60000);

  test("the versions screen reports the framework and where this application stands", async () => {
    const { snaps } = await drive([...boot, { keys: "6", after: 1200 }, { snap: "versions" }, ...quit]);
    expect(snaps.versions).toContain("Versions");
    expect(snaps.versions).toContain("running");
    expect(snaps.versions).toContain("this application");
    expect(snaps.versions).toContain("spec format");
    // The two actions that make the screen worth having.
    expect(snaps.versions).toContain("Update this application");
    expect(snaps.versions).toContain("Switch framework version");
  }, 60000);

  test("the versions screen plans an update and shows it before applying anything", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fishtea-vers-"));
    const app = join(dir, "app");
    await Bun.spawn(["bun", resolve(ROOT, "packages/cli/src/index.ts"), "new", "verstest", "--template", "blank", "--dir", app, "--force"], { env: { ...process.env, FISHTEA_HOME: ROOT }, stdout: "ignore", stderr: "ignore" }).exited;
    // Put it back a spec format, so there is something real to plan.
    const spec = await Bun.file(join(app, "spec.json")).json();
    spec.fishtea = "1.0";
    writeFileSync(join(app, "spec.json"), JSON.stringify(spec, null, 2));

    const { snaps } = await driveCmd(
      [...boot, { keys: "6", after: 1000 }, { snap: "before" }, { keys: "\r", after: 1500 }, { snap: "plan" }, { keys: "n", after: 400 }, ...quit],
      ["bun", resolve(ROOT, "packages/cli/src/index.ts"), "tui", "--app", app],
      { FISHTEA_APP: app },
    );
    expect(snaps.before).toContain("1.0");
    expect(snaps.plan).toContain("format 1.0");        // the plan names both formats
    expect(snaps.plan).toContain("Apply this?");       // and asks before writing
    // Answering "n" must leave the spec exactly as it was.
    expect((await Bun.file(join(app, "spec.json")).json()).fishtea).toBe("1.0");
    rmSync(dir, { recursive: true, force: true });
  }, 90000);
});
