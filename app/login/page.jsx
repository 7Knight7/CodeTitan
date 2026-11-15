"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { ROLES } from "@/components/RoleProvider";
import Icon, { Logo } from "@/components/Icon";
import { PasswordInput } from "@/components/AuthFrame";

// Demo accounts are listed in the order the guided demo visits them: Priya, then Arjun, then Meera.
const DEMO_ORDER = ["Creator", "Reviewer", "Marketing head"];
const byDemoOrder = (a, b) => DEMO_ORDER.indexOf(a.role) - DEMO_ORDER.indexOf(b.role);

const ROLE_HELP = {
  Creator: "Writes posts, fixes issues and sends them for review.",
  Reviewer: "Approves posts or asks for changes.",
  "Marketing head": "Uploads the brand kit and approves sensitive posts.",
};

export default function LoginPage() {
  return <Suspense fallback={null}><Login /></Suspense>;
}

function Login() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("Creator");
  const [health, setHealth] = useState(null); // { auth_mode, password_required, setup_needed, brand }
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/health").then(setHealth).catch(() => setHealth({ auth_mode: "password", password_required: true }));
  }, []);
  const mode = health?.auth_mode;
  const needsPassword = health ? !!health.password_required : null;
  const brand = health?.brand || "";

  const go = () => {
    const next = params.get("next") || "/overview"; // the guided demo lives on Overview
    window.location.href = next.startsWith("/") && !next.startsWith("//") ? next : "/"; // no open redirects
  };

  async function run(fn) {
    setBusy(true); setError("");
    try { await fn(); } catch (err) { setError(err.message); setBusy(false); }
  }

  const submitDemo = (e) => { e.preventDefault(); run(async () => { await api("/login", { method: "POST", body: { password: needsPassword ? password : "", role } }); go(); }); };
  const submitAccount = (e) => {
    e.preventDefault();
    run(async () => {
      await api("/login/account", { method: "POST", body: { email, password } });
      go();
    });
  };

  const sub = brand && brand !== "No brand kit yet" ? ` for ${brand}` : "";
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <ProductSample />
      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-[26rem]">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <Logo className="h-9 w-9" />
            <span className="text-lg font-semibold tracking-tight">Live Brand Check</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>

          {mode === "accounts" && (
            <>
              <p className="mt-1.5 text-sm leading-6 text-muted">Pre-publication brand and ad-claim checks{sub}. Sign in with your work account.</p>
              {health.setup_needed && (
                <p className="mt-4 flex items-start gap-2.5 rounded-lg bg-teal-soft/70 px-3.5 py-2.5 text-sm ring-1 ring-inset ring-teal/25">
                  <Icon name="sparkle" className="mt-0.5 h-4 w-4 shrink-0 text-teal-dark" />
                  <span>No accounts yet. <a href="/setup" className="font-medium underline">Set up the first account</a> (the marketing head).</span>
                </p>
              )}
              {health.demo_accounts?.length > 0 && (
                <div className="mt-4 rounded-lg bg-teal-soft/70 p-3.5 ring-1 ring-inset ring-teal/25">
                  <p className="flex items-center gap-2 text-sm font-medium"><Icon name="user" className="h-4 w-4 text-teal-dark" /> Demo accounts for testing</p>
                  <p className="mt-0.5 text-xs text-muted">Pick one to fill in the form, then press Sign in. Fictional demo data.</p>
                  <ul className="mt-2.5 space-y-1.5">
                    {[...health.demo_accounts].sort(byDemoOrder).map((a) => (
                      <li key={a.email} className="flex items-center gap-3 rounded-md bg-surface px-3 py-2 text-sm ring-1 ring-inset ring-line">
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{a.name}</span>
                          <span className="block break-all font-mono text-xs text-muted">{a.email} · {a.password}</span>
                        </span>
                        <button type="button" className="btn btn-sm shrink-0" onClick={() => { setEmail(a.email); setPassword(a.password); setError(""); }}
                          aria-label={`Use the ${a.name} demo account`}>Use</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <form onSubmit={submitAccount} className="mt-6 space-y-4">
                <div>
                  <label className="label" htmlFor="email">Work email</label>
                  <input id="email" type="email" autoComplete="username" required maxLength={254} className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="password">Password</label>
                  <PasswordInput id="password" value={password} onChange={setPassword} />
                </div>
                {error && <p role="alert" className="rounded-md bg-blocker-soft px-3 py-2 text-sm text-blocker">{error}</p>}
                <button className="btn btn-teal w-full py-2.5" disabled={busy || !email || !password}>{busy ? "Signing in…" : "Sign in"}</button>
                <p className="text-center text-xs text-muted">New here? Ask your marketing head for an invitation link. Forgot your password? Ask them to send you a new invitation.</p>
              </form>
            </>
          )}

          {mode && mode !== "accounts" && (
            <>
              <p className="mt-1.5 text-sm leading-6 text-muted">Pre-publication brand and ad-claim checks{sub}. Choose who you are to start.</p>
              <p className="mt-4 flex items-start gap-2.5 rounded-lg bg-teal-soft/70 px-3.5 py-2.5 text-sm ring-1 ring-inset ring-teal/25">
                <Icon name="checkCircle" className="mt-0.5 h-4 w-4 shrink-0 text-teal-dark" />
                <span>No setup needed. A sample brand kit is already loaded, and a guided demo opens after you continue.</span>
              </p>
              <form onSubmit={submitDemo} className="mt-6 space-y-5">
                {needsPassword && (
                  <div>
                    <label className="label" htmlFor="password">Password</label>
                    <PasswordInput id="password" value={password} onChange={setPassword} />
                  </div>
                )}
                <fieldset>
                  <legend className="label">Continue as</legend>
                  <div className="space-y-2">
                    {Object.entries(ROLES).map(([r, name]) => (
                      <label key={r} className={`flex cursor-pointer items-center gap-3 rounded-lg border bg-surface px-3.5 py-3 transition-colors ${role === r ? "border-teal ring-1 ring-teal" : "border-line hover:border-line-strong"}`}>
                        <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="sr-only" />
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${role === r ? "bg-teal text-ink" : "bg-canvas text-muted ring-1 ring-line"}`} aria-hidden>{name.charAt(0)}</span>
                        <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{name}</span><span className="block text-xs text-muted">{ROLE_HELP[r]}</span></span>
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${role === r ? "border-teal bg-teal" : "border-line-strong"}`} aria-hidden>
                          {role === r && <span className="h-1.5 w-1.5 rounded-full bg-surface" />}
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted">You can switch roles later from the account menu.</p>
                </fieldset>
                {error && <p role="alert" className="rounded-md bg-blocker-soft px-3 py-2 text-sm text-blocker">{error}</p>}
                <button className="btn btn-teal w-full py-2.5" disabled={busy || (needsPassword && !password)}>
                  {busy ? "Opening…" : needsPassword ? "Sign in" : "Continue"}
                </button>
                {needsPassword === false && <p className="text-center text-xs text-muted">Demo access: no password needed.</p>}
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Left panel: a sample coaching ad as the checker would mark it. A static illustration, not live data. */
function ProductSample() {
  return (
    <section className="relative hidden flex-col justify-between overflow-hidden rounded-r-[2.5rem] bg-navy p-12 text-white shadow-xl lg:flex xl:p-16" aria-label="Example of a checked post">
      <div className="flex items-center gap-3">
        <Logo className="h-9 w-9" />
        <span className="text-lg font-semibold tracking-tight">Live Brand Check</span>
      </div>

      <div className="max-w-lg">
        <h2 className="text-[1.75rem] font-semibold leading-tight tracking-tight">Every claim checked before it goes live.</h2>
        <p className="mt-3 text-sm leading-6 text-white/60">Brand guidelines, approved facts and Indian advertising rules, applied to every post, with the source for every finding.</p>

        <div className="theme-light mt-10 overflow-hidden rounded-lg bg-surface text-ink shadow-xl">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-xs text-muted">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink text-2xs font-semibold text-white">N</span>
            Draft caption, Instagram feed
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-blocker-soft px-2 py-0.5 font-medium text-blocker">1 critical, 1 warning</span>
          </div>
          <p className="px-4 py-4 text-[15px] leading-8">
            <span className="mark mark-blocker">Guaranteed 100% selection</span> in UPSC Prelims. Join <span className="mark mark-warning">the best coaching in India</span> before 30 June.
          </p>
          <ul className="space-y-2.5 border-t border-line bg-canvas px-4 py-3 text-xs">
            <li className="flex gap-2.5">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blocker-vivid" aria-hidden />
              <span><span className="font-semibold">Critical.</span> <span className="text-muted">Coaching ads can&rsquo;t promise selection. CCPA coaching-sector guidelines, 2024.</span></span>
            </li>
            <li className="flex gap-2.5">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-warning-vivid" aria-hidden />
              <span><span className="font-semibold">Warning.</span> <span className="text-muted">&ldquo;The best&rdquo; needs proof on file. ASCI Code, Chapter I.</span></span>
            </li>
          </ul>
        </div>
      </div>

      <p className="max-w-md text-xs leading-5 text-white/45">
        A person decides what to change, and a reviewer approves before anything is published. Demo data is fictional.
      </p>
    </section>
  );
}
