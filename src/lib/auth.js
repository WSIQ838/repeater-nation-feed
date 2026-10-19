import { createClient } from "@base44/sdk";
import { config } from "./config";

let base44Client = null;
function client() {
  if (!base44Client) {
    base44Client = createClient({
      appId: config.base44AppId,
      serverUrl: config.appUrl,
      requiresAuth: false,
      appBaseUrl: config.base44AppBaseUrl,
      options: { onError: (err) => console.error("[Base44 SDK]", err?.status, err?.message) },
    });
  }
  return base44Client;
}

const TOKEN_KEY = "base44_access_token";

// Making a feed token is an admin action on the server; this only decides whether the app is shown.
export const isAdmin = (member) => ["admin", "super_admin"].includes(String(member?.role || "").toLowerCase());

const TOKEN_KEYS = [TOKEN_KEY, "token"];
function savedToken() {
  try { for (const k of TOKEN_KEYS) { const v = localStorage.getItem(k); if (v) return v; } } catch { /* storage unavailable */ }
  return "";
}

// Sign-in progress for the login screen, so a failed browser hand-off says where it stopped.
export function reportAuthStatus(message, error = false) {
  console[error ? "error" : "info"]("[auth]", message);
  window.dispatchEvent(new CustomEvent("rn-auth-status", { detail: { message, error } }));
}

// { member } when the saved sign-in still works, null when there is none or the server refused it, and
// { offline: true } when the server couldn't be reached (the saved sign-in is kept so it can be tried again).
export async function restoreSession() {
  const token = savedToken();
  if (!token) return null;
  try {
    client().auth.setToken(token);
    let timer;
    const member = await Promise.race([
      client().auth.me(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), 15000); }),
    ]).finally(() => clearTimeout(timer));
    return member ? { member } : null;
  } catch (err) {
    const status = err?.status ?? err?.response?.status;
    if (status === 401 || status === 403) { await clearSession(); return null; }
    return { offline: true };
  }
}

const inDesktopApp = () => typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

async function sessionFromToken(token) {
  client().auth.setToken(token);
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* storage unavailable */ }
  const member = await client().auth.me();
  return member ? { member } : null;
}

// Google refuses sign-in inside an embedded window, so the app opens the system browser and the
// website hands the result back through a repeaternation-feed:// link (its own link type, so no other
// Repeater Nation app is opened by mistake).
export async function loginWithGoogle() {
  const base = config.base44AppBaseUrl;
  const login = (from) => `${base}/api/apps/auth/login?app_id=${encodeURIComponent(config.base44AppId)}&from_url=${encodeURIComponent(from)}`;
  if (inDesktopApp()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(login(`${config.appUrl}/oauth/feed-callback`));
    reportAuthStatus("Google sign-in opened in your browser. Finish there, then allow it to open Repeater Nation Feed.");
    return;
  }
  window.location.href = login(window.location.origin + window.location.pathname);
}

// Browser build: picks up the token Base44 returns in the address after Google sign-in.
export async function restoreSessionFromRedirect() {
  try {
    const u = new URL(window.location.href);
    const token = u.searchParams.get("access_token") || new URLSearchParams(u.hash.replace(/^#/, "")).get("access_token");
    if (!token) return null;
    window.history.replaceState({}, "", u.pathname);
    return await sessionFromToken(token);
  } catch { return null; }
}

// Desktop: the repeaternation-feed://oauth/callback?access_token=... link from the browser.
export async function restoreSessionFromLink(url) {
  const token = new URL(url).searchParams.get("access_token");
  if (!token) throw new Error("The sign-in link had no token. Try signing in again.");
  const s = await sessionFromToken(token);
  if (!s) throw new Error("Signed in, but the account could not be loaded.");
  return s;
}

export async function loginWithPassword(email, password) {
  const e = email.trim();
  if (!e || !password) throw new Error("Enter the email and password of a Repeater Nation admin account.");
  await client().auth.loginViaEmailPassword(e, password);
  const member = await client().auth.me();
  if (!member) throw new Error("Signed in, but the account could not be loaded.");
  return { member };
}

export async function clearSession() {
  try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem("token"); } catch { /* ignore */ }
  try { base44Client?.cleanup?.(); } catch { /* ignore */ }
  base44Client = null;
}

export async function listZonesAndChannels() {
  const e = client().entities;
  const [zones, channels] = await Promise.all([e.RadioZone.list("display_order", 200), e.RadioChannel.list("number", 500)]);
  return { zones: zones || [], channels: channels || [] };
}

const INVOKE_TIMEOUT_MS = 20000;

// A 401 from a server function can be a lapsed sign-in or a passing hiccup. Check once with the account call;
// only a refused sign-in there tells the app (rn-auth-expired) to stop and go back to the login screen.
let authCheck = null;
function checkSignIn() {
  if (authCheck || !base44Client) return;
  authCheck = (async () => {
    let timer;
    try {
      await Promise.race([client().auth.me(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), 10000); })]);
    } catch (err) {
      const status = err?.status ?? err?.response?.status;
      if (status === 401 || status === 403) window.dispatchEvent(new CustomEvent("rn-auth-expired"));
    } finally { clearTimeout(timer); setTimeout(() => { authCheck = null; }, 30000); }
  })();
}

async function invoke(name, payload, timeoutMs = INVOKE_TIMEOUT_MS) {
  let timer;
  try {
    const result = await Promise.race([
      client().functions.invoke(name, payload),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("Repeater Nation is not responding. Try again in a moment."), { timedOut: true })), timeoutMs); }),
    ]);
    return result?.data || result;
  } catch (err) {
    if (err?.timedOut) throw err;
    const status = err?.response?.status ?? err?.status;
    if (status === 401) checkSignIn();
    const data = err?.response?.data || err?.data;
    const detail = data?.error || data?.message || data?.detail;
    if (detail) throw Object.assign(new Error(String(detail)), { status });
    if (!err?.response && /network error/i.test(err?.message || "")) throw Object.assign(new Error("Can't reach Repeater Nation. Check the internet connection."), { network: true });
    throw err;
  } finally { clearTimeout(timer); }
}
export const radioFeedToken = (channelId, label) => invoke("radio-feed", { action: "token", channel_id: channelId, label: label || "" });
export const feedMine = () => invoke("radio-feed", { action: "mine" });
export const feedRequest = (name, description) => invoke("radio-feed", { action: "request", name, description: description || "" });
