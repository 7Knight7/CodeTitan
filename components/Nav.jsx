"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { canSee, homeFor, ROLES, useRole } from "./RoleProvider";

const LINKS = [
  { href: "/", label: "Write and check" },
  { href: "/review", label: "Review" },
  { href: "/workspace", label: "Brand workspace" },
  { href: "/insights", label: "Insights" },
  { href: "/analytics", label: "Analytics" },
];

export default function Nav() {
  const path = usePathname();
  const { person, setRole, signOut } = useRole();
  if (path === "/login") return null;
  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href={person ? homeFor(person.role) : "/"} className="flex items-baseline gap-2">
          <span className="font-proof text-xl font-semibold tracking-tight">Live Brand Check</span>
          <span className="hidden text-xs text-muted sm:inline">pre-publication brand checks</span>
        </Link>
        <nav className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto" aria-label="Main">
          {LINKS.filter((l) => person && canSee(person.role, l.href)).map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${active ? "bg-ink text-white" : "text-ink hover:bg-canvas"}`}>
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-muted">Acting as</span>
            <select className="field w-auto py-1.5" value={person?.role || ""} disabled={!person}
              onChange={(e) => setRole(e.target.value)}>
              {!person && <option value="">…</option>}
              {Object.entries(ROLES).map(([role, name]) => <option key={role} value={role}>{name}</option>)}
            </select>
          </label>
          <button className="btn btn-quiet py-1.5" onClick={signOut}>Sign out</button>
        </div>
      </div>
    </header>
  );
}
