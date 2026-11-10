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
import copy
import json
import os
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

from . import seed

TYPES = ("guideline", "rule", "fact", "draft", "event", "override", "meta", "memory")


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
    out = []
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
            events.append(("Approved" if action == "approve" else "Requested changes", by, role,
                           "Version 1" + (f": {comment}" if comment else ""), 30))
        out.append(("draft", draft))
        for k, (action, actor, role, detail, m) in enumerate(events):
            out.append(("event", {"id": f"{did}e{k}", "draft_id": did, "actor": actor, "role": role,
                                  "action": action, "detail": detail, "at": stamp(m)}))
    return out


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
            db = {t: {} for t in TYPES}
            for t, d in seed_items():
                db[t][d["id"]] = d
            self._save(db)

    def list(self, type_):
        return list(self._load()[type_].values())

    def replace_types(self, types, items):
        with self.lock:
            db = self._load()
            for t in types:
                db[t] = {}
            for t, d in items:
                db[t][d["id"]] = d
            self._save(db)

    def get(self, type_, id_):
        return self._load()[type_].get(id_)

    def put(self, type_, data):
        with self.lock:
            db = self._load()
            db[type_][data["id"]] = data
            self._save(db)
        return data


class SupabaseStore:
    def __init__(self, url, key):
        self.base = url.rstrip("/") + "/rest/v1/lbc_items"
        self.h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        self.client = httpx.Client(timeout=10.0)
        if not self.list("meta"):
            self.reset()

    def _key(self, type_, id_):
        return f"{type_}:{id_}"

    def reset(self):
        self.client.delete(self.base, params={"id": "neq.__none__"}, headers=self.h).raise_for_status()
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


_store = None


def get_store():
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
    return "supabase" if isinstance(get_store(), SupabaseStore) else "local"
