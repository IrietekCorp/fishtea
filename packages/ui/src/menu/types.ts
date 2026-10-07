/** Fishtea menu v1 — data contract. See SPEC.md §4. */

export type Vessel =
  | 'ask'
  | 'form'
  | 'list'
  | 'card'
  | 'detail'
  | 'compare'
  | 'timeline'
  | 'confirm';

export type TurnPreview =
  | { kind: 'swatches'; colors: string[] }
  | { kind: 'images'; items: { src: string; alt: string }[] };

/** One turn on the active path of the conversation trail. */
export interface Turn {
  id: string;
  /** 1-based position on the active path. */
  index: number;
  /** Where the turn happened (FishTea: its section); `roomLabel` is what the summary card shows. */
  roomId: string;
  roomLabel?: string;
  /** What the visitor said. */
  utterance: string;
  /** Pill label, ~3–5 words. */
  short: string;
  /** One line describing the answer. */
  summary: string;
  /** The shape that answered, e.g. "findProducts". */
  shape: string;
  /** The vessel the answer poured into. */
  vessel: Vessel;
  /** When it was answered. */
  at: string | Date;
  preview?: TurnPreview;
}

export interface FishteaMenuProps {
  /** Active path, oldest first. */
  turns: Turn[];
  /**
   * The turn the visitor is on now; left out, the last one. `null` when no turn is current — FishTea:
   * the visitor is in a room (a section entered with nothing asked), which is not a point on the trail.
   */
  currentTurnId?: string | null;
  /** Feeds the rotating "Ask anything — …" placeholder and the first 3 chips. */
  suggestions?: string[];
  /** True while a question is being answered: send becomes stop. */
  busy?: boolean;
  /** Open the trail drawer on mount (for demos/tests). */
  defaultTrailOpen?: boolean;
  onSubmit: (text: string) => void;
  onRewind?: (turnId: string) => void;
  onStop?: () => void;
  /** The `@`, `/` and mic buttons are shown only when these are given (SPEC §10: v1 has no pickers). */
  onMention?: () => void;
  onPickShape?: () => void;
  onDictate?: () => void;
  className?: string;
}
