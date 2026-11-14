"""Storage for workspace records, drafts and the audit log.

Uses one Supabase table (lbc_items) when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
are set; otherwise a local JSON file (for development and tests).

Supabase table:
  create table lbc_items (
    id text primary key,
    type text not null,
    data jsonb not null,
    created_at timestamptz default now()
  );
  create index lbc_items_type on lbc_items(type);
  alter table lbc_items enable row level security;  -- only the server's service key can read/write
"""
import contextvars
import copy
import json
import os
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

from . import audit, seed

TYPES = ("guideline", "rule", "fact", "draft", "event", "override", "meta", "memory", "user", "invite", "brand")
ACCOUNT_TYPES = ("user", "invite")  # personal accounts survive a demo reset
GLOBAL_TYPES = ("user", "invite", "brand")  # shared by every brand; everything else belongs to one brand
BRAND_TYPES = tuple(t for t in TYPES if t not in GLOBAL_TYPES)

# Multi-brand: every brand's kit, facts, rules, posts, memory and audit log live in their own namespace.
# The first brand ("main") uses the plain type names, so data from before multi-brand stays where it was.
MAIN = "main"
_brand = contextvars.ContextVar("lbc_brand", default=MAIN)


def set_brand(brand_id):
    return _brand.set(brand_id or MAIN)


def current_brand():
    return _brand.get()


def scoped_type(type_, brand):
    return type_ if type_ in GLOBAL_TYPES or brand == MAIN else f"{brand}__{type_}"


def seed_items():
    items = []
    for g in seed.GUIDELINES:
        items.append(("guideline", g))
    for r in seed.RULES:
        items.append(("rule", r | {"enabled": True}))
    for f in seed.FACTS:
        items.append(("fact", f))
    items.append(("meta", {"id": "workspace", **seed.WORKSPACE}))
    items += sample_history()
    return [(t, copy.deepcopy(d)) for t, d in items]


def sample_history():
    """Build sample drafts, decisions, overrides and audit events with the real engine."""
    from .engine import run_checks
    ws = {"rules": [r | {"enabled": True} for r in seed.RULES], "facts": seed.FACTS}
    base = datetime.now(timezone.utc) - timedelta(days=6)
    out, sample_events = [], []
    for i, h in enumerate(seed.SAMPLE_HISTORY):
        t0 = base + timedelta(days=i, hours=2)
        stamp = lambda m: (t0 + timedelta(minutes=m)).isoformat(timespec="seconds")
        did = f"s{i + 1}"
        findings, verified = run_checks(h["content"], h["channel"], ws)
        decisions, events = [], [("Created draft", h["author"], "Creator", f"Version 1 with {len(findings)} findings", 0)]
        for j, (rid, action, reason) in enumerate(h["decisions"]):
            f = next((x for x in findings if x["rule_id"] == rid), None)
            if not f:
                continue
            dec = {"id": f"{did}d{j}", "finding_id": f["id"], "rule_id": rid, "name": f["name"], "severity": f["severity"],
                   "engine": f["engine"], "quote": f["quote"], "location": "caption", "action": action, "reason": reason,
                   "new_text": "", "by": h["author"], "at": stamp(5 + j)}
            decisions.append(dec)
            if action == "reject":
                out.append(("override", {"id": dec["id"], "draft_id": did, "rule_id": rid, "name": f["name"],
                                         "reason": reason, "by": h["author"], "at": dec["at"]}))
                events.append(("Kept original (override)", h["author"], "Creator", f"{f['name']}: \"{f['quote']}\" because {reason}", 5 + j))
            else:
                events.append(("Accepted fix", h["author"], "Creator", f"{f['name']}: \"{f['quote']}\"", 5 + j))
        draft = {"id": did, "title": h["title"], "channel": h["channel"], "content": h["content"], "banner": None,
                 "findings": findings, "verified": verified, "status": h["status"], "author": h["author"], "version": 1,
                 "versions": [{"version": 1, "content": h["content"], "by": h["author"], "at": stamp(0)}],
                 "decisions": decisions, "requires_senior": any(f.get("sensitive") for f in findings),
                 "created_at": stamp(0), "updated_at": stamp(30), "sample": True,
                 "raised": {f["rule_id"]: f["name"] for f in findings}}
        events.append(("Sent for review", h["author"], "Creator", "Version 1", 10))
        if h["review"]:
            by, role, action, comment = h["review"]
            draft["review"] = {"action": action, "comment": comment, "by": by, "role": role, "at": stamp(30), "version": 1}
            if action == "approve":
                draft["approved_version"] = 1
                draft["evidence"] = audit.evidence(draft, seed.FACTS)
            events.append(("Approved" if action == "approve" else "Requested changes", by, role,
                           "Version 1" + (f": {comment}" if comment else ""), 30))
        out.append(("draft", draft))
        for k, (action, actor, role, detail, m) in enumerate(events):
            sample_events.append({"id": f"{did}e{k}", "draft_id": did, "actor": actor, "role": role,
                                  "action": action, "detail": detail, "at": stamp(m)})
    chained, head = audit.chain_all(sample_events)
    return out + [("event", e) for e in chained] + [("meta", head)]


