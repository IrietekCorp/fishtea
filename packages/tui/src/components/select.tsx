import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../theme.ts";
import { truncate } from "./ui.tsx";
import { useKeyLock } from "../lib/ctx.ts";

export interface Option<T = string> { value: T; label: string; hint?: string; badge?: string; badgeColor?: string; disabled?: boolean }

/** A keyboard list: ↑↓ move, ⏎ select, / filters, page keys jump. Scrolls to keep the cursor visible. */
export function SelectList<T>({ options, onSelect, onCancel, active = true, rows = 10, filterable = true, initial = 0, onHighlight }: {
  options: Option<T>[]; onSelect: (o: Option<T>, index: number) => void; onCancel?: () => void;
  active?: boolean; rows?: number; filterable?: boolean; initial?: number; onHighlight?: (o: Option<T> | undefined) => void;
}) {
  const [i, setI] = useState(initial);
  const [filter, setFilter] = useState("");
  const [filtering, setFiltering] = useState(false);
  const shown = useMemo(() => (filter ? options.filter((o) => (o.label + " " + (o.hint ?? "")).toLowerCase().includes(filter.toLowerCase())) : options), [options, filter]);
  const clamped = Math.min(i, Math.max(0, shown.length - 1));
  useKeyLock(active && filtering);
  useEffect(() => { onHighlight?.(shown[clamped]); }, [clamped, shown.length, filter]);

  useInput((input, key) => {
    if (filtering) {
      if (key.escape) { setFiltering(false); setFilter(""); return; }
      if (key.return) { setFiltering(false); return; }
      if (key.backspace || key.delete) return setFilter((f) => f.slice(0, -1));
      if (input && !key.ctrl && !key.meta) return setFilter((f) => f + input);
      return;
    }
    if (key.upArrow || input === "k") return setI((x) => (shown.length ? (x - 1 + shown.length) % shown.length : 0));
    if (key.downArrow || input === "j") return setI((x) => (shown.length ? (x + 1) % shown.length : 0));
    if (key.pageUp) return setI((x) => Math.max(0, x - rows));
    if (key.pageDown) return setI((x) => Math.min(shown.length - 1, x + rows));
    if (input === "/" && filterable) return setFiltering(true);
    if (key.return) { const o = shown[clamped]; if (o && !o.disabled) onSelect(o, options.indexOf(o)); return; }
    if (key.escape && onCancel) return onCancel();
  }, { isActive: active });

  const start = Math.max(0, Math.min(clamped - Math.floor(rows / 2), Math.max(0, shown.length - rows)));
  const view = shown.slice(start, start + rows);
  const width = Math.max(...options.map((o) => o.label.length), 8);
  return (
    <Box flexDirection="column">
      {filtering || filter ? <Text color={theme.dim}>/{filter}<Text color={theme.accent}>{filtering ? "▌" : ""}</Text> <Text color={theme.dim}>({shown.length})</Text></Text> : null}
      {view.map((o, n) => {
        const sel = start + n === clamped;
        return (
          <Box key={String(o.value) + n}>
            <Text color={sel ? theme.accent : undefined} bold={sel}>{sel ? "❯ " : "  "}</Text>
            <Box width={width + 1}><Text color={o.disabled ? theme.dim : sel ? theme.accent : undefined} bold={sel}>{o.label}</Text></Box>
            {o.badge ? <Text color={o.badgeColor ?? theme.dim}>{o.badge} </Text> : null}
            {o.hint ? <Text color={theme.dim}>{truncate(o.hint, 78 - width)}</Text> : null}
          </Box>
        );
      })}
      {!shown.length ? <Text color={theme.dim}>  nothing matches “{filter}”</Text> : null}
      {shown.length > rows ? <Text color={theme.dim}>  {clamped + 1}/{shown.length}</Text> : null}
    </Box>
  );
}
