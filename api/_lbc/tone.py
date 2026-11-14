"""Tone and messaging check (Round 3). Fixed rules, no AI, no API key, nothing leaves the server.

It runs only when the brand kit has a tone or voice guideline, and every finding cites that guideline:
- words or phrases the tone guideline itself says to avoid (quoted in the guideline, e.g. 'hurry'),
- shouting: several words in capitals in a row, or a long word in capitals,
- too many exclamation marks,
- hype and pressure words (a fixed list below).

Findings are always suggestions: a person decides. The rules are repeatable and explainable, but they don't
understand meaning, so off-tone writing without these signals isn't caught. Accuracy is not measured yet.
"""
import re

TONE_SECTION = re.compile(r"\b(tone|voice)\b", re.I)
HYPE = [
    "amazing", "unbelievable", "insane", "mind-blowing", "mind blowing", "jaw-dropping", "jaw dropping", "crazy deal",
    "once in a lifetime", "once-in-a-lifetime", "game-changer", "game changer", "revolutionary", "miracle", "shocking",
    "hurry", "act now", "last chance", "don't miss", "dont miss", "limited time only", "before it's too late",
    "grab it now", "what are you waiting for", "epic", "killer deal",
]
HYPE_RE = re.compile(r"(?<![\w-])(" + "|".join(re.escape(w) for w in sorted(HYPE, key=len, reverse=True)) + r")(?![\w-])", re.I)
CAPS_RUN = re.compile(r"\b[A-Z][A-Z'’]+(?:[\s,.!?-]+[A-Z][A-Z'’]+){2,}\b")  # 3+ words in capitals
CAPS_WORD = re.compile(r"\b[A-Z]{6,}\b")  # one long word in capitals (short ones are usually acronyms)
EXCLAIM = re.compile(r"!{2,}")
QUOTED = re.compile(r"[\"'‘“]([^\"'’”]{2,40})[\"'’”]")
AVOID = re.compile(r"\b(avoid|don't|do not|never|no|not)\b", re.I)


def tone_guidelines(guidelines):
    return [g for g in guidelines if TONE_SECTION.search(g.get("section") or "") and (g.get("text") or "").strip()]


def discouraged(guides):
    """Phrases a tone guideline quotes as things to avoid: [(phrase, guideline)]."""
    out = []
    for g in guides:
        for sentence in re.split(r"(?<=[.;])\s+", g["text"]):
            if AVOID.search(sentence):
                out += [(m.group(1).strip(), g) for m in QUOTED.finditer(sentence) if m.group(1).strip()]
    return out


def _cite(guides, *hints):
    """The tone guideline that best matches what was found (falls back to the first one)."""
    for g in guides:
        if any(h in g["text"].lower() for h in hints):
            return g
    return guides[0]


def check(parts, guidelines, brand="the brand", **_):
    """parts: [(location, label, text)]. Returns (issues, status). Each issue: location, quote, start, end,
    name, why, suggestion, guideline."""
    guides = tone_guidelines(guidelines)
    parts = [(loc, label, t) for loc, label, t in parts if (t or "").strip()]
    if not guides:
        return [], {"status": "skipped", "message": "The brand kit has no tone guideline, so tone wasn't checked."}
    if not parts:
        return [], {"status": "skipped", "message": "No text to check for tone."}
    avoid = discouraged(guides)
    issues = []

    def add(loc, m, name, why, suggestion, g):
        issues.append({"location": loc, "quote": m.group(0), "start": m.start(), "end": m.end(),
                       "name": name, "why": why, "suggestion": suggestion, "guideline": g})

    for loc, _, text in parts:
        taken = []

        def free(m):
            if any(m.start() < e and s < m.end() for s, e in taken):
                return False
            taken.append((m.start(), m.end()))
            return True

        for phrase, g in avoid:
            for m in re.finditer(r"(?<![\w-])" + re.escape(phrase) + r"(?![\w-])", text, re.I):
                if free(m):
                    add(loc, m, "Word the tone guideline avoids",
                        f"The brand's tone guideline asks to avoid “{phrase}”.", "", g)
        for m in HYPE_RE.finditer(text):
            if free(m):
                g = _cite(guides, "hype", "pressure", "pushy", "calm", "factual")
                add(loc, m, "Hype or pressure word",
                    f"“{m.group(0)}” is a hype or pressure word, which doesn't fit the brand's tone.", "", g)
        brand_words = {w.upper() for w in re.findall(r"[A-Za-z]+", brand)}
        for m in list(CAPS_RUN.finditer(text)) + list(CAPS_WORD.finditer(text)):
            if set(re.findall(r"[A-Z]+", m.group(0))) <= brand_words:
                continue  # the brand's own name in capitals
            if free(m):
                g = _cite(guides, "calm", "shout", "capital", "trusted", "empathetic")
                add(loc, m, "Shouting in capitals",
                    "Words in capitals read as shouting, which doesn't fit the brand's tone.",
                    m.group(0).capitalize() if len(m.group(0)) < 80 else "", g)
        bangs = list(EXCLAIM.finditer(text))
        if bangs or text.count("!") > 3:
            m = bangs[0] if bangs else list(re.finditer("!", text))[3]
            if free(m):
                g = _cite(guides, "exclamation", "calm", "hype")
                add(loc, m, "Too many exclamation marks",
                    "Several exclamation marks read as hype, which doesn't fit the brand's tone.", "!" if bangs else "", g)
    return issues, {"status": "done", "message": f"Checked with fixed rules (no AI) against {len(guides)} tone guideline(s)."}
