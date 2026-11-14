"use client";
import { useCallback, useEffect, useState } from "react";
import { api, when } from "@/lib/api";
import { useRole } from "@/components/RoleProvider";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { FormError } from "@/components/AuthFrame";
import Icon from "@/components/Icon";

const ROLE_LIST = ["Creator", "Reviewer", "Marketing head"];
const ROLE_HELP = { Creator: "writes and sends posts", Reviewer: "approves or asks for changes", "Marketing head": "brand kit, team and sensitive posts" };
// Creators are paired with the reviewers who review their posts; reviewers with the creators they look after.
const OTHER = { Creator: "Reviewer", Reviewer: "Creator" };
const PAIR_LABEL = { Creator: "Reviewed by", Reviewer: "Reviews posts of" };

/** Marketing head: who has access, with which role, on which brands, who reviews whom, and invitations.
    Creators and reviewers get a read-only view of who they work with on the open brand. */
export default function TeamPage() {
  const { person } = useRole();
  if (!person) return <div className="skeleton h-40 w-full" />;
  return person.role === "Marketing head" ? <ManageTeam person={person} /> : <MyTeam />;
}

function ManageTeam({ person }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api("/team").then(setD).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!d) return <div className="skeleton h-40 w-full" />;
  return (
    <div className="space-y-6">
      <PageHeader title="Team" sub="Everyone in your agency. Each creator and reviewer works on the brands you choose, and each creator is paired with the reviewers who approve their posts. Marketing heads see every brand." />
      <InviteForm onDone={load} days={d.invite_days} users={d.users} brands={d.brands} current={d.current} />
      <Members users={d.users} me={person} onChange={load} brands={d.brands} />
      <Pending invites={d.invites} onChange={load} />
    </div>
  );
}

/** Read-only for creators and reviewers: the marketing head(s) and the people they work with on the open brand. */
function MyTeam() {
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { api("/my-team").then(setD).catch((e) => setError(e.message)); }, []);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!d) return <div className="skeleton h-40 w-full" />;
  const Person = ({ u }) => (
    <li className="flex items-center gap-3 px-5 py-3 text-sm">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-soft text-xs font-semibold text-teal-dark">{u.name.charAt(0)}</span>
      <span className="min-w-0"><span className="block font-medium">{u.name}</span><span className="block text-xs text-muted">{u.role} · {u.email}</span></span>
    </li>
  );
  return (
    <div className="space-y-6">
      <PageHeader title="My team" sub={`Who you work with on ${d.brand || "this brand"}. Only the marketing head can invite people or change who works on which brand.`} />
      <Card title="Marketing head" bodyClass="p-0">
        <ul className="divide-y divide-line">{d.heads.map((u) => <Person key={u.id} u={u} />)}</ul>
      </Card>
      <Card title={d.title} bodyClass="p-0">
        {d.note && <p className="px-5 pt-4 text-xs text-muted">{d.note}</p>}
        {d.people.length ? <ul className="divide-y divide-line">{d.people.map((u) => <Person key={u.id} u={u} />)}</ul>
          : <div className="p-5"><EmptyState icon="user" title="Nobody yet" body="The marketing head hasn't added anyone to this brand yet." /></div>}
      </Card>
    </div>
  );
}

const activeOf = (users, role) => users.filter((u) => u.active && u.role === role);
// Marketing heads have brand_ids null (every brand); others work on the listed brands.
const sharesBrand = (u, brandIds) => !brandIds || !u.brand_ids || u.brand_ids.some((b) => brandIds.includes(b));

