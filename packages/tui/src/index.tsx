/**
 * The operator console (BLUEPRINT §13, D12): an editor and control surface over the spec, built on Ink.
 *
 * Why Ink and not a prompt library: under Bun, `node:readline` echoes every keystroke twice, so
 * @clack/prompts rendered "hheelllloo" and lost the value (see docs/DESIGN.md). Ink reads stdin directly
 * in raw mode, which Bun handles correctly, and a persistent screen is what an operator console wants
 * anyway — live service status, the trail, the unmet channel.
 */
import React from "react";
import { Box, Text, render } from "ink";
import { App, ALT_ON, ALT_OFF } from "./app.tsx";
import { Core } from "./lib/core.ts";
import { closeDatabase } from "./lib/app-state.ts";
import { Form, type Question } from "./components/form.tsx";
import type { Scaffolder } from "./lib/scaffolder.ts";

/** A repeated CLI flag arrives as an array; readers test for a string first. */
export type TuiFlags = Record<string, string | boolean | string[] | undefined>;
export interface TuiOptions { dir: string; fishteaHome: string; scaffolder: Scaffolder; flags?: TuiFlags }

export async function tui(o: TuiOptions) {
  if (!process.stdin.isTTY) throw new Error("the console needs a terminal (stdin is not a tty)");
  const core = new Core(
    process.env.FISHTEA_CORE_URL ?? `http://localhost:${process.env.FISHTEA_CORE_PORT ?? process.env.PORT ?? 3000}`,
    process.env.FISHTEA_OPERATOR_TOKEN ?? "change-me",
  );
  process.stdout.write(ALT_ON);
  let left = false;
  const leave = () => { if (left) return; left = true; process.stdout.write(ALT_OFF); };
  process.on("exit", leave);
  const instance = render(<App dir={o.dir} fishteaHome={o.fishteaHome} core={core} scaffolder={o.scaffolder} onExit={leave} />, { exitOnCtrlC: false });
  await instance.waitUntilExit();
  leave();
  await closeDatabase();
}

/** Run one archetype's onboarding interview and resolve with the answers. Used by `fishtea new --interactive`. */
export async function interview(fishteaHome: string, template: string, scaffolder: Scaffolder, seed: { name?: string } = {}): Promise<Record<string, unknown>> {
  const tpl = scaffolder.listTemplates(fishteaHome).find((t) => t.name === template);
  if (!tpl) throw new Error(`unknown template ${template}`);
  if (!process.stdin.isTTY) throw new Error("--interactive needs a terminal; pass --answers instead");
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => { if (settled) return; settled = true; instance.unmount(); fn(); };
    const instance = render(
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={Math.min(process.stdout.columns ?? 90, 96)}>
        <Text bold color="cyan">fishtea · {template}<Text color="gray">{seed.name ? ` · ${seed.name}` : ""}</Text></Text>
        <Text color="gray">{tpl.onboard.doc ?? "Answering this turns the archetype into your business."}</Text>
        <Form subject={seed.name} questions={tpl.onboard.questions as Question[]}
          onDone={(a) => done(() => resolve(a))}
          onCancel={() => done(() => reject(Object.assign(new Error("cancelled"), { cancelled: true })))} />
      </Box>,
      { exitOnCtrlC: true },
    );
  });
}

export { Form };
export { isCompiled, selfCommand } from "./lib/scaffolder.ts";
export type { Question };
export type { Scaffolder, ScaffoldRequest, TemplateInfo } from "./lib/scaffolder.ts";
