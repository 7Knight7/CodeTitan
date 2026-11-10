import os
import sys
from datetime import date

os.environ["LBC_DATA_PATH"] = "/tmp/lbc-test.json"
os.environ["LBC_SESSION_SECRET"] = "test-secret-not-for-production"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

from _lbc import auth, engine, seed  # noqa: E402
TEST_PW = "test-only-password"  # not the real one; the real password lives only as a hash in Vercel
os.environ["LBC_PASSWORD_HASH"] = auth.hash_password(TEST_PW)
os.environ["LBC_REQUIRE_PASSWORD"] = "1"  # the password tests run with sign-in protection on

from fastapi.testclient import TestClient  # noqa: E402
from _lbc.store import get_store  # noqa: E402
import index  # noqa: E402

TODAY = date(2026, 11, 9)
WS = {"rules": [r | {"enabled": True} for r in seed.RULES], "facts": seed.FACTS}
H = {"X-LBC": "1"}


def client(role="Creator"):
    c = TestClient(index.app, headers=H)
    r = c.post("/api/login", json={"password": TEST_PW, "role": role})
    assert r.status_code == 200, r.text
    return c


def as_role(c, role):
    assert c.post("/api/session/role", json={"role": role}).status_code == 200
    return c


def ids(findings):
    return {f["rule_id"] for f in findings}


# ---------- engine ----------

def test_walkthrough_caption_finds_all_issues():
    findings, _ = engine.run_checks(seed.SAMPLE_DRAFT["content"], "Instagram post", WS, today=TODAY)
    assert {"R1", "R2", "R3", "R4", "R5", "FACT-EXPIRED", "FACT-RESULT-COHORT"} <= ids(findings)
    cohort = next(f for f in findings if f["rule_id"] == "FACT-RESULT-COHORT")
    assert "32" in cohort["suggestion"] and "18" in cohort["suggestion"]
    assert next(f for f in findings if f["rule_id"] == "FACT-EXPIRED")["suggestion"] == "Rs 48,000"
    for f in findings:
        assert f["why"] and f["sources"]
        if f["quote"]:
            assert seed.SAMPLE_DRAFT["content"][f["start"]:f["end"]] == f["quote"]


def test_clean_caption_has_no_blockers_and_verifies_facts():
    text = ("32 students from our paid full course and 18 from our free interview-guidance programme qualified "
            "in UPSC CSE 2025. Foundation course fee for the 2026-27 batch: Rs 48,000. Early-bird 10% off until 30 November.")
    findings, verified = engine.run_checks(text, "Instagram post", WS, today=TODAY)
    assert not [f for f in findings if f["severity"] == "blocker"]
    assert {v["fact_id"] for v in verified} >= {"F1", "F4"}


def test_unknown_fee_result_expired_offer_disclosure_sensitive_banner():
    f, _ = engine.run_checks("Fees only Rs 39,999. 75 students selected!", "Instagram post", WS, today=TODAY)
    assert {"FACT-UNKNOWN-FEE", "FACT-RESULT-UNKNOWN"} <= ids(f)
    f, _ = engine.run_checks("Get 10% off today", "Instagram post", WS, today=date(2026, 12, 15))
    assert "FACT-OFFER" in ids(f)
    assert "R8" in ids(engine.run_checks("Loved it", "Influencer post", WS, today=TODAY)[0])
    assert "R8" not in ids(engine.run_checks("Loved it #ad", "Influencer post", WS, today=TODAY)[0])
    assert any(x["sensitive"] for x in engine.run_checks("Happy Diwali", "Instagram post", WS, today=TODAY)[0])
    f, _ = engine.run_checks("Soon", "Instagram post", WS, banner_text="Fees Rs 45,000", today=TODAY)
    assert any(x["location"] == "banner" and x["rule_id"] == "FACT-EXPIRED" for x in f)


# ---------- security ----------

def test_password_hashing():
    h = auth.hash_password(TEST_PW)
    assert TEST_PW not in h and auth.verify_password(TEST_PW, h) and not auth.verify_password(TEST_PW.upper(), h)
    assert auth.hash_password(TEST_PW) != h  # salted


def test_api_requires_session():
    c = TestClient(index.app, headers=H)
    assert c.get("/api/health").status_code == 200
    for path in ("/api/workspace", "/api/drafts", "/api/insights", "/api/session"):
        assert c.get(path).status_code == 401
    assert c.post("/api/check", json={"content": "x"}).status_code == 401


def test_forged_or_tampered_cookie_rejected():
    c = TestClient(index.app, headers=H)
    token = auth.make_token("Creator")
    payload, sig = token.split(".")
    forged = auth._b64(b'{"role": "Marketing head", "name": "x", "iat": 0, "exp": 9999999999}')
    c.cookies.set(auth.COOKIE, f"{forged}.{sig}")
    assert c.get("/api/session").status_code == 401
    c.cookies.set(auth.COOKIE, auth.make_token("Creator", now=1))  # expired long ago
    assert c.get("/api/session").status_code == 401


def test_wrong_password_and_rate_limit():
    auth._attempts.clear()
    c = TestClient(index.app, headers=H)
    for _ in range(auth.MAX_ATTEMPTS):
        assert c.post("/api/login", json={"password": "nope"}).status_code == 401
    assert c.post("/api/login", json={"password": TEST_PW}).status_code == 429
    auth._attempts.clear()


