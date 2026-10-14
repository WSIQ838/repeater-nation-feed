import { useEffect, useState } from "react";

const REPO = "WSIQ838/repeater-nation-feed";
const newer = (a, b) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
};
const isWindows = () => /Windows/i.test(navigator.userAgent);

// Looks at the latest feed release and says whether it is newer than this app, with the file for this computer.
export async function checkForUpdate() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`Could not check for updates (${res.status}).`);
  const r = await res.json();
  const latest = String(r.tag_name || "").replace(/^feed-v/, "");
  const assets = r.assets || [];
  const file = isWindows() ? assets.find((a) => /x64-setup\.exe$/.test(a.name)) : assets.find((a) => /\.AppImage$/.test(a.name)) || assets.find((a) => /\.deb$/.test(a.name));
  return { current: __APP_VERSION__, latest, available: !!latest && newer(latest, __APP_VERSION__), page: r.html_url, download: file?.browser_download_url || r.html_url };
}

export async function openLink(url) {
  if (window.__TAURI_INTERNALS__) { const { openUrl } = await import("@tauri-apps/plugin-opener"); await openUrl(url); }
  else window.open(url, "_blank", "noopener");
}

// Checks when the app opens, then every six hours; `check()` is the "Check for updates" link.
export function useUpdate() {
  const [state, setState] = useState({ update: null, checking: false, error: "" });
  const check = async () => {
    setState((s) => ({ ...s, checking: true, error: "" }));
    try { setState({ update: await checkForUpdate(), checking: false, error: "" }); }
    catch (e) { setState((s) => ({ ...s, checking: false, error: e?.message || "Could not check for updates." })); }
  };
  useEffect(() => { check(); const t = setInterval(check, 6 * 3600 * 1000); return () => clearInterval(t); }, []);
  return { ...state, check };
}
