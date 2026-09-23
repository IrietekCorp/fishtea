/**
 * Seam plugins: the ones that are a module rather than a spec fragment.
 *
 * An `integration` plugin contributes calls and entities, so the spec loader is the whole of its
 * support. A `classifier` or a `channel` contributes *behaviour* — something the framework calls at run
 * time — and that needs one more step: find the module the manifest names, import it, and check it
 * exports what its kind promised.
 *
 * Three things this deliberately does:
 *
 *   **It imports late.** Reading a manifest must never run anybody's code, so validation only checks
 *   that `module` is declared and points inside the plugin. The import happens here, once, when
 *   something actually wants the behaviour.
 *
 *   **It fails by name.** A plugin that resolves and then does nothing is the failure mode this whole
 *   second pass exists to remove, so every way of getting this wrong — no module, no such file, wrong
 *   export, an export that is not a function, a factory that throws — produces a message naming the
 *   plugin, the file and what was expected.
 *
 *   **It hands over config, not the spec.** A seam gets its answered configuration and the environment,
 *   because that is what its questions were for. It does not get the application's spec: a classifier
 *   is told the tools when it is reloaded, and a channel is told the notification when there is one.
 */
import { SEAM_EXPORT, defaultsOf, type ResolvedPlugin, type PluginKind } from "@fishtea/spec";
import { join } from "node:path";
import { existsSync } from "node:fs";

export class SeamError extends Error {
  constructor(public plugin: string, message: string) { super(`plugin "${plugin}": ${message}`); }
}

/** What every seam factory is handed: the answers to its own questions, and the environment. */
export interface SeamContext {
  config: Record<string, unknown>;
  env: Record<string, string | undefined>;
  /** the name the application gave this plugin in spec.plugins */
  as: string;
}

/** The enabled plugins of one kind, in spec order. */
export function seamsOfKind(plugins: ResolvedPlugin[], kind: PluginKind): ResolvedPlugin[] {
  return plugins.filter((p) => p.manifest.kind === kind && p.use.enabled !== false);
}

/**
 * Import a seam plugin's module and call its factory.
 *
 * Generic over what the factory returns, because the caller — and only the caller — knows what shape it
 * asked for. The export's *existence* and callability are checked here; whether the object it returns
 * satisfies an interface is the caller's business, and both consumers check it.
 */
export async function loadSeam<T>(p: ResolvedPlugin, env = process.env): Promise<T> {
  const wanted = SEAM_EXPORT[p.manifest.kind];
  if (!wanted) throw new SeamError(p.as, `kind "${p.manifest.kind}" has no seam module`);
  if (!p.manifest.module) throw new SeamError(p.as, `no "module" in its manifest, so there is nothing to load`);

  const file = join(p.dir, p.manifest.module);
  if (!existsSync(file)) {
    throw new SeamError(p.as, `its manifest names "${p.manifest.module}" but ${file} does not exist`);
  }

  let mod: Record<string, unknown>;
  try {
    mod = (await import(file)) as Record<string, unknown>;
  } catch (e) {
    throw new SeamError(p.as, `${p.manifest.module} could not be imported: ${(e as Error).message}`);
  }

  const factory = mod[wanted];
  if (typeof factory !== "function") {
    const found = Object.keys(mod).filter((k) => k !== "default");
    throw new SeamError(p.as, `${p.manifest.module} must export ${wanted}(), a function` +
      (found.length ? ` — it exports ${found.join(", ")}` : " — it exports nothing"));
  }

  const ctx: SeamContext = {
    config: { ...defaultsOf(p.manifest), ...(p.use.config ?? {}) },
    env,
    as: p.as,
  };
  try {
    return await (factory as (c: SeamContext) => T | Promise<T>)(ctx);
  } catch (e) {
    throw new SeamError(p.as, `${wanted}() threw: ${(e as Error).message}`);
  }
}
