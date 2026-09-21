import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SECTIONS, SpecError, applySectionPatch, leaves, pathPatch, entities as specEntities, calls as specCalls, shapes as specShapes, deriveTools, deriveDDL, vesselFor } from "@fishtea/spec";
import { theme } from "../theme.ts";
import { Hints, truncate, wrap } from "../components/ui.tsx";
import { SelectList, type Option } from "../components/select.tsx";
import { TextField } from "../components/input.tsx";
import { Form, type Question } from "../components/form.tsx";
import { useCtx } from "../lib/ctx.ts";

type Mode = { at: "sections" } | { at: "members"; section: string } | { at: "detail"; section: string; member: string } | { at: "leaf"; section: string; member?: string } | { at: "editing"; section: string; path: string; value: unknown } | { at: "addShape"; section: string };

const META = new Set(["version", "doc"]);
const membersOf = (section: any): string[] => Object.keys(section ?? {}).filter((k) => !META.has(k));

export function SpecScreen() {
  const { snap, dir, toast, refresh, suspend, busy, core } = useCtx();
  const [mode, setMode] = useState<Mode>({ at: "sections" });
  const app = snap.app;
  const spec: any = app?.spec;

  const afterWrite = async (what: string) => {
    await refresh();
    const h = await core.health();
    if (h) { try { await busy("reloading core", () => core.reload()); toast(`${what} · core reloaded`, "ok"); } catch { toast(`${what} · core will pick it up from the file watcher`, "warn"); } }
    else toast(`${what} · core is offline, it will load on start`, "warn");
  };

  const patch = async (section: string, body: unknown, opts: { replace?: boolean } = {}) => {
    try {
      const r = applySectionPatch(app!.specPath, section, body, { ...opts, dir });
      await afterWrite(`${section} → v${r.version}`);
      return true;
    } catch (e) {
      toast(e instanceof SpecError ? `refused: ${e.problems[0]}` : (e as Error).message, "bad");
      return false;
    }
  };

  const openEditor = async (section: string) => {
    const editor = process.env.EDITOR ?? process.env.VISUAL ?? "vi";
    const tmp = mkdtempSync(join(tmpdir(), "fishtea-"));
    const file = join(tmp, `${section}.json`);
    writeFileSync(file, JSON.stringify(spec[section] ?? { version: "2026.01.01-1" }, null, 2) + "\n");
    const edited = await suspend(async () => {
      const proc = Bun.spawn([editor, file], { stdio: ["inherit", "inherit", "inherit"] });
      await proc.exited;
      return readFileSync(file, "utf8");
    });
    rmSync(tmp, { recursive: true, force: true });
    try { await patch(section, JSON.parse(edited), { replace: true }); }
    catch { toast(`${section}: that isn't valid JSON, nothing written`, "bad"); }
  };

  if (!app) return <Box flexDirection="column"><Text color={theme.bad}>spec.json is invalid or missing.</Text>{(snap.specError ?? "").split("\n").slice(0, 8).map((l, i) => <Text key={i} color={theme.bad}>  {truncate(l, 96)}</Text>)}<Box marginTop={1}><EditRaw dir={dir} suspend={suspend} refresh={refresh} toast={toast} /></Box></Box>;

  if (mode.at === "sections") {
    const options: Option<string>[] = SECTIONS.filter((s) => spec[s]).map((s) => {
      const sec = spec[s];
      const n = s === "operator" ? Object.keys(sec.shapes ?? {}).length : s === "envelope" ? sec.accept.length : s === "business" ? Object.keys(sec).length - 1 : membersOf(sec).length;
      return { value: s, label: s, badge: `v${sec.version ?? "-"}`, hint: `${n} ${s === "envelope" ? "accepted keys" : s === "business" ? "fields" : "entries"} · ${(app.hashes as any)[s]?.slice(0, 8) ?? ""}` };
    });
    return (
      <Box flexDirection="column">
        <SelectList options={options} rows={10} onSelect={(o) => setMode({ at: "members", section: o.value })} />
        <Box marginTop={1}><Hints pairs={[["⏎", "open"], ["e", "$EDITOR"], ["v", "edit a value"], ["d", "derived DDL"], ["t", "tool list"]]} /></Box>
        <SectionKeys onEditor={openEditor} onLeaf={(s) => setMode({ at: "leaf", section: s })} onDerive={async (kind) => {
          const text = kind === "ddl" ? deriveDDL(spec) : JSON.stringify(deriveTools(spec), null, 2);
          await suspend(async () => { const p = Bun.spawn([process.env.PAGER ?? "less", "-R"], { stdin: "pipe", stdout: "inherit", stderr: "inherit" }); p.stdin.write(text); p.stdin.end(); await p.exited; });
        }} sections={SECTIONS.filter((s) => spec[s])} />
      </Box>
    );
  }

  if (mode.at === "members") {
    const sec = spec[mode.section];
    const names = mode.section === "operator" ? Object.keys(sec.shapes ?? {}) : membersOf(sec);
    const options: Option<string>[] = names.map((n) => ({ value: n, label: n, hint: describe(mode.section, n, sec, spec), badge: badgeFor(mode.section, n, sec), badgeColor: badgeFor(mode.section, n, sec) === "write" ? theme.write : theme.dim }));
    return (
      <Box flexDirection="column">
        <Text color={theme.dim}>spec › <Text color={theme.accent}>{mode.section}</Text> <Text color={theme.dim}>v{sec.version}</Text></Text>
        <Box marginTop={1}><SelectList options={options} rows={10} onCancel={() => setMode({ at: "sections" })} onSelect={(o) => setMode({ at: "detail", section: mode.section, member: o.value })} /></Box>
        <Box marginTop={1}><Hints pairs={[["⏎", "detail"], ["e", "$EDITOR"], ["v", "edit a value"], ...(mode.section === "shapes" ? [["a", "add a shape"] as [string, string]] : []), ["esc", "back"]]} /></Box>
        <MemberKeys onEditor={() => openEditor(mode.section)} onLeaf={() => setMode({ at: "leaf", section: mode.section })} onAdd={mode.section === "shapes" ? () => setMode({ at: "addShape", section: mode.section }) : undefined} onBack={() => setMode({ at: "sections" })} />
      </Box>
    );
  }

  if (mode.at === "detail") {
    const sec = mode.section === "operator" ? spec.operator.shapes : spec[mode.section];
    const value = sec[mode.member];
    return (
      <Box flexDirection="column">
        <Text color={theme.dim}>spec › {mode.section} › <Text color={theme.accent}>{mode.member}</Text></Text>
        <Box marginTop={1} flexDirection="column">
          {JSON.stringify(value, null, 2).split("\n").slice(0, 22).map((l, i) => <Text key={i} color={l.trim().startsWith('"') ? undefined : theme.dim}>{truncate(l, 100)}</Text>)}
        </Box>
        <Box marginTop={1}><Hints pairs={[["v", "edit a value here"], ["e", "$EDITOR on the section"], ["esc", "back"]]} /></Box>
        <MemberKeys onEditor={() => openEditor(mode.section)} onLeaf={() => setMode({ at: "leaf", section: mode.section, member: mode.member })} onBack={() => setMode({ at: "members", section: mode.section })} />
      </Box>
    );
  }

  if (mode.at === "leaf") {
    const sec = mode.section === "operator" ? spec.operator.shapes : spec[mode.section];
    const scope = mode.member ? { [mode.member]: sec[mode.member] } : sec;
    const all = leaves(scope);
    const options: Option<string>[] = all.map((l) => ({ value: l.path, label: l.path, hint: truncate(JSON.stringify(l.value), 60) }));
    return (
      <Box flexDirection="column">
        <Text color={theme.dim}>spec › {mode.section}{mode.member ? ` › ${mode.member}` : ""} › <Text color={theme.accent}>pick a value</Text></Text>
        <Box marginTop={1}><SelectList options={options} rows={12} onCancel={() => setMode(mode.member ? { at: "detail", section: mode.section, member: mode.member } : { at: "members", section: mode.section })}
          onSelect={(o) => setMode({ at: "editing", section: mode.section, path: o.value, value: all.find((l) => l.path === o.value)?.value })} /></Box>
        <Box marginTop={1}><Hints pairs={[["/", "filter"], ["⏎", "edit"], ["esc", "back"]]} /></Box>
      </Box>
    );
  }

  if (mode.at === "editing") {
    const back = () => setMode({ at: "leaf", section: mode.section });
    return (
      <Box flexDirection="column">
        <Text color={theme.dim}>spec › {mode.section} › <Text color={theme.accent}>{mode.path}</Text></Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.dim}>current <Text color={theme.text}>{JSON.stringify(mode.value)}</Text></Text>
          <Text color={theme.dim}>JSON, so strings need quotes.</Text>
          <Box marginTop={1}>
            <TextField label="›" initial={JSON.stringify(mode.value)} validate={(v) => { try { JSON.parse(v); return undefined; } catch { return "not JSON — strings need quotes"; } }}
              onCancel={back}
              onSubmit={async (v) => { const ok = await patch(mode.section, pathPatch(mode.path, JSON.parse(v))); if (ok) back(); }} />
          </Box>
        </Box>
      </Box>
    );
  }

  if (mode.at === "addShape") {
    const callNames = specCalls(spec).map(([n]) => n);
    const personaNames = Object.keys(spec.personas).filter((k) => !META.has(k));
    const questions: Question[] = [
      { id: "name", ask: "Shape name in camelCase. This is the route: the classifier picks it by name and description.", type: "string", default: "" },
      { id: "asks", ask: "What does it answer? One line. The classifier reads this as the tool description and the UI shows it on a chip.", type: "string", default: "" },
      { id: "call", ask: "Which call does the plan run?", type: "enum", values: callNames },
      { id: "allow", ask: "Which personas may use it?", type: "multi", values: personaNames, default: personaNames },
    ];
    return (
      <Box flexDirection="column">
        <Text color={theme.dim}>spec › shapes › <Text color={theme.accent}>new shape</Text></Text>
        <Box marginTop={1}>
          <Form questions={questions} onCancel={() => setMode({ at: "members", section: "shapes" })} onDone={async (a) => {
            const name = String(a.name).trim();
            if (!/^[a-z][A-Za-z0-9]*$/.test(name)) { toast("shape names are camelCase", "bad"); return setMode({ at: "members", section: "shapes" }); }
            const callDef: any = (spec.calls as any)[String(a.call)];
            const input: Record<string, string> = {}; const withMap: Record<string, unknown> = {};
            for (const [k, t] of Object.entries(callDef.in as Record<string, any>)) {
              const ts = typeof t === "string" ? t : t.type;
              if (/visitorid/i.test(k)) { withMap[k] = "$visitor.id"; continue; }
              input[k] = ts; withMap[k] = `$${k}`;
            }
            const shape = { asks: String(a.asks), input, answer: callDef.out, effect: callDef.kind === "mutation" ? "write" : "read", allow: a.allow, plan: [{ call: String(a.call), with: withMap }] };
            const ok = await patch("shapes", { [name]: shape });
            setMode(ok ? { at: "detail", section: "shapes", member: name } : { at: "members", section: "shapes" });
          }} />
        </Box>
      </Box>
    );
  }
  return null;
}

