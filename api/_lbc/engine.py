"""Deterministic checks: brand and regulatory rules, plus claims against approved facts.

Every finding carries the exact text span it refers to and the source behind it,
so the interface can underline it and explain why it was raised.
"""
import re
import uuid
from datetime import date

from .seed import DISCLOSURE_RULE, COACHING_GUIDELINES

DISCLOSURE_CHANNELS = {"Influencer post", "Paid partnership"}
DISCLOSURE_RE = re.compile(r"#(ad|ads|sponsored|collab(oration)?|partnership|paidpartnership)\b|\bpaid partnership\b", re.I)

MONEY_RE = re.compile(r"(?:₹|rs\.?|inr)\s?(\d[\d,]*(?:\.\d+)?)\s?(k|lakh|lakhs)?\b", re.I)
PERCENT_OFF_RE = re.compile(r"(\d{1,2})\s?%\s?(off|discount)", re.I)
RESULT_RE = re.compile(
    r"\b(\d{1,4})\s+(?:of\s+our\s+|our\s+)?(?:students|aspirants|candidates|selections)\b[^.!?\n]{0,30}?"
    r"(?:cracked|cleared|qualified|selected|made it|got through)?",
    re.I,
)
RANK_SHARE_RE = re.compile(r"\b(\d{1,2})\s+(?:of|out of)\s+(?:the\s+)?top\s+(\d{1,3})\b", re.I)
COHORT_WORDS = re.compile(r"interview|guidance|test series|full[- ]course|free|paid", re.I)

SEVERITY_ORDER = {"blocker": 0, "warning": 1, "suggestion": 2}


def _id():
    return uuid.uuid4().hex[:10]


def _today(today=None):
    return today or date.today()


def _is_valid(fact, today):
    return fact.get("valid_from", "0000") <= today.isoformat() <= fact.get("valid_until", "9999")


def _finding(*, rule_id, name, category, severity, start, end, text, why, sources,
             suggestion="", engine="Rule-based", location="caption", fact_ids=None,
             guideline_ids=None, sensitive=False, outcome="Rule risk", confidence=None):
    return {
        "id": _id(), "rule_id": rule_id, "name": name, "category": category,
        "severity": severity, "start": start, "end": end, "quote": text, "why": why,
        "sources": sources, "suggestion": suggestion, "engine": engine,
        "location": location, "fact_ids": fact_ids or [], "guideline_ids": guideline_ids or [],
        "sensitive": sensitive, "outcome": outcome, "confidence": confidence,
    }


def _amount(match):
    value = float(match.group(1).replace(",", ""))
    unit = (match.group(2) or "").lower()
    if unit == "k":
        value *= 1000
    elif unit.startswith("lakh"):
        value *= 100000
    return int(round(value))


def _fmt_inr(n):
    s = str(int(n))
    if len(s) <= 3:
        return s
    head, tail = s[:-3], s[-3:]
    parts = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return ",".join(parts) + "," + tail


def check_rules(text, rules, channel, location="caption"):
    findings = []
    for rule in rules:
        if not rule.get("enabled", True) or not rule.get("pattern"):
            continue
        for m in re.finditer(rule["pattern"], text, re.I):
            findings.append(_finding(
                rule_id=rule["id"], name=rule["name"], category=rule["category"],
                severity=rule["severity"], start=m.start(), end=m.end(), text=m.group(0),
                why=rule["why"], sources=rule["sources"], suggestion=rule.get("suggestion", ""),
                guideline_ids=rule.get("guideline_ids"), sensitive=rule.get("sensitive", False),
                location=location,
                outcome="Needs senior review" if rule.get("category") == "Needs senior review" else "Rule risk",
            ))
    if location == "caption" and channel in DISCLOSURE_CHANNELS and not DISCLOSURE_RE.search(text):
        r = DISCLOSURE_RULE
        findings.append(_finding(
            rule_id=r["id"], name=r["name"], category=r["category"], severity=r["severity"],
            start=len(text), end=len(text), text="", why=r["why"], sources=r["sources"],
            suggestion=" " + r["suggestion"], location=location,
        ))
    return findings


