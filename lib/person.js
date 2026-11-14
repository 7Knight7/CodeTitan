import { api } from "./api";

/** Act as another person, for the guided demo and its tips.
 *  Demo mode: switch the role of this session.
 *  Accounts mode: sign out and sign in with that role's demo account (their details are public on the sign-in page).
 *  Returns false when there is no demo account for the role, so the caller can explain what to do. */
export async function becomePerson(role, current) {
  if (current?.role === role) return true;
  if (!current?.uid) {
    await api("/session/role", { method: "POST", body: { role } });
    return true;
  }
  const health = await api("/health");
  const account = (health.demo_accounts || []).find((a) => a.role === role);
  if (!account) return false;
  await api("/logout", { method: "POST" });
  await api("/login/account", { method: "POST", body: { email: account.email, password: account.password } });
  return true;
}

export const NO_DEMO_ACCOUNT = "This step needs a different person. Sign out, then sign in with that person's account.";
