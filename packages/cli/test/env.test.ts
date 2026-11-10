import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { composePorts } from "../src/index.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { bindHost, bindPort, classifierUrl, databaseUrl, isInside, nextFreePort, portFree, portWasChosen, publicHost, reachableUrls, redact, resolvePort, SetupError, workspaceRoot, DEFAULT_APP_ID, POSTGRES_IMAGE, composePostgres, postgresMajor, appBun, BUN_VERSION } from "../src/env.ts";
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
    // The constant, not a literal: a bump should not need this test edited to agree with it.
    expect(app.services.db.image).toBe(POSTGRES_IMAGE);
    expect(app.services.core.build.context).toContain("FISHTEA_HOME");
    expect(app.services.core.restart).toBe("unless-stopped");
    // without an explicit target a build gets the last stage in the Dockerfile, and core ran Vite
    expect(app.services.core.build.target).toBe("core");
    expect(app.services.ui.build.target).toBe("ui");
    expect(app.services.core.environment.FISHTEA_HOST).toBe("0.0.0.0");
    expect(app.services.core.env_file[0].required).toBe(false);
    // The browser dials the page's own origin (/core, proxied to the core by the ui server), which is
    // right on any machine and keeps the visitor's cookie first-party; it once dialled the core's public
    // address, which was right only as long as nobody opened the page under another name.
    expect(app.services.ui.environment.VITE_CORE_URL).toBe("/core");
    expect(app.services.ui.environment.FISHTEA_CORE_URL).toBe("http://core:3000");
    // and it sees the application: its generated ui assets, its plugins, its spec
    expect(app.services.ui.environment.FISHTEA_APP_DIR).toBe("/app");
    expect(app.services.ui.volumes).toContain("./:/app");
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

/**
 * A generated project is the application and nothing else.
 *
 * It gets committed to its own repository and opened by people — and agents — who have never seen the
 * framework. Anything of this machine that leaks into it is wrong for everybody who clones it.
 */
describe("a generated project is clean", () => {
  const generated = async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "fishtea-clean-")), "app");
    scratch.push(dir);
    await scaffold({ id: "cleanapp", template: "portfolio", dir, fishteaHome: HOME, force: true });
    return dir;
  };

  test("it carries no framework source, only the application", async () => {
    const dir = await generated();
    for (const leaked of ["packages", "plugins", "templates", "bun.lock", "tsconfig.json", "Dockerfile.core"]) {
      expect({ leaked, present: existsSync(join(dir, leaked)) }).toEqual({ leaked, present: false });
    }
    for (const wanted of ["spec.json", "calls", "seed", "package.json", "fishtea.ts", "README.md", "CLAUDE.md", ".gitignore", ".env.example"]) {
      expect({ wanted, present: existsSync(join(dir, wanted)) }).toEqual({ wanted, present: true });
    }
  });

  test("nothing committable hard-codes this machine's home directory", async () => {
    const dir = await generated();
    const home = process.env.HOME!;
    // .env is git-ignored, and .env.example and docker-compose.yml need a literal path because neither a
    // dotenv file nor docker expands `~`. Everything else must be portable.
    const committed = ["package.json", "README.md", "CLAUDE.md", "fishtea.ts", ".gitignore", "spec.json"];
    for (const f of committed) {
      const text = readFileSync(join(dir, f), "utf8");
      expect({ file: f, leaks: text.includes(home) }).toEqual({ file: f, leaks: false });
    }
    // The framework's location is still recorded — as a path that survives being cloned.
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(pkg.fishtea.home.startsWith("~/") || !pkg.fishtea.home.startsWith(home)).toBe(true);
  });

  test("the README links somewhere a reader can go", async () => {
    const readme = readFileSync(join(await generated(), "README.md"), "utf8");
    expect(readme).toContain("(https://fishtea.io)");
    expect(readme).not.toMatch(/\]\(\/[a-z]/);                 // a link to a local absolute path
  });

  test("CLAUDE.md describes this application, not the framework", async () => {
    const dir = await generated();
    const md = readFileSync(join(dir, "CLAUDE.md"), "utf8");
    expect(md).not.toContain("${a.");                          // no unsubstituted template
    expect(md).toContain("Cleanapp");                          // the business, by name
    expect(md).toContain("portfolio");                         // and its archetype
    expect(md).toContain("spec.json` is the source");          // the rule that matters most
    // Every command it advertises has to exist, or an agent will follow it into an error.
    const scripts = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).scripts as Record<string, string>;
    for (const m of md.matchAll(/^\s{4}bun run ([a-z-]+)/gm)) {
      expect({ command: m[1], defined: m[1] in scripts }).toEqual({ command: m[1], defined: true });
    }
  });
});

