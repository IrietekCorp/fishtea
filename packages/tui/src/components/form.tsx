import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../theme.ts";
import { Confirm, MultiSelect, TextField } from "./input.tsx";
import { SelectList } from "./select.tsx";
import { truncate, wrap } from "./ui.tsx";

export interface Question { id: string; ask: string; type: "string" | "text" | "int" | "number" | "boolean" | "enum" | "multi" | "list"; values?: string[]; default?: unknown; doc?: string }

/** Walks a question list one at a time. ↑ revisits the previous answer; esc cancels the whole form. */
export function Form({ questions, onDone, onCancel, active = true, subject, width = 74 }: {
  questions: Question[]; onDone: (answers: Record<string, unknown>) => void; onCancel?: () => void; active?: boolean; subject?: string; width?: number;
}) {
  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const q = questions[at];
  if (!q) return null;
  const prior = answers[q.id];
  const raw = prior !== undefined ? prior : q.default;
  const def = typeof raw === "string" ? raw.replaceAll("{{name}}", subject ?? "") : raw;
  const defText = def == null ? "" : Array.isArray(def) ? def.join(", ") : String(def);

  const advance = (v: unknown) => {
    const next = { ...answers, [q.id]: v };
    setAnswers(next);
    if (at + 1 >= questions.length) return onDone(next);
    setAt(at + 1);
  };
  const back = () => setAt((x) => Math.max(0, x - 1));

  return (
    <Box flexDirection="column">
      <Text color={theme.dim}>{at + 1}/{questions.length}{at > 0 ? "  (esc cancels)" : ""}</Text>
      <Box flexDirection="column" marginTop={1}>
        {wrap(q.ask, width).map((l, i) => <Text key={i} bold={i === 0}>{l}</Text>)}
      </Box>
      <Box marginTop={1} flexDirection="column">
        {q.type === "enum" ? (
          <SelectList key={q.id} active={active} rows={7} filterable={false} initial={Math.max(0, (q.values ?? []).indexOf(String(def)))}
            options={(q.values ?? []).map((v) => ({ value: v, label: v }))} onSelect={(o) => advance(o.value)} onCancel={onCancel} />
        ) : q.type === "multi" ? (
          <MultiSelect key={q.id} active={active} options={(q.values ?? []).map((v) => ({ value: v, label: v }))} initial={Array.isArray(def) ? (def as string[]) : []} onSubmit={advance} onCancel={onCancel} />
        ) : q.type === "boolean" ? (
          <Confirm key={q.id} active={active} message="" initial={def !== false} onAnswer={advance} />
        ) : (
          <TextField key={q.id} active={active} label="›" initial=""
            placeholder={defText || (q.type === "list" ? "comma separated" : q.type === "text" ? "a sentence or two" : "")}
            hint={defText ? "⏎ keeps the default · type to replace it" : q.type === "list" ? "comma separated" : undefined}
            validate={(v) => (q.type === "int" || q.type === "number") && v !== "" && isNaN(Number(v)) ? "a number, please" : undefined}
            onSubmit={(v) => {
              if (v.trim() === "") return advance(def);
              if (q.type === "int") return advance(Math.trunc(Number(v)));
              if (q.type === "number") return advance(Number(v));
              if (q.type === "list") return advance(v.split(",").map((s) => s.trim()).filter(Boolean));
              return advance(v);
            }}
            onCancel={onCancel} />
        )}
      </Box>
      {at > 0 ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.dim}>answered so far</Text>
          {questions.slice(0, at).map((p) => (
            <Text key={p.id} color={theme.dim}>  {p.id.padEnd(14)}<Text color={theme.text}>{truncate(Array.isArray(answers[p.id]) ? (answers[p.id] as string[]).join(", ") : String(answers[p.id] ?? ""), 56)}</Text></Text>
          ))}
        </Box>
      ) : null}
      <Back onBack={back} active={active && at > 0} />
    </Box>
  );
}

function Back({ onBack, active }: { onBack: () => void; active: boolean }) {
  useInput((_input, key) => { if (key.tab && key.shift) onBack(); }, { isActive: active });
  return active ? <Box marginTop={1}><Text color={theme.dim}>shift+tab goes back a question</Text></Box> : null;
}
