// Runs only on the Live Brand Check site: tells the "Add the Chrome extension" page that the extension is installed
// and which address it is set to, so the page can show a tick or say what to fix. Reads nothing from the page.
(async () => {
  const root = document.documentElement;
  root.setAttribute("data-lbc-extension", chrome.runtime.getManifest().version);
  try {
    const { server } = await chrome.storage.sync.get({ server: "https://live-brand-check.vercel.app" });
    root.setAttribute("data-lbc-extension-server", server.replace(/\/+$/, ""));
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event("lbc-extension-ready"));
})();
