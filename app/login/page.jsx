"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { ROLES } from "@/components/RoleProvider";
import { Logo } from "@/components/Icon";

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
  const [needsPassword, setNeedsPassword] = useState(null); // null while asking the server
  const [brand, setBrand] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/health").then((h) => { setNeedsPassword(!!h.password_required); setBrand(h.brand || ""); })
      .catch(() => setNeedsPassword(true));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api("/login", { method: "POST", body: { password: needsPassword ? password : "", role } });
      const next = params.get("next") || "/";
      window.location.href = next.startsWith("/") && !next.startsWith("//") ? next : "/"; // no open redirects
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <ProductSample />
      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-[26rem]">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <Logo className="h-9 w-9" />
            <span className="text-lg font-semibold tracking-tight">Live Brand Check</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1.5 text-sm leading-6 text-muted">
            Pre-publication brand and ad-claim checks{brand && brand !== "No brand kit yet" ? ` for ${brand}` : ""}. Choose who you are to start.
          </p>
          <form onSubmit={submit} className="mt-8 space-y-5">
            {needsPassword && (
              <div>
                <label className="label" htmlFor="password">Password</label>
                <input id="password" type="password" autoComplete="current-password" required maxLength={128}
                  className="field" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            )}
            <fieldset>
              <legend className="label">Continue as</legend>
              <div className="space-y-2">
                {Object.entries(ROLES).map(([r, name]) => (
                  <label key={r} className={`flex cursor-pointer items-center gap-3 rounded-lg border bg-white px-3.5 py-3 transition-colors ${role === r ? "border-teal ring-1 ring-teal" : "border-line hover:border-[#CDD3DC]"}`}>
                    <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="sr-only" />
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${role === r ? "bg-teal text-ink" : "bg-canvas text-muted ring-1 ring-line"}`} aria-hidden>{name.charAt(0)}</span>
                    <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{name}</span><span className="block text-xs text-muted">{ROLE_HELP[r]}</span></span>
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${role === r ? "border-teal bg-teal" : "border-[#CDD3DC]"}`} aria-hidden>
                      {role === r && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">You can switch roles later from the account menu.</p>
            </fieldset>
            {error && <p role="alert" className="rounded-md bg-blocker-soft px-3 py-2 text-sm text-blocker">{error}</p>}
            <button className="btn btn-teal w-full py-2.5" disabled={busy || needsPassword === null || (needsPassword && !password)}>
              {busy ? "Opening…" : needsPassword ? "Sign in" : "Continue"}
            </button>
            {needsPassword === false && <p className="text-center text-xs text-muted">Demo access: no password needed.</p>}
          </form>
        </div>
      </div>
    </div>
  );
}

/** Left panel: a sample coaching ad as the checker would mark it. A static illustration, not live data. */
function ProductSample() {
  return (
    <section className="relative hidden flex-col justify-between overflow-hidden bg-navy p-12 text-white lg:flex xl:p-16" aria-label="Example of a checked post">
      <div className="flex items-center gap-3">
        <Logo className="h-9 w-9" />
        <span className="text-lg font-semibold tracking-tight">Live Brand Check</span>
      </div>

      <div className="max-w-lg">
        <h2 className="text-[1.75rem] font-semibold leading-tight tracking-tight">Every claim checked before it goes live.</h2>
        <p className="mt-3 text-sm leading-6 text-white/60">Brand guidelines, approved facts and Indian advertising rules, applied to every post, with the source for every finding.</p>

        <div className="mt-10 overflow-hidden rounded-lg bg-white text-ink shadow-xl">
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
