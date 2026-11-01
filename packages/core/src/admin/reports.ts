/**
 * Reports: /admin → Reports, the pages an application declares in spec.operator.reports.
 *
 * A report is a period and a list of panels; each panel is one query call drawn one way (tiles, a line,
 * bars, a table). The call is the application's SQL, so what is counted and how is the application's to
 * say, and the page only draws it. A report reads: the spec refuses a panel whose call is not a query, and
 * Engine.query refuses one whose SQL writes, so opening a report never changes anything.
 *
 * Every panel is asked with the period as `from` and `to` (ISO dates, `to` inclusive) when its call
 * declares them, and every panel is asked at once. One panel that fails says so in its own place; the
 * others still draw.
 */
import { operatorReports, getCall, type ReportPanel } from "@fishtea/spec";
import type { Engine } from "../engine.ts";

export interface ReportSummary { name: string; label: string; doc?: string; panels: number }
export interface PanelResult extends ReportPanel { rows: Record<string, unknown>[]; error?: string; ms: number }
export interface ReportResult { name: string; label: string; doc?: string; from: string; to: string; panels: PanelResult[] }

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The period asked for, or the last 30 days. A period turned the wrong way round is put right. */
export function period(from?: string | null, to?: string | null, now = new Date()): { from: string; to: string } {
  const t = to && DAY.test(to) ? to : iso(now);
  const f = from && DAY.test(from) ? from : iso(new Date(new Date(`${t}T00:00:00Z`).getTime() - 29 * 86400e3));
  return f <= t ? { from: f, to: t } : { from: t, to: f };
}

export class Reports {
  constructor(private engine: Engine) {}

  list(): ReportSummary[] {
    return operatorReports(this.engine.app.spec).map(([name, r]) => ({ name, label: r.label, doc: r.doc, panels: r.panels.length }));
  }

  async run(name: string, range: { from?: string | null; to?: string | null }): Promise<ReportResult | null> {
    const def = operatorReports(this.engine.app.spec).find(([n]) => n === name)?.[1];
    if (!def) return null;
    const { from, to } = period(range.from, range.to);
    const panels = await Promise.all(def.panels.map(async (p): Promise<PanelResult> => {
      const t0 = performance.now();
      const declared = getCall(this.engine.app.spec, p.call)?.in ?? {};
      const args: Record<string, unknown> = {};
      if ("from" in declared) args.from = from;
      if ("to" in declared) args.to = to;
      try {
        const out = await this.engine.query(p.call, args);
        const rows = (Array.isArray(out) ? out : out == null ? [] : [out]) as Record<string, unknown>[];
        return { ...p, rows, ms: Math.round(performance.now() - t0) };
      } catch (e) {
        return { ...p, rows: [], error: (e as Error)?.message ?? String(e), ms: Math.round(performance.now() - t0) };
      }
    }));
    return { name, label: def.label, doc: def.doc, from, to, panels };
  }
}