function describe(section: string, name: string, sec: any, spec: any): string {
  const v = section === "operator" ? sec.shapes[name] : sec[name];
  switch (section) {
    case "entities": return `${Object.keys(v.fields).length} fields: ${truncate(Object.keys(v.fields).join(", "), 60)}`;
    case "calls": return `${v.kind} · in ${Object.keys(v.in).join(",") || "—"} → ${typeof v.out === "string" ? v.out : "object"}`;
    case "shapes": case "operator": return `${v.allow?.join(",")} · ${truncate(v.asks, 54)}`;
    case "personas": return v.when;
    case "notifications": return `to ${v.to}: ${truncate(v.text, 56)}`;
    default: return truncate(JSON.stringify(v), 70);
  }
}
const badgeFor = (section: string, name: string, sec: any): string | undefined => {
  const v = section === "operator" ? sec.shapes[name] : sec[name];
  if (section === "shapes" || section === "operator") return v.effect === "write" ? "write" : "read ";
  if (section === "calls") return v.transaction ? "tx" : undefined;
  return undefined;
};

function SectionKeys({ onEditor, onLeaf, onDerive, sections }: { onEditor: (s: string) => void; onLeaf: (s: string) => void; onDerive: (k: "ddl" | "tools") => void; sections: readonly string[] }) {
  const [pick, setPick] = useState<null | "editor" | "leaf">(null);
  useInput((input) => {
    if (input === "e") return setPick("editor");
    if (input === "v") return setPick("leaf");
    if (input === "d") return onDerive("ddl");
    if (input === "t") return onDerive("tools");
  }, { isActive: !pick });
  if (!pick) return null;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.accent}>{pick === "editor" ? "open which section in $EDITOR?" : "edit a value in which section?"}</Text>
      <SelectList options={sections.map((s) => ({ value: s, label: s }))} rows={9} onCancel={() => setPick(null)}
        onSelect={(o) => { const fn = pick === "editor" ? onEditor : onLeaf; setPick(null); fn(o.value); }} />
    </Box>
  );
}

function MemberKeys({ onEditor, onLeaf, onAdd, onBack }: { onEditor: () => void; onLeaf: () => void; onAdd?: () => void; onBack: () => void }) {
  useInput((input, key) => {
    if (input === "e") return onEditor();
    if (input === "v") return onLeaf();
    if (input === "a" && onAdd) return onAdd();
    if (key.escape) return onBack();
  });
  return null;
}

function EditRaw({ dir, suspend, refresh, toast }: { dir: string; suspend: Ctxish["suspend"]; refresh: () => Promise<void>; toast: Ctxish["toast"] }) {
  useInput(async (input) => {
    if (input !== "e") return;
    const editor = process.env.EDITOR ?? process.env.VISUAL ?? "vi";
    await suspend(async () => { const p = Bun.spawn([editor, join(dir, "spec.json")], { stdio: ["inherit", "inherit", "inherit"] }); await p.exited; });
    await refresh();
    toast("reloaded spec.json from disk");
  });
  return <Hints pairs={[["e", "open spec.json in $EDITOR"]]} />;
}
type Ctxish = ReturnType<typeof useCtx>;
