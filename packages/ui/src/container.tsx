/**
 * The container (BLUEPRINT §10): one input (debounced 250 ms), the understood line (phrase + confidence dot with
 * text), the vessel, the verify strip (provenance: shape, read, wrote, records, time; writes in accent), and next[]
 * chips. aria-live="polite" announces each pour's phrase — but not on every keystroke (§12): only when the vessel
 * kind or shape changes, or on submit.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Undo2 } from "lucide-react";
import { Input } from "./components/ui/input";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Separator } from "./components/ui/separator";
import { utter, resume, subscribe, trail as fetchTrail, rewind as doRewind, type Pour, type Response, type Chip } from "./lib/client";
import { ListVessel } from "./vessels/list";
import { CardVessel } from "./vessels/card";
import { DetailVessel } from "./vessels/detail";
import { CompareVessel } from "./vessels/compare";
import { TimelineVessel } from "./vessels/timeline";
import { ConfirmVessel } from "./vessels/confirm";
import { FormVessel } from "./vessels/form";
import { AskVessel, Chips } from "./vessels/ask";
import { vesselOverrides } from "./plugins.generated";
import { Notice } from "./vessels/notice";

export function Container() {
  const [res, setRes] = useState<Response | null>(null);
  const [notices, setNotices] = useState<Pour[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [turns, setTurns] = useState<any[]>([]);
  const [showTrail, setShowTrail] = useState(false);
  const lastKey = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const apply = useCallback((r: Response | null, submitted = false) => {
    if (!r) return;
    setRes(r);
    setNotices((n) => [...n, ...r.notifications]);
    const key = `${r.pour.kind}:${(r.pour as any).shape ?? ""}`;
    if (submitted || key !== lastKey.current) { lastKey.current = key; setAnnounce((r.pour as any).phrase ?? (r.pour as any).text ?? ""); }
  }, []);

  useEffect(() => { resume().then((r) => apply(r, true)).finally(() => { fetchTrail().then((t) => setTurns(t.turns)).catch(() => {}); }); }, [apply]);
  useEffect(() => subscribe((type, data) => {
    if (type === "notification") { setNotices((n) => [...n, data]); setToast(data.text); setTimeout(() => setToast(null), 6000); }
    if (type === "reload") setToast(`Spec reloaded → v${data.version}`);
  }), [res?.visitor.id]);

  const send = useCallback(async (u: Parameters<typeof utter>[0], submitted = false) => {
    setBusy(true);
    try { const r = await utter(u); apply(r, submitted); if (r) fetchTrail().then((t) => setTurns(t.turns)).catch(() => {}); } finally { setBusy(false); }
  }, [apply]);

  // per-keystroke re-pour, debounced 250 ms; sequence numbers in the client drop stale pours
  const onType = (v: string) => { setText(v); clearTimeout(timer.current); if (v.trim().length >= 3) timer.current = setTimeout(() => send({ text: v }), 250); };
  const onSubmit = (e: React.FormEvent) => { e.preventDefault(); clearTimeout(timer.current); if (text.trim()) send({ text }, true); };
  const pick = (c: Chip) => { setText(""); send({ shape: c.shape, args: c.args, submit: true }, true); };
  const submitForm = (shape: string) => (args: Record<string, unknown>, confirm: boolean) => send({ shape, args, submit: true, confirm }, true);
  const rewindTo = async (turnId: string) => { await doRewind(turnId); const r = await resume(); apply(r, true); fetchTrail().then((t) => setTurns(t.turns)); };

  const pour = res?.pour;
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><span className="font-semibold text-foreground">FishTea</span>{res && <Badge variant="outline">{res.persona}</Badge>}</div>
        <Button variant="ghost" size="sm" onClick={() => setShowTrail((s) => !s)} aria-expanded={showTrail}>trail · {turns.length}</Button>
      </header>

      <form onSubmit={onSubmit} className="mb-4 flex gap-2" role="search">
        <Input value={text} onChange={(e) => onType(e.target.value)} placeholder={(pour as any)?.hint ?? "Say what you're after…"} aria-label="Say what you're after" autoFocus />
        <Button type="submit" disabled={busy} aria-label="Send"><Send className="h-4 w-4" /></Button>
      </form>

      {toast && <div role="status" className="mb-3 rounded-md border border-accent bg-accent/15 px-3 py-2 text-sm">{toast}</div>}
      {notices.slice(-3).map((n: any, i) => <div key={i} className="mb-3"><Notice author={n.author} text={n.text} next={n.next ?? []} onPick={pick} /></div>)}

      <div aria-live="polite" className="sr-only">{announce}</div>

      {res && pour && (
        <section key={res.turn.id} className="pour-enter space-y-4" aria-label="answer">
          {res.understood && pour.kind !== "ask" && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="text-foreground">{res.understood.phrase}</span>
              <span className="inline-flex items-center gap-1" title={`confidence ${(res.understood.confidence * 100).toFixed(0)}%`}>
                <span aria-hidden className={`h-2 w-2 rounded-full ${res.understood.confidence >= 0.8 ? "bg-success" : res.understood.confidence >= 0.5 ? "bg-warn" : "bg-write"}`} />
                {Math.round(res.understood.confidence * 100)}% sure
              </span>
              {(pour as any).stale && <Badge variant="write">stale</Badge>}
            </p>
          )}
          <Vessel pour={pour} pick={pick} submitForm={submitForm} />
          {(pour.kind === "answer" || pour.kind === "composite") && (
            <>
              <Chips chips={pour.next} onPick={pick} label="Next" />
              <Separator />
              {/* A composite has several shapes, reads and writes, and collapsing them into one line
                  would be the opacity the verify strip exists to prevent — so it gets a line each. */}
              {pour.kind === "composite"
                ? pour.provenance.map((p, i) => (
                    <VerifyStrip key={p.shape ?? i} p={p} classifier={res.classifier}
                      timings={i === 0 ? res.timings : { ...res.timings, totalMs: p.ms ?? 0, classifyMs: 0, planMs: p.ms ?? 0 }} />
                  ))
                : <VerifyStrip p={pour.provenance} classifier={res.classifier} timings={res.timings} />}
            </>
          )}
        </section>
      )}

      {showTrail && (
        <aside className="mt-6 rounded-lg border border-border p-3 text-sm" aria-label="trail">
          <h2 className="mb-2 font-semibold">Trail <span className="font-normal text-muted-foreground">— rewind to any turn; a new utterance branches from there</span></h2>
          <ol className="space-y-1">
            {turns.map((t) => (
              <li key={t.id} className={`flex items-center gap-2 ${t.id === res?.turn.id ? "font-medium" : ""}`}>
                <span className="w-6 tabular-nums text-muted-foreground">{t.seq}</span>
                <Badge variant="outline">{t.kind}</Badge>
                <span className="truncate">{t.utterance?.text ?? t.utterance?.shape ?? (t.utterance?.arrive ? "arrived" : t.utterance?.notification ?? "")}{t.shape ? <span className="text-muted-foreground"> → {t.shape}</span> : null}</span>
                {t.id !== res?.turn.id && t.kind !== "notification" && <Button variant="ghost" size="sm" onClick={() => rewindTo(t.id)} aria-label={`rewind to turn ${t.seq}`}><Undo2 className="h-3 w-3" /></Button>}
              </li>
            ))}
          </ol>
        </aside>
      )}
    </div>
  );
}

