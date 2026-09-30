/**
 * The conversation as browser navigation — the heart of the sections shell.
 *
 * Every turn is a history entry whose state is the turn id. Browser Back and Forward (and our own Back)
 * therefore move along the conversation: a popstate rewinds the trail's head to that turn and shows the
 * pour it stored — no re-classification, no new turn. Saying something new after going back branches the
 * trail from there, which is exactly what the trail was built to do.
 *
 * Actions (contact, remember me) are turns too, but they open *over* the section the visitor was on, so
 * `section` is the last pour that was not an action and `current` is what was said last.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { resume as arrive, rewind, subscribe, utter, type Pour, type Response, type Utterance } from "@fishtea/ui/lib/client";
import { actions, home, isAction, parentOf, parseLocation, urlFor, type Route } from "./site";

export interface View { res: Response; route: Route }
export interface Conversation {
  current: View | null;
  section: View | null;
  resumed: boolean;
  busy: boolean;
  error: string | null;
  notices: { id: number; text: string }[];
  log: Map<string, Response>;
  go(shape: string, args?: Record<string, unknown>): void;
  ask(text: string): void;
  submit(shape: string, args: Record<string, unknown>, confirm?: boolean): void;
  contact(prefill?: Record<string, unknown>): void;
  act(key: string, prefill?: Record<string, unknown>): void;
  closeAction(): void;
  back(): void;
  up(): void;
  home(): void;
  dismissResumed(): void;
}

export const shapeOf = (p?: Pour) => (p && "shape" in p ? p.shape : undefined);

export function useConversation(): Conversation {
  const [current, setCurrent] = useState<View | null>(null);
  const [section, setSection] = useState<View | null>(null);
  const [resumed, setResumed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<{ id: number; text: string }[]>([]);
  const log = useRef(new Map<string, Response>());
  const sectionRef = useRef<View | null>(null);

  /** Put a view on screen, and (unless it came from history) record it in history. */
  const show = useCallback((view: View, how: "push" | "replace" | "none") => {
    log.current.set(view.res.turn.id, view.res);
    const action = isAction(shapeOf(view.res.pour)) ? shapeOf(view.res.pour) : undefined;
    let url: string;
    if (action) {
      url = urlFor({ ...(sectionRef.current?.route ?? { shape: home, args: {} }), action });
    } else {
      sectionRef.current = view;
      setSection(view);
      url = urlFor(view.route);
    }
    setCurrent(view);
    setError(null);
    if (how !== "none") history[how === "push" ? "pushState" : "replaceState"]({ turnId: view.res.turn.id }, "", url);
    if (how === "push") window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  /** The arguments the engine actually used — for a typed utterance, what the classifier extracted. */
  const knownArgs = (p: Pour) => ((p.kind === "answer" && p.args) || {}) as Record<string, string>;

  const send = useCallback(async (u: Utterance, how: "push" | "replace" = "push") => {
    setBusy(true);
    try {
      const res = await utter(u);
      if (!res) return; // a newer utterance overtook this one
      const shape = shapeOf(res.pour);
      let route: Route;
      if ("shape" in u) route = { shape: u.shape, args: (u.args ?? {}) as Record<string, string> };
      else if (shape && res.pour.kind === "answer") route = { shape, args: knownArgs(res.pour) };
      else route = { shape: sectionRef.current?.route.shape ?? home, args: {}, text: "text" in u ? u.text : undefined };
      show({ res, route }, how);
      for (const n of res.notifications) notice((n as any).text);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [show]);

  const nextId = useRef(0);
  const notice = (text: string) => {
    const id = ++nextId.current;
    setNotices((n) => [...n, { id, text }]);
    setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), 8000);
  };

  /** Arrival: a deep link is honoured, "/" is either the greeting (→ home) or the conversation they left. */
  useEffect(() => {
    let off = () => {};
    (async () => {
      const route = parseLocation();
      setBusy(true);
      let res: Response;
      try { res = await arrive(); } catch (e) { setError((e as Error).message); setBusy(false); return; }
      setBusy(false);
      off = subscribe((type, data) => { if (type === "notification") notice(data.text); });

      const greeting = res.pour.kind === "ask" && (res.pour as any).reason === "greeting";
      if (route.text) return send({ text: route.text }, "replace");
      const deepLink = route.shape && (route.shape !== home || Object.keys(route.args).length);
      if (deepLink) {
        await send({ shape: route.shape!, args: route.args, submit: true }, "replace");
        if (route.action) send({ shape: route.action, submit: true }, "push");
        return;
      }
      const leftOff = shapeOf(res.pour);
      if (greeting || !leftOff || isAction(leftOff) || res.pour.kind === "ask" || leftOff === home) return send({ shape: home, submit: true }, "replace");
      // A returning visitor: "/" is the conversation they left, with a way back to the front page.
      show({ res, route: { shape: leftOff, args: knownArgs(res.pour) } }, "replace");
      setResumed(true);
    })();
    return () => off();
  }, [send, show]);

  /** Browser Back/Forward: rewind the trail to the turn that history entry recorded. */
  useEffect(() => {
    const onPop = async (e: PopStateEvent) => {
      const turnId = e.state?.turnId as string | undefined;
      const route = parseLocation();
      if (!turnId) { if (route.shape) send({ shape: route.shape, args: route.args, submit: true }, "replace"); return; }
      setBusy(true);
      try {
        const r = await rewind(turnId);
        const known = log.current.get(turnId);
        const res: Response = known ? { ...known, pour: r.pour } : { pour: r.pour, turn: { id: turnId, seq: r.seq, trailId: "", parentId: null }, visitor: { id: "", created: false }, persona: "", notifications: [], timings: { classifyMs: 0, planMs: 0, totalMs: 0 }, classifier: "" };
        const action = route.action;
        if (action && !isAction(shapeOf(res.pour))) route.action = undefined;
        // an action entry reopens over the section recorded in its URL
        show({ res, route: action ? (sectionRef.current?.route ?? route) : route }, "none");
      } catch {
        // the turn belongs to an earlier visit's trail: ask again from the URL instead
        if (route.shape) send({ shape: route.shape, args: route.args, submit: true }, "replace");
      } finally { setBusy(false); }
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [send, show]);

  const go = (shape: string, args: Record<string, unknown> = {}) => { setResumed(false); send({ shape, args, submit: true }); };
  const cur = shapeOf(current?.res.pour);

  return {
    current, section, resumed, busy, error, notices, log: log.current,
    go,
    ask: (text) => { setResumed(false); send({ text }); },
    submit: (shape, args, confirm) => send({ shape, args, submit: true, confirm }),
    contact: (prefill = {}) => send({ shape: actions.contact.shape, args: prefill, submit: true }),
    act: (key, prefill = {}) => actions[key] && send({ shape: actions[key].shape, args: prefill, submit: true }),
    closeAction: async () => {
      const s = sectionRef.current;
      if (!s) return go(home);
      try { await rewind(s.res.turn.id); show(s, "push"); } catch { go(s.route.shape ?? home, s.route.args); }
    },
    back: () => history.back(),
    up: () => {
      if (isAction(cur)) return history.back();
      const p = parentOf(shapeOf(section?.res.pour));
      if (p) go(p);
    },
    home: () => go(home),
    dismissResumed: () => setResumed(false),
  };
}
