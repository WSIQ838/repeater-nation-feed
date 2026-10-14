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

export async function restoreSession() {
  let token = "";
  try { token = localStorage.getItem(TOKEN_KEY) || ""; } catch { /* storage unavailable */ }
  if (!token) return null;
  try {
    client().auth.setToken(token);
    const member = await client().auth.me();
    return member ? { member } : null;
  } catch (err) {
    const status = err?.status ?? err?.response?.status;
    if (status === 401 || status === 403) await clearSession();
    return null;
  }
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

async function invoke(name, payload) {
  try {
    const result = await client().functions.invoke(name, payload);
    return result?.data || result;
  } catch (err) {
    const data = err?.response?.data || err?.data;
    const detail = data?.error || data?.message || data?.detail;
    if (detail) throw Object.assign(new Error(String(detail)), { status: err?.response?.status ?? err?.status });
    throw err;
  }
}
export const radioFeedToken = (channelId, label) => invoke("radio-feed", { action: "token", channel_id: channelId, label: label || "" });
export const feedMine = () => invoke("radio-feed", { action: "mine" });
export const feedRequest = (name, description) => invoke("radio-feed", { action: "request", name, description: description || "" });
