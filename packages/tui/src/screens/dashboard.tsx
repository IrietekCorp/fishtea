import React from "react";
import { Box, Text, useStdout } from "ink";
import { theme } from "../theme.ts";
import { Dot, Field, truncate, wrap } from "../components/ui.tsx";
import { personas as specPersonas } from "@fishtea/spec";
import { useCtx } from "../lib/ctx.ts";

export function Dashboard() {
  const { snap, dir } = useCtx();
  const { stdout } = useStdout();
  const inner = Math.max(40, Math.min(stdout.columns ?? 100, 120) - 6);
  const body = inner - 17; // the label column
  const spec = snap.app?.spec;
  const cls = snap.health?.classifier;
  const poolWarming = snap.pool?.warming;
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold color={theme.accent}>services</Text>
        <Field label="core" value={snap.health
          ? <Dot state="ok" label={`up · ${snap.health.business} v${snap.health.version}${snap.health.strict ? " · strict" : ""} · ${snap.health.sse} live`} />
          : <Dot state="bad" label={truncate("down — start it with: bun run dev (or bun run up)", body)} />} />
        <Field label="classifier" value={snap.pool
          ? <Dot state={poolWarming ? "warn" : snap.pool.ok ? "ok" : "warn"} label={`${snap.pool.model} · ${snap.pool.ready}/${snap.pool.workers} workers · ${snap.pool.tools} tools · dim ${snap.pool.dim}${poolWarming ? " · warming" : ""}`} />
          : cls?.name === "lexical"
            ? <Dot state="warn" label={truncate("lexical (development harness; not the product)", body)} />
            : <Dot state="bad" label={truncate("pool unreachable — core pours ask on every text utterance", body)} />} />
        <Field label="database" value={snap.db.ok
          ? <Dot state={snap.db.drifted ? "warn" : "ok"} label={`${snap.db.turns} turns · ${snap.db.visitors} visitors · ${snap.db.unmet} unmet${snap.db.drifted ? " · entities drifted, migrate" : ""}`} />
          : <Dot state="bad" label={truncate(snap.db.error ?? "unreachable", body)} />} />
      </Box>

      <Box flexDirection="column">
        <Text bold color={theme.accent}>application</Text>
        {snap.specError ? (
          <Box flexDirection="column">
            <Text color={theme.bad}>spec.json is invalid</Text>
            {snap.specError.split("\n").slice(0, 6).map((l, i) => <Text key={i} color={theme.bad}>  {truncate(l, inner - 2)}</Text>)}
            <Text color={theme.dim}>  fix it on the Spec screen (e opens $EDITOR)</Text>
          </Box>
        ) : spec ? (
          <>
            <Field label="business" value={`${spec.business.name} (${spec.business.id}) · v${spec.business.version}`} />
            <Field label="ground" value={`${snap.counts.entities} entities · ${snap.counts.calls} calls · ${snap.counts.shapes} shapes · ${specPersonas(spec).length} personas`} />
            <Field label="directory" value={<Text color={theme.dim}>{truncate(dir, body)}</Text>} />
            {wrap(spec.business.doc ?? "", inner).slice(0, 3).map((l, i) => <Text key={i} color={theme.dim}>{l}</Text>)}
          </>
        ) : <Text color={theme.dim}>no spec loaded</Text>}
      </Box>

      {!snap.health ? (
        <Box flexDirection="column">
          <Text bold color={theme.accent}>next</Text>
          <Text color={theme.dim}>  press <Text color={theme.text}>4</Text> for Run, then Migrate + seed and Compose up.</Text>
        </Box>
      ) : snap.db.unmet > 0 ? (
        <Box flexDirection="column">
          <Text bold color={theme.accent}>demand signal</Text>
          <Text color={theme.dim}>  {snap.db.unmet} utterances went unanswered. Press <Text color={theme.text}>3</Text> and pick the unmet channel.</Text>
        </Box>
      ) : null}
    </Box>
  );
}
