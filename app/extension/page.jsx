"use client";
import { useEffect, useState } from "react";
import { useRole } from "@/components/RoleProvider";
import { Card, Notice, PageHeader } from "@/components/ui";
import Icon from "@/components/Icon";
import { journeyEvent } from "@/lib/journey";

const ZIP = "/downloads/live-brand-check-extension.zip";
const BANNER = "/samples/banner-problems.jpg";
const CAPTION = "Guaranteed selection in UPSC Prelims! India's No.1 coaching. Hurry, last chance to join!!!";

function Copy({ text, label = "Copy" }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1800); })}>
      <Icon name={done ? "check" : "copy"} className="h-3.5 w-3.5" />{done ? "Copied" : label}
    </button>
  );
}

function Step({ n, title, children, done }) {
  return (
    <li className="flex gap-4 px-5 py-4">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${done ? "bg-approved-soft text-approved" : "bg-teal-soft text-teal-dark"}`}>
        {done ? <Icon name="check" className="h-4 w-4" strokeWidth={2.4} /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-2 text-sm">
        <p className="font-semibold">{title}</p>
        <div className="space-y-2 leading-6 text-muted">{children}</div>
      </div>
    </li>
  );
}

/** Reads what the extension's detect.js wrote on this page: installed version and the address it is set to. */
function useExtension() {
  const [ext, setExt] = useState(null);
  useEffect(() => {
    const read = () => {
      const v = document.documentElement.getAttribute("data-lbc-extension");
      if (v) setExt({ version: v, server: document.documentElement.getAttribute("data-lbc-extension-server") || "" });
    };
    read();
    window.addEventListener("lbc-extension-ready", read);
    const t = setInterval(read, 1500);
    return () => { window.removeEventListener("lbc-extension-ready", read); clearInterval(t); };
  }, []);
  return ext;
}

export default function ExtensionPage() {
  const { person } = useRole();
  const ext = useExtension();
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const connected = ext && ext.server === origin;
  useEffect(() => { if (connected) journeyEvent("extension"); }, [connected]);

  return (
    <div className="space-y-6">
      <PageHeader title="Chrome extension" sub="Check Instagram and Facebook posts while you write them: captions, images and banners, with the same brand kit and rules as this app. It only reads; nothing is changed or posted for you." />

      <section className={`panel flex flex-wrap items-center gap-4 p-5 ${connected ? "ring-1 ring-approved/30" : ""}`} data-testid="extension-status">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${connected ? "bg-approved-soft text-approved" : ext ? "bg-warning-soft text-warning" : "bg-canvas text-muted ring-1 ring-line"}`}>
          <Icon name={connected ? "checkCircle" : ext ? "alert" : "globe"} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 text-sm">
          {connected ? <><p className="font-semibold text-approved">Extension installed and connected</p><p className="text-muted">Version {ext.version}, checking with {ext.server}. Go to step 8 to try it on Instagram.</p></>
            : ext ? <><p className="font-semibold">Installed, but set to a different address</p><p className="text-muted">It is set to <span className="font-mono">{ext.server}</span>. Click the extension icon, set the address to <span className="font-mono">{origin}</span> and press Save (step 7).</p></>
            : <><p className="font-semibold">Not detected in this browser yet</p><p className="text-muted">Use Google Chrome (or Edge) on a computer and follow the steps below. This box turns green when the extension is ready.</p></>}
        </div>
      </section>

      <Card title="Add it to Chrome in 7 steps" sub="About 2 minutes. Free, no Chrome Web Store account needed." bodyClass="p-0">
        <ol className="divide-y divide-line">
          <Step n={1} title="Download the extension">
            <p><a href={ZIP} download className="btn btn-teal btn-sm" data-tour="extension-download"><Icon name="download" className="h-4 w-4" />Download live-brand-check-extension.zip</a> <span className="ml-1 text-xs">about 3 MB</span></p>
          </Step>
          <Step n={2} title="Unzip it">
            <p>Open your Downloads folder, right-click the zip and choose <b>Extract All…</b>, then <b>Extract</b> (Mac: double-click it). You get a folder called <b>live-brand-check-extension</b> (or <b>live-brand-check-extension (1)</b> if you downloaded it more than once). That folder is ready to use as it is.</p>
          </Step>
          <Step n={3} title="Open Chrome's extensions page">
            <p>Copy this address, paste it into Chrome&rsquo;s address bar and press Enter (Chrome doesn&rsquo;t let websites open it for you):</p>
            <p className="flex flex-wrap items-center gap-2"><span className="rounded bg-canvas px-2 py-1 font-mono text-xs text-ink ring-1 ring-line">chrome://extensions</span><Copy text="chrome://extensions" /></p>
          </Step>
          <Step n={4} title="Turn on Developer mode">
            <p>Use the <b>Developer mode</b> switch in the top-right corner of that page.</p>
          </Step>
          <Step n={5} title="Load the extension">
            <p>Click <b>Load unpacked</b> (top left), select the extracted <b>live-brand-check-extension</b> folder from step 2 and press <b>Select Folder</b>. A card called <b>Live Brand Check</b> appears.</p>
            <p className="text-xs">If Chrome says <i>Manifest file is missing</i>, you picked the zip file or a different folder: pick the extracted folder, the one with <span className="font-mono">manifest.json</span> directly inside. Already have an older Live Brand Check card? Press <b>Remove</b> on it first.</p>
          </Step>
          <Step n={6} title="Pin it to the toolbar">
            <p>Click the puzzle-piece icon in Chrome&rsquo;s toolbar, then the pin next to <b>Live Brand Check</b>. A blue tick icon appears.</p>
          </Step>
          <Step n={7} title="Connect it to Live Brand Check" done={connected}>
            <p>Click the blue tick icon. Under <b>Live Brand Check address</b> enter this address and press <b>Save</b>:</p>
            <p className="flex flex-wrap items-center gap-2"><span className="rounded bg-canvas px-2 py-1 font-mono text-xs text-ink ring-1 ring-line">{origin || "…"}</span>{origin && <Copy text={origin} />}</p>
            <p>The extension uses your sign-in here{person ? <> (you are signed in as <b className="text-ink">{person.name}</b>)</> : null}, so the popup should say <b>Signed in as …</b>. Come back to this page: the box at the top turns green.</p>
          </Step>
        </ol>
      </Card>

      <section id="try" className="scroll-mt-20">
        <Card title="Step 8: try it live on Instagram" sub="Use a test post. The panel only reads the composer; never press Share while testing." bodyClass="p-0">
          {person && person.role !== "Creator" && (
            <div className="px-5 pt-4"><Notice tone="info">Posts are written by creators. In the guided demo this step opens as Priya; any signed-in person can still see the checks.</Notice></div>
          )}
          <ol className="divide-y divide-line">
            <Step n="a" title="Get the sample banner and caption">
              <p className="flex flex-wrap items-center gap-2">
                <a href={BANNER} download className="btn btn-sm"><Icon name="download" className="h-3.5 w-3.5" />Sample banner</a>
                <Copy text={CAPTION} label="Copy sample caption" />
              </p>
              <p className="text-xs">Caption: &ldquo;{CAPTION}&rdquo;</p>
            </Step>
            <Step n="b" title="Open Instagram and start a post">
              <p><a href="https://www.instagram.com/" target="_blank" rel="noopener noreferrer" className="btn btn-teal btn-sm"><Icon name="globe" className="h-4 w-4" />Open Instagram</a></p>
              <p>Sign in, click <b>Create</b> (+) in the left menu, then <b>Post</b>. The first time, the extension shows a short how-to card at the bottom right.</p>
            </Step>
            <Step n="c" title="Add the banner">
              <p><b>Select from computer</b>, choose the sample banner, then <b>Next</b> on Crop and <b>Next</b> on Edit. You reach the screen with the <b>Write a caption…</b> box.</p>
            </Step>
            <Step n="d" title="Paste the caption and watch the panel">
              <p>Paste the sample caption. About 2 seconds later the <b>Live Brand Check</b> panel at the bottom right shows the counts and one card per issue: the words, why, a fix to try and the source. The first image read can take up to 30 seconds while the text reader loads.</p>
            </Step>
            <Step n="e" title="Fix it in Instagram">
              <p>Edit the caption in Instagram&rsquo;s box. The panel checks again as you type; press <b>Check</b> in the panel to re-run. When you&rsquo;re done, close the window and choose <b>Discard</b>.</p>
            </Step>
          </ol>
          <p className="border-t border-line px-5 py-3 text-xs text-muted">On Facebook: click <b>What&rsquo;s on your mind?</b>, add a photo and type the caption; the same panel appears.</p>
        </Card>
      </section>

      <Card title="What to look for">
        <ul className="grid gap-2 text-sm text-muted sm:grid-cols-2">
          {["Promises like “Guaranteed selection” flagged as critical, citing the CCPA coaching guidelines", "“India's No.1” flagged as an unproven claim (ASCI Code)", "Hype words, capitals and “!!!” flagged against the brand's tone guideline", "Text read from the banner checked with the same rules, plus contrast and brand colours", "“Not a post for …” if the post doesn't mention the brand", "Every finding names its source; images it can't read say “Couldn't verify”"].map((t) => (
            <li key={t} className="flex gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-teal-dark" />{t}</li>
          ))}
        </ul>
      </Card>

      <Card title="If something doesn't work">
        <dl className="space-y-3 text-sm">
          {[
            ["The popup says “Not signed in”", "Sign in on this site in the same Chrome window, then open the popup again."],
            ["The box at the top stays grey", "Reload this page after loading the extension. Check that Live Brand Check is switched on in chrome://extensions."],
            ["No panel on Instagram", "Reload the Instagram tab after installing (pages opened before the install don't have it yet), then start a new post."],
            ["“Couldn't verify image”", "The first read downloads the text reader's language data; wait a few seconds and press Check in the panel."],
          ].map(([q, a]) => <div key={q}><dt className="font-medium">{q}</dt><dd className="text-muted">{a}</dd></div>)}
        </dl>
      </Card>
    </div>
  );
}
