"""Turn a brand kit the marketing head confirmed into live guidelines, rules, facts and visual settings.

Indian regulatory rules (CCPA coaching guidelines, ASCI substantiation, health claims, influencer
disclosure) are always kept. Everything brand-specific comes from the kit and cites its page.
"""
import re
from datetime import datetime, timezone

from . import seed

REGULATORY_IDS = {"R1", "R2", "R6"}
DEFAULT_SENSITIVE = ["diwali", "eid", "christmas", "ganesh", "navratri", "dussehra", "sankranti", "ramzan",
                     "ramadan", "religion", "religious", "caste", "election", "political", "politics"]


def _src(item):
    page = f", page {item['page']}" if item.get("page") else ""
    quote = item.get("quote") or item.get("text") or ""
    return f"Brand kit{page}: \u201c{quote[:140]}\u201d"


def _num(v):
    try:
        return int(str(v).replace(",", "")) if v not in (None, "") else None
    except ValueError:
        return None


def build_workspace(kit, logo_data_url=None, file_name=""):
    brand = (kit.get("brand_name") or {}).get("text") or "Your brand"
    colours = [{"name": c.get("name") or "Brand colour", "hex": c["hex"].upper()} for c in kit.get("colours", [])
               if re.fullmatch(r"#[0-9A-Fa-f]{6}", str(c.get("hex", "")))][:12]
    meta = {
        "id": "workspace", "name": brand, "city": "", "note": f"Loaded from brand kit {file_name}".strip(),
        "brand_colours": colours, "fonts": [f["name"] for f in kit.get("fonts", [])][:8],
        "required_text": [r["text"] for r in kit.get("required_text", []) if r.get("text")][:10],
        "keywords": list(dict.fromkeys(k["text"].strip().lower() for k in kit.get("keywords", [])
                                       if (k.get("text") or "").strip()))[:40],
        "logo_required": bool((kit.get("logo_required") or {}).get("value", False)),
        "logo": logo_data_url, "confidential_terms": [],
        "kit_file": file_name, "activated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }

    guidelines = []
    for g in kit.get("guidelines", []):
        guidelines.append({"section": g.get("section") or "Guideline", "text": g.get("text", ""), "source": _src(g)})
    for t in kit.get("tone_rules", []):
        guidelines.append({"section": "Tone", "text": t.get("text", ""), "source": _src(t)})
    if colours:
        guidelines.append({"section": "Colours", "text": "Use the brand colours: " + ", ".join(f"{c['name']} {c['hex']}" for c in colours) + ".",
                           "source": "Brand kit colours"})
    for r in meta["required_text"]:
        guidelines.append({"section": "Required on every image", "text": r, "source": "Brand kit required text"})
    guidelines = [g | {"id": f"G{i}"} for i, g in enumerate([g for g in guidelines if g["text"]], 1)]

    rules = []
    for r in seed.RULES:
        if r["id"] in REGULATORY_IDS:
            r = dict(r, enabled=True, guideline_ids=[],
                     sources=[s for s in r["sources"] if not s.startswith("Brand guideline")])
            if r["id"] == "R2":
                r["suggestion"] = brand
            rules.append(r)
    n = 10
    for b in kit.get("banned_phrases", []):
        phrase = (b.get("text") or "").strip()
        if len(phrase) < 2:
            continue
        rules.append({"id": f"R{n}", "name": f"Avoid \u201c{phrase[:40]}\u201d", "category": "Brand wording",
                      "severity": "warning", "source_type": "brand", "enabled": True,
                      "pattern": r"\b" + re.escape(phrase) + r"\b", "why": "The brand kit says not to use this.",
                      "sources": [_src(b)], "guideline_ids": [], "suggestion": ""})
        n += 1
    for w in kit.get("wrong_names", []):
        name = (w.get("text") or "").strip()
        if len(name) < 2 or name.lower() == brand.lower():
            continue
        rules.append({"id": f"R{n}", "name": "Wrong brand name", "category": "Terminology", "severity": "warning",
                      "source_type": "brand", "enabled": True, "pattern": r"\b" + re.escape(name) + r"\b",
                      "why": f"The brand name must be written as \u201c{brand}\u201d.", "sources": [_src(w)],
                      "guideline_ids": [], "suggestion": brand})
        n += 1
    topics = sorted({t.get("text", "").lower() for t in kit.get("sensitive_topics", []) if t.get("text")} | set(DEFAULT_SENSITIVE))
    rules.append({"id": f"R{n}", "name": "Sensitive topic", "category": "Needs senior review", "severity": "warning",
                  "source_type": "brand", "enabled": True, "sensitive": True,
                  "pattern": r"\b(" + "|".join(re.escape(t) for t in topics if t) + r")\b",
                  "why": "Mentions a sensitive topic. The tool does not judge the creative; it routes the post to the marketing head.",
                  "sources": ["Brand kit sensitive topics and default list"], "guideline_ids": [], "suggestion": ""})

    facts = []
    for i, f in enumerate(kit.get("facts", []), 1):
        kind = f.get("kind") if f.get("kind") in ("fee", "offer", "result") else None
        if not kind:
            continue
        fact = {"id": f"F{i}", "kind": kind, "label": f.get("label") or kind.title(),
                "valid_from": f.get("valid_from") or "0000-01-01", "valid_until": f.get("valid_until") or "9999-12-31",
                "owner": "Brand kit", "source": _src(f)}
        if kind == "fee" and _num(f.get("amount")) is not None:
            fact["amount"] = _num(f.get("amount"))
        elif kind == "offer" and _num(f.get("percent")) is not None:
            fact["percent"] = _num(f.get("percent"))
        elif kind == "result":
            fact["full_course"] = _num(f.get("full_course")) or 0
            fact["interview_guidance"] = _num(f.get("interview_guidance")) or 0
            fact["full_course_paid"], fact["interview_guidance_paid"] = True, False
            fact["total"] = fact["full_course"] + fact["interview_guidance"]
        else:
            continue
        facts.append(fact)
    return meta, guidelines, rules, facts
