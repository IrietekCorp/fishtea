import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../theme.ts";
import { Hints, Spinner, truncate, wrap } from "../components/ui.tsx";
import { SelectList, type Option } from "../components/select.tsx";
import { TextField } from "../components/input.tsx";
import { database } from "../lib/app-state.ts";
import { useCtx } from "../lib/ctx.ts";

type Tab = "visitors" | "unmet" | "actions";
type Mode = { at: "list" } | { at: "trail"; visitorId: string } | { at: "notify"; visitorId: string };

export function Conversations() {
  const { core, toast, busy } = useCtx();
  const [tab, setTab] = useState<Tab>("visitors");
  const [mode, setMode] = useState<Mode>({ at: "list" });
  const [rows, setRows] = useState<any[] | null>(null);
  const [turns, setTurns] = useState<any[] | null>(null);

  const load = async () => {
    setRows(null);
    const db = database();
    if (!db) return setRows([]);
    try {
      // The action log: every turn with what it did, newest first. The refusals are the point — a log
      // of what worked says much less than one showing where the gate turned somebody away, where the
      // classifier gave up, and where a plan failed.
      if (tab === "actions") {
        setRows(await db.unsafe(`SELECT t.at, t.shape, t.kind, t.confidence, t.answered, t.latency_ms,
             t.utterance ->> 'persona' AS persona, t.provenance ->> 'unmet' AS unmet,
             tr.visitor_id
           FROM conversation.turn t JOIN conversation.trail tr ON tr.id = t.trail_id
           ORDER BY t.at DESC LIMIT 200`));
        return;
      }
      setRows(tab === "visitors"
        ? await db.unsafe(`SELECT v.id, v.customer_id, v.last_seen,
             (SELECT count(*)::int FROM conversation.trail t WHERE t.visitor_id = v.id) AS trails,
             (SELECT count(*)::int FROM conversation.turn tu JOIN conversation.trail t ON t.id = tu.trail_id WHERE t.visitor_id = v.id) AS turns,
             (SELECT tu.shape FROM conversation.turn tu JOIN conversation.trail t ON t.id = tu.trail_id WHERE t.visitor_id = v.id AND tu.shape IS NOT NULL ORDER BY tu.at DESC LIMIT 1) AS last_shape
           FROM conversation.visitor v ORDER BY v.last_seen DESC LIMIT 200`)
        : await db.unsafe(`SELECT at, asked, campaign, visitor_id FROM conversation.unmet ORDER BY at DESC LIMIT 200`));
    } catch (e) { setRows([]); toast((e as Error).message.split("\n")[0], "bad"); }
  };
  useEffect(() => { void load(); }, [tab]);

  useInput((input, key) => {
    if (mode.at !== "list") return;
    const TABS: Tab[] = ["visitors", "unmet", "actions"];
    if (input === "\t" || key.rightArrow) return setTab((t) => TABS[(TABS.indexOf(t) + 1) % TABS.length]);
    if (key.leftArrow) return setTab((t) => TABS[(TABS.indexOf(t) + TABS.length - 1) % TABS.length]);
    if (input === "r") return void load();
  }, { isActive: mode.at === "list" });

  if (mode.at === "notify") {
    return (
      <Box flexDirection="column">
        <Text color={theme.dim}>notify <Text color={theme.accent}>{mode.visitorId}</Text> — arrives as a turn, live over SSE if they are connected</Text>
        <Box marginTop={1}>
          <TextField label="›" placeholder="Your order shipped early" onCancel={() => setMode({ at: "trail", visitorId: mode.visitorId })}
            onSubmit={async (text) => {
              if (!text.trim()) return setMode({ at: "trail", visitorId: mode.visitorId });
              try { const r = await busy("queueing", () => core.notify(mode.visitorId, text)); toast(r.delivered ? "delivered over SSE" : "queued; delivered on their next visit", "ok"); }
              catch (e) { toast((e as Error).message, "bad"); }
              setMode({ at: "trail", visitorId: mode.visitorId });
            }} />
        </Box>
      </Box>
    );
  }

  if (mode.at === "trail") {
    return <Trail visitorId={mode.visitorId} turns={turns} onBack={() => { setTurns(null); setMode({ at: "list" }); }} onNotify={() => setMode({ at: "notify", visitorId: mode.visitorId })} />;
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Tabs tab={tab} />
        <Text color={theme.dim}>  tab switches</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {rows === null ? <Spinner label="reading the trail store" /> : rows.length === 0 ? (
          <Text color={theme.dim}>{tab === "visitors" ? "no visitors yet — run a conversation first (bun run headless, or the UI)" : tab === "actions" ? "no turns yet — the log fills as people talk to it" : "nothing unmet: every question was answered"}</Text>
        ) : tab === "visitors" ? (
          <SelectList rows={12} options={rows.map<Option<string>>((v) => ({
            value: v.id, label: v.id,
            badge: v.customer_id ? "known" : "anon ",
            badgeColor: v.customer_id ? theme.ok : theme.dim,
            hint: `${v.turns} turns · ${v.trails} trails${v.last_shape ? ` · last ${v.last_shape}` : ""} · ${new Date(v.last_seen).toISOString().slice(0, 16).replace("T", " ")}`,
          }))} onSelect={async (o) => {
            const db = database();
            setMode({ at: "trail", visitorId: o.value });
            if (db) setTurns(await db.unsafe(`SELECT tu.seq, tu.author, tu.kind, tu.shape, tu.confidence, tu.answered, tu.latency_ms, tu.utterance, tu.at
              FROM conversation.turn tu JOIN conversation.trail t ON t.id = tu.trail_id WHERE t.visitor_id = $1 ORDER BY tu.at DESC LIMIT 60`, [o.value]));
          }} />
        ) : tab === "actions" ? (
          <Box flexDirection="column">
            {rows.slice(0, 14).map((a, i) => (
              <Box key={i}>
                <Text color={theme.dim}>{new Date(a.at).toISOString().slice(11, 19)} </Text>
                <Text color={a.answered === false ? theme.warn : theme.ok}>{(a.answered === false ? "✗" : "✓")} </Text>
                <Text color={theme.text}>{String(a.shape ?? "—").padEnd(18).slice(0, 18)}</Text>
                <Text color={theme.dim}>{String(a.kind ?? "").padEnd(14).slice(0, 14)}</Text>
                <Text color={theme.dim}>{String(a.persona ?? "").padEnd(13).slice(0, 13)}</Text>
                <Text color={theme.dim}>{a.confidence != null ? Number(a.confidence).toFixed(2) : "    "} </Text>
                <Text color={theme.dim}>{a.latency_ms != null ? `${a.latency_ms}ms`.padStart(7) : ""}</Text>
                {a.unmet ? <Text color={theme.warn}>  {a.unmet}</Text> : null}
              </Box>
            ))}
            <Box marginTop={1}><Text color={theme.dim}>{rows.length} turns · ✗ is a turn the system declined or could not answer</Text></Box>
          </Box>
        ) : (
          <Box flexDirection="column">
            {rows.slice(0, 14).map((u, i) => (
              <Box key={i}>
                <Text color={theme.dim}>{new Date(u.at).toISOString().slice(5, 16).replace("T", " ")}  </Text>
                <Text>{truncate(u.asked ?? "(chip)", 62)}</Text>
                {u.campaign ? <Text color={theme.dim}>  ← {u.campaign}</Text> : null}
              </Box>
            ))}
            {rows.length > 14 ? <Text color={theme.dim}>  … {rows.length - 14} more</Text> : null}
            <Box marginTop={1}><Text color={theme.dim}>This is the vendor channel: what people asked for that the spec could not answer.</Text></Box>
          </Box>
        )}
      </Box>
      <Box marginTop={1}><Hints pairs={[["tab", "switch"], ["r", "refresh"], ...(tab === "visitors" ? [["⏎", "open the trail"] as [string, string]] : [])]} /></Box>
    </Box>
  );
}

