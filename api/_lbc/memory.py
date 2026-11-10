"""Brand memory: what the app learns about a brand from working with it, kept apart from the brand kit.

The brand kit (the marketing head's confirmed PDF) is never changed by this. Memory is learned only from
decisions people made, so it is human-sourced, and it never adds blockers:
- approved posts      -> topics the brand really talks about, and its house style (length, '!', hashtags, capitals)
- reviewer feedback   -> what reviewers keep asking for
- creator decisions   -> mistakes that keep coming back (fixes accepted) and accepted exceptions (kept with a reason)

Rule-based, no AI. One memory per brand kit (id = the kit's activation time); a reset leaves it with its brand.
The marketing head can make it forget a learned topic.
"""
import re
from datetime import datetime, timezone

from .brandkit import STOP

MIN_POSTS_TOPIC = 2   # a word must appear in at least this many approved posts to count as a learned topic
MIN_POSTS_STYLE = 3   # house style is only used once this many posts are approved
KEEP = 40             # how many recent values / notes to keep
EMOJI_RE = re.compile("[\U0001F300-\U0001FAFF☀-➿]")


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def empty(kit_id, brand):
    return {"id": kit_id, "brand": brand, "created_at": _now(), "updated_at": _now(), "approved_posts": 0,
            "terms": {}, "style": {"chars": [], "exclaim": [], "hashtags": [], "caps": [], "emoji": []},
            "feedback": [], "mistakes": {}, "exceptions": {}, "forgotten": [], "log": []}


def _note(mem, text):
    mem["log"] = ([{"at": _now(), "text": text}] + mem.get("log", []))[:KEEP]
    mem["updated_at"] = _now()


def terms_of(text, brand=""):
    """Hashtags and content words of a post (lower case), without stop words or the brand's own name."""
    low = (text or "").lower()
    brand_words = set(re.findall(r"[a-z0-9]+", (brand or "").lower()))
    tags = {"#" + t for t in re.findall(r"(?<![\w&])#([a-z][a-z0-9_]{2,30})", low)
            if not re.fullmatch(r"[0-9a-f]{3}|[0-9a-f]{6}", t)}
    words = {w for w in re.findall(r"[a-z][a-z-]{3,}", re.sub(r"#\w+", " ", low))
             if w not in STOP and w not in brand_words}
    return tags | words


def style_of(text):
    words = re.findall(r"[A-Za-z]{2,}", text or "")
    return {"chars": len((text or "").strip()), "exclaim": (text or "").count("!"),
            "hashtags": len(re.findall(r"(?<![\w&])#\w+", text or "")),
            "caps": sum(1 for w in words if len(w) >= 3 and w.isupper()),
            "emoji": len(EMOJI_RE.findall(text or ""))}


def learn_approved(mem, text, title, kit_keywords=()):
    """An approved post: count its topics and record its style."""
    mem["approved_posts"] += 1
    known = {k.lower().lstrip("#") for k in kit_keywords}
    before = set(learned_topics(mem, kit_keywords))
    for t in terms_of(text, mem.get("brand", "")):
        e = mem["terms"].setdefault(t, {"posts": 0, "first": _now()[:10]})
        e["posts"] += 1
    for k, v in style_of(text).items():
        mem["style"][k] = (mem["style"].get(k, []) + [v])[-KEEP:]
    new = [t for t in learned_topics(mem, kit_keywords) if t not in before and t.lstrip("#") not in known]
    _note(mem, f"Learned from approved post “{title}”" + (f": new topic{'s' if len(new) > 1 else ''} {', '.join(new[:5])}" if new else ""))
    return new


def learn_feedback(mem, comment, by, title):
    mem["feedback"] = ([{"text": comment[:300], "by": by, "post": title[:80], "at": _now()}] + mem["feedback"])[:KEEP]
    _note(mem, f"Remembered {by}'s feedback on “{title}”")


