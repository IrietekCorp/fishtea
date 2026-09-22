import { Badge } from "../components/ui/badge";
import { Separator } from "../components/ui/separator";
import { Field, labelOf, isHidden } from "../fields";
import { CardVessel } from "./card";

/**
 * timeline: { events[], ...rest } → a vertical list of events with a status badge, plus a card for the rest.
 *
 * Event fields are `unknown` (they come from whatever the shape assembled), so every conditional guard is
 * coerced with `!!`. Without it the expression is `unknown` rather than ReactNode — and at runtime a field
 * that happened to be `0` would render as a literal "0" instead of being skipped.
 */
export function TimelineVessel({ record }: { record: Record<string, unknown> }) {
  const events = (Array.isArray(record.events) ? record.events : []) as Record<string, unknown>[];
  const rest = Object.fromEntries(Object.entries(record).filter(([k]) => k !== "events" && !isHidden(k)));
  const byDay = new Map<string, Record<string, unknown>[]>();
  for (const e of events) { const key = e.day != null ? `Day ${e.day}` : typeof e.at === "string" ? new Date(e.at).toLocaleDateString(undefined, { dateStyle: "medium" }) : ""; byDay.set(key, [...(byDay.get(key) ?? []), e]); }
  return (
    <div className="space-y-4">
      {Object.keys(rest).length > 0 && (Array.isArray(rest.registrations) ? <ul className="space-y-1 text-sm">{(rest.registrations as any[]).map((r, i) => <li key={i} className="flex flex-wrap items-center gap-2"><span className="font-medium">{r.camper}</span><span className="text-muted-foreground">{r.session}</span><Badge variant="outline">{r.status}</Badge><Badge variant="outline">{r.paymentStatus}</Badge><Field name="price" value={r.price} /></li>)}</ul> : <CardVessel record={rest} />)}
      <ol className="relative border-l border-border pl-4" aria-label="timeline">
        {[...byDay.entries()].map(([day, list]) => (
          <li key={day} className="mb-4">
            {day && <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{day}</h4>}
            <ul className="space-y-2">
              {list.map((e, i) => (
                <li key={i} className="relative text-sm">
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-accent bg-card" aria-hidden />
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    {!!(e.startTime || e.at) && <time className="tabular-nums text-muted-foreground">{e.startTime ? `${e.startTime}–${e.endTime ?? ""}` : new Date(String(e.at)).toLocaleTimeString(undefined, { timeStyle: "short" })}</time>}
                    <span className="font-medium">{String(e.title ?? e.status ?? "")}</span>
                    {!!(e.status && e.title) && <Badge variant="outline">{String(e.status)}</Badge>}
                    {!!e.location && <span className="text-muted-foreground">· {String(e.location)}</span>}
                  </div>
                  {!!(e.description || e.note) && <p className="text-muted-foreground">{String(e.description ?? e.note)}</p>}
                </li>
              ))}
            </ul>
          </li>
        ))}
        {!events.length && <li className="text-sm text-muted-foreground">No events yet.</li>}
      </ol>
    </div>
  );
}
