"""Demo workspace for a fictional Hyderabad coaching institute.

Everything here is invented demo data. No real students or institutes.
"""

WORKSPACE = {
    "name": "Northstar Civils Academy",
    "city": "Hyderabad",
    "note": "Fictional demo institute. All records are invented.",
    "brand_colours": [
        {"name": "Northstar Navy", "hex": "#1F3A68"},
        {"name": "Saffron", "hex": "#F2A33A"},
        {"name": "White", "hex": "#FFFFFF"},
    ],
    # What the brand talks about: used by the brand-fit check ("is this a post for this brand at all?").
    "keywords": ["upsc", "civil services", "ias", "ips", "coaching", "prelims", "mains", "interview guidance",
                 "test series", "mentoring", "study material", "batch", "aspirants", "exam"],
    # Names that must never reach an external AI service.
    "confidential_terms": ["Project Dhruv"],
}

GUIDELINES = [
    {"id": "G1", "section": "Voice", "text": "Write in a calm, encouraging and factual voice. Avoid hype, slang and pressure tactics such as 'hurry', 'last chance' or several exclamation marks."},
    {"id": "G2", "section": "Name", "text": "Always write the institute name as 'Northstar Civils Academy'. Do not use 'Northstar IAS' or 'NCA'."},
    {"id": "G3", "section": "Results", "text": "Every results claim must say how many students came from which programme (full course, test series or interview guidance) and whether that programme was paid or free."},
    {"id": "G4", "section": "Promises", "text": "Never promise selection, ranks or jobs. Describe what we provide (mentoring, tests, study material) instead."},
    {"id": "G5", "section": "Fees and offers", "text": "Quote only the current approved fee or offer from the facts sheet, and name the batch it applies to."},
    {"id": "G6", "section": "Accessibility", "text": "Banner text must have a contrast ratio of at least 4.5:1 against its background, and every image post needs alt text."},
    {"id": "G7", "section": "Sensitive topics", "text": "Posts that mention religion, festivals, caste or politics need sign-off from the marketing head."},
    {"id": "G8", "section": "Visual identity", "text": "Use the brand colours Northstar Navy #1F3A68, Saffron #F2A33A and White #FFFFFF as the main colours of every banner."},
]

COACHING_GUIDELINES = "CCPA Guidelines for Prevention of Misleading Advertisement in Coaching Sector, 2024"
ASCI_CODE = "ASCI Code, Chapter I: claims must be truthful and capable of substantiation"
ASCI_INFLUENCER = "ASCI Guidelines for Influencer Advertising in Digital Media: paid or gifted posts must carry a disclosure label such as #ad"

RULES = [
    {
        "id": "R1", "name": "Guaranteed selection or job", "category": "Unsupported claim",
        "severity": "blocker", "source_type": "regulatory",
        "pattern": r"(100\s?%|guarantee[d]?|assured|sure[- ]shot)[^.!?\n]{0,25}?(selection|success|result|job|placement|rank|admission)s?(\s+(is\s+)?(guarantee[d]?|assured))?|(selection|success|result|job|placement|rank|admission)s?[^.!?\n]{0,15}(guarantee[d]?|assured)",
        "why": "Promises selection or a job, which the institute cannot substantiate.",
        "sources": [COACHING_GUIDELINES + ": no '100% selection' or job-guarantee claims", "Brand guideline G4"],
        "guideline_ids": ["G4"],
        "suggestion": "Structured mentoring and weekly mock tests",
    },
    {
        "id": "R2", "name": "Unproven superlative", "category": "Unsupported claim",
        "severity": "blocker", "source_type": "regulatory",
        "pattern": r"((india|hyderabad|telangana|south india)['\u2019]?s\s+)?(no\.?\s?1|number\s+one|#1|best|top)\s+(coaching|institute|academy|ias|civils|in\s+(india|hyderabad|telangana))",
        "why": "Ranks the institute above others without published evidence.",
        "sources": [ASCI_CODE],
        "guideline_ids": [],
        "suggestion": "Northstar Civils Academy",
    },
    {
        "id": "R3", "name": "Pressure or hype", "category": "Tone",
        "severity": "suggestion", "source_type": "brand",
        "pattern": r"\bhurry\b|last chance|don['\u2019]t miss|limited seats|!{2,}",
        "why": "Uses pressure or hype that our voice guideline asks us to avoid.",
        "sources": ["Brand guideline G1"], "guideline_ids": ["G1"],
        "suggestion": "",
    },
    {
        "id": "R4", "name": "Wrong institute name", "category": "Terminology",
        "severity": "warning", "source_type": "brand",
        "pattern": r"\bNorthstar\s+IAS\b|\bNCA\b",
        "why": "The institute name must always be written in full.",
        "sources": ["Brand guideline G2"], "guideline_ids": ["G2"],
        "suggestion": "Northstar Civils Academy",
    },
    {
        "id": "R5", "name": "Slang for exam results", "category": "Tone",
        "severity": "suggestion", "source_type": "brand",
        "pattern": r"\bcrack(ed|ing)?\b",
        "why": "Slang; our voice guideline asks for factual wording.",
        "sources": ["Brand guideline G1"], "guideline_ids": ["G1"],
        "suggestion": "qualified",
    },
    {
        "id": "R6", "name": "Health or cure claim", "category": "Unsupported claim",
        "severity": "blocker", "source_type": "regulatory",
        "pattern": r"\b(cure[sd]?|permanent(ly)? (cure|relief))\b",
        "why": "Health or cure claims need approved evidence and may fall under the Drugs and Magic Remedies Act.",
        "sources": ["Drugs and Magic Remedies (Objectionable Advertisements) Act, 1954", ASCI_CODE],
        "guideline_ids": [], "suggestion": "", "sensitive": True,
    },
    {
        "id": "R7", "name": "Sensitive topic", "category": "Needs senior review",
        "severity": "warning", "source_type": "brand",
        "pattern": r"\b(diwali|eid|christmas|ganesh|navratri|dussehra|sankranti|ramzan|ramadan|religio\w*|caste|election|political|politics)\b",
        "why": "Mentions a sensitive topic. The tool does not judge the creative; it routes the post to the marketing head.",
        "sources": ["Brand guideline G7"], "guideline_ids": ["G7"],
        "suggestion": "", "sensitive": True,
    },
]