const Tabs = ({ tab }: { tab: Tab }) => (
  <Text>
    <Text color={tab === "visitors" ? theme.accent : theme.dim} bold={tab === "visitors"}>visitors</Text>
    <Text color={theme.dim}> │ </Text>
    <Text color={tab === "unmet" ? theme.accent : theme.dim} bold={tab === "unmet"}>unmet</Text>
    <Text color={theme.dim}>  ·  </Text>
    <Text color={tab === "actions" ? theme.accent : theme.dim} bold={tab === "actions"}>actions</Text>
  </Text>
);

function Trail({ visitorId, turns, onBack, onNotify }: { visitorId: string; turns: any[] | null; onBack: () => void; onNotify: () => void }) {
  useInput((input, key) => { if (key.escape) return onBack(); if (input === "n") return onNotify(); });
  return (
    <Box flexDirection="column">
      <Text color={theme.dim}>trail of <Text color={theme.accent}>{visitorId}</Text> — newest first</Text>
      <Box marginTop={1} flexDirection="column">
        {turns === null ? <Spinner label="loading turns" /> : turns.length === 0 ? <Text color={theme.dim}>no turns</Text> : turns.slice(0, 16).map((t) => {
          const u = t.utterance ?? {};
          const said = u.text ? `"${truncate(u.text, 44)}"` : u.shape ? `[${u.shape}]` : u.arrive ? "(arrived)" : u.notification ? `(notification)` : u.resumedFrom ? "(resumed)" : "";
          return (
            <Box key={t.seq}>
              <Text color={theme.dim}>{String(t.seq).padStart(3)} </Text>
              <Text color={t.author === "visitor" ? undefined : theme.dim}>{t.author.padEnd(8)}</Text>
              <Text color={t.kind === "answer" ? theme.ok : t.kind === "confirm-write" ? theme.write : t.kind === "ask" ? theme.warn : theme.dim}>{String(t.kind).padEnd(14)}</Text>
              <Text>{said.padEnd(48)}</Text>
              <Text color={theme.dim}>{t.shape ? `→ ${t.shape}` : ""}{t.confidence != null ? ` ${Number(t.confidence).toFixed(2)}` : ""}{t.answered === false ? " unmet" : ""}</Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}><Hints pairs={[["n", "send a notification"], ["esc", "back"]]} /></Box>
    </Box>
  );
}
