import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Field } from "../fields";
import { Badge } from "../components/ui/badge";

/** compare: { left, right, facets } → two card columns and a facet table. */
export function CompareVessel({ left, right, facets }: { left: Record<string, unknown>; right: Record<string, unknown>; facets: { label: string; left: unknown; right: unknown; same?: boolean }[] }) {
  const Col = ({ r }: { r: Record<string, unknown> }) => (
    <Card>{typeof r.imageUrl === "string" && <img src={r.imageUrl} alt="" className="h-40 w-full object-cover" />}<CardHeader><CardTitle>{String(r.name ?? r.id)}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground line-clamp-4">{String(r.description ?? "")}</CardContent></Card>
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2"><Col r={left} /><Col r={right} /></div>
      <Table>
        <TableHeader><TableRow><TableHead>Facet</TableHead><TableHead>{String(left.name ?? "Left")}</TableHead><TableHead>{String(right.name ?? "Right")}</TableHead></TableRow></TableHeader>
        <TableBody>{(facets ?? []).map((f) => <TableRow key={f.label}><TableCell className="font-medium">{f.label} {f.same && <Badge variant="outline">same</Badge>}</TableCell><TableCell><Field name={f.label} value={f.left} /></TableCell><TableCell><Field name={f.label} value={f.right} /></TableCell></TableRow>)}</TableBody>
      </Table>
    </div>
  );
}
