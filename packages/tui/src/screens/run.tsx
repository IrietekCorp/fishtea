import { selfCommand } from "../lib/scaffolder.ts";
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { migrate, seed } from "@fishtea/core";
import { theme } from "../theme.ts";
import { Hints, truncate } from "../components/ui.tsx";
import { SelectList, type Option } from "../components/select.tsx";
import { Confirm } from "../components/input.tsx";
import { database } from "../lib/app-state.ts";
import { run } from "../lib/core.ts";
import { useCtx } from "../lib/ctx.ts";

interface Action { value: string; label: string; hint: string; confirm?: string; danger?: boolean }

export function Run() {
  const { snap, dir, core, toast, refresh, busy, suspend } = useCtx();
  const [out, setOut] = useState<string[]>([]);
  const [pending, setPending] = useState<Action | null>(null);
  const log = (s: string) => setOut((o) => [...o.slice(-200), ...s.split("\n")]);

  const actions: Action[] = [
    { value: "migrate", label: "Migrate", hint: `apply the entities section to Postgres${snap.db.drifted ? " — drifted, needed" : " (additive)"}` },
    { value: "migrate-destructive", label: "Migrate, allowing drops", hint: "also drop columns and tables that left the spec", confirm: "Drop columns and tables that are no longer in the spec?", danger: true },
    { value: "seed", label: "Seed", hint: "upsert seed/*.json into the business tables" },
    { value: "reload", label: "Reload the core's spec", hint: "hot-reload without restarting (non-entity sections)" },
    { value: "restart", label: "Restart the core", hint: "op.restart; Compose brings it back" },
    { value: "up", label: "Compose up", hint: "build and start db + classifier + core + ui" },
    { value: "stop", label: "Compose stop", hint: "pause the stack; start brings it back untouched" },
    { value: "start", label: "Compose start", hint: "resume a stopped stack" },
    { value: "down", label: "Compose down", hint: "stop and remove the containers; the data volume is kept" },
    { value: "down-v", label: "Compose down, deleting data", hint: "also drops the volume: every conversation and row goes", confirm: "Delete the database volume? Every conversation and every row goes.", danger: true },
    { value: "ps", label: "Compose ps", hint: "what is running" },
    { value: "logs", label: "Compose logs (core)", hint: "opens a follower; q to come back" },
    { value: "headless", label: "Headless walkthrough", hint: "run scripts/walkthrough.json and print every pour" },
    { value: "bench", label: "Bench", hint: "latency budgets against the running core" },
  ];

  const perform = async (a: Action) => {
    setOut([]);
    const app = snap.app;
    const compose = (args: string[]) => busy(`docker compose ${args[0]}`, () => run(["docker", "compose", ...args], { cwd: dir, env: { FISHTEA_HOME: process.env.FISHTEA_HOME ?? "" } }));
    try {
      switch (a.value) {
        case "migrate": case "migrate-destructive": {
          const db = database();
          if (!db || !app) return toast("need DATABASE_URL and a valid spec", "bad");
          const r = await busy("migrating", () => migrate(db, app, { allowDestructive: a.value.endsWith("destructive"), log }));
          log(`created ${r.created.length} · added ${r.added.length} · dropped ${r.dropped.length}${r.refused.length ? ` · refused ${r.refused.join(", ")}` : ""}`);
          toast(r.refused.length ? `migrated; refused ${r.refused.length} destructive changes` : "migrated", r.refused.length ? "warn" : "ok");
          await refresh();
          break;
        }
        case "seed": {
          const db = database();
          if (!db || !app) return toast("need DATABASE_URL and a valid spec", "bad");
          const counts = await busy("seeding", () => seed(db, app, { log }));
          toast(`seeded ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ") || "nothing"}`, "ok");
          await refresh();
          break;
        }
        case "reload": { const r = await busy("reloading", () => core.reload()); log(JSON.stringify(r)); toast(`core reloaded → v${r.version}`, "ok"); break; }
        case "restart": { await core.op("op.restart"); toast("restart requested", "ok"); setTimeout(() => void refresh(), 1500); break; }
        case "up": { const r = await compose(["up", "-d", "--build"]); log(r.out); toast(r.code === 0 ? "stack up" : "compose failed", r.code === 0 ? "ok" : "bad"); await refresh(); break; }
        case "stop": { const r = await compose(["stop"]); log(r.out); toast("stack paused"); await refresh(); break; }
        case "start": { const r = await compose(["start"]); log(r.out); toast(r.code === 0 ? "stack resumed" : "compose failed", r.code === 0 ? "ok" : "bad"); await refresh(); break; }
        case "down": { const r = await compose(["down"]); log(r.out); toast("stack down; data kept"); await refresh(); break; }
        case "down-v": { const r = await compose(["down", "-v"]); log(r.out); toast("stack down; data deleted", "warn"); await refresh(); break; }
        case "ps": { const r = await compose(["ps"]); log(r.out || "nothing running"); break; }
        case "logs":
          await suspend(async () => { const p = Bun.spawn(["docker", "compose", "logs", "-f", "--tail", "80", "core"], { cwd: dir, stdio: ["inherit", "inherit", "inherit"] }); await p.exited; });
          break;
        case "headless": {
          const home = process.env.FISHTEA_HOME!;
          await suspend(async () => {
            const p = Bun.spawn([...selfCommand(home), "headless", "--app", dir], { stdio: ["inherit", "inherit", "inherit"], env: { ...process.env, FISHTEA_APP: dir } });
            await p.exited;
            const wait = Bun.spawn(["bash", "-c", "read -n1 -s -r -p '\\n[any key to return to the console]'"], { stdio: ["inherit", "inherit", "inherit"] });
            await wait.exited;
          });
          break;
        }
        case "bench": {
          const home = process.env.FISHTEA_HOME!;
          await suspend(async () => {
            const p = Bun.spawn([...selfCommand(home), "bench", "--app", dir, "--no-fail"], { stdio: ["inherit", "inherit", "inherit"], env: { ...process.env, FISHTEA_APP: dir } });
            await p.exited;
            const wait = Bun.spawn(["bash", "-c", "read -n1 -s -r -p '\\n[any key to return to the console]'"], { stdio: ["inherit", "inherit", "inherit"] });
            await wait.exited;
          });
          break;
        }
      }
    } catch (e) { log(String((e as Error).message)); toast((e as Error).message.split("\n")[0], "bad"); }
  };

  useInput((input) => { if (input === "c") setOut([]); }, { isActive: !pending });

  if (pending) {
    return (
      <Box flexDirection="column">
        <Text color={theme.warn}>{pending.confirm}</Text>
        <Box marginTop={1}><Confirm message="" initial={false} onAnswer={(yes) => { const a = pending; setPending(null); if (yes) void perform(a); }} /></Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <SelectList rows={13} filterable={false} options={actions.map<Option<string>>((a) => ({ value: a.value, label: a.label, hint: a.hint, badge: a.danger ? "!" : undefined, badgeColor: theme.bad }))}
        onSelect={(o) => { const a = actions.find((x) => x.value === o.value)!; if (a.confirm) setPending(a); else void perform(a); }} />
      {out.length ? (
        <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor={theme.dim} paddingX={1}>
          {out.slice(-8).map((l, i) => <Text key={i} color={theme.dim}>{truncate(l, 96)}</Text>)}
        </Box>
      ) : null}
      <Box marginTop={1}><Hints pairs={[["⏎", "run"], ["c", "clear output"]]} /></Box>
    </Box>
  );
}
