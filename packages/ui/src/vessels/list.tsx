import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Field, columnsFor, labelOf, isHidden } from "../fields";

/** list: Table (≥ 6 rows) or Card grid (< 6, or has imageUrl). Chosen from the data, never from the shape. */
export function ListVessel({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing matched.</p>;
  const hasImage = rows.some((r) => typeof r.imageUrl === "string");
  if (rows.length < 6 || hasImage) return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{rows.map((r, i) => <RecordCard key={String(r.id ?? i)} row={r} />)}</div>;
  const cols = columnsFor(rows);
  return (
    <Table>
      <TableHeader><TableRow>{cols.map((c) => <TableHead key={c}>{labelOf(c)}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{rows.map((r, i) => <TableRow key={String(r.id ?? i)}>{cols.map((c) => <TableCell key={c}><Field name={c} value={r[c]} /></TableCell>)}</TableRow>)}</TableBody>
    </Table>
  );
}

export function RecordCard({ row }: { row: Record<string, unknown> }) {
  const title = String(row.name ?? row.title ?? row.question ?? row.id ?? "");
  const desc = row.description ?? row.answer ?? row.doc;
  const rest = Object.entries(row).filter(([k]) => !isHidden(k) && !["name", "title", "question", "description", "answer", "imageUrl"].includes(k)).slice(0, 6);
  return (
    <Card className="flex overflow-hidden">
      {typeof row.imageUrl === "string" && <img src={row.imageUrl} alt="" loading="lazy" className="h-auto w-28 shrink-0 object-cover" />}
      <div className="min-w-0 flex-1">
        <CardHeader className="pb-2"><CardTitle className="truncate">{title}</CardTitle>{typeof desc === "string" && <CardDescription className="line-clamp-3">{desc}</CardDescription>}</CardHeader>
        <CardContent><dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">{rest.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{labelOf(k)}</dt><dd><Field name={k} value={v} /></dd></div>)}</dl></CardContent>
      </div>
    </Card>
  );
}
