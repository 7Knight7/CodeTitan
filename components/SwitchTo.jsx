"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { becomePerson, NO_DEMO_ACCOUNT } from "@/lib/person";
import { ROLES, useRole } from "./RoleProvider";
import Icon from "./Icon";

let healthOnce = null; // which demo accounts exist, fetched once per page load
const demoRoles = () => (healthOnce ||= api("/health").then((h) => (h.demo_accounts || []).map((a) => a.role)).catch(() => []));

/** "Open as Arjun" and similar: signs in as the demo person for a role (or switches role in demo mode),
    then opens a page. Works in every sign-in mode; explains what to do when there is no demo account. */
export default function SwitchTo({ role, href, children, className = "btn btn-quiet btn-sm" }) {
  const { person } = useRole();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const name = ROLES[role]?.split(" (")[0] || role;
  // Without personal accounts anyone can switch role; with them, only while a demo account exists for that role.
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!person) return;
    if (!person.uid) { setAvailable(true); return; }
    demoRoles().then((roles) => setAvailable(roles.includes(role)));
  }, [person, role]);
  async function go() {
    setBusy(true); setError("");
    try {
      if (!(await becomePerson(role, person))) { setError(NO_DEMO_ACCOUNT); setBusy(false); return; }
      window.location.href = href || window.location.pathname;
    } catch (e) { setError(e.message); setBusy(false); }
  }
  if (!available) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2 align-middle">
      <button type="button" className={className} disabled={busy} onClick={go}>
        <Icon name="user" className="h-3.5 w-3.5" />{busy ? "Opening…" : children || `Open as ${name}`}
      </button>
      {error && <span role="alert" className="text-xs text-blocker">{error}</span>}
    </span>
  );
}