def learn_decision(mem, action, name, quote, reason, title):
    """accept/edit -> a mistake that was fixed; reject (kept with a reason) -> an accepted exception."""
    if action == "reject":
        e = mem["exceptions"].setdefault(name, {"count": 0, "reasons": []})
        e["count"] += 1
        e["reasons"] = ([reason[:200]] + e["reasons"])[:5]
        _note(mem, f"Exception kept on “{title}”: {name}")
    else:
        e = mem["mistakes"].setdefault(name, {"count": 0, "examples": []})
        e["count"] += 1
        if quote and quote not in e["examples"]:
            e["examples"] = ([quote[:80]] + e["examples"])[:5]
        _note(mem, f"Fix accepted on “{title}”: {name}")


def forget(mem, term):
    term = term.strip().lower()
    mem["terms"].pop(term, None)
    if term not in mem["forgotten"]:
        mem["forgotten"].append(term)
    _note(mem, f"Forgot the topic “{term}” (marketing head)")


def learned_topics(mem, kit_keywords=(), limit=25):
    if not mem:
        return []
    known = {k.lower().lstrip("#") for k in kit_keywords}
    rows = [(t, e["posts"]) for t, e in mem.get("terms", {}).items()
            if e["posts"] >= MIN_POSTS_TOPIC and t not in mem.get("forgotten", []) and t.lstrip("#") not in known]
    return [t for t, _ in sorted(rows, key=lambda r: (-r[1], r[0]))[:limit]]


def house_style(mem):
    """Typical values of approved posts, or None until enough posts are approved."""
    if not mem or mem.get("approved_posts", 0) < MIN_POSTS_STYLE:
        return None
    st = mem["style"]
    out = {"posts": len(st.get("chars", []))}
    for k in ("chars", "exclaim", "hashtags", "caps", "emoji"):
        vals = sorted(st.get(k, [])) or [0]
        out[k] = {"max": vals[-1], "typical": vals[len(vals) // 2]}
    return out


def style_findings(mem, text, make):
    """Suggestions (never blockers) when a post is far from every approved post of this brand."""
    hs = house_style(mem)
    if not hs or not (text or "").strip():
        return []
    st, out = style_of(text), []
    src = [f"Brand memory: {hs['posts']} approved posts of {mem['brand']}"]
    checks = [
        ("exclaim", 2, "More exclamation marks than usual", "exclamation marks"),
        ("hashtags", 3, "More hashtags than usual", "hashtags"),
        ("caps", 2, "More capital-letter words than usual", "words in capitals"),
        ("emoji", 3, "More emoji than usual", "emoji"),
    ]
    for key, slack, name, what in checks:
        if st[key] >= hs[key]["max"] + slack:
            out.append(make("MEM-STYLE", name, f"This post has {st[key]} {what}; approved posts of this brand have at most "
                            f"{hs[key]['max']} (usually {hs[key]['typical']}).", src,
                            f"Use at most {hs[key]['max']} {what}, like the approved posts"))
    if st["chars"] > max(200, hs["chars"]["max"] * 1.5):
        out.append(make("MEM-STYLE", "Much longer than usual", f"This post is {st['chars']} characters; approved posts of this "
                        f"brand are at most {hs['chars']['max']} (usually {hs['chars']['typical']}).", src,
                        "Shorten it to the length of the approved posts"))
    return out


def seen_before(mem, name):
    return (mem or {}).get("mistakes", {}).get(name, {}).get("count", 0)


def summary(mem, kit_keywords=()):
    if not mem:
        return None
    return {"brand": mem["brand"], "approved_posts": mem["approved_posts"], "updated_at": mem["updated_at"],
            "topics": [{"text": t, "posts": mem["terms"][t]["posts"]} for t in learned_topics(mem, kit_keywords)],
            "style": house_style(mem), "feedback": mem["feedback"][:10],
            "mistakes": sorted(({"name": k, **v} for k, v in mem["mistakes"].items()), key=lambda x: -x["count"])[:10],
            "exceptions": sorted(({"name": k, **v} for k, v in mem["exceptions"].items()), key=lambda x: -x["count"])[:10],
            "forgotten": mem["forgotten"], "log": mem["log"][:15]}
