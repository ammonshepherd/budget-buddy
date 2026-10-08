import { categoryFigures, monthNow, monthRow, cents, id } from "../models/budget.js";
import { moveMoney } from "../models/actions.js";
import { getState, changeState } from "../models/store.js";
import { $, template, formatMoney, decimal, dialog, fill, options, handle, announce } from "./ui.js";
import { summary } from "../models/budget.js";
export function initializeBudgetPage(params, rerender) {
  const state = getState();
  const requestedMonth = params.get("month") || localStorage.getItem("budget-buddy-month") || monthNow();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth) && requestedMonth >= state.household.start_month ? requestedMonth : state.household.start_month;
  const input = $("#budget-month"); input.value = month; input.min = state.household.start_month;
  input.addEventListener("change", () => { if (!input.reportValidity()) return; localStorage.setItem("budget-buddy-month", input.value); location.hash = `budget?month=${input.value}`; });
  const totals = summary(state, month);
  $("#assignable").textContent = formatMoney(totals.assignable);
  $("#budget-summary").textContent = `${formatMoney(totals.cash)} cash · ${formatMoney(totals.reserved)} reserved across months`;
  if (totals.unresolved || totals.assignable < 0) { $("#funding-warning").hidden = false; $("#funding-warning").textContent = `${totals.unresolved} transaction(s) need funding.${totals.assignable < 0 ? " Cash no longer covers all reservations. Resolve charges or release assignments." : " Open Activity to choose categories and fund them."}`; }
  const groups = [...state.groups].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  for (const group of groups) {
    const categories = state.categories.filter((c) => c.group_id === group.id);
    const section = template("budget-group"); $("h2", section).textContent = `${group.name}${group.archived ? " (archived)" : ""}`;
    $(".group-heading button", section).addEventListener("click", () => editGroup(group, rerender));
    for (const c of categories) {
      const f = categoryFigures(state, c.id, month), node = template("budget-category");
      $(".category-name", node).textContent = `${c.name}${c.archived ? " (archived)" : ""}`;
      $(".category-name", node).addEventListener("click", () => editCategory(c, rerender));
      $(".category-kind", node).textContent = c.kind === "card_payment" ? "Card reserve" : "";
      const form = $("form", node);
      form.setAttribute("aria-label", `${c.name} monthly amounts`);
      fill(form, { assigned: decimal(f.assigned), planned: decimal(f.planned) });
      for (const key of ["spent", "remaining", "saved"]) $(`.${key}`, node).textContent = formatMoney(f[key]);
      const savedButton = $(".use-saved", node); savedButton.disabled = f.saved <= 0;
      savedButton.addEventListener("click", () => openMove(month, rerender, c.id, true));
      form.addEventListener("submit", handle(async (event) => {
        event.preventDefault(); const button = $("button", form); button.disabled = true;
        try { await changeState((draft) => { const row = monthRow(draft, c.id, month); row.assigned += cents(form.assigned.value) - f.assigned; row.planned = cents(form.planned.value); }); announce(`${c.name} updated.`); await rerender(); }
        finally { button.disabled = false; }
      }));
      $(".categories", section).append(node);
    }
    $("#budget-groups").append(section);
  }
  $("#budget-empty").hidden = !!state.categories.length;
  $("#add-category").addEventListener("click", handle(() => { if (!state.groups.some((g) => !g.archived)) throw new Error("Add a group first."); editCategory(null, rerender); }));
  $("#add-group").addEventListener("click", () => editGroup(null, rerender));
  $("#reallocate").addEventListener("click", () => openMove(month, rerender));
}
export function editGroup(group, rerender) {
  const d = dialog(group ? "Edit group" : "Add group", "group-form");
  if (group) fill(d.form, group);
  d.submit(async (v) => {
    await changeState((s) => {
      if (d.form.archived.checked && s.categories.some((c) => c.group_id === group?.id && !c.archived)) throw new Error("Move or archive this group’s categories first.");
      const record = { id: group?.id || id(), name: v.name.trim(), position: Number(v.position), archived: d.form.archived.checked };
      if (group) Object.assign(s.groups.find((g) => g.id === group.id), record); else s.groups.push(record);
    }); announce("Group saved."); await rerender();
  });
}
export function editCategory(category, rerender) {
  const d = dialog(category ? "Edit category" : "Add category", "category-form");
  options(d.form.group_id, getState().groups.filter((g) => !g.archived || g.id === category?.group_id), { selected: category?.group_id });
  if (category) fill(d.form, category);
  d.submit(async (v) => {
    await changeState((s) => {
      const record = { ...(category || { id: id(), kind: "spending", card_account_id: null, position: s.categories.length }), name: v.name.trim(), group_id: v.group_id, archived: d.form.archived.checked };
      if (category) Object.assign(s.categories.find((c) => c.id === category.id), record); else s.categories.push(record);
    }); announce("Category saved."); await rerender();
  });
}
export function openMove(month, onSave, categoryId, saved = false) {
  const s = getState(), d = dialog(saved ? "Move Saved to Assigned" : "Reallocate Available", "move-form");
  const rows = s.categories;
  options(d.form.from, rows, { selected: saved ? categoryId : undefined, label: (r) => `${r.name}: ${formatMoney(categoryFigures(s, r.id, month)[saved ? "saved" : "remaining"])} ${saved ? "Saved" : "Available"}` });
  options(d.form.to, rows, { selected: categoryId });
  if (saved) { d.form.from.value = categoryId; d.form.from.disabled = true; d.form.to.value = categoryId; d.form.to.disabled = true; }
  $(".move-hint", d.form).textContent = saved ? `Moves this category’s Saved into Assigned for ${month}. Assignable will not change.` : `Only Available can move between categories in ${month}. Saved is separate.`;
  d.submit(async (v) => { await changeState((draft) => moveMoney(draft, { from: saved ? categoryId : v.from, to: saved ? categoryId : v.to, amount: cents(v.amount), month, saved })); announce("Money moved."); await onSave?.(); });
}
