import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Separator } from "../components/ui/separator";
import { Field, labelOf, isHidden } from "../fields";
import { ListVessel } from "./list";

/** detail: an object with array fields → a card for the scalars plus a nested list per array. */
export function DetailVessel({ record }: { record: Record<string, unknown> }) {
  const scalars = Object.entries(record).filter(([k, v]) => !isHidden(k) && !Array.isArray(v) && (typeof v !== "object" || v === null));
  const objects = Object.entries(record).filter(([k, v]) => !isHidden(k) && v && typeof v === "object" && !Array.isArray(v));
  const arrays = Object.entries(record).filter(([k, v]) => !isHidden(k) && Array.isArray(v));
  return (
    <div className="space-y-4">
      {(scalars.length > 0 || objects.length > 0) && (
        <Card><CardContent className="pt-4">
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
            {scalars.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{labelOf(k)}</dt><dd><Field name={k} value={v} /></dd></div>)}
            {objects.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{labelOf(k)}</dt><dd><dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[max-content_1fr]">{Object.entries(v as object).filter(([kk]) => !isHidden(kk)).map(([kk, vv]) => <div key={kk} className="contents"><dt className="text-muted-foreground">{labelOf(kk)}</dt><dd><Field name={kk} value={vv} /></dd></div>)}</dl></dd></div>)}
          </dl>
        </CardContent></Card>
      )}
      {arrays.map(([k, v], i) => (
        <section key={k} aria-labelledby={`detail-${k}`}>
          {i > 0 && <Separator className="mb-4" />}
          <h3 id={`detail-${k}`} className="mb-2 text-sm font-semibold text-muted-foreground">{labelOf(k)} <span className="font-normal">· {(v as unknown[]).length}</span></h3>
          {typeof (v as unknown[])[0] === "object" ? <ListVessel rows={v as Record<string, unknown>[]} /> : <Field name={k} value={v} />}
        </section>
      ))}
    </div>
  );
}