def test_csrf_header_required():
    c = client()
    r = c.post("/api/check", json={"content": "x"}, headers={"X-LBC": ""})
    assert r.status_code == 403


def test_roles_enforced_on_server():
    get_store().reset()
    c = client("Creator")
    assert c.put("/api/facts/F1", json={"amount": 1}).status_code == 403
    assert c.post("/api/reset").status_code == 403
    as_role(c, "Reviewer")
    assert c.post("/api/drafts", json={"content": "hello"}).status_code == 403
    as_role(c, "Marketing head")
    assert c.put("/api/facts/F1", json={"amount": 49000}).json()["amount"] == 49000


def test_input_limits():
    c = client()
    assert c.post("/api/check", json={"content": "x" * 5001}).status_code == 422
    assert c.post("/api/drafts", json={"content": "ok", "title": "t" * 151}).status_code == 422


# ---------- workflow ----------

def test_end_to_end_workflow_server_computes_findings():
    get_store().reset()
    c = client("Creator")
    d = c.post("/api/drafts", json={"title": "t", "content": seed.SAMPLE_DRAFT["content"]}).json()
    assert d["author"] == "Priya (social media)" and d["summary"]["blocker"] >= 3
    assert c.post(f"/api/drafts/{d['id']}/submit").status_code == 400
    blocker = next(f for f in d["findings"] if f["severity"] == "blocker")
    assert c.post(f"/api/drafts/{d['id']}/decisions", json={"finding_id": blocker["id"], "action": "reject"}).status_code == 400
    assert c.post(f"/api/drafts/{d['id']}/decisions", json={"finding_id": "fake", "action": "accept"}).status_code == 404
    fixed = ("Northstar Civils Academy for UPSC. 32 students from our paid full course and 18 from our free "
             "interview-guidance programme qualified this year. Structured mentoring and weekly mock tests. "
             "Foundation course fee for the 2026-27 batch: Rs 48,000.")
    d2 = c.put(f"/api/drafts/{d['id']}", json={"title": "t", "content": fixed}).json()
    assert d2["summary"]["blocker"] == 0 and d2["version"] == 2
    assert c.post(f"/api/drafts/{d['id']}/submit").json()["status"] == "in_review"
    assert c.put(f"/api/drafts/{d['id']}", json={"content": "sneaky edit"}).status_code == 409
    as_role(c, "Reviewer")
    assert c.post(f"/api/drafts/{d['id']}/review", json={"action": "request_changes", "comment": ""}).status_code == 400
    ok = c.post(f"/api/drafts/{d['id']}/review", json={"action": "approve"}).json()
    assert ok["status"] == "approved" and ok["approved_version"] == 2 and ok["review"]["by"] == "Arjun (brand reviewer)"
    actions = [e["action"] for e in c.get(f"/api/drafts/{d['id']}").json()["events"]]
    assert actions[0] == "Created draft" and "Approved" in actions


def test_no_self_approval_and_sensitive_needs_marketing_head():
    get_store().reset()
    c = client("Creator")
    d = c.post("/api/drafts", json={"content": "Happy Diwali from Northstar Civils Academy"}).json()
    c.post(f"/api/drafts/{d['id']}/submit")
    as_role(c, "Reviewer")
    assert c.post(f"/api/drafts/{d['id']}/review", json={"action": "approve"}).status_code == 403
    as_role(c, "Marketing head")
    assert c.post(f"/api/drafts/{d['id']}/review", json={"action": "approve"}).status_code == 200


def test_override_feeds_insights():
    get_store().reset()
    c = client("Creator")
    d = c.post("/api/drafts", json={"content": "50 of our students cracked it"}).json()
    slang = next(f for f in d["findings"] if f["rule_id"] == "R5")
    c.post(f"/api/drafts/{d['id']}/decisions", json={"finding_id": slang["id"], "action": "reject", "reason": "Our audience uses this word"})
    assert c.get("/api/insights").status_code == 403  # creators don't see insights
    as_role(c, "Reviewer")
    row = next(r for r in c.get("/api/insights").json()["rules"] if r["rule_id"] == "R5")
    assert row["overridden"] >= 1 and row["needs_review"]


def test_image_findings():
    c = client()
    chk = c.post("/api/check", json={"content": "", "images": [{
        "file_name": "b.png", "text": "100% selection guaranteed. Fees Rs 45,000", "alt_text": "", "contrast_min": 1.6, "contrast_text": "FEES",
        "brand_share": 0.1, "palette": [{"hex": "#00FF00", "share": 0.4}, {"hex": "#1F3A68", "share": 0.3}, {"hex": "javascript:", "share": 0.9}]}]}).json()
    got = ids(chk["findings"])
    assert {"IMG-CONTRAST", "IMG-ALT", "IMG-COLOUR", "IMG-BRAND-COLOUR", "R1", "FACT-EXPIRED"} <= got
    assert all(f["location"] == "image 1" for f in chk["findings"] if f["rule_id"] != "BRAND-FIT")
    assert chk["findings"][0]["rule_id"] == "BRAND-FIT"  # no name, no brand colours: not a post for this brand
    assert c.post("/api/check", json={"content": "", "images": []}).status_code == 400


