import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../theme.ts";
import { Option, SelectList } from "./select.tsx";
import { useKeyLock } from "../lib/ctx.ts";

/** Single-line text input with a cursor. No readline: Bun echoes readline input twice (see docs/DESIGN.md). */
export function TextField({ label, initial = "", onSubmit, onCancel, active = true, placeholder, validate, mask, hint }: {
  label: string; initial?: string; onSubmit: (v: string) => void; onCancel?: () => void; active?: boolean; placeholder?: string; validate?: (v: string) => string | undefined; mask?: boolean; hint?: string;
}) {
  const [v, setV] = useState(initial);
  const [pos, setPos] = useState(initial.length);
  const [err, setErr] = useState<string | undefined>();
  useKeyLock(active);
  useInput((input, key) => {
    if (key.escape) return onCancel?.();
    if (key.return) { const problem = validate?.(v); if (problem) return setErr(problem); return onSubmit(v); }
    if (key.leftArrow) return setPos((p) => Math.max(0, p - 1));
    if (key.rightArrow) return setPos((p) => Math.min(v.length, p + 1));
    if (key.ctrl && input === "a") return setPos(0);
    if (key.ctrl && input === "e") return setPos(v.length);
    if (key.ctrl && input === "u") { setV(""); return setPos(0); }
    if (key.backspace || key.delete) { if (!pos) return; setV(v.slice(0, pos - 1) + v.slice(pos)); return setPos((p) => p - 1); }
    if (key.tab) return; // the form uses shift+tab to step back
    // a single-line field takes printable characters only: some terminals deliver CR and LF separately,
    // and the stray LF would otherwise land in the value
    const typed = input?.replace(/[\r\n\t\x00-\x1f]/g, "") ?? "";
    if (typed && !key.ctrl && !key.meta) { setV(v.slice(0, pos) + typed + v.slice(pos)); setPos((p) => p + typed.length); setErr(undefined); }
  }, { isActive: active });
  const shown = mask ? "•".repeat(v.length) : v;
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.dim}>{label} </Text>
        {v.length === 0 && placeholder ? <Text color={theme.dim}>{active ? "▌" : ""}{placeholder}</Text> : (
          <Text>{shown.slice(0, pos)}<Text color={theme.accent}>{active ? "▌" : ""}</Text>{shown.slice(pos)}</Text>
        )}
      </Box>
      {err ? <Text color={theme.bad}>  {err}</Text> : hint ? <Text color={theme.dim}>  {hint}</Text> : null}
    </Box>
  );
}

export function Confirm({ message, initial = true, onAnswer, active = true }: { message: string; initial?: boolean; onAnswer: (v: boolean) => void; active?: boolean }) {
  const [yes, setYes] = useState(initial);
  useKeyLock(active);
  useInput((input, key) => {
    if (key.leftArrow || key.rightArrow || input === "\t") return setYes((y) => !y);
    if (input?.toLowerCase() === "y") return onAnswer(true);
    if (input?.toLowerCase() === "n") return onAnswer(false);
    if (key.return) return onAnswer(yes);
    if (key.escape) return onAnswer(false);
  }, { isActive: active });
  return (
    <Box>
      <Text>{message} </Text>
      <Text color={yes ? theme.accent : theme.dim} bold={yes}>[yes]</Text><Text> </Text>
      <Text color={!yes ? theme.accent : theme.dim} bold={!yes}>[no]</Text>
    </Box>
  );
}

/** Space toggles, ⏎ accepts. */
export function MultiSelect({ options, initial = [], onSubmit, onCancel, active = true }: { options: Option<string>[]; initial?: string[]; onSubmit: (v: string[]) => void; onCancel?: () => void; active?: boolean }) {
  const [picked, setPicked] = useState<string[]>(initial);
  const [i, setI] = useState(0);
  useKeyLock(active);
  useInput((input, key) => {
    if (key.upArrow) return setI((x) => (x - 1 + options.length) % options.length);
    if (key.downArrow) return setI((x) => (x + 1) % options.length);
    if (input === " ") { const v = options[i].value; return setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v])); }
    if (input === "a") return setPicked(options.map((o) => o.value));
    if (key.return) return onSubmit(picked);
    if (key.escape) return onCancel?.();
  }, { isActive: active });
  return (
    <Box flexDirection="column">
      {options.map((o, n) => (
        <Box key={o.value}>
          <Text color={n === i ? theme.accent : undefined}>{n === i ? "❯ " : "  "}</Text>
          <Text color={picked.includes(o.value) ? theme.ok : theme.dim}>{picked.includes(o.value) ? "◼" : "◻"} </Text>
          <Text color={n === i ? theme.accent : undefined}>{o.label}</Text>
          {o.hint ? <Text color={theme.dim}>  {o.hint}</Text> : null}
        </Box>
      ))}
      <Text color={theme.dim}>  space toggles · a all · ⏎ accept</Text>
    </Box>
  );
}

export { SelectList };
