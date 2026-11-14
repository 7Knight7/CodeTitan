"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, Notice, PageHeader } from "@/components/ui";
import { FormError, NewPassword, PasswordInput } from "@/components/AuthFrame";
import Icon from "@/components/Icon";

export default function AccountPage() {
  const [me, setMe] = useState(null);
  const load = useCallback(() => api("/session").then(setMe).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  if (!me) return <div className="skeleton h-40 w-full" />;
  if (!me.uid) {
    return (
      <div className="space-y-6">
        <PageHeader title="Account & security" />
        <Notice>This site is in demo mode, so you are signed in as a role, not a personal account. Personal accounts with invitations are switched on with <b>LBC_AUTH_MODE=accounts</b>.</Notice>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Account & security" sub="Your sign-in details. Every change here is recorded in the audit log." />
      <Card title="Profile">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
          <dt className="text-muted">Name</dt><dd>{me.name}</dd>
          <dt className="text-muted">Email</dt><dd className="break-all">{me.email}</dd>
          <dt className="text-muted">Role</dt><dd>{me.role} <span className="text-xs text-muted">(set by your marketing head)</span></dd>
        </dl>
      </Card>
      <Notice>
        For safety, sign-in pauses for 15 minutes after 3 wrong passwords, and the account is blocked after 5. Your marketing head can unblock it from the Team page.
      </Notice>
      <ChangePassword />
      <SignOutOthers />
    </div>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setError(""); setMsg(""); setBusy(true);
    try {
      await api("/account/password", { method: "POST", body: { current, new: next } });
      setMsg("Password changed. Other devices were signed out."); setCurrent(""); setNext("");
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <Card title="Password">
      <form onSubmit={submit} className="max-w-sm space-y-4">
        <div>
          <label className="label" htmlFor="current">Current password</label>
          <PasswordInput id="current" value={current} onChange={setCurrent} />
        </div>
        <NewPassword label="New password" value={next} onChange={setNext} />
        <FormError>{error}</FormError>
        {msg && <Notice tone="success">{msg}</Notice>}
        <button className="btn btn-teal" disabled={busy || !current || next.length < 10}>{busy ? "Saving…" : "Change password"}</button>
      </form>
    </Card>
  );
}

function SignOutOthers() {
  const [msg, setMsg] = useState("");
  return (
    <Card title="Devices">
      <p className="text-sm text-muted">Signed in somewhere you no longer use, like a shared computer? Sign out everywhere else. This device stays signed in.</p>
      {msg && <Notice tone="success" className="mt-3">{msg}</Notice>}
      <button className="btn mt-3" onClick={() => api("/account/logout-all", { method: "POST" }).then(() => setMsg("All other devices are signed out.")).catch((e) => setMsg(e.message))}>
        <Icon name="logout" className="h-4 w-4" /> Sign out other devices
      </button>
    </Card>
  );
}