/** Checkboxes for the brands a creator or reviewer works on. */
function BrandPicker({ brands, value, onChange, idPrefix }) {
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <fieldset>
      <legend className="label">Works on <span className="font-normal text-muted">(one or more brands)</span></legend>
      <div className="flex flex-wrap gap-2">
        {brands.map((b) => {
          const on = value.includes(b.id);
          return (
            <label key={b.id} htmlFor={`${idPrefix}-${b.id}`}
              className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${on ? "border-teal bg-teal-soft" : "border-line hover:border-line-strong"}`}>
              <input id={`${idPrefix}-${b.id}`} type="checkbox" className="accent-teal" checked={on} onChange={() => toggle(b.id)} />
              {b.name}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
const pairIds = (u) => (u.role === "Creator" ? u.reviewer_ids : u.creator_ids) || [];

/** Checkboxes for the people on the other side of the pairing. */
function PairPicker({ role, users, value, onChange, idPrefix, brandIds }) {
  const other = OTHER[role];
  if (!other) return null;
  const options = activeOf(users, other).filter((u) => sharesBrand(u, brandIds));
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <fieldset>
      <legend className="label">{role === "Creator" ? "Reviewed by" : "Reviews posts of"} <span className="font-normal text-muted">(choose at least one)</span></legend>
      {options.length === 0 ? (
        <p className="text-xs text-muted">No active {other.toLowerCase()}s on {brandIds ? "these brands" : "the team"} yet. Invite one, then pair them on this page.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((u) => {
            const on = value.includes(u.id);
            return (
              <label key={u.id} htmlFor={`${idPrefix}-${u.id}`}
                className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${on ? "border-teal bg-teal-soft" : "border-line hover:border-line-strong"}`}>
                <input id={`${idPrefix}-${u.id}`} type="checkbox" className="accent-teal" checked={on} onChange={() => toggle(u.id)} />
                {u.name}
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

function InviteForm({ onDone, days, users, brands, current }) {
  const start = current ? [current] : [];
  const [form, setForm] = useState({ name: "", email: "", role: "Creator", assign: [], brand_ids: start });
  const [link, setLink] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value, ...(k === "role" ? { assign: [] } : {}) }));
  const isHead = form.role === "Marketing head";
  const needsPair = OTHER[form.role] && activeOf(users, OTHER[form.role]).some((u) => sharesBrand(u, form.brand_ids));

  async function submit(e) {
    e.preventDefault(); setError(""); setCopied(false);
    if (!isHead && !form.brand_ids.length) { setError("Choose at least one brand for this person."); return; }
    if (needsPair && !form.assign.length) {
      setError(form.role === "Creator" ? "Choose at least one reviewer for this creator." : "Choose at least one creator for this reviewer.");
      return;
    }
    setBusy(true);
    try {
      const r = await api("/team/invites", { method: "POST", body: { ...form, brand_ids: isHead ? [] : form.brand_ids } });
      setLink({ url: `${window.location.origin}/invite?token=${encodeURIComponent(r.token)}`, name: r.invite.name, email: r.invite.email,
        role: r.invite.role, pair: r.invite.assign_names, brands: r.invite.brand_names });
      setForm({ name: "", email: "", role: form.role, assign: [], brand_ids: start });
      onDone();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const copy = () => navigator.clipboard?.writeText(link.url).then(() => setCopied(true));
  const message = link && encodeURIComponent(`Hi ${link.name.split(" ")[0]}, here is your invitation to Live Brand Check. Open it to choose your password (works once, within ${days} days): ${link.url}`);

  return (
    <Card title="Invite someone" sub={`They get a one-time link to choose their own password. Links expire after ${days} days. No email service needed: you send the link.`}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_12rem]">
          <div>
            <label className="label" htmlFor="inv-name">Name</label>
            <input id="inv-name" required minLength={2} maxLength={60} className="field" value={form.name} onChange={set("name")} />
          </div>
          <div>
            <label className="label" htmlFor="inv-email">Work email</label>
            <input id="inv-email" type="email" required maxLength={254} className="field" value={form.email} onChange={set("email")} />
          </div>
          <div>
            <label className="label" htmlFor="inv-role">Role</label>
            <select id="inv-role" className="field" value={form.role} onChange={set("role")}>
              {ROLE_LIST.map((r) => <option key={r}>{r}</option>)}
            </select>
            <p className="mt-1 text-xs text-muted">{ROLE_HELP[form.role]}</p>
          </div>
        </div>
        {isHead ? <p className="text-xs text-muted">Marketing heads see and manage every brand.</p> : (
          <BrandPicker brands={brands} value={form.brand_ids} idPrefix="inv-brand"
            onChange={(brand_ids) => setForm((f) => ({ ...f, brand_ids, assign: f.assign.filter((id) => sharesBrand(users.find((u) => u.id === id) || {}, brand_ids)) }))} />
        )}
        <PairPicker role={form.role} users={users} value={form.assign} idPrefix="inv" brandIds={isHead ? null : form.brand_ids}
          onChange={(assign) => setForm((f) => ({ ...f, assign }))} />
        <FormError>{error}</FormError>
        <button className="btn btn-teal" disabled={busy}><Icon name="plus" className="h-4 w-4" /> {busy ? "Creating…" : "Create invitation link"}</button>
      </form>
      {link && (
        <div className="mt-4 space-y-3 rounded-md bg-teal-soft/60 p-4 ring-1 ring-inset ring-teal/25">
          <p className="text-sm"><b>Invitation for {link.name}</b> ({link.email}) as {link.role}
            {link.brands?.length ? ` on ${link.brands.join(", ")}` : ""}
            {link.pair?.length ? `, ${link.role === "Creator" ? "reviewed by" : "reviewing"} ${link.pair.join(", ")}` : ""}. Send this link. It is shown only now.</p>
          <p className="break-all rounded bg-surface px-3 py-2 font-mono text-xs ring-1 ring-inset ring-line">{link.url}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm" onClick={copy}><Icon name="copy" className="h-4 w-4" /> {copied ? "Copied" : "Copy link"}</button>
            <a className="btn btn-sm" href={`https://wa.me/?text=${message}`} target="_blank" rel="noopener noreferrer"><Icon name="message" className="h-4 w-4" /> Send on WhatsApp</a>
            <a className="btn btn-sm" href={`mailto:${link.email}?subject=${encodeURIComponent("Your Live Brand Check invitation")}&body=${message}`}><Icon name="send" className="h-4 w-4" /> Email</a>
          </div>
        </div>
      )}
    </Card>
  );
}

function Members({ users, me, onChange, brands }) {
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // { id, ids }
  const [brandEdit, setBrandEdit] = useState(null); // { id, ids }
  const brandName = Object.fromEntries(brands.map((b) => [b.id, b.name]));
  const saveBrands = async () => {
    setError("");
    try { await api(`/team/${brandEdit.id}/brands`, { method: "PUT", body: { ids: brandEdit.ids } }); setBrandEdit(null); onChange(); }
    catch (e) { setError(e.message); }
  };
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  const act = async (uid, body) => {
    setError("");
    try { await api(`/team/${uid}`, { method: "PATCH", body }); onChange(); } catch (e) { setError(e.message); }
  };
  const remove = async (u) => {
    if (!window.confirm(`Remove ${u.name} (${u.email}) from Live Brand Check for good?

Their account is deleted and they can no longer sign in. Posts, reviews and history they were part of are kept under their name. You can invite this email again later.`)) return;
    setError("");
    try { await api(`/team/${u.id}/remove`, { method: "POST" }); onChange(); } catch (e) { setError(e.message); }
  };
  const unblock = async (u) => {
    setError("");
    try { await api(`/team/${u.id}/unblock`, { method: "POST" }); onChange(); } catch (e) { setError(e.message); }
  };
  const savePairs = async () => {
    setError("");
    try { await api(`/team/${editing.id}/assignments`, { method: "PUT", body: { ids: editing.ids } }); setEditing(null); onChange(); }
    catch (e) { setError(e.message); }
  };
  const unpairedCreators = activeOf(users, "Creator").filter((u) => !(u.reviewer_ids || []).some((r) => byId[r]?.active));

  return (
    <Card title={`Members (${users.filter((u) => u.active).length} active)`} bodyClass="p-0">
      {error && <div className="p-4"><FormError>{error}</FormError></div>}
      {unpairedCreators.length > 0 && (
        <div className="p-4 pb-0"><Notice tone="warning">
          {unpairedCreators.map((u) => u.name).join(", ")} {unpairedCreators.length > 1 ? "have" : "has"} no active reviewer, so any reviewer can review {unpairedCreators.length > 1 ? "their" : "their"} posts. Pair them below.
        </Notice></div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[62rem] text-sm">
          <thead className="text-left text-xs text-muted"><tr className="border-b border-line">
            <th className="px-5 py-2.5 font-medium">Person</th><th className="px-3 font-medium">Role</th><th className="px-3 font-medium">Brands</th><th className="px-3 font-medium">Paired with</th>
            <th className="px-3 font-medium">Sign-in</th><th className="px-3 font-medium">Last sign-in</th><th className="px-5 font-medium text-right">Access</th></tr></thead>
          <tbody>
            {users.map((u) => {
              const self = me?.uid === u.id;
              const pairs = pairIds(u).map((id) => byId[id]).filter(Boolean);
              const isEditing = editing?.id === u.id;
              return (
                <tr key={u.id} className={`border-b border-line align-top last:border-0 ${u.active ? "" : "opacity-60"}`}>
                  <td className="px-5 py-3"><span className="block font-medium">{u.name}{self && <span className="text-muted"> (you)</span>}</span><span className="block text-xs text-muted">{u.email}</span></td>
                  <td className="px-3 py-3">
                    {self || !u.active ? u.role : (
                      <select aria-label={`Role for ${u.name}`} className="field py-1.5" value={u.role} onChange={(e) => act(u.id, { role: e.target.value })}>
                        {ROLE_LIST.map((r) => <option key={r}>{r}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {!u.brand_ids ? <span className="text-muted">All brands</span> : brandEdit?.id === u.id ? (
                      <div className="space-y-2">
                        <BrandPicker brands={brands} value={brandEdit.ids} idPrefix={`brand-${u.id}`} onChange={(ids) => setBrandEdit({ id: u.id, ids })} />
                        <div className="flex gap-2">
                          <button className="btn btn-sm btn-teal" disabled={!brandEdit.ids.length} onClick={saveBrands}>Save</button>
                          <button className="btn btn-sm" onClick={() => setBrandEdit(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <span className="block">
                        {u.brand_ids.map((b) => brandName[b]).filter(Boolean).join(", ") || <span className="text-warning">no brand yet</span>}
                        {u.active && <button className="ml-2 text-xs text-teal-dark underline" onClick={() => setBrandEdit({ id: u.id, ids: u.brand_ids })}>Edit</button>}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {!OTHER[u.role] ? <span className="text-muted">Reviews everything</span> : isEditing ? (
                      <div className="space-y-2">
                        <PairPicker role={u.role} users={users} value={editing.ids} idPrefix={`pair-${u.id}`} brandIds={u.brand_ids} onChange={(ids) => setEditing({ id: u.id, ids })} />
                        <div className="flex gap-2">
                          <button className="btn btn-sm btn-teal" onClick={savePairs}>Save</button>
                          <button className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <span className="block">
                        <span className="text-muted">{PAIR_LABEL[u.role]}: </span>
                        {pairs.length ? pairs.map((p) => p.name + (p.active ? "" : " (inactive)")).join(", ") : <span className="text-warning">nobody yet</span>}
                        {u.active && <button className="ml-2 text-xs text-teal-dark underline" onClick={() => setEditing({ id: u.id, ids: pairIds(u).filter((id) => byId[id]?.active) })}>Edit</button>}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {u.blocked ? <span className="font-medium text-blocker">Blocked (5 wrong passwords)</span>
                      : u.locked_until ? <span className="text-warning">Paused until {when(u.locked_until)}</span>
                      : u.failed > 0 ? <span className="text-muted">{u.failed} wrong password{u.failed > 1 ? "s" : ""}</span>
                      : <span className="text-approved">OK</span>}
                    {(u.blocked || u.locked_until) && !self && <button className="btn btn-sm btn-teal ml-2" onClick={() => unblock(u)}>Unblock</button>}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted">{u.last_login ? when(u.last_login) : "Never"}</td>
                  <td className="px-5 py-3 text-right">
                    <span className="inline-flex flex-wrap justify-end gap-2">
                      {!self && <button className={`btn btn-sm ${u.active ? "" : "btn-teal"}`} onClick={() => act(u.id, { active: !u.active })}>{u.active ? "Deactivate" : "Reactivate"}</button>}
                      {!self && !u.active && !u.demo && <button className="btn btn-sm btn-danger" onClick={() => remove(u)}>Remove</button>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-5 py-3 text-xs text-muted">Creators and reviewers see only the brands they work on. Only a creator&rsquo;s paired reviewers (and the marketing head) can approve or send back that creator&rsquo;s posts. Sign-in pauses for 15 minutes after 3 wrong passwords and the account is blocked after 5, until you unblock it. Changing someone&rsquo;s role or deactivating them signs them out straight away. To delete someone entirely, deactivate them, then press Remove.</p>
    </Card>
  );
}

function Pending({ invites, onChange }) {
  if (!invites.length) return <Card title="Open invitations"><EmptyState icon="send" title="No open invitations" body="Links that haven't been used yet appear here until they expire." /></Card>;
  return (
    <Card title={`Open invitations (${invites.length})`} bodyClass="p-0">
      <ul className="divide-y divide-line">
        {invites.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <span className="min-w-0 flex-1"><span className="block font-medium">{i.name} <span className="font-normal text-muted">as {i.role}</span></span>
              <span className="block text-xs text-muted">{i.email} · invited by {i.by} · expires {when(i.expires_at)}
                {i.brand_names?.length ? ` · works on ${i.brand_names.join(", ")}` : ""}
                {i.assign_names?.length ? ` · ${i.role === "Creator" ? "reviewed by" : "reviews"} ${i.assign_names.join(", ")}` : ""}</span></span>
            <button className="btn btn-sm" onClick={() => api(`/team/invites/${i.id}/revoke`, { method: "POST" }).then(onChange)}>Cancel</button>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-5 py-3 text-xs text-muted">Lost the link? Create a new invitation for the same email; the old link stops working.</p>
    </Card>
  );
}