def test_brand_not_visible_is_blocker_and_preview_saved():
    get_store().reset()
    c = client()
    img = {"file_name": "a.jpg", "text": "Admissions open", "alt_text": "Poster", "preview": "data:image/jpeg;base64,/9j/AAAA"}
    d = c.post("/api/drafts", json={"title": "p", "images": [img]}).json()
    brand = next(f for f in d["findings"] if f["rule_id"] == "IMG-BRAND")
    assert brand["severity"] == "blocker"
    assert c.post(f"/api/drafts/{d['id']}/submit").status_code == 400
    assert c.get(f"/api/drafts/{d['id']}").json()["images"][0]["preview"] == img["preview"]
    bad = img | {"preview": "data:text/html;base64,PHNjcmlwdD4="}
    assert c.post("/api/drafts", json={"title": "p", "images": [bad]}).status_code == 422
    assert d["summary"]["checks_run"] > d["summary"]["checks_passed"] > 0
    assert d["versions"][0]["images"][0]["preview"] == img["preview"]  # each version keeps its images
    listed = next(x for x in c.get("/api/drafts").json() if x["id"] == d["id"])
    assert listed["open_blockers"] == ["Brand not visible"]
    # Acknowledging the blocker ("I will fix the image") lets it be sent.
    c.post(f"/api/drafts/{d['id']}/decisions", json={"finding_id": brand["id"], "action": "accept"})
    assert c.get(f"/api/drafts/{d['id']}").json()["open_blockers"] == []
    assert c.post(f"/api/drafts/{d['id']}/submit").status_code == 200


def test_change_request_visible_to_creator_and_analytics():
    get_store().reset()
    c = client("Creator")
    d = c.post("/api/drafts", json={"title": "Fee post", "content": "Foundation course fee for the 2026-27 batch: Rs 48,000."}).json()
    assert c.post(f"/api/drafts/{d['id']}/submit").status_code == 200
    as_role(c, "Reviewer")
    c.post(f"/api/drafts/{d['id']}/review", json={"action": "request_changes", "comment": "Add the logo please"})
    as_role(c, "Creator")
    back = c.get("/api/drafts?status=changes_requested").json()
    mine = next(x for x in back if x["id"] == d["id"])
    assert mine["review"]["comment"] == "Add the logo please" and mine["review"]["by"] == "Arjun (brand reviewer)"
    assert c.get("/api/analytics").status_code == 403  # creators don't see analytics
    # Resubmitting with a changed caption saves a new version and clears the change request.
    d2 = c.put(f"/api/drafts/{d['id']}", json={"title": "Fee post", "content": "Foundation course fee for the 2026-27 batch: Rs 48,000. Enrol now."}).json()
    assert d2["version"] == 2
    assert c.post(f"/api/drafts/{d['id']}/submit").json()["status"] == "in_review"
    assert all(x["id"] != d["id"] for x in c.get("/api/drafts?status=changes_requested").json())
    as_role(c, "Reviewer")
    a = c.get("/api/analytics").json()
    t = a["totals"]
    assert t["checks_run"] >= t["checks_passed"] > 0 and t["verified"] >= 1
    assert sum(p["blocker"] for p in a["posts"]) == t["blocker"]
    assert any(p["id"] == d["id"] for p in a["posts"])


def test_brand_kit_pdf_parse_and_activate():
    import base64
    get_store().reset()
    pdf = open(os.path.join(os.path.dirname(__file__), "fixtures", "sunrise_brand_book.pdf"), "rb").read()
    c = client("Creator")
    body = {"file_name": "sunrise.pdf", "data_b64": base64.b64encode(pdf).decode()}
    assert c.post("/api/brandkit/parse", json=body).status_code == 403
    as_role(c, "Marketing head")
    assert c.post("/api/brandkit/parse", json={"file_name": "x.pdf", "data_b64": base64.b64encode(b"not a pdf").decode()}).status_code == 400
    draft = c.post("/api/brandkit/parse", json=body).json()
    kit = draft["kit"]
    assert kit["brand_name"]["text"] == "Sunrise Tutorials"
    assert {x["hex"] for x in kit["colours"]} == {"#F26B21", "#0E5E6F", "#FFFFFF"}
    assert any(f.get("amount") == 120000 for f in kit["facts"])
    assert c.post("/api/brandkit/activate", json={"kit": kit}).status_code == 409  # demo posts exist: must confirm
    r = c.post("/api/brandkit/activate", json={"kit": kit, "confirm_reset": True}).json()
    assert r["meta"]["name"] == "Sunrise Tutorials" and r["meta"]["logo_required"]
    as_role(c, "Creator")
    chk = c.post("/api/check", json={"images": [{"file_name": "p.png", "text": "Guaranteed rank at Sunrise Academy. Fee Rs 1,20,000", "alt_text": "poster"}]}).json()
    names = {f["name"] for f in chk["findings"]}
    assert "Required text missing" in names and any("Sunrise Academy" in n for n in names)
    assert any(v["fact_id"] for v in chk["verified"])


