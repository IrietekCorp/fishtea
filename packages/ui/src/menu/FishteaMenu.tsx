/**
 * The Fishtea menu: the mouth (the prompt, its suggestions, send) and the trail drawer of the
 * conversation, from the v1 handoff (docs/design/fishtea-menu-v1/SPEC.md). Styles: ./fishtea-menu.css on
 * the --ft-* tokens in ./tokens.css, both loaded by index.css.
 *
 * Since the handoff:
 * - No Ask tab and no rooms. Navigation is the application's to place (the sections shell puts its
 *   sections in its header); this component is the conversation.
 * - The summary card holds while the pointer is on it, as well as on its pill.
 * - `currentTurnId: null` means no turn is current (FishTea: the visitor is in a room).
 * - The `@`, `/` and mic buttons appear only when their callbacks exist.
 * - On touch, the first tap previews and only the second rewinds (§3.3); focus had made the first tap
 *   count as both.
 * - "Rewind here" in the summary card is a button, not a label: it rewinds, as the pill does.
 * - The field's focus is a "/" prompt mark left of the input, not a ring around the bar. It pulses at one
 *   rate always; focus only changes its colour (dull → the highlight).
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  ArrowUp,
  AtSign,
  ChevronRight,
  CircleCheck,
  Clock,
  Columns2,
  FileText,
  List,
  MessageCircle,
  Mic,
  Plus,
  RotateCcw,
  Square,
  SquarePen,
  SquareSlash,
  type LucideIcon,
} from 'lucide-react';
import type { FishteaMenuProps, Turn, Vessel } from './types';

const VESSEL_ICON: Record<Vessel, LucideIcon> = {
  ask: MessageCircle,
  form: SquarePen,
  list: List,
  card: Square,
  detail: FileText,
  compare: Columns2,
  timeline: Clock,
  confirm: CircleCheck,
};

const PLACEHOLDER_MS = 3200;

function formatTime(at: string | Date): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export function FishteaMenu({
  turns,
  currentTurnId,
  suggestions = [],
  suggestionMode = 'fill',
  layout = 'card',
  busy = false,
  defaultTrailOpen = false,
  onSubmit,
  onRewind,
  onStop,
  onMention,
  onPickShape,
  onDictate,
  className,
}: FishteaMenuProps) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(defaultTrailOpen && turns.length > 0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [phIndex, setPhIndex] = useState(0);
  const [focused, setFocused] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const pillsRef = useRef<HTMLOListElement>(null);
  // on touch, the pill tapped once (previewed): kept apart from focus, which a tap also moves, so the
  // first tap cannot count as the second (the reference rewound on the first tap)
  const tappedRef = useRef<string | null>(null);

  const uid = useId();
  const inputId = `${uid}-ask`;
  const drawerId = `${uid}-trail`;

  const noHover = useMediaQuery('(hover: none)');
  const currentId = currentTurnId === undefined ? turns[turns.length - 1]?.id : currentTurnId;
  const roomLabel = (id: string) => turns.find((x) => x.roomId === id)?.roomLabel ?? id;

  // Rotate the placeholder only while empty and unfocused.
  useEffect(() => {
    if (value || focused || suggestions.length < 2) return;
    const t = window.setInterval(
      () => setPhIndex((i) => (i + 1) % suggestions.length),
      PLACEHOLDER_MS,
    );
    return () => window.clearInterval(t);
  }, [value, focused, suggestions.length]);

  // Close on a pointer press outside the component.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // No turns, no drawer.
  useEffect(() => {
    if (turns.length === 0) setOpen(false);
  }, [turns.length]);

  function close(returnFocus: boolean) {
    setOpen(false);
    setActiveId(null);
    tappedRef.current = null;
    if (returnFocus) toggleRef.current?.focus();
  }

  function handleRootKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      close(true);
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const text = value.trim();
    if (!text) return;
    onSubmit(text);
    setValue('');
  }

  function handlePillKeys(e: ReactKeyboardEvent<HTMLOListElement>) {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(e.key) || !pillsRef.current) return;
    const pills = Array.from(pillsRef.current.querySelectorAll<HTMLButtonElement>('.ft-menu__pill'));
    const i = pills.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const next =
      e.key === 'Home' ? 0
      : e.key === 'End' ? pills.length - 1
      : e.key === 'ArrowRight' ? Math.min(i + 1, pills.length - 1)
      : Math.max(i - 1, 0);
    pills[next]?.focus();
  }

  function pick(turn: Turn) {
    if (turn.id === currentId) return;
    // Touch: first tap previews, second tap rewinds.
    if (noHover && tappedRef.current !== turn.id) {
      tappedRef.current = turn.id;
      setActiveId(turn.id);
      return;
    }
    onRewind?.(turn.id);
    close(false);
  }

  const placeholder = suggestions.length
    ? `Ask anything — ${suggestions[phIndex % suggestions.length]}`
    : 'Ask anything';

  const sendState = busy ? 'busy' : value.trim() ? 'charged' : 'idle';

  return (
    <div
      ref={rootRef}
      className={['ft-menu', className].filter(Boolean).join(' ')}
      data-open={open}
      data-layout={layout}
      onKeyDown={handleRootKey}
    >
      <form className="ft-menu__bar" onSubmit={handleSubmit}>
        <div className="ft-menu__field">
          <span className="ft-menu__prompt" aria-hidden="true">/</span>
          <input
            ref={inputRef}
            id={inputId}
            className="ft-menu__input"
            aria-label="Ask anything"
            type="text"
            autoComplete="off"
            enterKeyHint="send"
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
        </div>

        {!value && suggestions.length > 0 && (
          <div className="ft-menu__suggestions">
            {suggestions.slice(0, 3).map((s) => (
              <button
                key={s}
                type="button"
                className="ft-menu__suggestion"
                onClick={() => {
                  if (suggestionMode === 'ask') {
                    if (!busy) onSubmit(s);
                    return;
                  }
                  setValue(s);
                  inputRef.current?.focus();
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="ft-menu__tools">
          <button
            ref={toggleRef}
            type="button"
            className="ft-menu__toggle"
            aria-expanded={open}
            aria-controls={drawerId}
            aria-label={open ? 'Close the trail' : 'Open the trail'}
            disabled={turns.length === 0}
            onClick={() => (open ? close(false) : setOpen(true))}
          >
            <Plus className="ft-menu__plus" aria-hidden="true" />
            <span className="ft-menu__toggle-label" aria-hidden="true">{open ? 'Close' : 'Trail'}</span>
            {!open && (
              <span className="ft-menu__count" aria-hidden="true">
                {turns.length}
              </span>
            )}
          </button>

          <span className="ft-menu__spacer" />

          {onMention && (
            <button type="button" className="ft-menu__icon-btn" aria-label="Mention a thing" onClick={onMention}>
              <AtSign aria-hidden="true" />
            </button>
          )}
          {onPickShape && (
            <button type="button" className="ft-menu__icon-btn" aria-label="Pick a shape" onClick={onPickShape}>
              <SquareSlash aria-hidden="true" />
            </button>
          )}
          {onDictate && (
            <button type="button" className="ft-menu__icon-btn" aria-label="Dictate" onClick={onDictate}>
              <Mic aria-hidden="true" />
            </button>
          )}
          {busy ? (
            <button
              type="button"
              className="ft-menu__icon-btn ft-menu__send"
              data-state="busy"
              aria-label="Stop"
              onClick={onStop}
            >
              <Square aria-hidden="true" fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              className="ft-menu__icon-btn ft-menu__send"
              data-state={sendState}
              aria-label="Send"
            >
              <ArrowUp aria-hidden="true" />
            </button>
          )}
        </div>
      </form>

      <div id={drawerId} className="ft-menu__drawer" aria-label="Conversation trail">
        <div className="ft-menu__drawer-inner">
          <div className="ft-menu__drawer-head">
            <span className="ft-key">Trail</span>
            <span className="ft-mono">
              {noHover ? 'tap for the turn · tap again to rewind' : 'hover for the turn · click to rewind'}
            </span>
          </div>

          <ol ref={pillsRef} className="ft-menu__pills" aria-label="Trail" onKeyDown={handlePillKeys}>
            {turns.map((turn, i) => {
              const isCurrent = turn.id === currentId;
              const isActive = open && activeId === turn.id;
              const Icon = VESSEL_ICON[turn.vessel] ?? List;
              const tipId = `${drawerId}-tip-${turn.id}`;
              return (
                <li key={turn.id} className="ft-menu__pill-item">
                  {i > 0 && <ChevronRight className="ft-menu__sep" aria-hidden="true" />}
                  {/* hover is the wrapper's, pill and card together, so the card holds under the pointer */}
                  <span className="ft-menu__pill-wrap"
                    onMouseEnter={() => !noHover && setActiveId(turn.id)}
                    onMouseLeave={() => !noHover && setActiveId(null)}>
                    <button
                      type="button"
                      className="ft-menu__pill"
                      data-active={isActive || undefined}
                      aria-current={isCurrent ? 'step' : undefined}
                      aria-describedby={tipId}
                      onFocus={() => setActiveId(turn.id)}
                      onBlur={() => setActiveId(null)}
                      onClick={() => pick(turn)}
                    >
                      <Icon aria-hidden="true" />
                      <span className="ft-menu__pill-label">{turn.short}</span>
                    </button>

                    <div id={tipId} role="tooltip" className="ft-menu__card" data-show={isActive || undefined}>
                      <span className="ft-menu__caret" aria-hidden="true" />
                      <div className="ft-menu__card-row">
                        <span className="ft-key">
                          Turn {turn.index} · {roomLabel(turn.roomId)}
                        </span>
                        <span className="ft-mono">{formatTime(turn.at)}</span>
                      </div>
                      <p className="ft-menu__card-quote">“{turn.utterance}”</p>
                      {turn.preview?.kind === 'swatches' && (
                        <div className="ft-menu__card-preview" aria-hidden="true">
                          {turn.preview.colors.slice(0, 4).map((c, j) => (
                            <span key={j} style={{ background: c }} />
                          ))}
                        </div>
                      )}
                      {turn.preview?.kind === 'images' && (
                        <div className="ft-menu__card-preview">
                          {turn.preview.items.slice(0, 4).map((img, j) => (
                            <img key={j} src={img.src} alt={img.alt} loading="lazy" />
                          ))}
                        </div>
                      )}
                      <p className="ft-menu__card-summary">{turn.summary}</p>
                      <div className="ft-menu__card-foot">
                        <span className="ft-mono">
                          {turn.shape} · {turn.vessel}
                        </span>
                        {isCurrent ? (
                          <span className="ft-menu__here">You are here</span>
                        ) : (
                          <button
                            type="button"
                            className="ft-menu__rewind"
                            onClick={() => {
                              onRewind?.(turn.id);
                              close(false);
                            }}
                          >
                            <RotateCcw aria-hidden="true" />
                            Rewind here
                          </button>
                        )}
                      </div>
                    </div>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}

export default FishteaMenu;
