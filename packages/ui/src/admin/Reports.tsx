/**
 * Reports: the pages the application declares in spec.operator.reports, over a period the operator picks.
 * The application's SQL decides what is counted; this page only draws it — tiles, a line over days, bars,
 * a table. Charts are plain SVG: one axis, at most three lines (more is a table), 2px lines, a crosshair
 * that reads every series at once, and the numbers behind every chart one click away.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { report as getReport, reports as getReports, type Report, type ReportFormat, type ReportPanel, type ReportSummary } from "./client";
import type { Go } from "./Admin";

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
const PRESETS = [{ label: "7 days", days: 7 }, { label: "30 days", days: 30 }, { label: "90 days", days: 90 }, { label: "12 months", days: 365 }] as const;
const RANGE_KEY = "fishtea-admin-report-range";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysBack = (n: number) => ({ from: iso(new Date(Date.now() - (n - 1) * 86400e3)), to: iso(new Date()) });

// ── formatting ─────────────────────────────────────────────────────────────

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const guess = (col: string): ReportFormat =>
  /date|day|^at$|At$/.test(col) ? "date" : /pct|rate|share|ctr/i.test(col) ? "percent" : /commission|revenue|sale|earn|epc|payout|amount|value/i.test(col) ? "money" : "number";

export function fmt(v: unknown, f: ReportFormat, currency = "USD"): string {
  if (v === null || v === undefined || v === "") return "—";
  if (f === "text" || f === "link") return String(v);
  if (f === "date") {
    const d = new Date(String(v).length === 10 ? `${v}T00:00:00Z` : String(v));
    return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (f === "money") {
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: Math.abs(n) < 10 && n !== 0 ? 2 : 0 }).format(n); }
    catch { return n.toFixed(2); }
  }
  if (f === "percent") return `${(n * 100).toFixed(n !== 0 && Math.abs(n) < 0.1 ? 1 : 0)}%`;
  if (f === "int") return Math.round(n).toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: Number.isInteger(n) ? 0 : 2 });
}

const formatOf = (p: ReportPanel, col: string, sample?: unknown): ReportFormat =>
  p.format?.[col] ?? (typeof sample === "string" && isNaN(Number(sample)) && !/^\d{4}-\d{2}-\d{2}/.test(sample) ? "text" : guess(col));
const labelOf = (p: ReportPanel, col: string) => p.labels?.[col] ?? col.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
const cell = (p: ReportPanel, row: Record<string, unknown>, col: string) => fmt(row[col], formatOf(p, col, row[col]), typeof row.currency === "string" ? row.currency : undefined);
const columnsOf = (p: ReportPanel) => p.columns ?? Object.keys(p.rows[0] ?? {}).filter((c) => c !== "currency");

/** The width a chart has to draw in, followed as the page resizes. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** A round top for an axis: 4 gridlines at 1, 2, 2.5 or 5 × 10ⁿ; whole steps for counts, so no label repeats. */
function niceMax(max: number, whole = false) {
  if (whole && max <= 4) return 4;
  if (max <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(max / 4));
  const m = (whole && step < 10 ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]).find((k) => k * step * 4 >= max) ?? 10;
  return m * step * 4;
}

// ── page ───────────────────────────────────────────────────────────────────

