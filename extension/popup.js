const $ = (id) => document.getElementById(id);
const DEFAULT_SERVER = "https://live-brand-check.vercel.app";

async function refresh() {
  const s = await chrome.storage.sync.get({ server: DEFAULT_SERVER, enabled: true });
  $("server").value = s.server;
  $("enabled").checked = s.enabled;
  $("open").href = s.server;
  const res = await chrome.runtime.sendMessage({ type: "session" });
  const st = $("status");
  st.textContent = "";
  if (res?.ok) {
    st.append(`Signed in as ${res.name} (${res.role}).`);
  } else {
    st.append(res?.status === 401 ? "Not signed in. " : `Can't reach the server (${res?.error || "no answer"}). `);
    const a = Object.assign(document.createElement("a"), { href: `${s.server}/login`, target: "_blank", rel: "noopener", textContent: "Sign in" });
    st.append(a);
  }
}

$("save").onclick = async () => {
  let server = $("server").value.trim().replace(/\/+$/, "") || DEFAULT_SERVER;
  try {
    const u = new URL(server);
    if (u.protocol !== "https:" && u.hostname !== "localhost") throw new Error("Use an https address.");
    const origin = `${u.origin}/*`;
    // The live site and localhost on any port (3000, 3001, …) are already allowed in the manifest.
    const known = u.origin === "https://live-brand-check.vercel.app" || ["localhost", "127.0.0.1"].includes(u.hostname);
    if (!known && !(await chrome.permissions.request({ origins: [origin] }))) throw new Error("Permission to reach that address was not given.");
    server = u.origin;
  } catch (e) {
    $("status").textContent = e.message;
    return;
  }
  await chrome.storage.sync.set({ server, enabled: $("enabled").checked });
  await chrome.runtime.sendMessage({ type: "forget" });
  refresh();
};
$("enabled").onchange = () => chrome.storage.sync.set({ enabled: $("enabled").checked });
refresh();