def test_brand_kit_lifecycle_activate_update_reset():
    import base64
    get_store().reset()
    c = client("Reviewer")
    assert any(r["rule_id"] == "R5" for r in c.get("/api/insights").json()["rules"])  # demo coaching rule
    as_role(c, "Marketing head")
    pdf = open(os.path.join(os.path.dirname(__file__), "fixtures", "sunrise_brand_book.pdf"), "rb").read()
    kit = c.post("/api/brandkit/parse", json={"file_name": "sunrise.pdf", "data_b64": base64.b64encode(pdf).decode()}).json()["kit"]
    c.post("/api/brandkit/activate", json={"kit": kit, "confirm_reset": True})
    ws = c.get("/api/workspace").json()
    assert ws["live"] and ws["post_count"] == 0 and ws["archived_count"] >= 5  # new brand starts from zero; demo posts kept as history
    assert c.post("/api/brandkit/activate", json={"kit": kit, "confirm_reset": True}).status_code == 409  # must reset first

    as_role(c, "Creator")
    d = c.post("/api/drafts", json={"title": "Kit post", "content": "100% selection guaranteed. Classes on Diwali"}).json()
    as_role(c, "Reviewer")
    ins = c.get("/api/insights").json()
    assert ins["drafts"] == 1 and all(r["rule_id"] != "R5" for r in ins["rules"])
    r1 = next(r for r in ins["rules"] if r["rule_id"] == "R1")
    assert r1["group"] == "Regulation" and "CCPA" in r1["source"]

    # A kit activated before the confirmed kit was stored is rebuilt from what is live: unedited, nothing changes.
    as_role(c, "Marketing head")
    meta = get_store().get("meta", "workspace")
    stored = meta.pop("kit")
    get_store().put("meta", meta)
    rebuilt = c.get("/api/brandkit").json()["live_kit"]
    assert c.post("/api/brandkit/update", json={"kit": rebuilt}).json()["changes"] == []
    get_store().put("meta", meta | {"kit": stored})

    # Update: add a banned phrase, change a colour. Posts stay, unchanged rules keep their ids, open posts re-checked.
    as_role(c, "Marketing head")
    old_rules = {r["name"]: r["id"] for r in c.get("/api/workspace").json()["rules"]}
    live = c.get("/api/brandkit").json()["live_kit"]
    new_kit = live | {"banned_phrases": live.get("banned_phrases", []) + [{"text": "Classes"}],
                      "colours": live["colours"][:-1] + [{"name": "Gold", "hex": "#F4C430"}]}
    preview = c.post("/api/brandkit/update", json={"kit": new_kit}).json()
    areas = {x["area"]: x for x in preview["changes"]}
    assert preview["applied"] is False and "Colours" in areas and any("Classes" in a for a in areas["Banned words and wrong names"]["added"])
    done = c.post("/api/brandkit/update", json={"kit": new_kit, "apply": True}).json()
    assert done["applied"] and done["revision"] == 2 and done["rechecked"] == 1
    rules_after = {r["name"]: r["id"] for r in c.get("/api/workspace").json()["rules"]}
    assert all(rules_after[n] == i for n, i in old_rules.items() if n in rules_after)
    rechecked = c.get(f"/api/drafts/{d['id']}").json()
    assert any("Classes" in f["name"] for f in rechecked["findings"])
    assert c.get("/api/workspace").json()["post_count"] == 1
    assert c.post("/api/brandkit/update", json={"kit": new_kit, "apply": True}).status_code == 400  # nothing changed

    # Reset: wrong confirmation refused; right one wipes everything; no posts until a new kit is live.
    as_role(c, "Creator")
    assert c.post("/api/brandkit/reset", json={"confirm": "Sunrise Tutorials"}).status_code == 403
    as_role(c, "Marketing head")
    assert c.post("/api/brandkit/reset", json={"confirm": "wrong"}).status_code == 400
    assert c.post("/api/brandkit/reset", json={"confirm": "sunrise tutorials"}).status_code == 200
    ws = c.get("/api/workspace").json()
    assert ws["empty"] and not ws["live"] and ws["post_count"] == 0 and not ws["facts"]
    assert {r["id"] for r in ws["rules"]} >= {"R1", "R2", "R6"}  # regulations stay on
    as_role(c, "Creator")
    assert c.post("/api/drafts", json={"content": "hello"}).status_code == 409
    as_role(c, "Reviewer")
    assert c.get("/api/insights").json()["drafts"] == 0
    # ...but nothing is deleted: the old brand's posts stay in All history, read-only and out of Write and Review
    hist = c.get("/api/analytics?scope=all").json()
    sun = next(b for b in hist["kit"]["brands"] if b["name"] == "Sunrise Tutorials")
    assert sun["posts"] == 1 and any(p["id"] == d["id"] for p in hist["posts"])
    assert c.get(f"/api/insights?scope=all&brand={sun['id'].replace('+', '%2B')}").json()["drafts"] == 1
    assert all(x["id"] != d["id"] for x in c.get("/api/drafts").json())
    assert c.get(f"/api/drafts/{d['id']}").json()["archived"] is True  # history page still opens
    as_role(c, "Creator")
    assert c.put(f"/api/drafts/{d['id']}", json={"title": "x", "content": "y"}).status_code == 409
    assert any(e["action"] == "Archived posts" for e in get_store().list("event"))


# ---------- Platform Intelligence Engine: the specification's test scenarios ----------

IMG = {"kind": "image", "file_name": "p.jpg", "text": "Northstar Civils Academy admissions", "alt_text": "Poster", "width": 1080, "height": 1080}


