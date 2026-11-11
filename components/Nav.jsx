"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { canSee, homeFor, ROLES, useRole } from "./RoleProvider";
import Icon, { Logo } from "./Icon";
import Notifications from "./CreatorNotes";
import { TourHelp } from "./Tour";
import ThemeToggle from "./Theme";

export { Logo };

// `match` is the page whose access rules apply; `group` splits doing work from reading results.
export const LINKS = [
  { href: "/overview", label: "Overview", icon: "overview", group: 0 },
  { href: "/", label: "Content checker", icon: "checker", group: 0 },
  { href: "/review", label: "Review & approvals", icon: "review", group: 0 },
  { href: "/workspace", label: "Brand guidelines", icon: "brand", group: 1 },
  { href: "/workspace#facts", match: "/workspace", label: "Approved facts", icon: "facts", group: 1, anchor: true },
  { href: "/insights", label: "Insights", icon: "insights", group: 2 },
  { href: "/analytics", label: "Analytics", icon: "analytics", group: 2 },
];

const isActive = (l, path) => !l.anchor && (l.href === "/" ? path === "/" : path.startsWith(l.href));

export function pageTitle(path) {
  if (path.startsWith("/drafts/")) return ["Review & approvals", "Post history"];
  const l = LINKS.find((x) => isActive(x, path));
  return [l?.label || "Live Brand Check"];
}

const initials = (name = "") => name.trim().charAt(0).toUpperCase() || "·";

function Avatar({ name, className = "h-8 w-8 text-sm" }) {
  return <span className={`flex shrink-0 items-center justify-center rounded-full bg-teal-soft font-semibold text-teal-dark ${className}`} aria-hidden>{initials(name)}</span>;
}

