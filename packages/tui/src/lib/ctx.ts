import { createContext, useContext, useEffect } from "react";
import type { Core } from "./core.ts";
import type { Snapshot } from "./app-state.ts";
import type { Scaffolder } from "./scaffolder.ts";

export interface Ctx {
  dir: string;
  fishteaHome: string;
  core: Core;
  /** The CLI's scaffolding functions, passed in rather than imported: see lib/scaffolder.ts. */
  scaffolder: Scaffolder;
  snap: Snapshot;
  refresh: () => Promise<void>;
  toast: (text: string, tone?: "ok" | "warn" | "bad") => void;
  /** Drop out of the alternate screen and raw mode, run something that owns the terminal, come back. */
  suspend: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Run a long job with a spinner in the footer; returns what the job returned. */
  busy: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
  quit: () => void;
}

export const AppCtx = createContext<Ctx | null>(null);
export const useCtx = (): Ctx => {
  const c = useContext(AppCtx);
  if (!c) throw new Error("AppCtx missing");
  return c;
};

/**
 * While a text field or other character-consuming control is mounted, the global shortcuts (1–5, q, r)
 * must not fire: typing "run" in a field should not restart the core. Controls take the lock; the root
 * only handles globals when nothing holds it.
 */
export const LockCtx = createContext<{ push: () => void; pop: () => void } | null>(null);
export function useKeyLock(active: boolean) {
  const lock = useContext(LockCtx);
  useEffect(() => {
    if (!active || !lock) return;
    lock.push();
    return () => lock.pop();
  }, [active, lock]);
}