def post(c, platform, fmt, context="organic", content="", fields=None, images=None, title="t"):
    return c.post("/api/drafts", json={"title": title, "platform": platform, "format": fmt, "context": context,
                                       "content": content, "fields": fields or {}, "images": images or []})


def schema_ids(c, platform, fmt, context="organic"):
    return [f["id"] for f in c.get(f"/api/input-schema?platform={platform}&format={fmt}&context={context}").json()["fields"]]


def test_platform_config_and_schemas():
    get_store().reset()
    c = client("Creator")
    cfg = c.get("/api/platforms").json()
    assert [p["id"] for p in cfg["platforms"]] == ["instagram", "linkedin", "facebook", "whatsapp", "website"]
    assert [f["label"] for f in c.get("/api/platforms/instagram/formats").json()] == ["Feed post", "Carousel", "Reel", "Story"]
    assert len(cfg["contexts"]) == 5 and len(cfg["layers"]) == 5
    assert schema_ids(c, "linkedin", "text") == ["main_text", "url", "hashtags"]  # text-first, no media box
    assert schema_ids(c, "instagram", "feed")[0] == "media"  # visual-first
    assert "sponsor" not in schema_ids(c, "linkedin", "text") and "sponsor" in schema_ids(c, "linkedin", "text", "sponsored")
    pp = schema_ids(c, "instagram", "reel", "paid_partnership")
    assert {"partner_brand", "product", "relationship", "connection_details", "disclosure", "creator_script"} <= set(pp)
    assert "offer_valid_until" in schema_ids(c, "whatsapp", "text", "promo_offer")
    assert "offer_valid_until" not in schema_ids(c, "whatsapp", "text")  # no irrelevant fields
    assert c.get("/api/input-schema?platform=myspace&format=x").status_code == 400
    prof = c.get("/api/validation-profile?platform=instagram&format=feed&context=paid_partnership").json()
    layer = {L["id"]: [x["id"] for x in L["checks"]] for L in prof["layers"]}
    assert "PLAT-LENGTH" in layer["platform"] and "CTX-DISCLOSURE" in layer["regulation"] and "IMG-ALT" in layer["visual"]
    assert "R1" in layer["regulation"] and "R3" in layer["brand"]  # a brand preference is not shown as law


def test_linkedin_text_and_text_image():
    get_store().reset()
    c = client("Creator")
    d = post(c, "linkedin", "text", content="Northstar Civils Academy: weekly mock tests start Monday.").json()
    assert d["channel"] == "LinkedIn · Text-only post" and d["input_errors"] == []
    long = post(c, "linkedin", "text", content="x" * 3001).json()
    f = next(x for x in long["findings"] if x["rule_id"] == "PLAT-LENGTH")
    assert f["severity"] == "warning" and f["layer"] == "platform" and "3,000" in f["sources"][0]
    assert all(x["layer"] in {"platform", "regulation", "brand", "facts", "visual"} and x["confidence"] for x in long["findings"])
    missing = post(c, "linkedin", "text_image", content="See the poster").json()
    assert any(e["field"] == "media" for e in missing["input_errors"])
    ok = post(c, "linkedin", "text_image", content="See the poster", images=[IMG]).json()
    assert ok["input_errors"] == []


def test_instagram_image_and_carousel():
    get_store().reset()
    c = client("Creator")
    tall = IMG | {"width": 1080, "height": 1920}
    d = post(c, "instagram", "feed", content="Admissions open", images=[tall]).json()
    asp = next(x for x in d["findings"] if x["rule_id"] == "PLAT-ASPECT")
    assert asp["severity"] == "suggestion"  # a formatting difference is not a violation
    assert post(c, "instagram", "feed", images=[IMG]).json()["input_errors"][0]["field"] == "main_text"  # caption required
    one = post(c, "instagram", "carousel", content="Swipe", images=[IMG]).json()
    assert any("at least 2" in e["message"] for e in one["input_errors"])
    tags = " ".join(f"#t{i}" for i in range(31))
    three = post(c, "instagram", "carousel", content="Swipe", fields={"hashtags": tags}, images=[IMG, IMG, IMG]).json()
    assert three["input_errors"] == [] and any(x["rule_id"] == "PLAT-HASHTAGS" for x in three["findings"])


def test_whatsapp_text_and_website_promotional_banner():
    get_store().reset()
    c = client("Creator")
    w = post(c, "whatsapp", "text", content="Northstar Civils Academy: classes resume on Monday.").json()
    assert w["input_errors"] == [] and w["channel"] == "WhatsApp broadcast · Text-only message"
    bad = post(c, "website", "promo", context="promo_offer", images=[IMG],
               fields={"headline": "Free demo class", "cta": "Book", "url": "not a link", "offer_details": "Free demo class",
                       "offer_valid_until": "2020-01-01"}).json()
    assert any(e["field"] == "url" for e in bad["input_errors"])
    assert {"CTX-OFFER-ENDED", "CTX-OFFER-TERMS"} <= ids(bad["findings"])
    ended = next(x for x in bad["findings"] if x["rule_id"] == "CTX-OFFER-ENDED")
    assert ended["severity"] == "blocker" and ended["location_label"] == "Offer valid until"


