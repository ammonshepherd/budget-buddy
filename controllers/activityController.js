import { getState } from "../models/store.js";
import { $, options, values } from "./ui.js";
import { editTransaction, renderLedger } from "./transactionController.js";
export function initializeActivityPage(params, rerender) {
  const s = getState(), form = $("#activity-filters");
  options(form.account, s.accounts, { placeholder: "All accounts", selected: params.get("account") });
  form.month.value = params.get("month") || ""; form.search.value = params.get("search") || "";
  form.sort.value = params.get("sort") || "newest"; form.unfunded.checked = params.get("unfunded") === "on";
  const filter = () => {
    const v = values(form), search = v.search.trim().toLocaleLowerCase();
    const transactions = s.transactions.filter((t) => t.status === "active" && (!v.month || t.date.startsWith(v.month)) && (!v.account || t.account_id === v.account) &&
      (!v.unfunded || t.funding === "needs_funding") && (!search || t.allocations.some((a) => s.categories.find((c) => c.id === a.category_id)?.name.toLocaleLowerCase().includes(search))));
    transactions.sort((a,b) => v.sort === "amount" ? b.amount-a.amount : v.sort === "oldest" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));
    renderLedger($("#activity-transactions"), transactions, rerender); $("#activity-count").textContent = `${transactions.length} transaction(s)`;
    const query = new URLSearchParams(Object.entries(v).filter(([,value]) => value)); history.replaceState(null, "", `#activity?${query}`);
  };
  form.addEventListener("input", filter); form.addEventListener("change", filter); form.addEventListener("submit", (e) => e.preventDefault());
  $("#clear-filters").addEventListener("click", () => { form.reset(); filter(); });
  $("#add-transaction").addEventListener("click", () => editTransaction(null, rerender)); filter();
}
