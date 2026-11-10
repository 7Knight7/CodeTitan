"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api, DRAFTS_EVENT } from "@/lib/api";
import Nav from "./Nav";

const KEY = "lbc-sidebar-collapsed";
const WorkspaceContext = createContext(null);
/** The current brand workspace (name, whether a kit is live), shared by the shell and pages. */
export const useWorkspaceMeta = () => useContext(WorkspaceContext);

/** App frame: navy sidebar + top bar. The sign-in page is full-bleed. */
export default function Shell({ children }) {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [workspace, setWorkspace] = useState(null);

  useEffect(() => { try { setCollapsed(localStorage.getItem(KEY) === "1"); } catch { /* storage blocked */ } }, []);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem(KEY, c ? "0" : "1"); } catch { /* ignore */ } return !c; });

  useEffect(() => {
    if (path === "/login") return;
    const load = () => api("/workspace").then((w) => setWorkspace({ name: w.meta?.name, live: !!w.live, empty: !!w.empty })).catch(() => {});
    load();
    window.addEventListener(DRAFTS_EVENT, load);
    return () => window.removeEventListener(DRAFTS_EVENT, load);
  }, [path]);

  if (path === "/login") return children;
  return (
    <WorkspaceContext.Provider value={workspace}>
      <div className={`min-h-screen transition-[padding] duration-200 ${collapsed ? "lg:pl-[4.5rem]" : "lg:pl-64"}`}>
        <Nav collapsed={collapsed} onToggle={toggle} workspace={workspace} />
        <div className="mx-auto max-w-[88rem] px-4 sm:px-6 lg:px-8">
          <main className="py-6 lg:py-8">{children}</main>
          <footer className="border-t border-line py-6 text-xs leading-relaxed text-muted">
            <p className="max-w-3xl">
              Demo data is fictional. Post images are read in your browser; only a small preview is saved so reviewers can see the post. Posts are checked with fixed rules
              and your approved facts, not AI. Brand kit PDFs may be read with an AI service if one is configured; every item is confirmed by a person.
            </p>
          </footer>
        </div>
      </div>
    </WorkspaceContext.Provider>
  );
}