def test_instagram_paid_partnership_disclosure():
    get_store().reset()
    c = client("Creator")
    pp = {"partner_brand": "Northstar", "product": "Mock tests", "relationship": "Paid", "connection_details": "Paid Rs 10,000",
          "disclosure": "#ad"}
    none = post(c, "instagram", "feed", "paid_partnership", content="Loved these mock tests!", fields=pp, images=[IMG]).json()
    f = next(x for x in none["findings"] if x["rule_id"] == "CTX-DISCLOSURE")
    assert f["severity"] == "blocker" and f["layer"] == "regulation" and any("ASCI" in s_ for s_ in f["sources"])
    assert not any(x["location"] == "field:connection_details" for x in none["findings"])  # internal detail, not ad copy
    upfront = post(c, "instagram", "feed", "paid_partnership", content="#ad Loved these mock tests!", fields=pp, images=[IMG]).json()
    assert not any(x["rule_id"].startswith("CTX-DISCLOSURE") for x in upfront["findings"])
    buried = post(c, "instagram", "feed", "paid_partnership", content="Loved these mock tests from the academy! #upsc #exam #ad #study",
                  fields=pp, images=[IMG]).json()
    assert any(x["rule_id"] == "CTX-DISCLOSURE-BURIED" for x in buried["findings"])
    reel = post(c, "instagram", "reel", "paid_partnership", content="#ad mock tests", fields=pp,
                images=[IMG | {"kind": "video", "width": 1080, "height": 1920, "duration": 20}]).json()
    v = next(x for x in reel["findings"] if x["rule_id"] == "CTX-DISCLOSURE-VIDEO")
    assert v["confidence"] == "Unverified" and v["outcome"] == "Couldn't verify"  # not invented
    no_fields = post(c, "instagram", "feed", "paid_partnership", content="#ad x", images=[IMG]).json()
    assert any(e["field"] == "relationship" for e in no_fields["input_errors"])


def test_linkedin_sponsored_and_review_workflow():
    get_store().reset()
    c = client("Creator")
    no_sponsor = post(c, "linkedin", "text", "sponsored", content="Northstar Civils Academy mock tests").json()
    assert any(e["field"] == "sponsor" for e in no_sponsor["input_errors"])
    assert c.post(f"/api/drafts/{no_sponsor['id']}/submit").status_code == 400  # fields missing
    d = c.put(f"/api/drafts/{no_sponsor['id']}", json={"title": "t", "platform": "linkedin", "format": "text", "context": "sponsored",
                                                       "content": "Northstar Civils Academy mock tests", "fields": {"sponsor": "Northstar"}}).json()
    assert d["input_errors"] == [] and d["version"] == 2 and d["versions"][-1]["fields"] == {"sponsor": "Northstar"}
    assert not any(x["rule_id"].startswith("CTX-DISCLOSURE") for x in d["findings"])  # own sponsored post: the platform labels it
    assert c.post(f"/api/drafts/{d['id']}/submit").json()["status"] == "in_review"
    as_role(c, "Reviewer")
    assert c.post(f"/api/drafts/{d['id']}/review", json={"action": "approve"}).json()["status"] == "approved"
    res = c.get(f"/api/drafts/{d['id']}/results").json()
    assert [L["id"] for L in res["layers"]] == ["platform", "regulation", "brand", "facts", "visual"] and res["profile"]


def test_adapt_campaign_to_multiple_platforms():
    get_store().reset()
    c = client("Creator")
    src = post(c, "instagram", "feed", content="Northstar Civils Academy: weekly mock tests start Monday. Join us!",
               fields={"hashtags": "#upsc #mocktests", "url": "https://northstar.example"}, images=[IMG]).json()
    r = c.post(f"/api/drafts/{src['id']}/adapt", json={"targets": [
        {"platform": "linkedin", "format": "text_image"}, {"platform": "whatsapp", "format": "text"},
        {"platform": "website", "format": "promo"}]}).json()
    assert len(r["created"]) == 3
    li, wa, web = (c.get(f"/api/drafts/{x['id']}").json() for x in r["created"])
    assert li["platform"] == "linkedin" and li["images"] and li["fields"]["hashtags"] == "#upsc #mocktests"
    assert wa["images"] == [] and "#upsc" not in wa["content"] and "mock tests" in wa["content"]
    assert web["fields"]["headline"].startswith("Northstar Civils Academy") and web["fields"]["cta"] == "Learn more"
    assert all(x["status"] == "draft" and x["campaign_id"] == src["id"] for x in (li, wa, web))  # each needs its own review
    assert all(any(e["action"] == "Adapted from another post" for e in x["events"]) for x in (li, wa, web))


def test_missing_fields_and_invalid_uploads():
    import base64
    get_store().reset()
    c = client("Creator")
    video_in_feed = post(c, "instagram", "feed", content="hi", images=[IMG | {"kind": "video"}]).json()
    assert any("accepts image only" in e["message"] for e in video_in_feed["input_errors"])
    assert post(c, "instagram", "nope", content="hi").status_code == 400
    assert post(c, "instagram", "feed", content="hi", images=[IMG] * 11).status_code == 422
    assert c.post("/api/extract-text", json={"file_name": "x.pdf", "data_b64": "bm90IGEgcGRm"}).status_code == 400
    pdf = open(os.path.join(os.path.dirname(__file__), "fixtures", "sunrise_brand_book.pdf"), "rb").read()
    out = c.post("/api/extract-text", json={"file_name": "s.pdf", "data_b64": base64.b64encode(pdf).decode()}).json()
    assert out["pages"] >= 1 and "Sunrise" in out["text"]
    doc = post(c, "linkedin", "document", content="Our brochure", fields={"doc_title": "Brochure"},
               images=[{"kind": "document", "file_name": "s.pdf", "text": "100% selection guaranteed"}]).json()
    assert doc["input_errors"] == [] and any(x["rule_id"] == "R1" and x["location"] == "document 1" for x in doc["findings"])