describe("the ports a running stack already holds", () => {
  test("docker compose ps output, either shape, becomes ports by service (IPv4 and IPv6 listed once)", async () => {
    const { publishedPorts } = await import("../src/index.ts");
    const db = { Service: "db", Publishers: [{ PublishedPort: 5432, TargetPort: 5432 }, { URL: "::", PublishedPort: 5432, TargetPort: 5432 }] };
    const core = { Service: "core", Publishers: [{ PublishedPort: 3002, TargetPort: 3000 }] };
    const idle = { Service: "classifier", Publishers: [{ PublishedPort: 0, TargetPort: 8081 }] };
    const want = { db: [5432], core: [3002] };
    expect(publishedPorts(JSON.stringify([db, core, idle]))).toEqual(want);
    expect(publishedPorts([db, core, idle].map((r) => JSON.stringify(r)).join("\n"))).toEqual(want);
    expect(publishedPorts("")).toEqual({});
    expect(publishedPorts("not json")).toEqual({});
  });
});

describe("the Postgres an application's compose names", () => {
  // doctor's only way of telling an application that the framework moved its pin: a compose is written
  // once at scaffold and never reconciled, so nothing else would ever mention it.
  const write = (dir: string, rel: string, image: string | null) => {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    const db = image === null ? "" : `  db:\n    image: ${image}\n`;
    writeFileSync(join(dir, rel), `services:\n${db}  core:\n    image: x\n`);
  };

  test("reads both compose files and says which agree", () => {
    const dir = temp();
    write(dir, "docker-compose.yml", POSTGRES_IMAGE);
    write(dir, "deploy/docker-compose.yml", "pgvector/pgvector:0.8.6-pg18-bookworm");
    const sites = composePostgres(dir);
    expect(sites.map((s) => [s.file, s.agrees, s.major])).toEqual([
      ["docker-compose.yml", true, 18],
      [join("deploy", "docker-compose.yml"), false, 18],
    ]);
  });

  test("an application running Postgres somewhere else gets no row, not a complaint", () => {
    const dir = temp();
    write(dir, "docker-compose.yml", null);
    expect(composePostgres(dir)).toEqual([]);
    expect(composePostgres(join(dir, "nothing-here"))).toEqual([]);
  });

  test("an unparseable compose is not this check's to report", () => {
    // `bun run up` fails on it with the parser's own message, which is more use than a doctor row.
    const dir = temp();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "docker-compose.yml"), "services: { db: image: broken\n");
    expect(composePostgres(dir)).toEqual([]);
  });

  test("the major is what a bump cannot paper over", () => {
    // pgdata is written in a major-version layout and will not start under the next one.
    expect(postgresMajor("pgvector/pgvector:0.8.7-pg18-trixie")).toBe(18);
    expect(postgresMajor("pgvector/pgvector:pg19")).toBe(19);
    expect(postgresMajor("postgres:18-alpine")).toBe(18);
    // Nothing is claimed from a tag that does not say, so doctor warns instead of failing.
    expect(postgresMajor("postgres:latest")).toBeNull();
    expect(postgresMajor("mysql:8")).toBeNull();
  });
});

describe("the Bun an application's own Dockerfiles build from", () => {
  const app = (files: Record<string, string>) => {
    const d = temp();
    for (const [f, body] of Object.entries(files)) { mkdirSync(dirname(join(d, f)), { recursive: true }); writeFileSync(join(d, f), body); }
    return d;
  };

  test("a floating tag is named as floating; an exact one agrees or does not", () => {
    const d = app({
      "deploy/Dockerfile": "FROM oven/bun:1 AS framework\nFROM caddy:2-alpine AS web\n",
      "Dockerfile": `FROM oven/bun:${BUN_VERSION}\n`,
      "deploy/Dockerfile.worker": "FROM oven/bun:1.0.0-slim\n",
    });
    expect(appBun(d)).toEqual([
      { file: "Dockerfile", tag: BUN_VERSION, agrees: true, floats: false },
      { file: "deploy/Dockerfile", tag: "1", agrees: false, floats: true },
      { file: "deploy/Dockerfile.worker", tag: "1.0.0-slim", agrees: false, floats: false },
    ]);
  });

  test("an ARG the FROM reads is followed to its value", () => {
    const d = app({ "Dockerfile": `ARG BUN_VERSION=${BUN_VERSION}\nFROM oven/bun:\${BUN_VERSION} AS base\n` });
    expect(appBun(d)).toEqual([{ file: "Dockerfile", tag: BUN_VERSION, agrees: true, floats: false }]);
  });

  test("an application with no Dockerfile of its own gets no row", () => {
    expect(appBun(app({ "spec.json": "{}" }))).toEqual([]);
  });
});
