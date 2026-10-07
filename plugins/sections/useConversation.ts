/**
 * The conversation as browser navigation — the heart of the sections shell.
 *
 * History is the conversation, not the addresses. Each history entry is a point in the conversation (its
 * state is the turn), and the tab's entries mirror the breadcrumb one for one, so browser Back and Forward
 * (and our own Back) step through the conversation: a popstate rewinds the trail to that turn and shows
 * the pour it stored — no re-classification, no new turn. The URL follows along for sharing and search;
 * nothing navigates by it once the page is open. Saying something new after going back branches the
 * trail from there on the server, and goes on the end of the breadcrumb and of history here.
 *
 * Actions (contact, remember me) are turns too, but they open *over* the section the visitor was on, so
 * `section` is the last pour that was not an action and `current` is what was said last.
 *
 * The breadcrumb (`crumbs`) is the visit as it happened: one crumb per thing the visitor said or clicked,
 * in order, and it only ever grows. `revisit` reviews a crumb — the trail rewinds to it and its answer is
 * shown again, no re-classification and no new crumb — and whatever is said next is appended as a new
 * crumb (the trail branches from the reviewed turn, so the engine answers in that context). The crumbs
 * are the server's record of this visit (GET /sessions), so a reload keeps them.
 *
 * Going to a section with nothing asked of it — the menu, Home, Up — is not a change to the conversation:
 * it is choosing the room to have it in. It makes no crumb. It does get a history entry, so Back returns
 * to the point the visitor came from, but a room's entry is only held until something is said: the next
 * point takes its place, and rooms are never laid back down, so Back steps over them afterwards.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { resume as arrive, rewind, sessions, subscribe, utter, type Pour, type Response, type Utterance } from "@fishtea/ui/lib/client";
import { actions, home, isAction, isSection, labelOf, parentOf, parseLocation, sectionOf, urlFor, type Route } from "./site";

export interface View { res: Response; route: Route }
/** A point in the visit: where it went (`title`), which section that is (`section`), and how to get back. */
/**
 * A point in the visit: where it went (`title`), which section that is (`section`), and how to get back —
 * plus what the menu's trail shows of it: the shape and the kind of pour it got, when, what the visitor
 * said (when they typed), and the answer's own phrase.
 */
export interface Crumb {
  turnId: string; step: number; section: string; title: string; typed: boolean; route: Route;
  shape?: string; kind: string; at: string; said?: string; phrase?: string;
}
export interface Conversation {
  current: View | null;
  section: View | null;
  resumed: boolean;
  busy: boolean;
  error: string | null;
  notices: { id: number; text: string }[];
  log: Map<string, Response>;
  crumbs: Crumb[];
  /** Review a crumb: show that point again without adding to the breadcrumb. */
  revisit(turnId: string): void;
  go(shape: string, args?: Record<string, unknown>): void;
  ask(text: string): void;
  submit(shape: string, args: Record<string, unknown>, confirm?: boolean): void;
  contact(prefill?: Record<string, unknown>): void;
  act(key: string, prefill?: Record<string, unknown>): void;
  closeAction(): void;
  /** Let go of the answer in flight: it is dropped when it lands, and the trail stays where it is. */
  stop(): void;
  /** Whether there is an earlier point in this tab to go back to (Back never leaves the site). */
  canBack: boolean;
  back(): void;
  up(): void;
  home(): void;
  dismissResumed(): void;
}

export const shapeOf = (p?: Pour) => (p && "shape" in p ? p.shape : undefined);

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * This tab's history as the turns its entries show: entry i (state.pos = i) shows ledger[i]. The browser
 * keeps its entries over a reload, so the ledger is kept in sessionStorage, which lives exactly as long.
 */
const LEDGER = "fishtea:history";
/** An entry: the turn it shows, and whether it is only a room (a section entered with nothing asked). */
interface Entry { t: string; room?: boolean }
const readLedger = (): Entry[] => {
  try { const l = JSON.parse(sessionStorage.getItem(LEDGER) ?? "[]"); return Array.isArray(l) ? l.map((e) => (typeof e === "string" ? { t: e } : e)) : []; } catch { return []; }
};
const writeLedger = (l: Entry[]) => { try { sessionStorage.setItem(LEDGER, JSON.stringify(l)); } catch { /* private mode: Back still works, by the entries' own states */ } };
const ledgerIndexOf = (turnId: string) => { const l = readLedger(); for (let i = l.length - 1; i >= 0; i--) if (l[i].t === turnId) return i; return -1; };
const posNow = (): number => (typeof history.state?.pos === "number" ? history.state.pos : 0);