/** Account menu: who you are, switch the role you act as, sign out. */
function AccountMenu({ person, setRole, signOut, trigger, placement = "down" }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div className="relative" ref={box}>
      {trigger({ open, toggle: () => setOpen(!open) })}
      {open && (
        <div role="menu" className={`pop-in absolute z-50 w-72 overflow-hidden rounded-lg border border-line bg-surface text-ink shadow-xl ${placement === "up" ? "bottom-full left-0 mb-2" : "right-0 top-11"}`}>
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <Avatar name={person?.name} className="h-9 w-9 text-sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{person?.name}</p>
              <p className="truncate text-xs text-muted">{person?.role}</p>
            </div>
          </div>
          <p className="px-4 pb-1 pt-3 text-xs font-medium text-muted">Act as</p>
          <div className="px-2 pb-2">
            {Object.entries(ROLES).map(([role, name]) => {
              const current = person?.role === role;
              return (
                <button key={role} role="menuitemradio" aria-checked={current} disabled={current}
                  onClick={() => { setOpen(false); setRole(role); }}
                  className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm ${current ? "bg-teal-soft" : "hover:bg-canvas"}`}>
                  <Avatar name={name} className="h-6 w-6 text-2xs" />
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  {current && <Icon name="check" className="h-4 w-4 text-teal-dark" />}
                </button>
              );
            })}
          </div>
          <div className="border-t border-line p-2">
            <button role="menuitem" onClick={signOut} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm text-muted hover:bg-canvas hover:text-ink">
              <Icon name="logout" className="h-4 w-4" /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarBody({ path, person, workspace, collapsed, onToggle, onNavigate, setRole, signOut }) {
  const links = LINKS.filter((l) => person && canSee(person.role, l.match || l.href));
  return (
    <div className="flex h-full flex-col">
      <div className={`flex items-center gap-3 pb-4 pt-5 ${collapsed ? "justify-center px-2" : "px-5"}`}>
        <Link href={person ? homeFor(person.role) : "/"} onClick={onNavigate} className="flex min-w-0 items-center gap-3" aria-label="Live Brand Check home">
          <Logo />
          {!collapsed && <span className="truncate text-[15px] font-semibold tracking-tight">Live Brand Check</span>}
        </Link>
      </div>

      {!collapsed && (
        <div className="mx-3 mb-4 rounded-md border border-line bg-surface/60 px-3.5 py-3">
          <p className="text-2xs text-muted">Workspace</p>
          <p className="mt-0.5 truncate text-sm font-medium">{workspace?.name || "…"}</p>
          <p className="mt-1 flex items-center gap-1.5 text-2xs text-muted">
            <span className={`dot ${workspace?.empty ? "bg-warning-vivid" : "bg-approved-vivid"}`} aria-hidden />
            {workspace ? (workspace.empty ? "No brand kit live" : workspace.live ? "Brand kit live" : "Sample brand kit ready") : "Loading"}
          </p>
        </div>
      )}

      <nav className={`flex-1 overflow-y-auto ${collapsed ? "px-2" : "px-3"}`} aria-label="Main" data-tour="nav">
        {!person && [0, 1, 2, 3].map((i) => <span key={i} className="mx-2 my-3 block h-3 rounded bg-canvas" aria-hidden />)}
        {links.map((l, i) => (
          <div key={l.href}>
            {i > 0 && links[i - 1].group !== l.group && <div className="mx-3 my-3 border-t border-line" aria-hidden />}
            <Link href={l.href} onClick={onNavigate} aria-current={isActive(l, path) ? "page" : undefined}
              title={collapsed ? l.label : undefined} className={`nav-link mb-1 ${collapsed ? "justify-center px-0" : ""}`}>
              <Icon name={l.icon} />
              {!collapsed && <span className="truncate">{l.label}</span>}
              {collapsed && <span className="sr-only">{l.label}</span>}
            </Link>
          </div>
        ))}
      </nav>

      <div className={`border-t border-line p-3 ${collapsed ? "space-y-2" : ""}`}>
        {person && (
          <AccountMenu person={person} setRole={setRole} signOut={signOut} placement="up"
            trigger={({ toggle, open }) => (
              <button onClick={toggle} aria-expanded={open} aria-haspopup="menu"
                className={`flex w-full items-center gap-3 rounded-full p-1.5 text-left transition-colors hover:bg-surface/70 ${collapsed ? "justify-center" : ""}`}>
                <Avatar name={person.name} />
                {!collapsed && (
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-sm font-medium">{person.name}</span>
                    <span className="block truncate text-xs text-muted">{person.role}</span>
                  </span>
                )}
                {!collapsed && <Icon name="chevronDown" className="h-4 w-4 rotate-180 text-faint" />}
              </button>
            )} />
        )}
        {onToggle && (
          <button onClick={onToggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`mt-1 flex w-full items-center gap-3 rounded-full px-3 py-2 text-xs text-muted transition-colors hover:bg-surface/70 hover:text-ink ${collapsed ? "justify-center px-0" : ""}`}>
            <Icon name={collapsed ? "expand" : "collapse"} className="h-4 w-4" />
            {!collapsed && "Collapse"}
          </button>
        )}
      </div>
    </div>
  );
}

/** Floating frosted sidebar on large screens; a drawer on small ones. */
export default function Nav({ collapsed, onToggle, workspace }) {
  const path = usePathname();
  const { person, setRole, signOut } = useRole();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const body = { path, person, workspace, setRole, signOut };

  return (
    <>
      <aside className={`glass fixed bottom-3 left-3 top-3 z-30 hidden rounded-xl shadow transition-[width] duration-300 lg:block ${collapsed ? "w-[4.5rem]" : "w-60"}`}>
        <SidebarBody {...body} collapsed={collapsed} onToggle={onToggle} />
      </aside>
      <TopBar path={path} person={person} setRole={setRole} signOut={signOut} workspace={workspace} onMenu={() => setOpen(true)} menuOpen={open} />
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="fade-in absolute inset-0 bg-navy/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="glass-strong drawer-enter absolute bottom-2 left-2 top-2 w-72 max-w-[85vw] rounded-xl shadow-xl">
            <button onClick={() => setOpen(false)} aria-label="Close menu"
              className="absolute right-3 top-5 rounded-full p-1.5 text-muted hover:bg-surface/70 hover:text-ink">
              <Icon name="close" className="h-5 w-5" />
            </button>
            <SidebarBody {...body} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}

function TopBar({ path, person, setRole, signOut, workspace, onMenu, menuOpen }) {
  const crumbs = pageTitle(path);
  return (
    <header className="sticky top-0 z-20 px-3 pt-3 sm:px-5 lg:px-6">
      <div className="glass-strong flex h-14 items-center gap-2 rounded-full pl-4 pr-2 shadow sm:gap-3 sm:pl-5">
        <button onClick={onMenu} aria-label="Open menu" aria-expanded={menuOpen} data-tour="menu-button"
          className="-ml-1.5 rounded-full p-1.5 text-muted hover:bg-surface/70 hover:text-ink lg:hidden">
          <Icon name="menu" className="h-5 w-5" />
        </button>
        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
          <ol className="flex min-w-0 items-center gap-1.5 text-sm">
            <li className="hidden truncate text-muted sm:block">{workspace?.name || "Workspace"}</li>
            {crumbs.map((c, i) => (
              <li key={c} className={`flex min-w-0 items-center gap-1.5 ${i < crumbs.length - 1 ? "hidden sm:flex" : ""}`}>
                <Icon name="chevronRight" className="hidden h-3.5 w-3.5 shrink-0 text-faint sm:block" />
                {i === crumbs.length - 1
                  ? <span className="truncate font-medium text-ink" aria-current="page">{c}</span>
                  : <Link href="/review" className="truncate text-muted hover:text-ink">{c}</Link>}
              </li>
            ))}
          </ol>
        </nav>
        <div className="flex items-center gap-0.5 sm:gap-1">
          <ThemeToggle />
          <TourHelp />
          <Notifications />
          {person && (
            <AccountMenu person={person} setRole={setRole} signOut={signOut}
              trigger={({ toggle, open }) => (
                <button onClick={toggle} aria-expanded={open} aria-haspopup="menu" aria-label={`Account: ${person.name}`} data-tour="account"
                  className="ml-1 flex items-center gap-2 rounded-full p-0.5 transition-colors hover:bg-surface/70 sm:pr-3">
                  <Avatar name={person.name} />
                  <span className="hidden text-left leading-tight sm:block">
                    <span className="block max-w-[10rem] truncate text-xs font-medium">{person.name.split(" (")[0]}</span>
                    <span className="block text-2xs text-muted">{person.role}</span>
                  </span>
                </button>
              )} />
          )}
        </div>
      </div>
    </header>
  );
}
