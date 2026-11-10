"""Brand fit: does this post belong to the live brand at all?

Rule-based, no AI. It combines signals that are already measured or written in the brand kit:
brand name in the text, logo match, share of brand colours, names of other brands, the topics the
brand kit says the brand talks about, and offers or fees missing from this brand's approved facts.

The verdict is "no" (blocker: not a post for this brand), "weak" (partly on brand) or "yes".
Every signal names its source. A signal with nothing to measure is "unknown" and never counts against the post.
"""
import re

LOGO_MATCH = 0.6     # same threshold as the logo check
COLOUR_SHARE = 0.25  # same threshold as the brand-colour check
MIN_TOPICS = 3       # fewer brand topics than this: the topic signal is not used
MIN_WORDS = 8        # less post text than this: the topic signal is not used


def _norm(s):
    return re.sub(r"[^a-z0-9@.]+", "", (s or "").lower())


def _has_term(text_lower, term):
    """Term at the start of a word (so #upscprep matches 'upsc', but 'bias' does not match 'ias')."""
    t = (term or "").strip().lower().lstrip("#")
    if len(t) < 2:
        return False
    return re.search(r"(?<![a-z0-9])" + re.escape(t), text_lower) is not None


def brand_fit(meta, texts, images, findings, other_brands=(), learned=()):
    """texts: every typed field and every image's read text. images: list of dicts (kind, logo_score, brand_share).
    findings: the other findings for this post. learned: topics the brand memory learned from approved posts.
    Returns the verdict with its signals."""
    name = (meta.get("name") or "").strip()
    if not name or meta.get("empty"):
        return None
    all_text = "\n".join(t for t in texts if t)
    low = all_text.lower()
    visual = [i for i in images if i.get("kind") in ("image", "video")]
    signals = []

    def sig(sid, label, status, detail, source):
        signals.append({"id": sid, "label": label, "status": status, "detail": detail, "source": source})

    # 1. brand name anywhere in the post (text, hashtags or text read from the images)
    if _norm(name) and _norm(name) in _norm(all_text):
        sig("name", "Brand name", "pass", f"“{name}” appears in the post.", "Brand kit: brand name")
    elif all_text.strip():
        sig("name", "Brand name", "fail", f"“{name}” does not appear anywhere in the text, hashtags or images.", "Brand kit: brand name")
    else:
        sig("name", "Brand name", "unknown", "No text could be read from this post.", "Brand kit: brand name")

    # 2. logo, when the brand kit has one and there are images to look at
    scores = [i.get("logo_score") for i in visual if i.get("logo_score") is not None]
    if meta.get("logo") and visual:
        if any(s >= LOGO_MATCH for s in scores):
            sig("logo", "Logo", "pass", "The brand logo was found in an image.", "Brand kit: logo")
        elif scores:
            sig("logo", "Logo", "fail", "The brand logo was not found in any image.", "Brand kit: logo")
        else:
            sig("logo", "Logo", "unknown", "The images could not be compared with the logo.", "Brand kit: logo")

    # 3. brand colours across the images
    colours = meta.get("brand_colours") or []
    shares = [i.get("brand_share") for i in visual if i.get("brand_share") is not None]
    if colours and shares:
        avg = sum(shares) / len(shares)
        hexes = ", ".join(c["hex"] for c in colours[:6])
        if avg < COLOUR_SHARE:
            sig("colours", "Brand colours", "fail", f"Only about {round(avg * 100)}% of the visuals use the brand colours.",
                f"Brand kit colours: {hexes}")
        else:
            sig("colours", "Brand colours", "pass", f"About {round(avg * 100)}% of the visuals use the brand colours.",
                f"Brand kit colours: {hexes}")

    # 4. another brand's name: a wrong name from the kit, or a brand that had its own kit here before
    wrong = sorted({f.get("quote", "") for f in findings if f.get("category") == "Terminology" and f.get("quote")})
    others = sorted({b for b in other_brands if b and len(_norm(b)) >= 4 and _norm(b) != _norm(name)
                     and _norm(b) in _norm(all_text)})
    if wrong or others:
        parts = []
        if others:
            parts.append("mentions " + ", ".join(f"“{b}”" for b in others) + ", a different brand")
        if wrong:
            parts.append("uses " + ", ".join(f"“{w}”" for w in wrong) + ", which the brand kit lists as a wrong name")
        sig("other_brand", "Other brands", "fail", "The post " + " and ".join(parts) + ".",
            "Brand kit: wrong brand names" if wrong and not others else "Brand kits used in this workspace")
    elif all_text.strip():
        sig("other_brand", "Other brands", "pass", "No other brand's name was found.", "Brand kit: wrong brand names")

    # 5. what the brand talks about (products, services, topics, hashtags from the brand kit)
    topics = [t for t in list(meta.get("keywords") or []) + list(learned) if t and len(t.strip()) >= 2]
    topic_src = "Brand kit: what the brand talks about" + (" + brand memory (approved posts)" if learned else "")
    words = len(re.findall(r"[A-Za-z]{2,}", all_text))
    if len(topics) >= MIN_TOPICS and words >= MIN_WORDS:
        hits = [t for t in topics if _has_term(low, t)]
        shown = ", ".join(topics[:6])
        if hits:
            sig("topics", "Brand topics", "pass", "Talks about " + ", ".join(hits[:4]) + ".", topic_src)
        else:
            sig("topics", "Brand topics", "fail", f"None of the brand's topics ({shown}…) appear in the post.", topic_src)
    elif len(topics) < MIN_TOPICS:
        sig("topics", "Brand topics", "unknown", "Fewer than 3 brand topics are known yet, so topic fit was not checked.", topic_src)

    # 6. offers and fees that are not in this brand's approved facts
    bad_offers = [f for f in findings if f.get("rule_id") in ("FACT-OFFER", "FACT-UNKNOWN-FEE")]
    if bad_offers:
        quotes = ", ".join(sorted({f"“{f['quote']}”" for f in bad_offers if f.get("quote")})[:3])
        sig("offers", "Offers and prices", "fail", f"{quotes or 'An offer or fee'} is not in this brand's approved facts.",
            "Approved facts sheet")
    elif re.search(r"\d\s?%|₹|\brs\.?\s?\d", low):
        sig("offers", "Offers and prices", "pass", "Offers and prices match the approved facts.", "Approved facts sheet")

    failed = [s for s in signals if s["status"] == "fail"]
    ids = {s["id"] for s in failed}
    no_identity = "name" in ids and ("logo" in ids or not any(s["id"] == "logo" for s in signals))
    if "other_brand" in ids or len(failed) >= 3 or (no_identity and len(failed) >= 2):
        verdict = "no"
    elif failed:
        verdict = "weak"
    else:
        verdict = "yes"
    return {"verdict": verdict, "brand": name, "signals": signals, "failed": len(failed),
            "checked": sum(1 for s in signals if s["status"] != "unknown")}


def finding(fit, location="post"):
    """The blocker shown when the verdict is no. Its sources are the sources of the failed signals."""
    failed = [s for s in fit["signals"] if s["status"] == "fail"]
    return {
        "rule_id": "BRAND-FIT", "name": f"Not a post for {fit['brand']}", "category": "Brand fit",
        "severity": "blocker", "start": 0, "end": 0, "quote": "",
        "why": f"This does not look like a {fit['brand']} post. " + " ".join(s["detail"] for s in failed),
        "sources": list(dict.fromkeys(s["source"] for s in failed)),
        "suggestion": f"Rework the post for {fit['brand']} (name or logo, brand colours, the brand's own topics and approved offers), "
                      "or check that the right brand kit is live.",
        "engine": "Rule-based", "location": location, "fact_ids": [], "guideline_ids": [], "sensitive": False,
        "outcome": "Rule risk", "confidence": "Medium", "layer": "brand",
    }
