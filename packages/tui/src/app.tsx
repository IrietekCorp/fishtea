import type { Scaffolder } from "./lib/scaffolder.ts";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdin, useStdout } from "ink";
import { theme, SCREENS, type ScreenId } from "./theme.ts";
import { Dot, Hints, Spinner } from "./components/ui.tsx";
import { AppCtx, LockCtx, type Ctx } from "./lib/ctx.ts";
import { Core } from "./lib/core.ts";
import { EMPTY, snapshot, type Snapshot } from "./lib/app-state.ts";
import { Dashboard } from "./screens/dashboard.tsx";
import { SpecScreen } from "./screens/spec.tsx";
import { Conversations } from "./screens/conversations.tsx";
import { Run } from "./screens/run.tsx";
import { Onboard } from "./screens/onboard.tsx";
import { Versions } from "./screens/versions.tsx";

const ALT_ON = "\x1b[?1049h", ALT_OFF = "\x1b[?1049l";

export function App({ dir, fishteaHome, core, scaffolder, onExit }: { dir: string; fishteaHome: string; core: Core; scaffolder: Scaffolder; onExit: () => void }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { stdin, setRawMode } = useStdin();
  const [screen, setScreen] = useState<ScreenId>("dashboard");
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [toastMsg, setToastMsg] = useState<{ text: string; tone: "ok" | "warn" | "bad" } | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [locks, setLocks] = useState(0);
  const [suspended, setSuspended] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const refresh = useCallback(async () => { setSnap(await snapshot(dir, core)); }, [dir, core]);
  useEffect(() => { void refresh(); const t = setInterval(() => { void refresh(); }, 5000); return () => clearInterval(t); }, [refresh]);

  const toast = useCallback((text: string, tone: "ok" | "warn" | "bad" = "ok") => {
    setToastMsg({ text, tone });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 6000);
  }, []);

  const busy = useCallback(async <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
    setBusyLabel(label);
    try { return await fn(); } finally { setBusyLabel(null); }
  }, []);

  const suspend = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setSuspended(true);
    stdout.write(ALT_OFF);
    setRawMode(false);
    try { return await fn(); }
    finally { setRawMode(true); stdout.write(ALT_ON); setSuspended(false); void refresh(); }
  }, [stdout, setRawMode, refresh]);

  const quit = useCallback(() => { onExit(); exit(); }, [exit, onExit]);
  const lockApi = useMemo(() => ({ push: () => setLocks((n) => n + 1), pop: () => setLocks((n) => Math.max(0, n - 1)) }), []);
  const ctx: Ctx = useMemo(() => ({ dir, fishteaHome, core, scaffolder, snap, refresh, toast, suspend, busy, quit }), [dir, fishteaHome, core, scaffolder, snap, refresh, toast, suspend, busy, quit]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") return quit();
    if (locks > 0) return;
    const hit = SCREENS.find((s) => s.key === input);
    if (hit) return setScreen(hit.id);
    if (input === "q") return quit();
    if (input === "r") { void refresh(); return toast("refreshed"); }
    // tab is deliberately not a global: screens use it for their own tabs (conversations), and a key that
    // means two things is worse than one more number.
  }, { isActive: !suspended });

  if (suspended) return null;
  const spec = snap.app?.spec;
  const width = Math.max(60, Math.min(stdout.columns ?? 100, 120));

  return (
    <LockCtx.Provider value={lockApi}>
      <AppCtx.Provider value={ctx}>
        <Box flexDirection="column" width={width}>
          <Box borderStyle="round" borderColor={theme.accent} paddingX={1} flexDirection="column">
            <Box justifyContent="space-between">
              <Text bold color={theme.accent}>fishtea{spec ? <Text color={theme.text}> · {spec.business.name}</Text> : null}</Text>
              <Text color={theme.dim}>{snap.specError ? <Text color={theme.bad}>spec invalid</Text> : spec ? `v${spec.business.version}` : "no spec"}</Text>
            </Box>
            <Box gap={2}>
              <Dot state={snap.health ? "ok" : "bad"} label={snap.health ? `core :${new URL(core.url).port || "80"}` : "core down"} />
              <Dot state={snap.pool?.ok ? (snap.pool.warming ? "warn" : "ok") : snap.health?.classifier?.name === "lexical" ? "warn" : "bad"}
                label={snap.pool?.ok ? `needle3 ${snap.pool.ready}/${snap.pool.workers}` : snap.health?.classifier?.name === "lexical" ? "lexical (dev)" : "no classifier"} />
              <Dot state={snap.db.ok ? (snap.db.drifted ? "warn" : "ok") : "bad"} label={snap.db.ok ? `db ${snap.db.turns} turns${snap.db.drifted ? " · drifted" : ""}` : "db down"} />
            </Box>
          </Box>

          <Box paddingX={1}>
            {SCREENS.map((s) => (
              <Text key={s.id}>
                <Text color={s.id === screen ? theme.accent : theme.dim} bold={s.id === screen}>{s.id === screen ? "▌" : " "}{s.key} {s.label}</Text>
                <Text> </Text>
              </Text>
            ))}
          </Box>

          <Box borderStyle="round" borderColor={theme.dim} paddingX={1} paddingY={0} flexDirection="column" minHeight={16}>
            {screen === "dashboard" ? <Dashboard /> : screen === "spec" ? <SpecScreen /> : screen === "conversations" ? <Conversations /> : screen === "run" ? <Run /> : screen === "onboard" ? <Onboard /> : <Versions />}
          </Box>

          <Box paddingX={1} justifyContent="space-between">
            <Box>
              {busyLabel ? <Spinner label={busyLabel} /> : toastMsg
                ? <Text color={toastMsg.tone === "ok" ? theme.ok : toastMsg.tone === "warn" ? theme.warn : theme.bad}>{toastMsg.tone === "bad" ? "✗" : "✓"} {toastMsg.text}</Text>
                : <Hints pairs={[["1–6", "screens"], ["r", "refresh"], ["q", "quit"], ["ctrl+c", "exit"]]} />}
            </Box>
            <Text color={theme.dim}>{snap.at ? new Date(snap.at).toISOString().slice(11, 19) : ""}</Text>
          </Box>
        </Box>
      </AppCtx.Provider>
    </LockCtx.Provider>
  );
}

export { ALT_ON, ALT_OFF };