/**
 * A ui plugin may replace a vessel outright, not just restyle it.
 *
 * `plugins.generated.ts` is written by `fishtea ui-assets` and is an empty object for almost every
 * application; a design system that only moves tokens needs no component at all. An override is handed
 * the same props the built-in would have received plus the whole pour, so it can be as thin as a
 * different card or as thick as it likes — and anything it does not claim stays the built-in, which is
 * why this is a lookup with a fallback rather than a registry the framework depends on.
 */
function overrideFor(name: string) {
  return vesselOverrides[name];
}

function Vessel({ pour, pick, submitForm }: { pour: Pour; pick: (c: Chip) => void; submitForm: (shape: string) => (args: Record<string, unknown>, confirm: boolean) => void }) {
  const Override = overrideFor(pour.kind === "answer" ? pour.vessel : pour.kind);
  if (Override) return <Override pour={pour} onPick={pick} submitForm={submitForm} />;
  switch (pour.kind) {
    case "ask": return <AskVessel phrase={pour.phrase} hint={pour.hint} options={pour.options} onPick={pick} />;
    case "form": {
      // A chip carrying `on` is not shown as a chip: it fires when its field changes. The rest are
      // offered as usual, so a spec can mix "ask me when you pick a country" with "or do this instead".
      const watch = (pour.options ?? []).filter((c) => c.on).map((c) => ({ field: c.on!.field, shape: c.shape, args: c.args }));
      const clickable = (pour.options ?? []).filter((c) => !c.on);
      return <>
        <FormVessel shape={pour.shape} fields={pour.fields} known={pour.known} errors={pour.errors} error={pour.error} hint={pour.hint} phrase={pour.phrase} write={false} onSubmit={submitForm(pour.shape)}
          watch={watch} onFire={(c) => pick({ label: "", shape: c.shape, args: c.args })} />
        {clickable.length > 0 && <Chips chips={clickable} onPick={pick} label="Or" />}
      </>;
    }
    case "confirm-write": return <FormVessel shape={pour.shape} fields={pour.fields} known={pour.known} phrase={pour.phrase} summary={pour.summary} write onSubmit={submitForm(pour.shape)} />;
    case "notification": return <Notice author={pour.author} text={pour.text} next={pour.next} onPick={pick} />;
    // A composite renders its root, then its root's children, each through this same function. Parts are
    // ordinary pours, so nothing below needed a new branch and a vessel override still applies per part.
    case "composite": {
      const order = [pour.root, ...(pour.parts[pour.root]?.children ?? [])];
      return (
        <div className="space-y-6">
          {order.map((id) => {
            const part = pour.parts[id];
            if (!part) return null;
            return (
              <section key={id} aria-label={part.from ?? id} className="pour-enter">
                <Vessel pour={part.of} pick={pick} submitForm={submitForm} />
              </section>
            );
          })}
        </div>
      );
    }
    case "answer": {
      const a = pour.answer;
      switch (pour.vessel) {
        case "list": return <ListVessel rows={Array.isArray(a) ? a : []} />;
        case "card": return <CardVessel record={a} />;
        case "detail": return <DetailVessel record={a ?? {}} />;
        case "compare": return <CompareVessel left={a.left} right={a.right} facets={a.facets} />;
        case "timeline": return <TimelineVessel record={a ?? {}} />;
        case "confirm": return <ConfirmVessel record={a ?? {}} phrase={pour.phrase} />;
      }
    }
  }
  return null;
}

function VerifyStrip({ p, classifier, timings }: { p: any; classifier: string; timings: Response["timings"] }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="verify">
      <span>shape <code>{p.shape}</code></span>
      {p.calls?.length > 0 && <span>calls {p.calls.map((c: any) => `${c.call} ${c.ms}ms`).join(" → ")}</span>}
      {p.read?.length > 0 && <span>read {p.read.join(", ")}</span>}
      {p.wrote?.length > 0 && <strong className="text-write">wrote {p.wrote.join(", ")}</strong>}
      <span>{p.records} records</span>
      <span>{timings.totalMs} ms (classify {timings.classifyMs}, plan {timings.planMs})</span>
      <span>{classifier}{classifier === "lexical" ? " (dev)" : ""}</span>
    </p>
  );
}
