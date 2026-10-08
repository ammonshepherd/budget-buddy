import { config } from "../config.js";
const SESSION_KEY = "budget-buddy-session-v1";
let session;
let refreshing;
export const configured = () => !!(config.supabaseUrl && config.supabaseKey);
export function checkConfig() {
  if (!configured()) throw new Error("Supabase is not configured. Use the demo or follow the README setup instructions.");
  const url = new URL(config.supabaseUrl);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Supabase must use HTTPS.");
  if (config.supabaseKey.startsWith("sb_secret_")) throw new Error("A secret key cannot be used in the browser.");
  if (config.supabaseKey.includes(".")) {
    let role;
    try { role = JSON.parse(atob(config.supabaseKey.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role; }
    catch { throw new Error("Invalid public Supabase key."); }
    if (role !== "anon") throw new Error("Only a public anon key can be used in the browser.");
  }
}
export function getSession() { return session; }
function persist(value) {
  if (value) value = { ...value, expires_at: value.expires_at ?? Math.floor(Date.now() / 1000) + Number(value.expires_in || 3600) };
  session = value;
  if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  else localStorage.removeItem(SESSION_KEY);
}
async function authRequest(path, body, token, method = "POST") {
  checkConfig();
  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, "")}/auth/v1/${path}`, {
    method, headers: { apikey: config.supabaseKey, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.msg || data.message || data.error_description || "Sign-in request failed.");
    error.status = response.status; throw error;
  }
  return data;
}
export async function initializeAuth() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (fragment.has("access_token")) {
    const recovery = fragment.get("type") === "recovery";
    const token = fragment.get("access_token");
    history.replaceState(null, "", `${location.pathname}${location.search}${recovery ? "#reset-password" : "#budget"}`);
    const user = await authRequest("user", null, token, "GET");
    persist({ access_token: token, refresh_token: fragment.get("refresh_token"), expires_at: Math.floor(Date.now() / 1000) + Number(fragment.get("expires_in") || 3600), user });
    return;
  }
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { persist(null); }
  if (!session || !configured()) { persist(null); return; }
  try {
    await accessToken();
    session.user = await authRequest("user", null, session.access_token, "GET");
    persist(session);
  } catch (error) {
    // A network outage must not erase a valid stored session. The app stays locked
    // until the identity can be verified; it never restores private budget data.
    if ([400,401,403].includes(error.status)) persist(null);
    else session = undefined;
    throw error;
  }
}
export async function signIn(email, password) {
  const data = await authRequest("token?grant_type=password", { email, password });
  persist(data); return data.user;
}
export async function accessToken() {
  if (!session) throw new Error("Sign in to continue.");
  if (session.expires_at > Date.now() / 1000 + 90) return session.access_token;
  if (!refreshing) {
    const refresh = async () => {
      const latest = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (!latest) throw new Error("Your session ended. Sign in again.");
      if (latest.expires_at > Date.now() / 1000 + 90) { session = latest; return; }
      persist(await authRequest("token?grant_type=refresh_token", { refresh_token: latest.refresh_token }));
    };
    refreshing = (navigator.locks ? navigator.locks.request("budget-buddy-refresh", refresh) : refresh()).finally(() => { refreshing = undefined; });
  }
  await refreshing; return session.access_token;
}
export async function signOut() {
  const token = session?.access_token;
  persist(null);
  if (token && configured()) await authRequest("logout", null, token).catch(() => {});
}
export async function resetPassword(email) {
  await authRequest(`recover?redirect_to=${encodeURIComponent(`${location.origin}${location.pathname}`)}`, { email });
}
export async function updateUser({ email, name, password }) {
  const data = await authRequest("user", { ...(email ? { email } : {}), ...(name ? { data: { display_name: name } } : {}), ...(password ? { password } : {}) }, await accessToken(), "PUT");
  persist({ ...session, user: data }); return data;
}
export async function rpc(name, args = {}) {
  checkConfig();
  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
    method: "POST", headers: { apikey: config.supabaseKey, Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" }, body: JSON.stringify(args)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || "The database request failed.");
  return result;
}
export async function deleteUser() {
  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, "")}/functions/v1/delete-account`, {
    method: "POST", headers: { apikey: config.supabaseKey, Authorization: `Bearer ${await accessToken()}` }
  });
  if (!response.ok) { const data = await response.json(); throw new Error(data.error || "Account deletion failed."); }
  await signOut();
}
window.addEventListener("storage", (event) => {
  if (event.key === SESSION_KEY) {
    session = undefined;
    // Never leave another person's budget visible after a cross-tab sign-out.
    location.reload();
  }
});