def test_all_history_is_grouped_by_brand():
    get_store().reset()
    c = client("Creator")
    d = c.post("/api/drafts", json={"title": "Old brand post", "content": "Classes resume on Monday"}).json()
    old = get_store().get("draft", d["id"]) | {"kit_id": "2025-01-01T00:00:00+00:00", "kit_name": "Sunrise Tutorials"}
    get_store().put("draft", old)
    as_role(c, "Reviewer")
    a = c.get("/api/analytics?scope=all").json()
    names = [b["name"] for b in a["kit"]["brands"]]
    assert "Northstar Civils Academy (demo)" in names and "Sunrise Tutorials" in names
    assert {b["name"]: b["posts"] for b in a["by_brand"]}["Sunrise Tutorials"] == 1
    only = c.get("/api/analytics?scope=all&brand=2025-01-01T00:00:00%2B00:00").json()
    assert [p["title"] for p in only["posts"]] == ["Old brand post"] and only["kit"]["brand"]
    ins = c.get("/api/insights?scope=all&brand=2025-01-01T00:00:00%2B00:00").json()
    assert ins["drafts"] == 1 and ins["quiet"] == []


def test_demo_sign_in_without_password():
    os.environ.pop("LBC_REQUIRE_PASSWORD")
    try:
        c = TestClient(index.app, headers=H)
        assert c.get("/api/health").json()["password_required"] is False
        r = c.post("/api/login", json={"role": "Reviewer"})
        assert r.status_code == 200 and r.json()["name"] == "Arjun (brand reviewer)"
        assert c.get("/api/session").json()["role"] == "Reviewer"
        assert TestClient(index.app).post("/api/login", json={"role": "Reviewer"}).status_code == 403  # X-LBC still required
        assert TestClient(index.app, headers=H).get("/api/drafts").status_code == 401  # still needs a session
    finally:
        os.environ["LBC_REQUIRE_PASSWORD"] = "1"


def test_brand_fit_says_no_to_a_post_for_another_brand():
    get_store().reset()
    c = client("Creator")
    on = {"kind": "image", "file_name": "on.jpg", "text": "Northstar Civils Academy UPSC prelims test series",
          "alt_text": "Poster", "brand_share": 0.6, "width": 1080, "height": 1080}
    good = post(c, "instagram", "feed", content="Join our UPSC prelims test series and mentoring for the new batch of aspirants.",
                fields={"hashtags": "#upsc #prelims"}, images=[on]).json()
    assert good["summary"]["brand_fit"]["verdict"] == "yes" and "BRAND-FIT" not in ids(good["findings"])
    assert any(p_["check"] == "BRAND-FIT" for p_ in good["summary"]["passed"])

    off = {"kind": "image", "file_name": "pizza.jpg", "text": "Pizza Palace large pizza 50% off", "alt_text": "Pizza",
           "brand_share": 0.05, "width": 1080, "height": 1080}
    bad = post(c, "instagram", "feed", content="Craving cheese? Grab a large pepperoni pizza tonight, delivered hot to your door.",
               fields={"hashtags": "#pizza #foodie"}, images=[off]).json()
    fit = bad["summary"]["brand_fit"]
    assert fit["verdict"] == "no"
    assert {s_["id"] for s_ in fit["signals"] if s_["status"] == "fail"} >= {"name", "colours", "topics", "offers"}
    f = bad["findings"][0]
    assert f["rule_id"] == "BRAND-FIT" and f["severity"] == "blocker" and f["sources"] and f["location_label"] == "Post"
    assert f["name"] == "Not a post for Northstar Civils Academy"
    assert c.post(f"/api/drafts/{bad['id']}/submit").status_code == 400
    c.post(f"/api/drafts/{bad['id']}/decisions", json={"finding_id": f["id"], "action": "accept"})
    assert "Not a post for Northstar Civils Academy" in c.post(f"/api/drafts/{bad['id']}/submit").json()["detail"]["blockers"]

    # partly on brand: the name is there but the colours are off -> weak, no blocker
    meh = post(c, "instagram", "feed", content="Northstar Civils Academy UPSC mains mentoring starts Monday for all aspirants.",
               images=[on | {"brand_share": 0.05}]).json()
    assert meh["summary"]["brand_fit"]["verdict"] == "weak" and "BRAND-FIT" not in ids(meh["findings"])
    assert not any(p_["check"] == "BRAND-FIT" for p_ in meh["summary"]["passed"])

    # a brand that had its own kit here before is "another brand"
    old = get_store().get("draft", good["id"]) | {"archived": True, "kit_name": "Sunrise Tutorials"}
    get_store().put("draft", old)
    other = post(c, "instagram", "feed", content="Northstar Civils Academy and Sunrise Tutorials UPSC prelims batch for aspirants.",
                 images=[on]).json()
    assert other["summary"]["brand_fit"]["verdict"] == "no"


