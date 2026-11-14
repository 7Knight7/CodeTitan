"""Trusted history (Round 3).

1. Tamper-evident audit log: every event carries its place in the log (seq), the fingerprint of the
   entry before it (prev) and its own fingerprint (hash = SHA-256 of its fields plus prev). Changing,
   removing or reordering any entry breaks every link after it, and verify() says where.
   (This proves tampering happened; it can't stop someone with database access from rewriting
   the whole chain. Exporting the head fingerprint in approval records makes that detectable too.)
2. Evidence-bound approvals: an approval records the exact approved facts it relied on, with a
   fingerprint of each. If a fact changes, is removed or expires, the approval reopens.
"""
import hashlib
import json

GENESIS = "0" * 64
HEAD_ID = "audit_chain"
FIELDS = ("id", "draft_id", "actor", "role", "action", "detail", "at", "seq", "prev")


def _sha(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def digest(event):
    return _sha({k: event.get(k) for k in FIELDS})


def empty_head():
    return {"id": HEAD_ID, "seq": 0, "hash": GENESIS}


def link(event, head):
    """Chain a new event after head. Returns (event, new head)."""
    head = head or empty_head()
    event = dict(event, seq=head["seq"] + 1, prev=head["hash"])
    event["hash"] = digest(event)
    return event, {"id": HEAD_ID, "seq": event["seq"], "hash": event["hash"]}


def chain_all(events):
    """Chain a batch of new events in time order (used for the sample data)."""
    head, out = empty_head(), []
    for e in sorted(events, key=lambda e: (e["at"], e["id"])):
        e, head = link(e, head)
        out.append(e)
    return out, head


def verify(events, head):
    chained = sorted([e for e in events if e.get("hash")], key=lambda e: (e.get("seq") or 0, e["at"]))
    legacy = len(events) - len(chained)
    prev, expect = GENESIS, 1

    def broken(e, reason):
        return {"ok": False, "entries": len(chained), "legacy": legacy, "head": (head or {}).get("hash"),
                "broken_at": {"seq": e.get("seq"), "id": e.get("id"), "action": e.get("action"), "at": e.get("at"), "reason": reason}}

    for e in chained:
        if e.get("seq") != expect:
            return broken(e, "An entry before this one is missing." if (e.get("seq") or 0) > expect
                          else "Two entries claim the same place in the log.")
        if e.get("prev") != prev:
            return broken(e, "This entry is not linked to the one before it.")
        if digest(e) != e["hash"]:
            return broken(e, "This entry was changed after it was written.")
        prev, expect = e["hash"], expect + 1
    if head and (head.get("seq") != expect - 1 or head.get("hash") != prev):
        return {"ok": False, "entries": len(chained), "legacy": legacy, "head": head.get("hash"),
                "broken_at": {"seq": expect, "reason": "Entries were removed from the end of the log."}}
    return {"ok": True, "entries": len(chained), "legacy": legacy, "head": prev}


# ---------- evidence-bound approvals ----------

FACT_FIELDS = ("id", "kind", "label", "amount", "percent", "valid_from", "valid_until", "full_course",
               "interview_guidance", "total", "owner")


def fingerprint(fact):
    return _sha({k: fact.get(k) for k in FACT_FIELDS})[:16]


def relied_fact_ids(d):
    """Facts the post's claims were matched against and found correct (findings about wrong or expired facts are problems, not evidence)."""
    return list(dict.fromkeys(v.get("fact_id") for v in d.get("verified") or [] if v.get("fact_id")))


def evidence(d, facts):
    """The approved facts this post relies on, frozen at approval time."""
    by_id = {f["id"]: f for f in facts}
    out = []
    for fid in relied_fact_ids(d):
        f = by_id.get(fid)
        if f:
            out.append({"fact_id": fid, "label": f.get("label"), "valid_until": f.get("valid_until"), "fingerprint": fingerprint(f)})
    return out


def stale_reasons(evidence_list, facts, today):
    """Why an approval no longer stands: a fact it relied on changed, was removed or expired."""
    by_id = {f["id"]: f for f in facts}
    reasons = []
    for ev in evidence_list or []:
        f = by_id.get(ev["fact_id"])
        if not f:
            reasons.append(f"Approved fact “{ev['label']}” was removed from the brand kit.")
        elif fingerprint(f) != ev["fingerprint"]:
            reasons.append(f"Approved fact “{f.get('label')}” changed after this post was approved.")
        elif (f.get("valid_until") or "9999") < today:
            reasons.append(f"Approved fact “{f.get('label')}” expired on {f['valid_until']}.")
    return reasons
