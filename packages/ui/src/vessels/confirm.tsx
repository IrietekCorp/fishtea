import { CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Field, labelOf, isHidden } from "../fields";

/** confirm: { ok, ... } ≤ 4 keys → a success Alert. */
export function ConfirmVessel({ record, phrase }: { record: Record<string, unknown>; phrase: string }) {
  const entries = Object.entries(record).filter(([k]) => k !== "ok" && !isHidden(k));
  return (
    <Alert variant={record.ok === false ? "destructive" : "success"}>
      <CheckCircle2 className="h-4 w-4" />
      <div>
        <AlertTitle>{typeof record.summary === "string" ? record.summary : phrase}</AlertTitle>
        <AlertDescription><dl className="mt-1 grid gap-x-3 gap-y-1 sm:grid-cols-[max-content_1fr]">{entries.filter(([k]) => k !== "summary").map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{labelOf(k)}</dt><dd>{v && typeof v === "object" && !Array.isArray(v) ? <span>{String((v as any).id ?? (v as any).name ?? JSON.stringify(v).slice(0, 60))}</span> : <Field name={k} value={v} />}</dd></div>)}</dl></AlertDescription>
      </div>
    </Alert>
  );
}
