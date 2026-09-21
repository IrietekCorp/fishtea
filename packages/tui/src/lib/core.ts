/** Operator-side client for a running core, plus direct probes for the classifier pool and the database. */
export interface Health { ok: boolean; db: boolean; classifier: { name: string; ok: boolean; detail?: any }; business: string; version: string; strict: boolean; sse: number }

export class Core {
  constructor(public url: string, public token: string) {}
  private h() { return { "content-type": "application/json", "x-fishtea-operator": this.token }; }
  private async json<T>(res: Response, what: string): Promise<T> {
    if (!res.ok) throw new Error(`${what}: ${res.status} ${(await res.text()).slice(0, 160)}`);
    return res.json() as Promise<T>;
  }
  async health(): Promise<Health | null> {
    try { const r = await fetch(`${this.url}/healthz`, { signal: AbortSignal.timeout(1500) }); return r.ok ? ((await r.json()) as Health) : null; } catch { return null; }
  }
  async op(shape: string, args: Record<string, unknown> = {}) {
    return this.json<any>(await fetch(`${this.url}/op/utter`, { method: "POST", headers: this.h(), body: JSON.stringify({ shape, args }), signal: AbortSignal.timeout(120000) }), shape);
  }
  async reload() { return this.json<any>(await fetch(`${this.url}/op/reload`, { method: "POST", headers: this.h(), signal: AbortSignal.timeout(180000) }), "reload"); }
  async unmet(since: string) { return (await this.json<any>(await fetch(`${this.url}/op/unmet?since=${encodeURIComponent(since)}`, { headers: this.h() }), "unmet")).unmet as any[]; }
  async visitors() { return (await this.json<any>(await fetch(`${this.url}/op/visitors`, { headers: this.h() }), "visitors")).visitors as any[]; }
  async notify(visitorId: string, text: string) {
    return this.json<any>(await fetch(`${this.url}/op/notify`, { method: "POST", headers: this.h(), body: JSON.stringify({ visitorId, text }) }), "notify");
  }
}

export async function poolHealth(url: string): Promise<any | null> {
  try { const r = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1500) }); return r.ok ? await r.json() : null; } catch { return null; }
}

/** Run a command, capturing output. Used for docker compose and migrations that print. */
export async function run(cmd: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(cmd, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, out: (out + err).trim() };
}
