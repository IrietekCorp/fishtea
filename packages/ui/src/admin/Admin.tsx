/**
 * /admin: where the people who run this application sign in. Visitors (every visit, every turn, the
 * layout each answer carried — what /debug used to show a visitor about themselves), the questions
 * nobody could answer, the reports the spec declares, the rows the spec opens to operators, the operator shapes as jobs to run, the spec itself, the lighter settings, and
 * their own account.
 *
 * The gate is the core's, not this page's: every call is refused without a session, and a session on the
 * password it was given can do nothing but change it. This page only follows along — it shows the
 * sign-in, then the forced change, then the console.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { KeyRound, Loader2, LogOut } from "lucide-react";
import { AdminError, SIGNED_OUT, changePassword, me, signIn, signOut, type Me } from "./client";
import { Visitors, Unmet } from "./Visitors";
import { SpecEditor } from "./SpecEditor";
import { Settings } from "./Settings";
import { Data } from "./Data";
import { Jobs } from "./Jobs";
import { Reports } from "./Reports";

const SECTIONS = [
  { path: "reports", label: "Reports" },
  { path: "visitors", label: "Visitors" },
  { path: "unmet", label: "Unmet" },
  { path: "data", label: "Data" },
  { path: "jobs", label: "Jobs" },
  { path: "spec", label: "Spec" },
  { path: "settings", label: "Settings" },
  { path: "account", label: "Account" },
] as const;

/** /admin/visitors/v_123 → ["visitors", "v_123"] */
const route = () => location.pathname.replace(/^\/admin\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);

export function useAdminRoute() {
  const [parts, setParts] = useState(route);
  useEffect(() => { const on = () => setParts(route()); addEventListener("popstate", on); return () => removeEventListener("popstate", on); }, []);
  const go = useCallback((...p: string[]) => { history.pushState({}, "", `/admin/${p.map(encodeURIComponent).join("/")}`); setParts(p); scrollTo({ top: 0 }); }, []);
  return { parts, go };
}
export type Go = ReturnType<typeof useAdminRoute>["go"];

export function Admin() {
  const [who, setWho] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { parts, go } = useAdminRoute();
  const refresh = useCallback(() => me().then(setWho).catch((e) => setError(e.message)), []);
  useEffect(() => { document.title = "Admin"; refresh(); }, [refresh]);
  useEffect(() => { addEventListener(SIGNED_OUT, refresh); return () => removeEventListener(SIGNED_OUT, refresh); }, [refresh]);

  if (error) return <Frame><p role="alert" className="text-write">{error}</p></Frame>;
  if (!who) return <Frame><Loader2 className="mx-auto h-6 w-6 animate-spin text-accent" aria-label="Loading" /></Frame>;
  if (!who.operator) return <Frame><SignIn onDone={setWho} /></Frame>;
  if (who.mustChange) return (
    <Frame>
      <h1 className="mb-2 text-2xl font-black tracking-tight">Choose your own password</h1>
      <p className="mb-6 text-sm text-muted-foreground">You signed in as <b className="text-foreground">{who.operator.username}</b> with the password this installation was given. Nothing else opens until you replace it.</p>
      <PasswordForm onDone={refresh} submitLabel="Set password and continue" />
    </Frame>
  );

  const section = parts[0] && SECTIONS.some((s) => s.path === parts[0]) ? parts[0] : "reports";
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
          <a href="/admin" onClick={(e) => { e.preventDefault(); go("reports"); }} className="font-black tracking-tighter">Admin<span className="text-accent">.</span></a>
          <nav className="flex flex-1 gap-1 overflow-x-auto" aria-label="Admin">
            {SECTIONS.map((s) => (
              <button key={s.path} onClick={() => go(s.path)} aria-current={section === s.path ? "page" : undefined}
                className={`rounded px-3 py-1.5 text-sm font-semibold ${section === s.path ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{s.label}</button>
            ))}
          </nav>
          <span className="hidden text-sm text-muted-foreground sm:inline">{who.operator.username}</span>
          <button onClick={async () => { await signOut().catch(() => {}); refresh(); }} className="rounded p-2 text-muted-foreground hover:text-foreground" aria-label="Sign out" title="Sign out"><LogOut className="h-4 w-4" /></button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {section === "reports" && <Reports parts={parts.slice(1)} go={go} />}
        {section === "visitors" && <Visitors parts={parts.slice(1)} go={go} />}
        {section === "unmet" && <Unmet go={go} />}
        {section === "data" && <Data parts={parts.slice(1)} go={go} />}
        {section === "jobs" && <Jobs />}
        {section === "spec" && <SpecEditor />}
        {section === "settings" && <Settings />}
        {section === "account" && (
          <div className="max-w-md">
            <h1 className="mb-6 text-2xl font-black tracking-tight">Change your password</h1>
            <PasswordForm onDone={() => {}} submitLabel="Change password" />
          </div>
        )}
      </main>
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-2xl">{children}</div>
    </div>
  );
}

const inputCls = "h-11 w-full rounded border border-border bg-background px-3 text-foreground focus:border-accent focus:outline-none";
const primaryCls = "flex h-11 w-full items-center justify-center gap-2 rounded bg-accent font-black text-accent-foreground hover:brightness-110 disabled:opacity-60";

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div className="space-y-1.5"><label htmlFor={id} className="text-xs font-black uppercase tracking-widest text-muted-foreground">{label}</label>{children}</div>;
}

function SignIn({ onDone }: { onDone: (m: Me) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { onDone(await signIn(username, password)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); setPassword(""); }
  };
  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-accent" /><h1 className="text-2xl font-black tracking-tight">Sign in</h1></div>
      <Field id="u" label="Username"><input id="u" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} className={inputCls} autoFocus /></Field>
      <Field id="p" label="Password"><input id="p" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} /></Field>
      {error && <p role="alert" className="text-sm text-write">{error}</p>}
      <button type="submit" disabled={busy} className={primaryCls}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Sign in</button>
    </form>
  );
}

export function PasswordForm({ onDone, submitLabel }: { onDone: () => void; submitLabel: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setMessage(null);
    if (next !== again) return setMessage({ ok: false, text: "the two new passwords are not the same" });
    setBusy(true);
    try { await changePassword(current, next); setCurrent(""); setNext(""); setAgain(""); setMessage({ ok: true, text: "Password changed. Other sessions have been signed out." }); onDone(); }
    catch (e) { setMessage({ ok: false, text: e instanceof AdminError ? e.message : String(e) }); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-5">
      <Field id="cur" label="Current password"><input id="cur" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} className={inputCls} /></Field>
      <Field id="new" label="New password"><input id="new" type="password" autoComplete="new-password" required minLength={12} value={next} onChange={(e) => setNext(e.target.value)} className={inputCls} aria-describedby="new-hint" /></Field>
      <p id="new-hint" className="-mt-3 text-xs text-muted-foreground">At least 12 characters. A few ordinary words together is a good one.</p>
      <Field id="again" label="New password, again"><input id="again" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} className={inputCls} /></Field>
      {message && <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-success" : "text-write"}`}>{message.text}</p>}
      <button type="submit" disabled={busy} className={primaryCls}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{submitLabel}</button>
    </form>
  );
}
