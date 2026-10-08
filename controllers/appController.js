import { initializeAccountsPage } from "./accountsController.js";
import { initializeActivityPage } from "./activityController.js";
import { initializeBudgetPage } from "./budgetController.js";
import { initializeSettingsPage } from "./settingsController.js";
import { configured, getSession, initializeAuth, signIn, resetPassword, updateUser, rpc, signOut } from "../models/auth.js";
import { getState, isDemo, enterDemo, loadState, clearState } from "../models/store.js";
import { monthNow } from "../models/budget.js";
import { $, $$, announce, handle, values, dialog } from "./ui.js";
export const APP_VERSION = "0.1.0";
const routes = { budget: initializeBudgetPage, accounts: initializeAccountsPage, activity: initializeActivityPage, settings: initializeSettingsPage };
const viewCache = new Map(); let sequence = 0;
async function view(name) {
  if (!viewCache.has(name)) {
    const response = await fetch(`./views/${name}.html`);
    if (!response.ok) throw new Error("Could not load this page. Reconnect and refresh.");
    viewCache.set(name, await response.text());
  }
  return viewCache.get(name);
}
export async function initializeApp() {
  $("#app-version").textContent = `v${APP_VERSION}`;
  try {
    $("#shared-templates").innerHTML = await view("shared");
    if (sessionStorage.getItem("budget-buddy-demo-active") === "1") enterDemo();
    else { await initializeAuth(); if (getSession()) await loadState(); }
  } catch (error) { announce(error.message, true); }
  window.addEventListener("hashchange", () => renderRoute(true));
  $("#exit-demo").addEventListener("click", handle(async () => { sessionStorage.removeItem("budget-buddy-demo-active"); clearState(); if (getSession()) await loadState(); await renderRoute(true); }));
  $(".skip-link").addEventListener("click", (event) => { event.preventDefault(); $("#app").focus(); });
  $("#reload-update").addEventListener("click", () => location.reload());
  await renderRoute(false);
  if (location.hash === "#reset-password" && getSession()) {
    const d = dialog("Choose a new password", "reset-form");
    d.submit(async (v) => { await updateUser({ password: v.password }); location.hash = "budget"; announce("Password updated."); });
  }
}
export async function renderRoute(focus = true) {
  const ticket = ++sequence;
  const [requested, query = ""] = location.hash.slice(1).split("?");
  const name = routes[requested] ? requested : "budget";
  const state = getState(), signedIn = !!getSession() || isDemo();
  const page = !signedIn ? "auth" : !state ? "setup" : name;
  try {
    const html = await view(page); if (ticket !== sequence) return;
    $("#app").innerHTML = html;
    $(".bottom-nav").hidden = !state;
    $("#demo-label").hidden = !isDemo(); $("#exit-demo").hidden = !isDemo();
    $$("[data-route]").forEach((link) => { link.classList.toggle("active", link.dataset.route === name); if (link.dataset.route === name) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current"); });
    document.title = `${page === "auth" ? "Sign in" : name[0].toUpperCase() + name.slice(1)} | Budget Buddy`;
    if (page === "auth") initializeSignIn(); else if (page === "setup") initializeSetup(); else routes[name](new URLSearchParams(query), () => renderRoute(true));
    if (focus) $("#page-title")?.focus();
  } catch (error) { announce(error.message, true); }
}
function initializeSignIn() {
  $("#config-message").hidden = configured();
  const form = $("#sign-in-form");
  form.addEventListener("submit", handle(async (event) => {
    event.preventDefault(); const v = values(form), button = $("button", form); button.disabled = true;
    try { await signIn(v.email, v.password); form.password.value = ""; await loadState(); announce("Signed in."); await renderRoute(true); }
    finally { button.disabled = false; }
  }));
  $("#forgot-password").addEventListener("click", handle(async () => { if (!form.email.reportValidity()) return; await resetPassword(form.email.value); announce("If this account exists, a password reset email will arrive shortly."); }));
  $("#try-demo").addEventListener("click", handle(async () => { enterDemo(); sessionStorage.setItem("budget-buddy-demo-active", "1"); announce("Demo mode. Changes are stored on this device."); await renderRoute(true); }));
}
function initializeSetup() {
  const form = $("#setup-form"); form.month.value = monthNow(); form.month.max = monthNow();
  form.addEventListener("submit", handle(async (event) => { event.preventDefault(); const v = values(form); await rpc("create_household", { p_name: v.name.trim(), p_start_month: v.month, p_currency: v.currency }); await loadState(); announce("Household created. Add an account to begin."); await renderRoute(true); }));
  $("#retry-household").addEventListener("click", handle(async () => { await loadState(); await renderRoute(true); }));
  $("#setup-signout").addEventListener("click", handle(async () => { await signOut(); clearState(); await renderRoute(true); }));
}
