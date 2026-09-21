import { Button } from "../components/ui/button";
import type { Chip } from "../lib/client";

/** ask: the option list — shapes as chips. Also used for next[] under an answer. */
export function Chips({ chips, onPick, label }: { chips: Chip[]; onPick: (c: Chip) => void; label: string }) {
  if (!chips.length) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label={label}>
      {chips.map((c, i) => <li key={`${c.shape}-${i}`}><Button variant="chip" size="sm" onClick={() => onPick(c)} title={c.gated ? "You'll be asked to identify yourself first" : undefined}>{c.label}{c.gated && <span aria-hidden className="text-muted-foreground">·</span>}</Button></li>)}
    </ul>
  );
}

export function AskVessel({ phrase, hint, options, onPick }: { phrase: string; hint?: string; options: Chip[]; onPick: (c: Chip) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-lg">{phrase}</p>
      {hint && hint !== phrase && <p className="text-sm text-muted-foreground">{hint}</p>}
      <Chips chips={options} onPick={onPick} label="What I can help with" />
    </div>
  );
}
