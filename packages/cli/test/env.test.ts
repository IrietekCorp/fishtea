import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { composePorts } from "../src/index.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bindHost, bindPort, classifierUrl, databaseUrl, isInside, nextFreePort, portFree, portWasChosen, publicHost, reachableUrls, redact, resolvePort, SetupError, workspaceRoot, DEFAULT_APP_ID } from "../src/env.ts";
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
    // without an explicit target a build gets the last stage in the Dockerfile, and core ran Vite
    expect(app.services.core.build.target).toBe("core");
    expect(app.services.ui.build.target).toBe("ui");
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

/**
 * Picking a port that is actually free.
 *
 * `fishtea up` used to fail with docker's own message — "failed to bind host port 0.0.0.0:3000/tcp:
 * address already in use" — after the database and classifier had already started healthy. A developer
 * machine has something on 3000 most days, and which port this particular stack lands on is usually not
 * a thing anyone has an opinion about. When they do have an opinion, they say so, and then being moved
 * silently is worse than being told.
 */
describe("ports", () => {
  /** Hold a port for the duration of a test, the way another process would. */
  async function holding<T>(fn: (port: number) => Promise<T>): Promise<T> {
    const srv = createServer();
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const port = (srv.address() as AddressInfo).port;
    try { return await fn(port); } finally { await new Promise<void>((r) => srv.close(() => r())); }
  }

  test("a held port reads as taken, and reads free again once released", async () => {
    const port = await holding(async (p) => {
      expect(await portFree(p, "127.0.0.1")).toBe(false);
      return p;
    });
    expect(await portFree(port, "127.0.0.1")).toBe(true);
  });

  test("the next free port steps over what is held", async () => {
    await holding(async (p) => {
      const next = await nextFreePort(p, "127.0.0.1");
      expect(next).toBeGreaterThan(p);
    });
  });

  test("a port nobody chose moves, and says it moved", async () => {
    await holding(async (p) => {
      const r = await resolvePort(p, "127.0.0.1", { chosen: false });
      expect(r.moved).toBe(true);
      expect(r.port).not.toBe(p);
      expect(await portFree(r.port, "127.0.0.1")).toBe(true);
    });
  });

  test("a free port is used as-is and reports no move", async () => {
    const free = (await nextFreePort(41000, "127.0.0.1"))!;
    const r = await resolvePort(free, "127.0.0.1", { chosen: false });
    expect(r).toEqual({ port: free, moved: false });
  });

  test("a port somebody chose is an error, not a surprise", async () => {
    await holding(async (p) => {
      // Serving somewhere other than where you were told is how you spend twenty minutes wondering
      // why your requests reach the wrong application.
      const err = await resolvePort(p, "127.0.0.1", { chosen: true }).catch((e) => e as SetupError);
      expect(err).toBeInstanceOf(SetupError);
      expect(String((err as SetupError).message)).toContain(String(p));
      expect((err as SetupError).fixes.join(" ")).toContain("--port");
    });
  });

  test("--port and PORT both count as chosen; neither means we may move", () => {
    expect(portWasChosen({ port: "4000" })).toBe(true);
    expect(portWasChosen({})).toBe(false);
    const was = process.env.PORT;
    try {
      process.env.PORT = "4000";
      expect(portWasChosen({})).toBe(true);
    } finally {
      if (was === undefined) delete process.env.PORT; else process.env.PORT = was;
    }
  });

  test("compose leaves a port somebody set alone", async () => {
    const was = process.env.FISHTEA_CORE_PORT;
    try {
      process.env.FISHTEA_CORE_PORT = "3999";
      expect(await composePorts()).not.toHaveProperty("FISHTEA_CORE_PORT");
    } finally {
      if (was === undefined) delete process.env.FISHTEA_CORE_PORT; else process.env.FISHTEA_CORE_PORT = was;
    }
  });
});