def check_facts(text, facts, today=None, location="caption"):
    """Compare fees, offers and result claims in the text with the approved facts table."""
    today = _today(today)
    findings, verified = [], []
    fees = [f for f in facts if f["kind"] == "fee"]
    current_fees = [f for f in fees if _is_valid(f, today)]

    for m in MONEY_RE.finditer(text):
        amount = _amount(m)
        match = next((f for f in fees if f.get("amount") == amount), None)
        current = current_fees[0] if current_fees else None
        if match and _is_valid(match, today):
            verified.append({"quote": m.group(0), "fact_id": match["id"], "label": match["label"], "location": location})
            continue
        if match:  # matches an expired fact
            findings.append(_finding(
                rule_id="FACT-EXPIRED", name="Outdated fee", category="Outdated fact", severity="warning",
                start=m.start(), end=m.end(), text=m.group(0),
                why=f"Rs {_fmt_inr(amount)} is the {match['label'].lower()}, which expired on {match['valid_until']}.",
                sources=[f"Approved fact {match['id']}: {match['label']} (valid until {match['valid_until']})", "Brand guideline G5"],
                suggestion=f"Rs {_fmt_inr(current['amount'])}" if current else "",
                fact_ids=[match["id"]] + ([current["id"]] if current else []), guideline_ids=["G5"],
                location=location, outcome="Evidence conflict",
            ))
        else:
            findings.append(_finding(
                rule_id="FACT-UNKNOWN-FEE", name="Fee not in approved facts", category="Unsupported claim",
                severity="blocker", start=m.start(), end=m.end(), text=m.group(0),
                why=f"No approved fee or offer of Rs {_fmt_inr(amount)} exists in the facts sheet.",
                sources=["Approved facts sheet: fees", "Brand guideline G5"],
                suggestion=f"Rs {_fmt_inr(current['amount'])}" if current else "",
                fact_ids=[current["id"]] if current else [], guideline_ids=["G5"],
                location=location, outcome="Couldn't verify",
            ))

    offers = [f for f in facts if f["kind"] == "offer"]
    for m in PERCENT_OFF_RE.finditer(text):
        pct = int(m.group(1))
        match = next((f for f in offers if f.get("percent") == pct), None)
        if match and _is_valid(match, today):
            verified.append({"quote": m.group(0), "fact_id": match["id"], "label": match["label"], "location": location})
        else:
            why = (f"The {match['label'].lower()} expired on {match['valid_until']}." if match
                   else f"No approved {pct}% offer exists in the facts sheet.")
            findings.append(_finding(
                rule_id="FACT-OFFER", name="Offer not currently approved", category="Outdated fact" if match else "Unsupported claim",
                severity="warning" if match else "blocker", start=m.start(), end=m.end(), text=m.group(0), why=why,
                sources=[f"Approved fact {match['id']}: {match['label']} (valid until {match['valid_until']})" if match else "Approved facts sheet: offers", "Brand guideline G5"],
                fact_ids=[match["id"]] if match else [], guideline_ids=["G5"], location=location,
                outcome="Evidence conflict" if match else "Couldn't verify",
            ))

    results = [f for f in facts if f["kind"] == "result" and _is_valid(f, today)]
    for m in RESULT_RE.finditer(text):
        n = int(m.group(1))
        sentence = _sentence(text, m.start())
        fact = next((f for f in results if n in (f.get("total"), f.get("full_course"), f.get("interview_guidance"))), None)
        if not fact:
            findings.append(_finding(
                rule_id="FACT-RESULT-UNKNOWN", name="Result not in records", category="Unsupported claim",
                severity="blocker", start=m.start(), end=m.end(), text=m.group(0),
                why=f"No approved results record supports '{n}' students.",
                sources=["Approved facts sheet: results", COACHING_GUIDELINES],
                guideline_ids=["G3"], location=location, outcome="Couldn't verify",
            ))
            continue
        mixes_cohorts = n == fact.get("total") and not COHORT_WORDS.search(sentence)
        if mixes_cohorts:
            findings.append(_finding(
                rule_id="FACT-RESULT-COHORT", name="Results claim hides programme details", category="Unsupported claim",
                severity="blocker", start=m.start(), end=m.end(), text=m.group(0),
                why=(f"Records show {fact['total']} selections, but only {fact['full_course']} took the paid full course; "
                     f"{fact['interview_guidance']} joined only the free interview-guidance programme. "
                     "The claim must say which programme each group took and whether it was paid or free."),
                sources=[f"Approved fact {fact['id']}: {fact['label']}", COACHING_GUIDELINES + ": disclose course, duration and whether paid or free", "Brand guideline G3"],
                suggestion=(f"{fact['full_course']} students from our paid full course and {fact['interview_guidance']} "
                            "from our free interview-guidance programme"),
                fact_ids=[fact["id"]], guideline_ids=["G3"], location=location, outcome="Evidence conflict",
            ))
        else:
            verified.append({"quote": m.group(0), "fact_id": fact["id"], "label": fact["label"], "location": location})

    for m in RANK_SHARE_RE.finditer(text):
        findings.append(_finding(
            rule_id="FACT-RANK", name="Rank claim needs evidence", category="Unsupported claim",
            severity="warning", start=m.start(), end=m.end(), text=m.group(0),
            why="No approved record lists top-rank holders or the programme each one took.",
            sources=["Approved facts sheet: results", COACHING_GUIDELINES + ": disclose course, duration and whether paid or free"],
            guideline_ids=["G3"], location=location, outcome="Couldn't verify",
        ))
    return findings, verified


def _sentence(text, pos):
    start = max(text.rfind(c, 0, pos) for c in ".!?\n") + 1
    ends = [i for i in (text.find(c, pos) for c in ".!?\n") if i != -1]
    return text[start:(min(ends) if ends else len(text))]


def dedupe(findings):
    """Keep the most severe finding when spans overlap, preferring rule-based ones."""
    ordered = sorted(findings, key=lambda f: (SEVERITY_ORDER[f["severity"]], f["engine"] != "Rule-based", f["start"]))
    kept = []
    for f in ordered:
        clash = any(
            k["location"] == f["location"] and f["end"] > f["start"] and k["start"] < f["end"] and f["start"] < k["end"]
            and k["rule_id"] == f["rule_id"]
            for k in kept
        )
        if not clash:
            kept.append(f)
    return sorted(kept, key=lambda f: (f["location"] != "caption", f["start"]))


def run_checks(content, channel, workspace, banner_text="", today=None):
    rules = workspace["rules"]
    facts = workspace["facts"]
    findings = check_rules(content, rules, channel)
    fact_findings, verified = check_facts(content, facts, today)
    findings += fact_findings
    if banner_text.strip():
        findings += check_rules(banner_text, rules, channel, location="banner")
        bf, bv = check_facts(banner_text, facts, today, location="banner")
        findings += bf
        verified += bv
    return dedupe(findings), verified
