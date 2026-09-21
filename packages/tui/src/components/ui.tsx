import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.ts";

export const Dot = ({ state, label }: { state: "ok" | "warn" | "bad" | "idle"; label: string }) => (
  <Text>
    <Text color={state === "ok" ? theme.ok : state === "warn" ? theme.warn : state === "bad" ? theme.bad : theme.dim}>●</Text>
    <Text color={state === "bad" ? theme.bad : undefined}> {label}</Text>
  </Text>
);

export const Panel = ({ title, children, focused = true, height }: { title?: string; children: React.ReactNode; focused?: boolean; height?: number }) => (
  <Box flexDirection="column" borderStyle="round" borderColor={focused ? theme.accent : theme.dim} paddingX={1} height={height} flexGrow={1}>
    {title ? <Text bold color={focused ? theme.accent : theme.dim}>{title}</Text> : null}
    {children}
  </Box>
);

export const Hints = ({ pairs }: { pairs: [string, string][] }) => (
  <Text color={theme.dim}>{pairs.map(([k, v], i) => <Text key={k + i}>{i ? "  " : ""}<Text color={theme.text}>{k}</Text> {v}</Text>)}</Text>
);

export const Field = ({ label, value, width = 16 }: { label: string; value: React.ReactNode; width?: number }) => (
  <Box><Box width={width}><Text color={theme.dim}>{label}</Text></Box><Text>{value}</Text></Box>
);

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export function Spinner({ label }: { label: string }) {
  const [i, setI] = React.useState(0);
  React.useEffect(() => { const t = setInterval(() => setI((x) => x + 1), 80); return () => clearInterval(t); }, []);
  return <Text color={theme.accent}>{FRAMES[i % FRAMES.length]} {label}</Text>;
}

/** Wrap a long string to a width, for panels that show free text. */
export const wrap = (s: string, width: number): string[] => {
  const out: string[] = [];
  for (const para of String(s ?? "").split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/)) {
      if (!line.length) line = w;
      else if (line.length + 1 + w.length <= width) line += " " + w;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
};

export const truncate = (s: unknown, n: number) => { const t = String(s ?? ""); return t.length <= n ? t : t.slice(0, n - 1) + "…"; };
