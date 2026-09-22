/** Re-exported from the CLI so the console and `fishtea new` agree on where applications go. */
export const DEFAULT_APP_ID = "myapp";

export function targetDir(id: string, o: { fishteaHome: string; dir?: string }): string {
  const { join, resolve, dirname, sep } = require("node:path") as typeof import("node:path");
  if (o.dir) return resolve(o.dir);
  const workspace = process.env.FISHTEA_WORKSPACE;
  if (workspace) return join(resolve(workspace), id);
  const cwd = process.cwd();
  const inside = (resolve(cwd) + sep).startsWith(resolve(o.fishteaHome) + sep) || resolve(cwd) === resolve(o.fishteaHome);
  return join(inside ? dirname(resolve(o.fishteaHome)) : cwd, id);
}