def test_brand_kit_topics_from_pdf():
    from _lbc import brandkit
    kit = brandkit.pattern_read(["Sunrise Tutorials\nWe teach maths and science tuition. #SunriseLearning\n"
                                 "Maths tuition for class 10. Science tuition for class 12. Maths and science doubt classes."])
    words = [k["text"] for k in kit["keywords"]]
    assert "#SunriseLearning" in words and "tuition" in words and "maths" in words
    assert all(k["quote"] and k["page"] == 1 for k in kit["keywords"])
    from _lbc.brandapply import build_workspace
    meta = build_workspace({"brand_name": {"text": "Sunrise"}, "keywords": [{"text": " Maths "}, {"text": "maths"}, {"text": "#Tuition"}]})[0]
    assert meta["keywords"] == ["maths", "#tuition"]


def test_brand_memory_learns_from_posts_and_never_changes_the_kit():
    get_store().reset()
    c = client("Creator")
    kit_before = {k: get_store().list(k) for k in ("rule", "fact", "guideline")}
    meta_before = get_store().get("meta", "workspace")
    on = {"kind": "image", "file_name": "on.jpg", "text": "Northstar Civils Academy UPSC prelims", "alt_text": "Poster",
          "brand_share": 0.6, "width": 1080, "height": 1080}
    texts = ["Northstar Civils Academy weekend essay workshop for UPSC aspirants. Seats limited.",
             "Northstar Civils Academy essay workshop returns this weekend for UPSC aspirants.",
             "Join the Northstar Civils Academy essay workshop: practise answers with mentors."]
    reviewer = TestClient(index.app, headers=H)
    reviewer.post("/api/login", json={"password": TEST_PW, "role": "Reviewer"})
    for i, t in enumerate(texts):
        d = post(c, "instagram", "feed", content=t, images=[on], title=f"Workshop {i}").json()
        assert c.post(f"/api/drafts/{d['id']}/submit").status_code == 200, d["findings"]
        if i == 0:
            assert reviewer.post(f"/api/drafts/{d['id']}/review", json={"action": "request_changes",
                                 "comment": "Mention the batch start date"}).status_code == 200
            assert c.post(f"/api/drafts/{d['id']}/submit").status_code == 200
        assert reviewer.post(f"/api/drafts/{d['id']}/review", json={"action": "approve"}).status_code == 200
    m = reviewer.get("/api/memory").json()["memory"]
    assert m["approved_posts"] == 3 and m["style"] is not None
    assert "workshop" in [t["text"] for t in m["topics"]] and "essay" in [t["text"] for t in m["topics"]]
    assert m["feedback"][0]["text"] == "Mention the batch start date"
    # the brand kit itself is untouched
    assert {k: get_store().list(k) for k in ("rule", "fact", "guideline")} == kit_before
    assert get_store().get("meta", "workspace") == meta_before

    # house style: far more '!' than any approved post -> a suggestion with a memory source, never a blocker
    loud = c.post("/api/check", json={"platform": "instagram", "format": "feed", "content":
                  "Northstar Civils Academy essay workshop!!! Join now!!!", "images": [on]}).json()
    st = [f for f in loud["findings"] if f["rule_id"] == "MEM-STYLE"]
    assert st and all(f["severity"] == "suggestion" and "Brand memory" in f["sources"][0] for f in st)

    # mistakes fixed before are remembered
    for _ in range(2):
        d = post(c, "instagram", "feed", content="Northstar Civils Academy essay workshop, slang: cracked it", images=[on]).json()
        f = next(x for x in d["findings"] if x["rule_id"] == "R5")
        c.post(f"/api/drafts/{d['id']}/decisions", json={"finding_id": f["id"], "action": "accept"})
    again = c.post("/api/check", json={"content": "Our students cracked it"}).json()
    assert next(x for x in again["findings"] if x["rule_id"] == "R5")["seen_before"] == 2

    # only the marketing head can make it forget a topic
    assert reviewer.post("/api/memory/forget", json={"topic": "workshop"}).status_code == 403
    as_role(reviewer, "Marketing head")
    left = reviewer.post("/api/memory/forget", json={"topic": "workshop"}).json()
    assert "workshop" not in [t["text"] for t in left["topics"]] and "workshop" in left["forgotten"]


def test_pdf_reader_finds_tone_positioning_and_banned_words():
    from _lbc import brandkit
    page = ("BRAND TOOLKIT\nACME PAYMENTS \u2013 India Region Guidelines\n5. Words We Don't Use:\n"
            "\"Instant transfer\" (Instead use: \"In minutes\")\n\"Cheap\" (Instead use: \"Transparent fees\")\n"
            "6. Fees and Offers\nUse only approved metrics.\n"
            "Overall Tone: Trusted, global and secure. We connect families and enable global opportunities.\n"
            "Sensitive Topic \u2014 Security & Fraud: Never make light of scams.\n")
    kit = brandkit.pattern_read([page])
    assert kit["brand_name"]["text"] == "Acme Payments"
    assert [b["text"] for b in kit["banned_phrases"]] == ["Instant transfer", "Cheap"]
    assert kit["tone_rules"][0]["text"] == "Trusted, global and secure."
    assert any(g["section"] == "Positioning" and g["text"].startswith("We connect families") for g in kit["guidelines"])
    assert {"security", "fraud"} <= {t["text"] for t in kit["sensitive_topics"]}
