import { money } from "../models/budget.js";
import { getState } from "../models/store.js";
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const template = (name) => $( `#${name}-template`).content.firstElementChild.cloneNode(true);
export const formatMoney = (amount) => money(amount, getState()?.household.currency || "USD");
export const decimal = (n) => (n / 100).toFixed(2);
export function announce(message, error = false) {
  const node = $(error ? "#app-error" : "#app-status");
  node.textContent = message; node.hidden = !message;
  if (!error) { $("#app-error").textContent = ""; $("#app-error").hidden = true; }
}
export function options(select, rows, { placeholder, selected, label = (r) => r.name } = {}) {
  select.replaceChildren();
  if (placeholder !== undefined) select.add(new Option(placeholder, ""));
  rows.forEach((r) => select.add(new Option(label(r), r.id)));
  if (selected) select.value = selected;
}
export function values(form) { return Object.fromEntries(new FormData(form)); }
export function fill(form, record) {
  for (const [key, value] of Object.entries(record)) {
    const field = form.elements.namedItem(key);
    if (field) { if (field.type === "checkbox") field.checked = !!value; else field.value = value ?? ""; }
  }
}
export function handle(action) {
  return async (event) => { try { await action(event); } catch (error) { announce(error.message, true); } };
}
export function dialog(title, name) {
  const opener = document.activeElement;
  const node = template("dialog");
  const titleId = `dialog-${crypto.randomUUID()}`;
  $("h2", node).textContent = title; $("h2", node).id = titleId; node.setAttribute("aria-labelledby", titleId);
  const form = template(name); $(".dialog-body", node).append(form);
  document.body.append(node); node.showModal();
  $(".close-dialog", node).addEventListener("click", () => node.close());
  node.addEventListener("close", () => { node.remove(); if (opener?.isConnected) opener.focus(); else $("#page-title")?.focus(); }, { once: true });
  const error = (message) => { const area = $(".dialog-error", node); area.textContent = message; area.hidden = false; };
  return { node, form, close: () => node.close(), error, submit(action) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault(); const buttons = $$("button[type=submit]", form); buttons.forEach((b) => b.disabled = true);
      $(".dialog-error", node).hidden = true;
      try { await action(values(form)); node.close(); }
      catch (e) { error(e.message); }
      finally { buttons.forEach((b) => b.disabled = false); }
    });
  } };
}
export function confirm(title, message, action) {
  const d = dialog(title, "confirm-form"); $(".confirmation-text", d.form).textContent = message; d.submit(action); return d;
}
export function closeDialogs() { $$("dialog[open]").forEach((d) => d.close()); }
