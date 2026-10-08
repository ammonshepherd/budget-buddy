import { getSession, updateUser, signOut, deleteUser, rpc } from "../models/auth.js";
import { getState, isDemo, clearState, loadState } from "../models/store.js";
import { $, dialog, fill, handle, announce, confirm } from "./ui.js";
import { openImport } from "./importController.js";
export function initializeSettingsPage(params, rerender) {
  const s = getState(), demo = isDemo(), user = getSession()?.user;
  $("#user-name").textContent = demo ? "Demo user" : user.user_metadata?.display_name || "Your account";
  $("#user-email").textContent = demo ? "No sign-in required for demo" : user.email;
  $("#household-info").textContent = `${s.household.name} · ${s.household.currency} · started ${s.household.start_month}`;
  $("#connection-info").textContent = demo ? "Demo mode: data is saved only on this device." : "Connected to your shared Supabase household.";
  $("#sign-out").textContent = demo ? "Exit demo" : "Sign out";
  $("#sign-out").addEventListener("click", handle(async () => { if (!demo) await signOut(); sessionStorage.removeItem("budget-buddy-demo-active"); clearState(); if (demo && getSession()) await loadState(); location.hash = "budget"; await rerender(); }));
  $("#edit-profile").disabled = demo; $("#add-member").disabled = demo; $("#delete-user").disabled = demo;
  $("#transfer-ownership").disabled = demo;
  $("#transfer-ownership").addEventListener("click", () => {
    const d = dialog("Transfer household ownership", "member-form");
    $(".hint", d.form).textContent = "Choose another existing household member. They will become the owner; you will remain a member.";
    $("button[type=submit]", d.form).textContent = "Transfer ownership";
    d.submit(async (v) => { await rpc("transfer_household_ownership", { p_email: v.email }); announce("Ownership transferred."); });
  });
  $("#edit-profile").addEventListener("click", () => {
    const d = dialog("Edit your account", "profile-form"); fill(d.form, { name: user.user_metadata?.display_name || "", email: user.email });
    d.submit(async (v) => { await updateUser({ name: v.name.trim(), email: v.email !== user.email ? v.email : undefined, password: v.password || undefined }); announce("Profile saved. Check your email if you changed your address."); await rerender(); });
  });
  $("#add-member").addEventListener("click", () => { const d = dialog("Add household member", "member-form"); d.submit(async (v) => { await rpc("add_household_member", { p_email: v.email }); announce("Member added. They can refresh and open this shared budget."); }); });
  $("#delete-user").addEventListener("click", () => confirm("Delete sign-in account", "Permanently delete your login? A household owner with other members must transfer ownership first. Shared financial history is retained. A sole-owner household and all its data will be deleted.", async () => { await deleteUser(); clearState(); await rerender(); announce("Sign-in account deleted."); }));
  $("#open-import").addEventListener("click", () => openImport(rerender));
  $("#refresh-data").addEventListener("click", handle(async () => { await loadState(); await rerender(); announce("Budget refreshed."); }));
  $("#check-update").addEventListener("click", handle(async () => { const registration = await navigator.serviceWorker?.getRegistration(); if (!registration) throw new Error("App updates are available when the service worker is installed over HTTPS."); await registration.update(); announce("Checked for an app update. Reload when the update notice appears."); }));
}
