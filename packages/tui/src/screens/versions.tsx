/**
 * Versions — what is running, what else is installed, and how this application stands against it.
 *
 * The point of this screen is to make "am I current?" and "put it back" answerable without leaving the
 * application directory. Before it existed the answer lived in two other places — a framework checkout
 * you had to cd into, and a package.json you had to read — which is exactly the juggling that made people
 * avoid upgrading at all.
 *
 * Nothing here is implicit. Switching the framework never touches an application; updating an application
 * shows its plan first and applies it only on a second keypress. Both are reported in the same words the
 * CLI uses, so what you learn here transfers.
 */
import React, { useCallback, useEffect, useState } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Box, Text } from "ink";
import { FISHTEA_VERSION, SPEC_FORMAT, checkCompatibility } from "@fishtea/spec";
import { theme } from "../theme.ts";
import { Field, Hints, truncate } from "../components/ui.tsx";
import { SelectList, type Option } from "../components/select.tsx";
import { Confirm } from "../components/input.tsx";
import { useCtx } from "../lib/ctx.ts";
// Reached by path rather than by package name on purpose: @fishtea/cli already depends on @fishtea/tui,
// so naming it here would declare a cycle. These three modules are pure application-management logic with
// no import back into the CLI's entrypoint, so nothing actually cycles at runtime.
import {
  currentVersion, installRoot, installedVersions, shimOnPath, useVersion, type InstalledVersion,
} from "../../../cli/src/runtime.ts";
import { applyUpdate, planUpdate, renderPlan, type UpdatePlan } from "../../../cli/src/update.ts";
import { readManifest } from "../../../cli/src/manifest.ts";

type Mode = { t: "menu" } | { t: "pickVersion" } | { t: "plan"; plan: UpdatePlan } | { t: "confirmSwitch"; version: string };

