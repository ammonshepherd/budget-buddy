import { cents, id, today } from "./budget.js";
// RFC 4180 quotes, escaped quotes, CRLF and multiline cells. No eval or HTML.
export function parseCSV(text) {
  const rows = []; let row = [], cell = "", quoted = false, afterQuote = false;
  text = text.replace(/^\uFEFF/, "");
  if (text.length > 5_000_000) throw new Error("CSV files must be smaller than 5 MB.");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; afterQuote = true; }
      else cell += c;
    } else if (c === '"' && cell === "" && !afterQuote) quoted = true;
    else if (c === "," || c === "\n" || c === "\r") {
      row.push(cell); cell = ""; afterQuote = false;
      if (c !== ",") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        if (row.some((v) => v.trim())) rows.push(row);
        row = [];
      }
    } else {
      if (afterQuote && !/\s/.test(c)) throw new Error("Invalid characters after a quoted CSV cell.");
      if (!afterQuote) cell += c;
    }
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field.");
  if (cell || row.length) { row.push(cell); rows.push(row); }
  if (rows.length < 2) throw new Error("CSV needs a header and at least one transaction.");
  if (rows.length > 2001) throw new Error("Import at most 2,000 transactions at a time.");
  const headers = rows.shift().map((v) => v.trim());
  if (new Set(headers).size !== headers.length || headers.some((h) => !h)) throw new Error("CSV headers must be unique and nonempty.");
  if (rows.some((r) => r.length !== headers.length)) throw new Error("CSV rows must have the same number of fields as the header.");
  return { headers, rows };
}
export function parseDate(value, format = "iso") {
  let y, m, d;
  if (format === "iso") { const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim()); if (match) [, y, m, d] = match; }
  else {
    const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value.trim());
    if (match) { y = match[3]; [m, d] = format === "mdy" ? [match[1], match[2]] : [match[2], match[1]]; }
  }
  if (!y || Number(y) < 1900) throw new Error("Invalid date. Check the selected date format.");
  const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(+parsed) || parsed.toISOString().slice(0, 10) !== date || date > today()) throw new Error("Invalid or future transaction date.");
  return date;
}
export function mappedTransactions(csv, mapping, account, state) {
  const cell = (row, name) => mapping[name] === "" || mapping[name] == null ? "" : row[Number(mapping[name])].trim();
  return csv.rows.map((row, index) => {
    try {
      const date = parseDate(cell(row, "date"), mapping.dateFormat);
      const payee = cell(row, "payee"); if (!payee) throw new Error("Missing payee/description.");
      const parseAmount = (raw) => cents(raw.replace(/^\((.*)\)$/, "-$1"));
      let amount;
      if (mapping.amount !== "") { amount = parseAmount(cell(row, "amount")); if (mapping.reverse === "yes") amount = -amount; }
      else amount = (cell(row, "credit") ? Math.abs(parseAmount(cell(row, "credit"))) : 0) - (cell(row, "debit") ? Math.abs(parseAmount(cell(row, "debit"))) : 0);
      if (!amount) throw new Error("Amount is zero or missing.");
      const external = cell(row, "external_id");
      const transaction = { id: id(), account_id: account.id, date, posted_date: cell(row, "posted_date") ? parseDate(cell(row, "posted_date"), mapping.dateFormat) : null,
        amount, payee, note: cell(row, "note"), check_number: cell(row, "check_number"), tags: cell(row, "tags").split(/[;|]/).map((t) => t.trim()).filter(Boolean),
        kind: amount < 0 ? "expense" : account.type === "credit" ? "adjustment" : "income", funding: amount < 0 && account.on_budget && date.slice(0, 7) >= state.household.start_month && (cell(row, "posted_date") || date) >= account.opening_date ? "needs_funding" : "not_required",
        status: "active", transfer_id: null, merged_into_id: null, source: "csv", external_id: external || null,
        original_description: payee, import_data: Object.fromEntries(csv.headers.map((h, i) => [h, row[i]])), allocations: [] };
      const candidates = state.transactions.filter((t) => t.status === "active" && t.account_id === account.id &&
        ((external && t.external_id === external) || t.date === date && t.amount === amount));
      return { row: index + 2, transaction, candidates };
    } catch (error) { return { row: index + 2, error: error.message }; }
  });
}
export function matchTransaction(state, imported, targetId) {
  const target = state.transactions.find((t) => t.id === targetId && t.status === "active");
  if (!target || target.account_id !== imported.account_id || target.amount !== imported.amount) throw new Error("A match must have the same account and amount.");
  if (target.external_id && imported.external_id && target.external_id !== imported.external_id) throw new Error("Different bank IDs cannot be matched.");
  target.external_id ||= imported.external_id;
  target.posted_date ||= imported.posted_date;
  target.original_description ||= imported.original_description;
  target.import_data = { ...target.import_data, ...imported.import_data };
  target.check_number ||= imported.check_number;
  target.tags = [...new Set([...target.tags, ...imported.tags])];
  state.transactions.push({ ...imported, status: "merged", merged_into_id: target.id });
}