export function Reports({ parts, go }: { parts: string[]; go: Go }) {
  const [list, setList] = useState<ReportSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<{ from: string; to: string; days?: number }>(() => {
    try { const r = JSON.parse(localStorage.getItem(RANGE_KEY) ?? "null"); if (r?.days) return { ...daysBack(r.days), days: r.days }; if (r?.from && r?.to) return r; } catch { /* storage may be unavailable */ }
    return { ...daysBack(30), days: 30 };
  });
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { getReports().then((r) => setList(r.reports)).catch((e) => setError(e.message)); }, []);
  const name = parts[0] ?? list?.[0]?.name;

  const load = useCallback(() => {
    if (!name) return;
    setLoading(true);
    getReport(name, range.from, range.to).then((r) => { setData(r); setError(null); }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [name, range.from, range.to]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { try { localStorage.setItem(RANGE_KEY, JSON.stringify(range)); } catch { /* fine */ } }, [range]);

  if (!list) return error ? <p role="alert" className="text-write">{error}</p> : <Loader2 className="h-5 w-5 animate-spin text-accent" aria-label="Loading" />;
  if (!list.length) return (
    <section className="max-w-2xl">
      <h1 className="mb-2 text-2xl font-black tracking-tight">Reports</h1>
      <p className="text-sm text-muted-foreground">This application declares no reports. A report is a list of panels in <code>spec.operator.reports</code>, each a query call drawn as tiles, a line, bars or a table (docs/OPERATING.md).</p>
    </section>
  );

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-black tracking-tight">{data?.label ?? list.find((r) => r.name === name)?.label ?? "Reports"}</h1>
          {data?.doc && <p className="max-w-3xl text-sm text-muted-foreground">{data.doc}</p>}
        </div>
        {list.length > 1 && (
          <nav aria-label="Reports" className="flex flex-wrap gap-1 rounded bg-muted p-1">
            {list.map((r) => (
              <button key={r.name} onClick={() => go("reports", r.name)} aria-current={r.name === name ? "page" : undefined}
                className={`rounded px-3 py-1 text-sm font-semibold ${r.name === name ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{r.label}</button>
            ))}
          </nav>
        )}
      </div>

      {/* the period, in one row above everything it filters */}
      <div className="mb-6 flex flex-wrap items-center gap-2" role="group" aria-label="Period">
        {PRESETS.map((p) => (
          <button key={p.days} onClick={() => setRange({ ...daysBack(p.days), days: p.days })} aria-pressed={range.days === p.days}
            className={`rounded border px-3 py-1.5 text-sm font-semibold ${range.days === p.days ? "border-accent bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>{p.label}</button>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
        <label className="flex items-center gap-1 text-sm text-muted-foreground">From
          <input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange((r) => ({ from: e.target.value, to: r.to }))} className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground" />
        </label>
        <label className="flex items-center gap-1 text-sm text-muted-foreground">to
          <input type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange((r) => ({ from: r.from, to: e.target.value }))} className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground" />
        </label>
        <button onClick={load} disabled={loading} aria-label="Refresh" className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-40">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {error && <p role="alert" className="mb-4 text-sm text-write">{error}</p>}
      {!data ? <Loader2 className="h-5 w-5 animate-spin text-accent" aria-label="Loading" /> : (
        <div className={`grid gap-6 lg:grid-cols-2 ${loading ? "opacity-60" : ""}`}>
          {data.panels.map((p, i) => <Panel key={`${data.name}-${i}`} panel={p} />)}
        </div>
      )}
    </section>
  );
}

function Panel({ panel: p }: { panel: ReportPanel }) {
  const full = p.view === "tiles" || p.width === "full" || (p.width !== "half" && p.view === "line");
  return (
    <article className={`min-w-0 rounded border border-border bg-card p-5 ${full ? "lg:col-span-2" : ""}`}>
      <header className="mb-4">
        <h2 className="text-sm font-black">{p.title}</h2>
        {p.doc && <p className="text-xs text-muted-foreground">{p.doc}</p>}
      </header>
      {p.error ? <p role="alert" className="font-mono text-xs text-write">{p.error}</p>
        : !p.rows.length ? <p className="text-sm text-muted-foreground">Nothing in this period.</p>
        : p.view === "tiles" ? <Tiles p={p} />
        : p.view === "line" ? <Line p={p} />
        : p.view === "bar" ? <Bars p={p} />
        : <Table p={p} />}
    </article>
  );
}

// ── tiles ──────────────────────────────────────────────────────────────────

function Tiles({ p }: { p: ReportPanel }) {
  const row = p.rows[0];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 xl:grid-cols-5">
      {columnsOf(p).map((c) => (
        <div key={c} className="min-w-0">
          <dt className="truncate text-xs font-semibold text-muted-foreground">{labelOf(p, c)}</dt>
          <dd className="mt-1 text-2xl font-black tabular-nums tracking-tight">{cell(p, row, c)}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── line: one axis, ≤3 series, crosshair ───────────────────────────────────

function Line({ p }: { p: ReportPanel }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const x = p.x!, ys = (p.y ?? []).slice(0, 3);
  const rows = p.rows;
  const H = 220, L = 52, R = ys.length > 1 ? 84 : 16, T = 12, B = 28;
  const w = width - L - R, h = H - T - B;
  const f = formatOf(p, ys[0]);
  const max = useMemo(() => niceMax(Math.max(0, ...rows.flatMap((r) => ys.map((y) => num(r[y]) ?? 0))), f === "int"), [rows, ys, f]);
  const px = (i: number) => L + (rows.length === 1 ? w / 2 : (i / (rows.length - 1)) * w);
  const py = (v: number) => T + h - (v / max) * h;
  const cur = typeof rows[0]?.currency === "string" ? (rows[0].currency as string) : undefined;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => k * max);
  const xTicks = rows.length <= 2 ? rows.map((_, i) => i) : [0, Math.floor((rows.length - 1) / 2), rows.length - 1];

  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = e.clientX - box.left - L;
    setHover(Math.max(0, Math.min(rows.length - 1, Math.round((rel / Math.max(1, w)) * (rows.length - 1)))));
  };

  return (
    <div ref={ref} className="relative">
      {ys.length > 1 && (
        <ul className="mb-2 flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="Legend">
          {ys.map((y, i) => <li key={y} className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded" style={{ background: SERIES[i] }} />{labelOf(p, y)}</li>)}
        </ul>
      )}
      <svg width={width} height={H} role="img" aria-label={`${p.title}: ${ys.map((y) => labelOf(p, y)).join(", ")} by ${labelOf(p, x)}`}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)} className="block touch-none">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={L + w} y1={py(t)} y2={py(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={L - 8} y={py(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted-foreground)" className="tabular-nums">{fmt(t, f === "percent" ? "percent" : f === "money" ? "money" : "int", cur)}</text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={i} x={px(i)} y={H - 8} textAnchor={i === 0 && rows.length > 1 ? "start" : i === rows.length - 1 && rows.length > 1 ? "end" : "middle"} fontSize={11} fill="var(--muted-foreground)">{fmt(rows[i][x], "date")}</text>
        ))}
        {ys.map((y, si) => {
          const d = rows.map((r, i) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(num(r[y]) ?? 0).toFixed(1)}`).join("");
          const last = rows.length - 1;
          return (
            <g key={y}>
              <path d={d} fill="none" stroke={SERIES[si]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {rows.length === 1 && <circle cx={px(0)} cy={py(num(rows[0][y]) ?? 0)} r={4} fill={SERIES[si]} />}
              {ys.length > 1 && <text x={L + w + 8} y={py(num(rows[last][y]) ?? 0)} dy="0.32em" fontSize={11} fill="var(--foreground)">{labelOf(p, y)}</text>}
            </g>
          );
        })}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={px(hover)} x2={px(hover)} y1={T} y2={T + h} stroke="var(--muted-foreground)" strokeWidth={1} />
            {ys.map((y, si) => <circle key={y} cx={px(hover)} cy={py(num(rows[hover][y]) ?? 0)} r={4} fill={SERIES[si]} stroke="var(--card)" strokeWidth={2} />)}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div role="status" className="pointer-events-none absolute top-0 z-10 rounded border border-border bg-card px-3 py-2 text-xs shadow-md"
          style={{ left: Math.min(Math.max(0, px(hover) + 12), width - 170) }}>
          <p className="mb-1 font-semibold text-muted-foreground">{fmt(rows[hover][x], "date")}</p>
          {ys.map((y, si) => (
            <p key={y} className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: SERIES[si] }} />
              <b className="tabular-nums">{cell(p, rows[hover], y)}</b><span className="text-muted-foreground">{labelOf(p, y)}</span>
            </p>
          ))}
        </div>
      )}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">The numbers</summary>
        <div className="mt-2"><Table p={{ ...p, columns: [x, ...ys] }} /></div>
      </details>
    </div>
  );
}

// ── bars: one per row, longest first as the query orders them ──────────────

function Bars({ p }: { p: ReportPanel }) {
  const x = p.x!, y = p.y![0];
  const rows = p.rows.slice(0, 15);
  const max = Math.max(0, ...rows.map((r) => num(r[y]) ?? 0));
  if (!max) return <p className="text-sm text-muted-foreground">None in this period.</p>;
  return (
    <ul className="space-y-2" aria-label={`${p.title}: ${labelOf(p, y)} by ${labelOf(p, x)}`}>
      {rows.map((r, i) => {
        const v = num(r[y]) ?? 0;
        return (
          <li key={i} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 text-sm sm:grid-cols-[minmax(0,12rem)_1fr]">
            <span className="truncate text-muted-foreground" title={String(r[x] ?? "")}>{String(r[x] ?? "—")}</span>
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-3 shrink-0 rounded-r" style={{ width: `${Math.max(v > 0 ? 1 : 0, (v / max) * 80)}%`, background: SERIES[0] }} title={`${r[x]}: ${cell(p, r, y)}`} />
              <b className="whitespace-nowrap tabular-nums">{cell(p, r, y)}</b>
            </span>
          </li>
        );
      })}
      {p.rows.length > rows.length && <li className="text-xs text-muted-foreground">and {p.rows.length - rows.length} more</li>}
    </ul>
  );
}

// ── table: sortable by any column ──────────────────────────────────────────

function Table({ p }: { p: ReportPanel }) {
  const cols = columnsOf(p);
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  const rows = useMemo(() => {
    if (!sort) return p.rows;
    return [...p.rows].sort((a, b) => {
      const av = a[sort.col], bv = b[sort.col];
      const an = Number(av), bn = Number(bv);
      const c = av != null && bv != null && !isNaN(an) && !isNaN(bn) ? an - bn : String(av ?? "").localeCompare(String(bv ?? ""));
      return c * sort.dir;
    });
  }, [p.rows, sort]);
  const numeric = (c: string) => !["text", "date", "link"].includes(formatOf(p, c, p.rows[0]?.[c]));
  return (
    <div className="max-h-[28rem] overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border">
            {cols.map((c) => (
              <th key={c} scope="col" aria-sort={sort?.col === c ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                className={`whitespace-nowrap px-2 py-2 text-xs font-semibold text-muted-foreground ${numeric(c) ? "text-right" : "text-left"}`}>
                <button onClick={() => setSort((s) => ({ col: c, dir: s?.col === c && s.dir === -1 ? 1 : -1 }))} className="hover:text-foreground">
                  {labelOf(p, c)}{sort?.col === c ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0">
              {cols.map((c) => formatOf(p, c) === "link" && r[c]
                ? <td key={c} className="px-2 py-1.5"><CopyLink url={String(r[c])} /></td>
                : <td key={c} className={`px-2 py-1.5 ${numeric(c) ? "text-right tabular-nums" : "max-w-[16rem] truncate"}`} title={numeric(c) ? undefined : String(r[c] ?? "")}>{cell(p, r, c)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A link a report hands out (a campaign's tagged address): shown short, copied whole. */
function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* the address stays selectable */ } };
  return (
    <span className="flex max-w-[22rem] items-center gap-2">
      <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={url}>{url.replace(/^https?:\/\//, "")}</span>
      <button onClick={copy} className="shrink-0 rounded border border-border px-2 py-0.5 text-xs font-semibold hover:border-foreground" aria-label="Copy the link">{done ? "Copied" : "Copy"}</button>
    </span>
  );
}