export function Versions() {
  const { dir, fishteaHome, toast, refresh, busy } = useCtx();
  const [mode, setMode] = useState<Mode>({ t: "menu" });
  const [versions, setVersions] = useState<InstalledVersion[]>([]);
  const [out, setOut] = useState<string[]>([]);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => {
    try { setVersions(installedVersions()); } catch { setVersions([]); }
    setTick((n) => n + 1);
  }, []);
  useEffect(reload, [reload]);

  // Where this application stands. Read fresh on every tick so an applied update shows immediately.
  const [app, setApp] = useState<{ pin?: string; specFormat?: string; template?: string; generatedBy?: string }>({});
  useEffect(() => {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      const spec = JSON.parse(readFileSync(join(dir, "spec.json"), "utf8"));
      const m = readManifest(dir);
      setApp({ pin: pkg.fishtea?.version, specFormat: spec.fishtea, template: m?.template ?? pkg.fishtea?.template, generatedBy: m?.fishtea });
    } catch { setApp({}); }
  }, [dir, tick]);

  const compat = checkCompatibility(app.pin);
  const installedHere = currentVersion();
  const onPath = shimOnPath();

  const actions: Option<string>[] = [
    {
      value: "plan",
      label: "Update this application",
      hint: app.specFormat === SPEC_FORMAT ? "reconcile its files with the archetype" : `spec format ${app.specFormat} → ${SPEC_FORMAT}, and reconcile its files`,
    },
    { value: "switch", label: "Switch framework version", hint: versions.length > 1 ? `${versions.length} installed` : "only one installed — fishtea upgrade installs more", disabled: versions.length < 2 },
    { value: "refresh", label: "Re-read", hint: "pick up a version installed from another terminal" },
  ];

  const showPlan = async () => {
    try {
      const plan = await busy("planning", async () => planUpdate(dir, fishteaHome));
      setOut(renderPlan(plan).split("\n"));
      setMode({ t: "plan", plan });
    } catch (e) { toast((e as Error).message, "bad"); }
  };

  const apply = async (plan: UpdatePlan) => {
    try {
      const r = await busy("updating", async () => applyUpdate(plan));
      setOut((o) => [...o, "", `wrote ${r.wrote.length} files${r.specMigrated ? ", migrated the spec" : ""}`,
        ...(r.conflicts.length ? ["", "conflicting — yours kept, theirs beside it:", ...r.conflicts.map((c) => `  ${c}.new`)] : [])]);
      toast(r.conflicts.length ? `updated; ${r.conflicts.length} to resolve by hand` : "updated", r.conflicts.length ? "warn" : "ok");
      setMode({ t: "menu" });
      reload();
      await refresh();
    } catch (e) { toast((e as Error).message, "bad"); }
  };

  const switchTo = (version: string) => {
    try {
      useVersion(version);
      reload();
      toast(`now running ${version} — restart the console to load it`, "warn");
      setMode({ t: "menu" });
    } catch (e) { toast((e as Error).message, "bad"); }
  };

  return (
    <Box flexDirection="column" gap={0}>
      <Box flexDirection="column">
        <Field label="running" value={
          <Text>
            <Text bold color={theme.accent}>{FISHTEA_VERSION}</Text>
            <Text color={theme.dim}>{`  spec format ${SPEC_FORMAT}`}</Text>
            {installedHere && installedHere !== FISHTEA_VERSION
              ? <Text color={theme.warn}>{`  (installed current is ${installedHere}; this console is a checkout)`}</Text>
              : null}
          </Text>
        } />
        <Field label="home" value={<Text color={theme.dim}>{truncate(fishteaHome, 60)}</Text>} />
        {versions.length && !onPath
          ? <Field label="path" value={<Text color={theme.warn}>{`${installRoot()}/bin is not on PATH`}</Text>} />
          : null}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold color={theme.dim}>this application</Text>
        <Field label="archetype" value={<Text>{app.template ?? <Text color={theme.dim}>unknown</Text>}</Text>} />
        <Field label="pins" value={
          app.pin
            ? <Text>{app.pin} <Text color={compat.ok ? theme.ok : theme.bad}>{compat.ok ? "✓ satisfied" : "✗ not satisfied"}</Text></Text>
            : <Text color={theme.dim}>nothing</Text>
        } />
        <Field label="spec format" value={
          <Text>
            {app.specFormat ?? "?"}
            {app.specFormat && app.specFormat !== SPEC_FORMAT ? <Text color={theme.warn}>{`  → ${SPEC_FORMAT} available`}</Text> : null}
          </Text>
        } />
        <Field label="generated by" value={<Text color={theme.dim}>{app.generatedBy ?? "unknown — no manifest"}</Text>} />
      </Box>

      <Box marginTop={1} flexDirection="column" flexGrow={1}>
        {mode.t === "menu" ? (
          <>
            <SelectList options={actions} rows={4} filterable={false} onSelect={(o) => {
              if (o.value === "plan") return void showPlan();
              if (o.value === "switch") return setMode({ t: "pickVersion" });
              reload();
              toast("re-read");
            }} />
            {out.length ? <Box marginTop={1} flexDirection="column">{out.slice(-8).map((l, i) => <Text key={i} color={theme.dim}>{truncate(l, 96)}</Text>)}</Box> : null}
          </>
        ) : mode.t === "pickVersion" ? (
          <>
            <Text color={theme.dim}>Switching the framework never touches an application.</Text>
            <SelectList
              rows={8}
              filterable={false}
              options={versions.map((v) => ({
                value: v.version,
                label: v.version,
                hint: v.current ? "current" : truncate(v.dir, 54),
                badge: v.current ? "running" : undefined,
                badgeColor: theme.accent,
              }))}
              onCancel={() => setMode({ t: "menu" })}
              onSelect={(o) => (o.value === currentVersion() ? setMode({ t: "menu" }) : setMode({ t: "confirmSwitch", version: o.value }))}
            />
          </>
        ) : mode.t === "confirmSwitch" ? (
          <Confirm
            message={`Switch to ${mode.version}? (this console keeps running the version it started with)`}
            onAnswer={(yes) => (yes ? switchTo(mode.version) : setMode({ t: "menu" }))}
          />
        ) : (
          <>
            <Box flexDirection="column" marginBottom={1}>
              {out.map((l, i) => <Text key={i}>{truncate(l, 96)}</Text>)}
            </Box>
            {mode.plan.clean
              ? <Confirm message="Nothing to do. Back to the menu?" onAnswer={() => setMode({ t: "menu" })} />
              : <Confirm message="Apply this? Files you changed are never overwritten." onAnswer={(yes) => (yes ? void apply(mode.plan) : setMode({ t: "menu" }))} />}
          </>
        )}
      </Box>

      <Hints pairs={mode.t === "menu" ? [["↑↓", "move"], ["⏎", "choose"]] : [["y/n", "answer"], ["esc", "back"]]} />
    </Box>
  );
}