class LocalStore:
    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.Lock()
        if not self.path.exists():
            self.reset()

    def _load(self):
        db = json.loads(self.path.read_text())
        for t in TYPES:  # data files written before a type existed
            db.setdefault(t, {})
        return db

    def _save(self, db):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(db))
        tmp.replace(self.path)

    def reset(self):
        with self.lock:
            kept = {t: self._load()[t] for t in ACCOUNT_TYPES} if self.path.exists() else {}
            db = {t: {} for t in TYPES} | kept
            for t, d in seed_items():
                db[t][d["id"]] = d
            self._save(db)

    def list(self, type_):
        return list(self._load().get(type_, {}).values())

    def replace_types(self, types, items):
        with self.lock:
            db = self._load()
            for t in types:
                db[t] = {}
            for t, d in items:
                db.setdefault(t, {})[d["id"]] = d
            self._save(db)

    def get(self, type_, id_):
        return self._load().get(type_, {}).get(id_)

    def put(self, type_, data):
        with self.lock:
            db = self._load()
            db.setdefault(type_, {})[data["id"]] = data
            self._save(db)
        return data


class SupabaseStore:
    def __init__(self, url, key):
        self.base = url.rstrip("/") + "/rest/v1/lbc_items"
        self.h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        self.client = httpx.Client(timeout=10.0)
        if not self.list("meta") and not self.list("brand"):  # an empty database (not one whose first brand was removed)
            self.reset()

    def _key(self, type_, id_):
        return f"{type_}:{id_}"

    def reset(self):
        self.client.delete(self.base, params={"type": f"not.in.({','.join(ACCOUNT_TYPES)})"}, headers=self.h).raise_for_status()
        rows = [{"id": self._key(t, d["id"]), "type": t, "data": d} for t, d in seed_items()]
        self.client.post(self.base, json=rows, headers=self.h).raise_for_status()

    def replace_types(self, types, items):
        self.client.delete(self.base, params={"type": f"in.({','.join(types)})"}, headers=self.h).raise_for_status()
        rows = [{"id": self._key(t, d["id"]), "type": t, "data": d} for t, d in items]
        if rows:
            self.client.post(self.base, json=rows, headers=self.h).raise_for_status()

    def list(self, type_):
        r = self.client.get(self.base, params={"type": f"eq.{type_}", "select": "data", "order": "created_at.asc"}, headers=self.h)
        r.raise_for_status()
        return [row["data"] for row in r.json()]

    def get(self, type_, id_):
        r = self.client.get(self.base, params={"id": f"eq.{self._key(type_, id_)}", "select": "data"}, headers=self.h)
        r.raise_for_status()
        rows = r.json()
        return rows[0]["data"] if rows else None

    def put(self, type_, data):
        row = {"id": self._key(type_, data["id"]), "type": type_, "data": data}
        h = self.h | {"Prefer": "resolution=merge-duplicates"}
        self.client.post(self.base, json=row, headers=h).raise_for_status()
        return data


class ScopedStore:
    """The store as one brand sees it. Brand types are mapped into that brand's namespace."""

    def __init__(self, base, brand):
        self.base, self.brand = base, brand

    def _t(self, type_):
        return scoped_type(type_, self.brand)

    def list(self, type_):
        return self.base.list(self._t(type_))

    def get(self, type_, id_):
        return self.base.get(self._t(type_), id_)

    def put(self, type_, data):
        return self.base.put(self._t(type_), data)

    def replace_types(self, types, items):
        self.base.replace_types([self._t(t) for t in types], [(self._t(t), d) for t, d in items])

    def reset(self):
        """The main brand resets everything (as before multi-brand); another brand restores only its own data
        to the sample brand."""
        if self.brand == MAIN:
            self.base.reset()
        else:
            self.replace_types(list(BRAND_TYPES), seed_items())


_store = None


def base_store():
    return _base()


def get_store():
    """The store for the brand of the current request (see set_brand)."""
    base_store_ = _base()
    return ScopedStore(base_store_, current_brand())


def _base():
    global _store
    if _store is None:
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")
        if url and key:
            _store = SupabaseStore(url, key)
        else:
            _store = LocalStore(os.environ.get("LBC_DATA_PATH", "/tmp/lbc-data.json"))
    return _store


def storage_mode():
    return "supabase" if isinstance(_base(), SupabaseStore) else "local"
