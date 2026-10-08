import { accountBalance, id, today } from "../models/budget.js";
import { saveAccount } from "../models/actions.js";
import { cents } from "../models/budget.js";
import { getState, changeState } from "../models/store.js";
import { $, template, dialog, fill, decimal, formatMoney, announce } from "./ui.js";
import { editTransaction, editTransfer, renderLedger } from "./transactionController.js";
export function initializeAccountsPage(params, rerender) {
  const state = getState(), selected = state.accounts.find((a) => a.id === params.get("id"));
  $("#add-account").addEventListener("click", () => editAccount(null, rerender));
  $("#accounts-empty").hidden = !!state.accounts.length;
  if (selected) {
    $("#account-detail").hidden = false; $("#account-list").hidden = true; $("#account-name").textContent = selected.name;
    $("#account-balance").textContent = formatMoney(accountBalance(state, selected));
    $("#edit-account").addEventListener("click", () => editAccount(selected, rerender));
    $("#account-add-transaction").addEventListener("click", () => editTransaction(null, rerender, selected.id));
    $("#account-transfer").addEventListener("click", () => editTransfer(null, rerender, selected.id));
    renderLedger($("#account-transactions"), state.transactions.filter((t) => t.account_id === selected.id && t.status === "active").sort((a,b) => b.date.localeCompare(a.date)), rerender);
    return;
  }
  for (const account of state.accounts) {
    const node = template("account"); $(".account-link", node).href = `#accounts?id=${account.id}`;
    $(".name", node).textContent = `${account.name}${account.archived ? " (archived)" : ""}`;
    $(".type", node).textContent = `${account.type} · ${account.on_budget ? "in budget" : "tracking"}`;
    $(".balance", node).textContent = formatMoney(accountBalance(state, account));
    $("button", node).setAttribute("aria-label", `Edit ${account.name}`); $("button", node).addEventListener("click", () => editAccount(account, rerender)); $("#account-list").append(node);
  }
}
export function editAccount(account, rerender) {
  const d = dialog(account ? "Edit account" : "Add account", "account-form");
  fill(d.form, account ? { ...account, opening_balance: decimal(account.opening_balance) } : { opening_date: today() });
  const locked = account && getState().transactions.some((t) => t.account_id === account.id);
  for (const field of ["type", "on_budget", "opening_balance", "opening_date"]) d.form.elements[field].disabled = !!locked;
  const update = () => { if (!locked) { d.form.on_budget.disabled = d.form.type.value === "tracking"; if (d.form.type.value === "tracking") d.form.on_budget.checked = false; } };
  d.form.type.addEventListener("change", update); update();
  d.submit(async (v) => {
    await changeState((s) => saveAccount(s, { id: account?.id || id(), name: v.name.trim(), type: locked ? account.type : v.type,
      on_budget: locked ? account.on_budget : d.form.on_budget.checked, opening_balance: locked ? account.opening_balance : cents(v.opening_balance), opening_date: locked ? account.opening_date : v.opening_date, archived: d.form.archived.checked }));
    announce("Account saved."); await rerender();
  });
}
