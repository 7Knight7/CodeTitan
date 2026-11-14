"""Multi-brand workspaces: an agency works on several brands at once.

- Each brand has its own namespace in the store (kit, facts, rules, posts, memory, insights, audit log); see store.py.
- The brand list is the global store type `brand`: {id, name, created_at, created_by, sample, demo}.
- Marketing heads see every brand. Creators and reviewers see only the brands in their account's `brand_ids`
  (one or more). Without personal accounts (demo or shared-password sign-in) everyone sees every brand.
- First run: the existing data becomes the first brand ("main"), and a second fictional brand is added so the
  brand switcher can be shown: the sample brand if "main" holds your own kit, otherwise Sunrise Tutorials,
  read from the sample brand-kit PDF.
"""
import os
import uuid
from datetime import datetime, timezone

from . import audit, seed
from .store import BRAND_TYPES, MAIN, ScopedStore, base_store, seed_items

SAMPLE_PDF = os.path.join(os.path.dirname(__file__), "samples", "sunrise-brand-kit.pdf")
HEAD = "Marketing head"


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def records():
    return sorted(base_store().list("brand"), key=lambda b: (b["id"] != MAIN, b.get("created_at") or ""))


def get(brand_id):
    return base_store().get("brand", brand_id) if brand_id else None


def label(rec):
    """A brand's name: the name in its live brand kit, or the name it was added with."""
    meta = ScopedStore(base_store(), rec["id"]).get("meta", "workspace") or {}
    return (meta.get("name") if meta.get("name") and not meta.get("empty") else None) or rec.get("name") or "Untitled brand"


def summary(rec, current=None):
    meta = ScopedStore(base_store(), rec["id"]).get("meta", "workspace") or {}
    return {"id": rec["id"], "name": label(rec), "sample": bool(rec.get("sample")), "current": rec["id"] == current,
            "empty": bool(meta.get("empty")) or not meta, "live": bool(meta.get("activated_at")) and not meta.get("empty")}


def member_ids(user):
    """The brands a person belongs to. Accounts made before multi-brand belong to the first brand."""
    if user is None:
        return None  # no personal account: every brand
    if user.get("role") == HEAD:
        return None  # marketing heads: every brand
    return list(user.get("brand_ids") if "brand_ids" in user else [MAIN])


def allowed(user):
    ids = member_ids(user)
    recs = records()
    return recs if ids is None else [r for r in recs if r["id"] in ids]


def pick(user, wanted):
    """The brand a request works in: the one chosen (if the person may use it), else their first brand."""
    recs = allowed(user)
    if not recs:
        return None
    return next((r["id"] for r in recs if r["id"] == wanted), recs[0]["id"])


def _put_namespace(brand_id, items):
    ScopedStore(base_store(), brand_id).replace_types(list(BRAND_TYPES), items)


def _log_items(brand_id, action, detail, actor="Live Brand Check", role="System"):
    store = ScopedStore(base_store(), brand_id)
    event, head = audit.link({"id": uuid.uuid4().hex[:8], "draft_id": None, "actor": actor, "role": role,
                              "action": action, "detail": detail, "at": now()}, store.get("meta", audit.HEAD_ID))
    store.put("event", event)
    store.put("meta", head)


def empty_items(name):
    """A new brand: only the Indian ad regulations, waiting for its brand kit."""
    from .brandapply import build_workspace
    _, _, rules, _ = build_workspace({}, None, "")
    for r in rules:
        if r["id"] == "R2":
            r["suggestion"] = ""
    meta = {"id": "workspace", "name": name, "empty": True, "city": "", "note": "", "brand_colours": [], "fonts": [],
            "required_text": [], "keywords": [], "logo_required": False, "logo": None, "confidential_terms": []}
    return [("rule", r) for r in rules] + [("meta", meta)]


def sunrise_items():
    """A second fictional demo brand, read from the sample brand-kit PDF with the same reader the app uses."""
    from .brandapply import build_workspace
    from .brandkit import parse_brand_pdf
    with open(SAMPLE_PDF, "rb") as fh:
        kit, _ = parse_brand_pdf(fh.read())
    meta, guidelines, rules, facts = build_workspace(kit, None, "sunrise-brand-kit.pdf")
    meta |= {"kit": kit, "revision": 1, "updated_at": meta["activated_at"]}
    return ([("guideline", g) for g in guidelines] + [("rule", r) for r in rules] + [("fact", f) for f in facts]
            + [("meta", meta)])


def create(name, by, items=None, brand_id=None, **extra):
    brand_id = brand_id or "b" + uuid.uuid4().hex[:8]
    _put_namespace(brand_id, items if items is not None else empty_items(name))
    rec = {"id": brand_id, "name": name, "created_at": now(), "created_by": by} | extra
    base_store().put("brand", rec)
    _log_items(brand_id, "Added brand", f"{name} added by {by}")
    return rec


def is_sample_main():
    meta = base_store().get("meta", "workspace") or {}
    return meta.get("name") == seed.WORKSPACE["name"] and not meta.get("activated_at") and not meta.get("empty")


def ensure():
    """First run of multi-brand: register the existing data as the first brand and add a second demo brand."""
    base = base_store()
    if base.list("brand"):
        return
    main_meta = base.get("meta", "workspace") or {}
    sample_main = is_sample_main()
    base.put("brand", {"id": MAIN, "name": main_meta.get("name") or "First brand", "created_at": now(),
                       "created_by": "setup", "sample": sample_main})
    try:
        if sample_main:
            create("Sunrise Tutorials", "setup", sunrise_items(), brand_id="sunrise", demo=True)
        else:
            create(seed.WORKSPACE["name"], "setup", seed_items(), brand_id="northstar", sample=True)
    except Exception:  # a missing sample file must never stop the app; the head can add brands by hand
        pass
    give_demo_accounts_all_brands()


def give_demo_accounts_all_brands():
    """Demo Priya and Arjun work on every brand, to show one login across brands."""
    base = base_store()
    ids = [r["id"] for r in records()]
    for u in base.list("user"):
        if u.get("demo") and u.get("role") != HEAD and "brand_ids" not in u:
            base.put("user", u | {"brand_ids": ids})


def sample_brand():
    """The brand that holds the sample data (the guided demo runs there), or None if it was removed."""
    return next((r["id"] for r in records() if r.get("sample")), None)


def add_to_demo_accounts(brand_id):
    base = base_store()
    for u in base.list("user"):
        if u.get("demo") and u.get("role") != HEAD and brand_id not in (u.get("brand_ids") or []):
            base.put("user", u | {"brand_ids": list(u.get("brand_ids") or []) + [brand_id]})


def remove(brand_id):
    """Delete a brand for good: its brand kit, facts, rules, posts, reviews, memory and audit log.
    People stay; they just stop working on it. The last remaining brand can't be removed."""
    base = base_store()
    recs = records()
    if brand_id not in {r["id"] for r in recs}:
        raise KeyError(brand_id)
    if len(recs) == 1:
        raise ValueError("last brand")
    ScopedStore(base, brand_id).replace_types(list(BRAND_TYPES), [])
    base.replace_types(["brand"], [("brand", r) for r in recs if r["id"] != brand_id])
    for kind in ("user", "invite"):
        for item in base.list(kind):
            if brand_id in (item.get("brand_ids") or []):
                base.put(kind, item | {"brand_ids": [b for b in item["brand_ids"] if b != brand_id]})
