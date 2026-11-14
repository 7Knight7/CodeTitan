"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import AuthFrame, { FormError, NewPassword } from "@/components/AuthFrame";

/** First-run setup: creates the first account, a marketing head. Only works while no account exists. */
export default function SetupPage() {
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", password: "", setup_code: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { api("/setup").then(setStatus).catch((e) => setStatus({ error: e.message })); }, []);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: typeof v === "string" ? v : v.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api("/setup", { method: "POST", body: form });
      window.location.href = "/team"; // next: invite the team
    } catch (err) { setError(err.message); setBusy(false); }
  }

  if (!status) return <AuthFrame title="Set up Live Brand Check" sub="Loading…" />;
  if (status.error) return <AuthFrame title="Set up Live Brand Check"><FormError>{status.error}</FormError></AuthFrame>;
  if (!status.needed) {
    return (
      <AuthFrame title="Already set up" sub="This site already has accounts. Sign in, or ask your marketing head for an invitation.">
        <a href="/login" className="btn btn-teal w-full py-2.5">Go to sign in</a>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title="Set up Live Brand Check" sub="Create the first account. It will be the marketing head, who invites everyone else from the Team page.">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="name">Your name</label>
          <input id="name" required minLength={2} maxLength={60} autoComplete="name" className="field" value={form.name} onChange={set("name")} />
        </div>
        <div>
          <label className="label" htmlFor="email">Work email</label>
          <input id="email" type="email" required maxLength={254} autoComplete="username" className="field" value={form.email} onChange={set("email")} />
        </div>
        <NewPassword value={form.password} onChange={set("password")} />
        {status.code_required && (
          <div>
            <label className="label" htmlFor="code">Setup code</label>
            <input id="code" required maxLength={200} autoComplete="off" className="field" value={form.setup_code} onChange={set("setup_code")} />
            <p className="mt-1 text-xs text-muted">The LBC_SETUP_CODE value from the server settings. It stops strangers from claiming a new site first.</p>
          </div>
        )}
        <FormError>{error}</FormError>
        <button className="btn btn-teal w-full py-2.5" disabled={busy || form.password.length < 10}>{busy ? "Creating…" : "Create account"}</button>
      </form>
    </AuthFrame>
  );
}
