"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { ROLES } from "@/components/RoleProvider";

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
    <div className="mx-auto mt-10 max-w-md">
      <h1 className="font-proof text-3xl font-semibold">Live Brand Check</h1>
      <p className="mt-2 text-muted">
        Pre-publication brand and ad-claim checks{brand && brand !== "No brand kit yet" ? ` for ${brand}` : ""}. Choose who you are to start.
      </p>
      <form onSubmit={submit} className="panel mt-6 space-y-4 p-5">
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
              <label key={r} className={`flex cursor-pointer gap-3 rounded-md border px-3 py-2 ${role === r ? "border-ink bg-canvas" : "border-line"}`}>
                <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="mt-1" />
                <span><span className="block font-medium">{name}</span><span className="text-xs text-muted">{ROLE_HELP[r]}</span></span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">You can switch roles later from the header.</p>
        </fieldset>
        {error && <p role="alert" className="rounded-md bg-blocker-soft px-3 py-2 text-sm text-blocker">{error}</p>}
        <button className="btn btn-primary w-full" disabled={busy || needsPassword === null || (needsPassword && !password)}>
          {busy ? "Opening…" : needsPassword ? "Sign in" : "Continue"}
        </button>
        {needsPassword === false && <p className="text-center text-xs text-muted">Demo access: no password needed.</p>}
      </form>
    </div>
  );
}
