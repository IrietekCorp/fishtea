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
  /**
   * What a suggestion chip does: `fill` puts it in the input for the visitor to edit and send (the
   * default); `ask` sends it at once — one tap instead of two, for suggestions that are complete questions.
   */
  suggestionMode?: 'fill' | 'ask';
  /**
   * `card` (the default) floats the menu as a bordered, shadowed card; `flush` drops the card so the menu
   * is the band it sits in — no border, corners or shadow, the full width it is given, one row where it fits.
   */
  layout?: 'card' | 'flush';
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
