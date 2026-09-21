import { Bell } from "lucide-react";
import { Chips } from "./ask";
import type { Chip } from "../lib/client";

/** notice: notification turns — an inline row above the vessel (and a toast when they arrive live). */
export function Notice({ author, text, next, onPick }: { author: string; text: string; next: Chip[]; onPick: (c: Chip) => void }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-lg border border-accent/50 bg-accent/10 p-3 text-sm">
      <Bell className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="space-y-2"><p><span className="text-muted-foreground">{author}: </span>{text}</p><Chips chips={next} onPick={onPick} label="notification actions" /></div>
    </div>
  );
}
