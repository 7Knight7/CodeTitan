"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, PUBLIC_PAGES } from "@/lib/api";
import { becomePerson } from "@/lib/person";

export const ROLES = {
  Creator: "Priya (social media)",
  Reviewer: "Arjun (brand reviewer)",
  "Marketing head": "Meera (marketing head)",
};

// Pages each role can open (null = all). The server enforces the same limits on its data.
const PAGES = {
  Creator: ["/", "/overview", "/review", "/workspace", "/drafts", "/account", "/team", "/extension"],
  Reviewer: ["/overview", "/review", "/workspace", "/insights", "/analytics", "/drafts", "/account", "/team", "/extension"],
  "Marketing head": null,
};
const HOME = { Creator: "/", Reviewer: "/review", "Marketing head": "/overview" };

export function canSee(role, path) {
  const allowed = PAGES[role];
  if (!allowed) return true;
  return allowed.some((p) => (p === "/" ? path === "/" : path === p || path.startsWith(p + "/")));
}

export const homeFor = (role) => HOME[role] || "/";

// The signed-in role comes from the server session, not from the browser.
const RoleContext = createContext({ person: null, setRole: async () => {}, signOut: async () => {} });

export function RoleProvider({ children }) {
  const path = usePathname();
  const router = useRouter();
  const [person, setPerson] = useState(null);
  useEffect(() => {
    if (PUBLIC_PAGES.includes(path)) return;
    api("/session").then((s) => setPerson(s)).catch(() => {});
  }, [path]);
  useEffect(() => {
    if (!person || PUBLIC_PAGES.includes(path)) return;
    if (!canSee(person.role, path)) router.replace(homeFor(person.role));
  }, [person, path, router]);
  const setRole = async (role) => {
    await becomePerson(role, person);
    window.location.href = canSee(role, window.location.pathname) ? window.location.href : homeFor(role);
  };
  const signOut = async () => {
    await api("/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  };
  const blocked = person && !PUBLIC_PAGES.includes(path) && !canSee(person.role, path);
  return <RoleContext.Provider value={{ person, setRole, signOut }}>{blocked ? null : children}</RoleContext.Provider>;
}

export const useRole = () => useContext(RoleContext);
