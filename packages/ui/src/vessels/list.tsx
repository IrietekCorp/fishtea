import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Field, columnsFor, labelOf, rankFields } from "../fields";

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
  // Ranked, not in key order. A card is small, so what it drops matters more than what it keeps: four
  // fields chosen by interest beats the first six the entity happens to declare.
  const rest = rankFields([row], 4, ["name", "title", "question", "description", "answer", "doc", "imageUrl"]);
  return (
    <Card className="flex overflow-hidden">
      {/* self-stretch, not h-auto: a portrait photo at its natural height makes one card tower over its row. */}
      {typeof row.imageUrl === "string" && <img src={row.imageUrl} alt="" loading="lazy" className="w-28 shrink-0 self-stretch object-cover" />}
      <div className="min-w-0 flex-1">
        <CardHeader className="pb-2"><CardTitle className="line-clamp-2">{title}</CardTitle>{typeof desc === "string" && <CardDescription className="line-clamp-3">{desc}</CardDescription>}</CardHeader>
        {/* A row per field rather than a two-column grid: a card is ~230px wide, and a long label like
            "Compare At Price" in a max-content column leaves the value almost no room — enough that
            "$42.00" wrapped one character per line. Here the label gives way and the value never breaks. */}
        <CardContent><dl className="space-y-1 text-sm">{rest.map((k) => <div key={k} className="flex items-baseline gap-2"><dt className="min-w-0 truncate text-muted-foreground">{labelOf(k)}</dt><dd className="ml-auto max-w-[62%] text-right"><Field name={k} value={row[k]} /></dd></div>)}</dl></CardContent>
      </div>
    </Card>
  );
}