/** A section entered with nothing asked of it: a room for the conversation, not a point in it. */
const isRoom = (u: Record<string, unknown>) =>
  typeof u.shape === "string" && isSection(u.shape) && !u.text && !u.confirm && !Object.keys((u.args as object) ?? {}).length;

/** The same place: one shape, the same arguments, whatever order they were written in. */
const samePlace = (a: Route, b: Route) => {
  const norm = (r: Route) => JSON.stringify([r.shape ?? home, Object.entries(r.args ?? {}).map(([k, v]) => [k, String(v)]).sort()]);
  return norm(a) === norm(b);
};

/**
 * A crumb's words. Typed, it is what the visitor asked, in their own words; clicked, it is where they
 * arrived — the answer's phrase ("FishTea", "Resume · AI · patents"), else the shape's label.
 */
function crumbOf(turnId: string, step: number, shape: string | undefined, kind: string, phrase: string | undefined, text: string | undefined, route: Route, at = new Date().toISOString()): Crumb {
  const section = shape ? labelOf(isAction(shape) ? shape : sectionOf(shape)) : "Asked";
  const about = { shape, kind, at, said: text, phrase };
  if (text) return { turnId, step, section: kind === "ask" ? "Asked" : section, title: `“${text}”`, typed: true, route, ...about };
  const title = cap(kind === "answer" && phrase ? phrase : shape ? labelOf(shape) : phrase ?? "…");
  return { turnId, step, section: title === section ? "" : section, title, typed: false, route, ...about };
}

