import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bindHost, bindPort, classifierUrl, databaseUrl, isInside, publicHost, reachableUrls, redact, workspaceRoot, DEFAULT_APP_ID } from "../src/env.ts";
import { targetDir, scaffold } from "../src/new.ts";

const HOME = resolve(import.meta.dir, "../../..");
const scratch: string[] = [];
const temp = () => { const d = mkdtempSync(join(tmpdir(), "fishtea-new-")); scratch.push(d); return d; };
afterEach(() => { for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("network settings", () => {
  test("the core binds every interface unless told otherwise", () => {
    expect(bindHost({})).toBe("0.0.0.0");
    expect(bindHost({ host: "127.0.0.1" })).toBe("127.0.0.1");
    expect(bindPort({ port: "4000" })).toBe(4000);
  });
  test("a flag beats the environment, which beats the default", () => {
    expect(databaseUrl({ db: "postgres://a@h:1/x" })).toBe("postgres://a@h:1/x");
    expect(classifierUrl({ classifier: "http://box:9000" })).toBe("http://box:9000");
    expect(databaseUrl({})).toContain("postgres://");
    expect(publicHost({ "public-host": "fishtea.local" })).toBe("fishtea.local");
  });
  test("a wildcard binding advertises both loopback and the LAN address", () => {
    const urls = reachableUrls("0.0.0.0", 3000);
    expect(urls[0]).toBe("http://localhost:3000");
    expect(urls.every((u) => u.endsWith(":3000"))).toBe(true);
    expect(reachableUrls("10.0.0.5", 80)).toEqual(["http://10.0.0.5:80"]);
  });
  test("passwords never reach a log line", () => {
    expect(redact("postgres://fishtea:hunter2@db.example:5432/fishtea")).toBe("postgres://fishtea:***@db.example:5432/fishtea");
  });
});

describe("the generated docker-compose.yml", () => {
  // it was once written in flow style, where "${FISHTEA_HOME:-/path}" closes the mapping early and the file
  // will not parse: `bun run up` failed with "did not find expected ',' or '}'"
  const parse = (text: string) => (Bun as unknown as { YAML: { parse: (s: string) => any } }).YAML.parse(text);

  test("parses, and so does the framework's own", async () => {
    const dir = join(temp(), "composecheck");
    await scaffold({ id: "composecheck", template: "ecommerce", dir, fishteaHome: HOME });
    const app = parse(readFileSync(join(dir, "docker-compose.yml"), "utf8"));
    expect(Object.keys(app.services).sort()).toEqual(["classifier", "core", "db", "ui"]);
    expect(app.services.db.image).toContain("pg18");
    expect(app.services.core.build.context).toContain("FISHTEA_HOME");
    expect(app.services.core.restart).toBe("unless-stopped");
    expect(app.services.core.environment.FISHTEA_HOST).toBe("0.0.0.0");
    expect(app.services.core.env_file[0].required).toBe(false);
    expect(app.services.ui.environment.VITE_CORE_URL).toContain("FISHTEA_PUBLIC_HOST");
    expect(parse(readFileSync(join(HOME, "docker-compose.yml"), "utf8")).services.core.environment.FISHTEA_HOST).toBe("0.0.0.0");
  });
});

describe("where a new application goes", () => {
  test("never inside the framework checkout", () => {
    expect(isInside(join(HOME, "anything"), HOME)).toBe(true);
    expect(isInside("/tmp/elsewhere", HOME)).toBe(false);
    expect(workspaceRoot(HOME, {})).not.toBe(HOME);
  });
  test("--dir wins, then --workspace, then a sibling of the framework", () => {
    expect(targetDir("shop", { fishteaHome: HOME, dir: "/srv/shop" })).toBe("/srv/shop");
    expect(targetDir("shop", { fishteaHome: HOME, flags: { workspace: "/srv/apps" } })).toBe("/srv/apps/shop");
    expect(targetDir("shop", { fishteaHome: HOME })).toBe(resolve(HOME, "../shop"));
  });
  test("scaffolding into the framework is refused with a way out", async () => {
    await expect(scaffold({ id: "nope", template: "blank", dir: join(HOME, "nope"), fishteaHome: HOME }))
      .rejects.toThrow(/inside the framework checkout[\s\S]*--dir/);
  });
  test("the id defaults to myapp and the app is written with a usable .env", async () => {
    const dir = join(temp(), DEFAULT_APP_ID);
    const out = await scaffold({ id: DEFAULT_APP_ID, template: "blank", dir, fishteaHome: HOME });
    expect(out.dir).toBe(dir);
    const env = readFileSync(join(dir, ".env"), "utf8");
    expect(existsSync(join(dir, ".env.example"))).toBe(true);
    expect(env).toContain("FISHTEA_HOST=0.0.0.0");          // reachable from other machines out of the box
    expect(env).toContain("DATABASE_URL=");
    expect(env).toContain("CLASSIFIER_URL=");
    expect(env).toContain(`FISHTEA_HOME=${HOME}`);
    const pkg = await Bun.file(join(dir, "package.json")).json();
    expect(pkg.name).toBe(DEFAULT_APP_ID);
    expect(String(pkg.scripts.doctor)).toContain("doctor");
    const compose = readFileSync(join(dir, "docker-compose.yml"), "utf8");
    expect(compose).toContain("FISHTEA_PUBLIC_HOST");        // the UI dials a real address, not localhost
  });
});