# Applied only when the channel is an influencer or paid-partner post.
DISCLOSURE_RULE = {
    "id": "R8", "name": "Missing ad disclosure", "category": "Disclosure",
    "severity": "blocker", "source_type": "regulatory",
    "why": "This is a paid or partner post but has no disclosure label.",
    "sources": [ASCI_INFLUENCER], "guideline_ids": [],
    "suggestion": "#ad",
}

FACTS = [
    {"id": "F1", "kind": "fee", "label": "Foundation course fee, 2026-27 batch", "amount": 48000,
     "valid_from": "2026-10-01", "valid_until": "2027-06-30", "owner": "Admissions office"},
    {"id": "F2", "kind": "fee", "label": "Foundation course fee, 2025-26 batch", "amount": 45000,
     "valid_from": "2025-10-01", "valid_until": "2026-09-30", "owner": "Admissions office"},
    {"id": "F3", "kind": "result", "label": "UPSC CSE 2025 final selections",
     "full_course": 32, "full_course_paid": True,
     "interview_guidance": 18, "interview_guidance_paid": False,
     "total": 50, "valid_from": "2026-04-20", "valid_until": "2027-04-30", "owner": "Results cell"},
    {"id": "F4", "kind": "offer", "label": "Early-bird discount, 2026-27 batch", "percent": 10,
     "valid_from": "2026-10-01", "valid_until": "2026-11-30", "owner": "Admissions office"},
]

SAMPLE_DRAFT = {
    "title": "UPSC 2025 results post",
    "channel": "Instagram post",
    "content": (
        "India's No. 1 coaching for UPSC! 50 of our students cracked the exam this year. "
        "100% selection guaranteed at Northstar IAS. Fees just Rs 45,000. Hurry, limited seats!!"
    ),
}

# Sample history so Review and Insights have something to show on first visit.
# Each entry: title, author, channel, content, status, decisions [(rule_id, action, reason)], review
SAMPLE_HISTORY = [
    {"title": "Sample: Prelims test series launch", "author": "Priya (social media)", "channel": "Instagram post",
     "content": "Crack Prelims 2027 with our weekly test series at Northstar Civils Academy. Early-bird 10% off for the 2026-27 batch.",
     "status": "approved", "decisions": [("R5", "reject", "Aspirants search for 'crack UPSC'; it is how our audience talks")],
     "review": ("Arjun (brand reviewer)", "Reviewer", "approve", "")},
    {"title": "Sample: Interview guidance webinar", "author": "Rahul (agency)", "channel": "Instagram post",
     "content": "Free interview-guidance webinar this Sunday. \"This is how I cracked my mock interview\" - a 2025 student.",
     "status": "approved", "decisions": [("R5", "reject", "It is inside a student's quote, so we kept their words")],
     "review": ("Arjun (brand reviewer)", "Reviewer", "approve", "")},
    {"title": "Sample: Mains answer-writing tips", "author": "Priya (social media)", "channel": "LinkedIn post",
     "content": "Five habits that helped our students crack Mains answer writing. Hurry, limited seats in the next workshop!!",
     "status": "approved", "decisions": [("R5", "reject", "Common phrase in the exam community"), ("R3", "accept", "")],
     "review": ("Arjun (brand reviewer)", "Reviewer", "approve", "")},
    {"title": "Sample: Fee reminder", "author": "Rahul (agency)", "channel": "WhatsApp broadcast",
     "content": "Reminder: Foundation course fee is Rs 45,000. Seats filling fast at Northstar IAS.",
     "status": "changes_requested", "decisions": [],
     "review": ("Arjun (brand reviewer)", "Reviewer", "request_changes", "Use the 2026-27 fee from the facts sheet and the full institute name.")},
    {"title": "Sample: Diwali greeting", "author": "Priya (social media)", "channel": "Instagram post",
     "content": "Happy Diwali from everyone at Northstar Civils Academy. Classes resume on Monday.",
     "status": "in_review", "decisions": [], "review": None},
]
