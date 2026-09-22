import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { resolve } from "node:path";
import { DEFAULT_APP_ID, targetDir } from "../lib/paths.ts";
import { theme } from "../theme.ts";
import { Hints, wrap } from "../components/ui.tsx";
import { SelectList, type Option } from "../components/select.tsx";
import { TextField, Confirm } from "../components/input.tsx";
import { Form, type Question } from "../components/form.tsx";
import { useCtx } from "../lib/ctx.ts";

type Step =
  | { at: "template" }
  | { at: "id"; template: string }
  | { at: "where"; template: string; id: string }
  | { at: "interview"; template: string; id: string; dir: string }
  | { at: "confirm"; template: string; id: string; dir: string; answers: Record<string, unknown> }
  | { at: "done"; dir: string };

/** Create a new application: pick an archetype, answer its interview, write the directory. */
export function Onboard() {
  const { fishteaHome, toast, busy } = useCtx();
  const [step, setStep] = useState<Step>({ at: "template" });
  const [templates, setTemplates] = useState<any[] | null>(null);

  useEffect(() => {
    void (async () => {
      const { listTemplates } = await import(`${fishteaHome}/packages/cli/src/new.ts`);
      setTemplates(listTemplates(fishteaHome));
    })();
  }, [fishteaHome]);

  if (!templates) return <Text color={theme.dim}>reading templates…</Text>;

  if (step.at === "template") {
    return (
      <Box flexDirection="column">
        <Text color={theme.dim}>An archetype is a complete, runnable application. The interview turns it into yours.</Text>
        <Box marginTop={1}>
          <SelectList rows={7} filterable={false} options={templates.map<Option<string>>((t) => ({ value: t.name, label: t.name, hint: `${t.doc.slice(0, 68)} · ${t.onboard.questions.length} questions` }))}
            onSelect={(o) => setStep({ at: "id", template: o.value })} />
        </Box>
      </Box>
    );
  }

  if (step.at === "id") {
    return (
      <Box flexDirection="column">
        <Text color={theme.dim}>archetype <Text color={theme.accent}>{step.template}</Text></Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Application id: lowercase letters, digits and dashes. It names the directory and the business.</Text>
          <Box marginTop={1}>
            <TextField label="›" placeholder={DEFAULT_APP_ID} hint="⏎ accepts the placeholder" onCancel={() => setStep({ at: "template" })}
              validate={(v) => (v === "" || /^[a-z][a-z0-9-]{1,40}$/.test(v) ? undefined : "lowercase letters, digits, dashes; start with a letter")}
              onSubmit={(v) => setStep({ at: "where", template: step.template, id: v || DEFAULT_APP_ID })} />
          </Box>
        </Box>
      </Box>
    );
  }

  if (step.at === "where") {
    const suggested = targetDir(step.id, { fishteaHome });
    return (
      <Box flexDirection="column">
        <Text color={theme.dim}>{step.template} › <Text color={theme.accent}>{step.id}</Text></Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Where should the application go? It is its own project, so it is never created inside the framework.</Text>
          <Box marginTop={1}>
            <TextField label="›" placeholder={suggested} hint="⏎ accepts this path" onCancel={() => setStep({ at: "id", template: step.template })}
              onSubmit={(v) => setStep({ at: "interview", template: step.template, id: step.id, dir: v.trim() ? resolve(v.trim()) : suggested })} />
          </Box>
        </Box>
      </Box>
    );
  }

  if (step.at === "interview") {
    const tpl = templates.find((t) => t.name === step.template)!;
    const name = step.id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
    return (
      <Box flexDirection="column">
        <Text color={theme.dim}>{step.template} › <Text color={theme.accent}>{step.id}</Text></Text>
        <Box marginTop={1}>
          <Form subject={name} questions={tpl.onboard.questions as Question[]} onCancel={() => setStep({ at: "template" })}
            onDone={(answers) => setStep({ at: "confirm", template: step.template, id: step.id, dir: step.dir, answers: { name, ...answers } })} />
        </Box>
      </Box>
    );
  }

  if (step.at === "confirm") {
    const target = step.dir;
    return (
      <Box flexDirection="column">
        <Text>Create <Text color={theme.accent}>{target}</Text> from the <Text color={theme.accent}>{step.template}</Text> archetype?</Text>
        <Box marginTop={1} flexDirection="column">
          {Object.entries(step.answers).slice(0, 12).map(([k, v]) => (
            <Text key={k} color={theme.dim}>  {k.padEnd(14)}<Text color={theme.text}>{Array.isArray(v) ? v.join(", ") : String(v)}</Text></Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Confirm message="" initial onAnswer={async (yes) => {
            if (!yes) return setStep({ at: "template" });
            try {
              const { scaffold } = await import(`${fishteaHome}/packages/cli/src/new.ts`);
              const out = (await busy("scaffolding", () => scaffold({ id: step.id, template: step.template, dir: target, name: String(step.answers.name), fishteaHome, answers: step.answers }))) as { dir: string };
              toast(`created ${out.dir}`, "ok");
              setStep({ at: "done", dir: out.dir });
            } catch (e) { toast((e as Error).message, "bad"); setStep({ at: "template" }); }
          }} />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color={theme.ok}>created {step.dir}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.dim}>  cd {step.dir}</Text>
        <Text color={theme.dim}>  bun run doctor      # is the database and the classifier reachable?</Text>
        <Text color={theme.dim}>  bun run up          # or: bun run migrate && bun run seed && bun run dev</Text>
        <Text color={theme.dim}>  bun run tui         # this console, pointed at the new application</Text>
      </Box>
      <Box marginTop={1}><Text color={theme.dim}>.env is written already: the core binds 0.0.0.0, so it answers on every address of this machine.</Text></Box>
      <Box marginTop={1}><Hints pairs={[["⏎", "create another"]]} /></Box>
      <Again onAgain={() => setStep({ at: "template" })} />
    </Box>
  );
}

function Again({ onAgain }: { onAgain: () => void }) {
  useInput((_input, key) => { if (key.return) onAgain(); });
  return null;
}