export function useConversation(): Conversation {
  const [current, setCurrent] = useState<View | null>(null);
  const [section, setSection] = useState<View | null>(null);
  const [resumed, setResumed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<{ id: number; text: string }[]>([]);
  const log = useRef(new Map<string, Response>());
  const sectionRef = useRef<View | null>(null);
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const stopped = useRef(false);
  const currentRef = useRef<View | null>(null);
  useEffect(() => { currentRef.current = current; }, [current]);
  const routes = useRef(new Map<string, Route>());
  /** Append a crumb for a new turn (never twice for the same turn). */
  const addCrumb = useCallback((res: Response, route: Route, text?: string) => {
    routes.current.set(res.turn.id, route);
    setCrumbs((cs) => cs.some((c) => c.turnId === res.turn.id) ? cs
      : [...cs, crumbOf(res.turn.id, cs.length + 1, shapeOf(res.pour), res.pour.kind, (res.pour as any).phrase, text, route)]);
  }, []);

  const [pos, setPos] = useState(posNow);
  const urls = useRef(new Map<string, string>());
  const urlOf = (turnId: string) => urls.current.get(turnId) ?? urlFor(routes.current.get(turnId) ?? { shape: home, args: {} });

  /**
   * Record a point in history. "replace" puts it in this entry; "push" puts it on the end — after first
   * laying the entries ahead of this one back down, since a push drops them and the conversation has not.
   */
  const record = useCallback((turnId: string, url: string, how: "push" | "replace", room = false) => {
    let ledger = readLedger();
    let at = posNow();
    const entry: Entry = room ? { t: turnId, room } : { t: turnId };
    if (how === "replace" || !ledger.length || ledger[at]?.room) {
      // a first entry, a replacement, or a room giving way to whatever comes next: this entry, in place
      if (!ledger.length) at = 0;
      ledger[at] = entry;
      history.replaceState({ turnId, pos: at }, "", url);
    } else {
      // lay the points ahead of this one back down (a push drops them), leaving out rooms, then this one
      const ahead = ledger.slice(at + 1).filter((e) => !e.room);
      ledger = ledger.slice(0, at + 1);
      for (const e of ahead) { ledger.push(e); history.pushState({ turnId: e.t, pos: ledger.length - 1 }, "", urlOf(e.t)); }
      ledger.push(entry); at = ledger.length - 1;
      history.pushState({ turnId, pos: at }, "", url);
    }
    writeLedger(ledger);
    setPos(at);
  }, []);

  /** Put a view on screen, and (unless it came from history) record it in history. */
  const show = useCallback((view: View, how: "push" | "replace" | "none", room = false) => {
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
    urls.current.set(view.res.turn.id, url);
    setCurrent(view);
    setError(null);
    if (how !== "none") record(view.res.turn.id, url, how, room);
    else setPos(posNow());
    window.scrollTo({ top: 0, behavior: how === "push" ? "smooth" : "auto" });
  }, [record]);

  /** The arguments the engine actually used — for a typed utterance, what the classifier extracted. */
  const knownArgs = (p: Pour) => ((p.kind === "answer" && p.args) || {}) as Record<string, string>;

  const send = useCallback(async (u: Utterance, how: "push" | "replace" = "push") => {
    stopped.current = false;
    setBusy(true);
    try {
      const res = await utter(u);
      if (!res) return; // a newer utterance overtook this one, or the visitor stopped it
      if (stopped.current) {
        // stopped, but the core answered anyway and moved the trail's head to it: put the head back
        stopped.current = false;
        const here = currentRef.current?.res.turn.id;
        if (here) rewind(here).catch(() => {});
        return;
      }
      const shape = shapeOf(res.pour);
      let route: Route;
      if ("shape" in u) route = { shape: u.shape, args: (u.args ?? {}) as Record<string, string> };
      else if (shape && res.pour.kind === "answer") route = { shape, args: knownArgs(res.pour) };
      else route = { shape: sectionRef.current?.route.shape ?? home, args: {}, text: "text" in u ? u.text : undefined };
      const room = isRoom(u as Record<string, unknown>);
      show({ res, route }, how, room);
      if (!room) addCrumb(res, route, "text" in u ? u.text : undefined);
      for (const n of res.notifications) notice((n as any).text);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [show, addCrumb]);

  const nextId = useRef(0);
  const notice = (text: string) => {
    const id = ++nextId.current;
    setNotices((n) => [...n, { id, text }]);
    setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), 8000);
  };

  /** This visit's crumbs as the core recorded them, so a reload starts where the visitor was. */
  const restoreCrumbs = useCallback(async (): Promise<Crumb[]> => {
    try {
      const visit = (await sessions(1)).sessions.find((s) => s.current);
      if (!visit) return [];
      const turns = [...visit.turns].filter((x) => x.author === "visitor" && !isRoom({ ...(x.utterance ?? {}), shape: x.utterance?.shape })).sort((a, b) => a.seq - b.seq);
      const restored = turns.map((x, i) => {
        const u = x.utterance ?? {};
        const route: Route = { shape: x.shape ?? undefined, args: (u.known ?? u.args ?? {}) as Record<string, string> };
        routes.current.set(x.id, route);
        return crumbOf(x.id, i + 1, x.shape ?? undefined, x.kind, x.phrase, typeof u.text === "string" ? u.text : undefined, route, x.at);
      });
      setCrumbs((cs) => [...restored, ...cs.filter((c) => !restored.some((r) => r.turnId === c.turnId))].map((c, i) => ({ ...c, step: i + 1 })));
      return restored;
    } catch { return []; /* no history to show: the breadcrumb starts with this visit's first turn */ }
  }, []);

  /** Show a turn again: rewind the trail to it, and put its pour back on screen. */
  const reshow = useCallback(async (turnId: string, route: Route, how: "push" | "replace" | "none") => {
    const r = await rewind(turnId);
    if (!r?.pour) throw new Error("not on this trail");
    const known = log.current.get(turnId);
    const res: Response = known ? { ...known, pour: r.pour } : { pour: r.pour, turn: { id: turnId, seq: r.seq, trailId: "", parentId: null }, visitor: { id: "", created: false }, persona: "", notifications: [], timings: { classifyMs: 0, planMs: 0, totalMs: 0 }, classifier: "" };
    show({ res, route }, how);
  }, [show]);

  /** Arrival: a deep link is honoured, "/" is either the greeting (→ home) or the conversation they left. */
  // arrival happens once per page: React's development mode runs effects twice, and a second arrival
  // would say "home" to the core again — a turn nobody asked for, and a crumb that appears on reload
  const arrived = useRef(false);
  const unsubscribe = useRef<() => void>(() => {});
  useEffect(() => () => unsubscribe.current(), []);
  useEffect(() => {
    if (arrived.current) return;
    arrived.current = true;
    (async () => {
      const route = parseLocation();
      setBusy(true);
      let res: Response;
      try { res = await arrive(); } catch (e) { setError((e as Error).message); setBusy(false); return; }
      setBusy(false);
      unsubscribe.current = subscribe((type, data) => { if (type === "notification") notice(data.text); });
      const restored = await restoreCrumbs();

      // a reload: this entry already says which point of the conversation it is
      const was = history.state?.turnId as string | undefined;
      if (was && ledgerIndexOf(was) >= 0) {
        try { await reshow(was, routes.current.get(was) ?? route, "none"); return; } catch { /* that trail is gone: arrive afresh */ }
      }
      const greeting = res.pour.kind === "ask" && (res.pour as any).reason === "greeting";
      if (route.text) return send({ text: route.text }, "replace");
      const deepLink = route.shape && (route.shape !== home || Object.keys(route.args).length);
      // a link to a place this visit has already been: show that point again rather than asking twice
      const here = [...restored].reverse().find((k) => samePlace(k.route, route));
      if (deepLink && !route.action && here) {
        try { await reshow(here.turnId, route, "replace"); return; } catch { /* fall through and ask */ }
      }
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
  }, [send, show, reshow, restoreCrumbs]);

  /** Browser Back/Forward: rewind the trail to the turn that history entry recorded. */
  useEffect(() => {
    const onPop = async (e: PopStateEvent) => {
      const turnId = e.state?.turnId as string | undefined;
      const route = parseLocation();
      if (!turnId) { if (route.shape) send({ shape: route.shape, args: route.args, submit: true }, "replace"); return; }
      setBusy(true);
      try {
        // the turn's own place, as the conversation recorded it; the URL is only a fallback
        const known = routes.current.get(turnId);
        await reshow(turnId, known ?? (route.action ? (sectionRef.current?.route ?? route) : route), "none");
      } catch {
        // the turn belongs to an earlier visit's trail: ask again from the URL instead
        if (route.shape) send({ shape: route.shape, args: route.args, submit: true }, "replace");
      } finally { setBusy(false); }
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [send, reshow]);

  const go = (shape: string, args: Record<string, unknown> = {}) => { setResumed(false); send({ shape, args, submit: true }); };

  /**
   * Review a point. When this tab's history holds it, that is a walk through history (the popstate shows
   * it), so Back and Forward stay the breadcrumb's order. When it does not — a crumb from before this tab
   * opened — it is shown and put on the end of history.
   */
  const revisit = async (turnId: string) => {
    setResumed(false);
    const route = routes.current.get(turnId) ?? { shape: home, args: {} };
    const p = ledgerIndexOf(turnId), q = posNow();
    if (p === q) {
      // this entry's own point, but something earlier is on screen: put it back without moving history
      if (current?.res.turn.id !== turnId) { setBusy(true); try { await reshow(turnId, route, "none"); } catch { /* stays */ } finally { setBusy(false); } }
      return;
    }
    if (p >= 0) return history.go(p - q);
    setBusy(true);
    // a crumb from an earlier visit's trail cannot be rewound to: ask for that place again instead
    try { await reshow(turnId, route, "push"); } catch { if (route.shape) send({ shape: route.shape, args: route.args, submit: true }); }
    finally { setBusy(false); }
  };
  const cur = shapeOf(current?.res.pour);

  return {
    current, section, resumed, busy, error, notices, log: log.current,
    revisit,
    crumbs,
    stop: () => { stopped.current = true; setBusy(false); },
    canBack: pos > 0,
    go,
    ask: (text) => { setResumed(false); send({ text }); },
    submit: (shape, args, confirm) => send({ shape, args, submit: true, confirm }),
    contact: (prefill = {}) => send({ shape: actions.contact.shape, args: prefill, submit: true }),
    act: (key, prefill = {}) => actions[key] && send({ shape: actions[key].shape, args: prefill, submit: true }),
    // closing an action returns to the point it opened over, as a pill would
    closeAction: () => { const s = sectionRef.current; return s ? revisit(s.res.turn.id) : go(home); },
    back: () => { if (posNow() > 0) history.back(); },
    up: () => {
      if (isAction(cur)) { const s = sectionRef.current; return s ? revisit(s.res.turn.id) : go(home); }
      const p = parentOf(shapeOf(section?.res.pour));
      if (p) go(p);
    },
    home: () => go(home),
    dismissResumed: () => setResumed(false),
  };
}
