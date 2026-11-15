// The guided demo journey for judges: one person at a time, in the order the work flows (Priya writes, Arjun
// reviews, Meera runs the brand), then back to Priya for the Chrome extension, the feature that matters most.
// Progress lives in this browser (not per account), because the journey switches people.
import { api } from "./api";
import { becomePerson } from "./person";

const KEY = "lbc-journey";

export const STAGES = [
  { id: "write", role: "Creator", who: "Priya (creator)", href: "/?example=claims", title: "Write a post and send it for review",
    body: "Priya writes a post. It's checked against the brand kit and Indian ad rules: every problem is underlined with its source and a fix. Accept the fixes (or keep text with a reason), then press Send for review.",
    doneOn: "sent", doneText: "Sent. The post is now waiting for the reviewer." },
  { id: "review", role: "Reviewer", who: "Arjun (reviewer)", href: "/review", title: "Review it as Arjun",
    body: "Arjun sees the post, what the checks found and Priya's choices. Try Request changes with a comment (it goes back to Priya), or Approve it.",
    doneOn: "reviewed", doneText: "Decision recorded. It goes straight back to Priya." },
  { id: "head", role: "Marketing head", who: "Meera (marketing head)", href: "/overview", highlight: "brand-switcher", title: "Meera, the marketing head",
    body: "An agency works on several brands. Open the Workspace dropdown (top left, highlighted) to switch brands or add one; each brand has its own kit, facts, posts, reviews and team. Meera also manages the brand kit, assigns people to brands on Team, approves sensitive posts (the Diwali greeting is waiting for her in Review) and sees Insights.",
    links: [{ label: "Review", href: "/review" }, { label: "Team", href: "/team" }, { label: "Brand guidelines", href: "/workspace" }, { label: "Insights", href: "/insights" }] },
  { id: "extension", role: "Creator", who: "Priya (creator)", href: "/extension", highlight: "extension-download", title: "Download the Chrome extension",
    body: "Back to Priya. Arjun's decision is already waiting for her in the note at the top right. Now the most important part: Live Brand Check also works inside Instagram and Facebook as a Chrome extension. Download it and add it to Chrome with the steps on this page; the box at the top turns green when it's detected.",
    doneOn: "extension", doneText: "Extension detected in this browser." },
  { id: "instagram", role: "Creator", who: "Priya (creator)", href: "/extension#try", title: "Try it live on Instagram",
    body: "Open Instagram, start a new post, add the sample banner and paste the sample caption. The Live Brand Check panel appears at the bottom right and checks the post while you type. Nothing is posted for you." },
];

export function readJourney() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}

export function writeJourney(j) {
  try { j ? localStorage.setItem(KEY, JSON.stringify(j)) : localStorage.removeItem(KEY); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event("lbc:journey-change"));
}

/** Pages call this when something a journey step waits for happens ("sent", "reviewed", "extension"). */
export function journeyEvent(name) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("lbc:journey", { detail: name }));
}

async function openSampleBrand() {
  const d = await api("/brands").catch(() => null);
  const sample = d?.brands.find((b) => b.sample);
  if (sample && !sample.current) await api("/brand", { method: "POST", body: { id: sample.id } });
}

/** Open a step: sign in as the right person, open the sample brand, go to the right page. */
export async function goToStage(i, person) {
  const s = STAGES[i];
  if (!(await becomePerson(s.role, person))) return false;
  await openSampleBrand();
  writeJourney({ i, done: false });
  const target = new URL(s.href, window.location.origin);
  if (target.pathname === window.location.pathname && target.search === window.location.search) {
    window.location.hash = target.hash; // same page (e.g. /extension → /extension#try): reload so the new person shows
    window.location.reload();
  } else {
    window.location.href = s.href;
  }
  return true;
}
