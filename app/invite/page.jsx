"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import AuthFrame, { FormError, NewPassword } from "@/components/AuthFrame";

const ROLE_TEXT = {
  Creator: "You'll write posts, fix issues and send them for review.",
  Reviewer: "You'll approve posts or ask for changes.",
  "Marketing head": "You'll manage the brand kit and the team, and approve sensitive posts.",
};

export default function InvitePage() {
  return <Suspense fallback={null}><Invite /></Suspense>;
}

/** Accept an invitation: the link carries a one-time token; the person chooses their own password. */
function Invite() {
  const token = useSearchParams().get("token") || "";
  const [inv, setInv] = useState(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) { setInv({ error: "This link has no invitation in it. Open the full link you were sent." }); return; }
    api("/invite/lookup", { method: "POST", body: { token } }).then(setInv).catch((e) => setInv({ error: e.message }));
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api("/invite/accept", { method: "POST", body: { token, password } });
      window.location.href = "/overview";
    } catch (err) { setError(err.message); setBusy(false); }
  }

  if (!inv) return <AuthFrame title="Join your team" sub="Checking your invitation…" />;
  if (inv.error) {
    return (
      <AuthFrame title="Invitation not valid">
        <FormError>{inv.error}</FormError>
        <a href="/login" className="btn mt-4 w-full py-2.5">Go to sign in</a>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title={`Welcome, ${inv.name.split(" ")[0]}`}
      sub={`${inv.by} invited you to Live Brand Check${inv.brand && inv.brand !== "No brand kit yet" ? ` for ${inv.brand}` : ""} as ${inv.role}.`}>
      <form onSubmit={submit} className="space-y-4">
        <p className="rounded-md bg-canvas px-3.5 py-2.5 text-sm ring-1 ring-inset ring-line">
          <span className="block font-medium">{inv.email}</span>
          <span className="block text-xs text-muted">{ROLE_TEXT[inv.role]}</span>
        </p>
        <NewPassword label="Choose a password" value={password} onChange={setPassword} />
        <FormError>{error}</FormError>
        <button className="btn btn-teal w-full py-2.5" disabled={busy || password.length < 10}>{busy ? "Creating your account…" : "Create my account"}</button>
        <p className="text-center text-xs text-muted">This link works once and expires on {new Date(inv.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}.</p>
      </form>
    </AuthFrame>
  );
}
