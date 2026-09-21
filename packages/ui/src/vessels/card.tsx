import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Field, labelOf, isHidden } from "../fields";

/** card: an object with scalar fields only. */
export function CardVessel({ record, title }: { record: Record<string, unknown> | null; title?: string }) {
  if (!record) return <p className="text-sm text-muted-foreground">Nothing here yet.</p>;
  const entries = Object.entries(record).filter(([k]) => !isHidden(k));
  return (
    <Card>
      {title && <CardHeader><CardTitle>{title}</CardTitle></CardHeader>}
      <CardContent className={title ? "" : "pt-4"}>
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          {entries.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{labelOf(k)}</dt><dd>{Array.isArray(v) && typeof v[0] === "object" ? <Lines rows={v as Record<string, unknown>[]} /> : <Field name={k} value={v} />}</dd></div>)}
        </dl>
      </CardContent>
    </Card>
  );
}

function Lines({ rows }: { rows: Record<string, unknown>[] }) {
  return <ul className="divide-y divide-border rounded-md border border-border">{rows.map((r, i) => <li key={i} className="flex justify-between gap-3 px-3 py-1.5"><span>{String(r.name ?? r.title ?? r.productId ?? r.status ?? "")}{r.qty ? <span className="text-muted-foreground"> × {String(r.qty)}</span> : null}</span>{"price" in r && <Field name="price" value={r.price} />}</li>)}</ul>;
}
