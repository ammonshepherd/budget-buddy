/**
 * DataStore that keeps everything in memory. Used only for UI tests
 * (`VITE_DATA_STORE=memory`), so Playwright can exercise every screen without
 * a real Supabase project. It mirrors the database rules the UI relies on.
 */
import { paymentEnvelopeName } from "./accounts";
import { APP_VERSION } from "./appInfo";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  NOT_EMPTY,
  isEmptyHousehold,
  validateBackup,
  withFreshIds,
} from "./backup";
import { UserFacingError, type DataStore, type UserSession } from "./dataStore";
import { nameKey } from "./envelopePlan";
import { MAX_SPLIT_LINES } from "./splits";
import { asImportFormat } from "./transactionImport";
import type { BudgetData, Transaction } from "./types";

/** Same message as the import_transactions SQL function. */
const MATCH_CHANGED =
  "A transaction to match has changed since the preview. Choose the file again.";

/** Same message as the database's allocation check. */
const TRACKING_ALONE = "A tracking account stands alone: no envelopes, Income or transfers";

export function createMemoryStore(): DataStore {
  let session: UserSession | null = null;
  let data: BudgetData | null = null;
  const listeners = new Set<(s: UserSession | null) => void>();
  const id = () => crypto.randomUUID();

  const budget = (): BudgetData => {
    if (!session || !data) throw new UserFacingError("Sign in first");
    return data;
  };
  const setSession = (next: UserSession | null) => {
    session = next;
    listeners.forEach((listener) => listener(next));
  };
  const nextPosition = (items: { position: number }[]) =>
    items.reduce((max, item) => Math.max(max, item.position + 1), 0);
  /** Like the SQL reorder functions: the list must name every item once. */
  const reorder = (items: { id: string; position: number }[], ids: string[], stale: string) => {
    if (ids.length !== items.length || !items.every((item) => ids.includes(item.id))) {
      throw new UserFacingError(stale);
    }
    for (const item of items) item.position = ids.indexOf(item.id);
  };
  /** Unlinks a transfer side: a typed-in one is deleted, an imported one becomes Uncategorized. */
  const release = (tx: Transaction) => {
    tx.transferId = null;
    tx.isTransfer = false;
    if (tx.importKey === null) {
      budget().transactions = budget().transactions.filter((t) => t !== tx);
    }
  };
  /** Like the SQL release_transfer: unlinks a transaction and releases its other side. */
  const releaseTransfer = (transactionId: string) => {
    const tx = budget().transactions.find((t) => t.id === transactionId);
    if (!tx?.transferId) return;
    const others = budget().transactions.filter((t) => t.transferId === tx.transferId && t !== tx);
    tx.transferId = null;
    tx.isTransfer = false;
    others.forEach(release);
  };
  const envelopeMonth = (envelopeId: string, month: string) => {
    const b = budget();
    if (!b.envelopes.some((e) => e.id === envelopeId)) {
      throw new UserFacingError("Envelope not found");
    }
    let record = b.envelopeMonths.find((r) => r.envelopeId === envelopeId && r.month === month);
    if (!record) {
      record = { envelopeId, month, assigned: 0, released: 0, planned: 0 };
      b.envelopeMonths.push(record);
    }
    return record;
  };

  return {
    async getSession() {
      return session;
    },
    onSessionChange(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    async signIn(email) {
      setSession({ userId: "memory-user", email });
    },
    async signOut() {
      setSession(null);
    },

    async load() {
      if (!session) throw new UserFacingError("Sign in first");
      // structuredClone hands out a copy, like a real network response.
      return data && structuredClone(data);
    },
    async createHousehold(name) {
      if (data) throw new UserFacingError("You already belong to a household");
      data = {
        household: { id: id(), name },
        accounts: [],
        groups: [],
        envelopes: [],
        envelopeMonths: [],
        transactions: [],
        incomeRules: [],
      };
    },

    async addAccount(_householdId, { onBudget = true, ...account }) {
      const b = budget();
      // Like the database check: only a checking-type account can be off budget.
      if (!onBudget && account.type !== "checking") {
        throw new UserFacingError("Only a checking-type account can be a tracking account");
      }
      const accountId = id();
      b.accounts.push({
        id: accountId,
        ...account,
        onBudget,
        closedAt: null,
        importFormat: null,
      });
      // Like the database trigger: a card gets its payment envelope.
      if (account.type === "credit_card") {
        // Like the trigger: join the other cards' payment envelopes, wherever they are.
        const cardGroupId = b.envelopes.find((e) => e.cardAccountId)?.groupId;
        let group =
          b.groups.find((g) => g.id === cardGroupId) ??
          b.groups.find((g) => nameKey(g.name) === "credit card payments");
        if (!group) {
          group = { id: id(), name: "Credit card payments", position: nextPosition(b.groups) };
          b.groups.push(group);
        }
        const groupId = group.id;
        b.envelopes.push({
          id: id(),
          groupId,
          name: paymentEnvelopeName(account.name),
          position: nextPosition(b.envelopes.filter((e) => e.groupId === groupId)),
          cardAccountId: accountId,
        });
      }
    },
    async updateAccount(accountId, { name, openingBalance, openingDate }) {
      const b = budget();
      const account = b.accounts.find((a) => a.id === accountId);
      if (!account) throw new UserFacingError("Account not found");
      Object.assign(account, { name, openingBalance, openingDate });
      for (const envelope of b.envelopes) {
        if (envelope.cardAccountId === accountId) envelope.name = paymentEnvelopeName(name);
      }
    },
    async closeAccount(accountId) {
      const account = budget().accounts.find((a) => a.id === accountId);
      if (account) account.closedAt = new Date().toISOString();
    },

    async addGroup(_householdId, name, position) {
      budget().groups.push({ id: id(), name, position });
    },
    async addEnvelope(_householdId, groupId, name, position) {
      budget().envelopes.push({ id: id(), groupId, name, position, cardAccountId: null });
    },
    async deleteEnvelope(envelopeId) {
      const b = budget();
      const card = b.envelopes.find((e) => e.id === envelopeId)?.cardAccountId;
      if (card && !b.accounts.find((a) => a.id === card)?.closedAt) {
        throw new UserFacingError(
          "A card's payment envelope cannot be deleted while the card is open",
        );
      }
      if (b.transactions.some((tx) => tx.allocations.some((a) => a.envelopeId === envelopeId))) {
        throw new UserFacingError("It is still in use. Move or delete what uses it first.");
      }
      b.envelopes = b.envelopes.filter((e) => e.id !== envelopeId);
      b.envelopeMonths = b.envelopeMonths.filter((r) => r.envelopeId !== envelopeId);
    },
    async deleteGroup(groupId) {
      const b = budget();
      if (b.envelopes.some((e) => e.groupId === groupId)) {
        throw new UserFacingError("It is still in use. Move or delete what uses it first.");
      }
      b.groups = b.groups.filter((g) => g.id !== groupId);
    },
    async renameGroup(groupId, name) {
      const group = budget().groups.find((g) => g.id === groupId);
      if (!group) throw new UserFacingError("Group not found");
      group.name = name;
    },
    async renameEnvelope(envelopeId, name) {
      const envelope = budget().envelopes.find((e) => e.id === envelopeId);
      if (!envelope) throw new UserFacingError("Envelope not found");
      if (envelope.cardAccountId) {
        throw new UserFacingError(
          "A card's payment envelope is named after its card; rename the card instead",
        );
      }
      envelope.name = name;
    },
    async moveEnvelope(envelopeId, groupId, position) {
      const b = budget();
      const envelope = b.envelopes.find((e) => e.id === envelopeId);
      if (!envelope) throw new UserFacingError("Envelope not found");
      if (!b.groups.some((g) => g.id === groupId)) throw new UserFacingError("Group not found");
      if (envelope.cardAccountId && envelope.groupId !== groupId) {
        throw new UserFacingError("A card's payment envelope stays in its group");
      }
      Object.assign(envelope, { groupId, position });
    },
    async reorderGroups(_householdId, groupIds) {
      reorder(budget().groups, groupIds, "The groups have changed; reload and try again");
    },
    async reorderEnvelopes(groupId, envelopeIds) {
      const siblings = budget().envelopes.filter((e) => e.groupId === groupId);
      reorder(siblings, envelopeIds, "The envelopes have changed; reload and try again");
    },

    async adjustEnvelopeMonth(envelopeId, month, change) {
      const record = envelopeMonth(envelopeId, month);
      record.assigned += change.assigned ?? 0;
      record.released += change.released ?? 0;
    },
    async moveBetweenEnvelopes(fromId, toId, month, amount) {
      if (amount <= 0) throw new UserFacingError("Amount must be positive");
      envelopeMonth(fromId, month).assigned -= amount;
      envelopeMonth(toId, month).assigned += amount;
    },
    async setPlanned(_householdId, envelopeId, month, planned) {
      envelopeMonth(envelopeId, month).planned = planned;
    },
    async setPlannedAmounts(_householdId, month, rows) {
      const b = budget();
      for (const row of rows) {
        if (!b.envelopes.some((e) => e.id === row.envelopeId)) {
          throw new UserFacingError("Envelope not found");
        }
        if (!Number.isSafeInteger(row.planned) || row.planned < 0) {
          throw new UserFacingError("Planned cannot be negative.");
        }
      }
      for (const row of rows) envelopeMonth(row.envelopeId, month).planned = row.planned;
    },
    async importEnvelopePlan(_householdId, month, rows) {
      const b = budget();
      const byPosition = <T extends { position: number }>(items: T[]) =>
        [...items].sort((x, y) => x.position - y.position);
      for (const row of rows) {
        let group = byPosition(b.groups).find((g) => nameKey(g.name) === nameKey(row.group));
        if (!group) {
          group = { id: id(), name: row.group.trim(), position: nextPosition(b.groups) };
          b.groups.push(group);
        }
        const siblings = b.envelopes.filter((e) => e.groupId === group.id);
        let envelope = byPosition(siblings).find((e) => nameKey(e.name) === nameKey(row.envelope));
        if (!envelope) {
          envelope = {
            id: id(),
            groupId: group.id,
            name: row.envelope.trim(),
            position: nextPosition(siblings),
            cardAccountId: null,
          };
          b.envelopes.push(envelope);
        }
        envelopeMonth(envelope.id, month).planned = row.planned;
      }
    },

    async saveTransaction(_householdId, input) {
      const b = budget();
      const lines = input.allocations;
      if (lines.some((a) => b.envelopes.find((e) => e.id === a.envelopeId)?.cardAccountId)) {
        throw new UserFacingError(
          "A card's payment envelope fills itself; choose another envelope",
        );
      }
      if (lines.some((a) => !b.envelopes.some((e) => e.id === a.envelopeId))) {
        throw new UserFacingError("Envelope not found");
      }
      if (lines.length > MAX_SPLIT_LINES) {
        throw new UserFacingError(`Split into at most ${MAX_SPLIT_LINES} envelopes`);
      }
      if (new Set(lines.map((a) => a.envelopeId)).size !== lines.length) {
        throw new UserFacingError("Each envelope can appear only once in a split");
      }
      if (input.isIncome && (input.amount <= 0 || lines.length > 0)) {
        throw new UserFacingError("Income is money coming in, without an envelope");
      }
      const account = b.accounts.find((a) => a.id === input.accountId);
      if (account && !account.onBudget && (lines.length > 0 || input.isIncome)) {
        throw new UserFacingError(TRACKING_ALONE);
      }
      const onCard = account?.type === "credit_card";
      if (onCard && input.amount > 0 && (lines.length > 0 || input.isIncome)) {
        throw new UserFacingError(
          "A card credit lowers what you owe; it cannot go in an envelope or be Income",
        );
      }
      if (lines.some((a) => a.amount === 0 || Math.sign(a.amount) !== Math.sign(input.amount))) {
        throw new UserFacingError("Every line of a split goes the same way as the transaction");
      }
      const sum = lines.reduce((total, a) => total + a.amount, 0);
      if (lines.length > 0 && sum !== input.amount) {
        throw new UserFacingError(
          `Allocations (${sum}) must sum to the transaction amount (${input.amount})`,
        );
      }
      if (input.id) releaseTransfer(input.id);
      const previous = b.transactions.find((t) => t.id === input.id);
      const tx = {
        id: input.id ?? id(),
        accountId: input.accountId,
        date: input.date,
        amount: input.amount,
        payee: input.payee,
        memo: input.memo,
        isTransfer: false,
        isIncome: input.isIncome,
        transferId: null,
        voided: false,
        allocations: lines.map((a) => ({ ...a })),
        importKey: previous?.importKey ?? null,
        reconciled: previous?.reconciled ?? false,
      };
      const index = b.transactions.findIndex((t) => t.id === tx.id);
      if (index >= 0) b.transactions[index] = tx;
      else b.transactions.unshift(tx);
      b.transactions.sort((x, y) => y.date.localeCompare(x.date));
    },
    async importTransactions(accountId, format, rows) {
      const b = budget();
      const account = b.accounts.find((a) => a.id === accountId);
      if (!account) throw new UserFacingError("Account not found");
      if (account.closedAt) throw new UserFacingError("That account is closed");
      const keys = new Set(
        b.transactions.filter((t) => t.accountId === accountId).map((t) => t.importKey),
      );
      // Like the SQL function: every match must still fit, or nothing is saved.
      const matches = rows.flatMap((row) => {
        if (row.matchId === null) return [];
        const tx = b.transactions.find((t) => t.id === row.matchId);
        const fits =
          tx?.accountId === accountId &&
          tx.importKey === null &&
          !tx.voided &&
          tx.amount === row.amount &&
          !keys.has(row.importKey);
        if (!fits) throw new UserFacingError(MATCH_CHANGED);
        return [{ tx, importKey: row.importKey }];
      });
      if (new Set(matches.map((m) => m.tx)).size !== matches.length) {
        throw new UserFacingError(MATCH_CHANGED);
      }
      for (const { tx, importKey } of matches) {
        tx.importKey = importKey;
        keys.add(importKey);
      }
      let added = matches.length;
      for (const row of rows) {
        if (row.matchId !== null || keys.has(row.importKey)) continue;
        keys.add(row.importKey);
        b.transactions.push({
          id: id(),
          accountId,
          date: row.date,
          amount: row.amount,
          payee: row.payee,
          memo: row.memo,
          isTransfer: false,
          isIncome:
            row.isIncome && row.amount > 0 && account.type !== "credit_card" && account.onBudget,
          transferId: null,
          voided: false,
          allocations: [],
          importKey: row.importKey,
          reconciled: false,
        });
        added++;
      }
      b.transactions.sort((x, y) => y.date.localeCompare(x.date));
      account.importFormat = structuredClone(format);
      return added;
    },
    async addIncomeRule(_householdId, rule) {
      budget().incomeRules.push({ id: id(), ...rule });
    },
    async deleteIncomeRule(ruleId) {
      const b = budget();
      b.incomeRules = b.incomeRules.filter((r) => r.id !== ruleId);
    },
    async markIncome(transactionIds) {
      let marked = 0;
      // Cards and tracking accounts never have Income.
      const canBeIncome = new Set(
        budget()
          .accounts.filter((a) => a.type !== "credit_card" && a.onBudget)
          .map((a) => a.id),
      );
      for (const tx of budget().transactions) {
        if (
          transactionIds.includes(tx.id) &&
          canBeIncome.has(tx.accountId) &&
          tx.amount > 0 &&
          !tx.isTransfer &&
          !tx.isIncome &&
          !tx.voided &&
          tx.allocations.length === 0
        ) {
          tx.isIncome = true;
          marked++;
        }
      }
      return marked;
    },
    async setReconciled(transactionIds, reconciled) {
      if (transactionIds.length > 2000) {
        throw new UserFacingError("Reconcile at most 2000 transactions at once");
      }
      let changed = 0;
      for (const tx of budget().transactions) {
        if (transactionIds.includes(tx.id) && tx.reconciled !== reconciled) {
          tx.reconciled = reconciled;
          changed++;
        }
      }
      return changed;
    },
    async saveTransfer(input) {
      const b = budget();
      const [first, second] = input.sides;
      const accounts = input.sides.map((side) =>
        b.accounts.find((a) => a.id === side.accountId && !a.closedAt),
      );
      if (accounts.some((a) => !a)) throw new UserFacingError("Account not found or closed");
      if (accounts.some((a) => !a!.onBudget)) throw new UserFacingError(TRACKING_ALONE);
      if (first.accountId === second.accountId || first.amount + second.amount !== 0) {
        throw new UserFacingError(
          "A transfer needs two sides in different accounts that cancel out",
        );
      }
      const transferId = input.transferId ?? id();
      const ids = input.sides.map((side) => side.id).filter(Boolean);
      if (
        b.transactions.some(
          (t) => ids.includes(t.id) && t.transferId && t.transferId !== transferId,
        )
      ) {
        throw new UserFacingError("That transaction is already part of another transfer");
      }
      // Sides this transfer had that it no longer has.
      for (const old of b.transactions.filter(
        (t) => t.transferId === transferId && !ids.includes(t.id),
      )) {
        release(old);
      }
      for (const side of input.sides) {
        const existing = side.id ? b.transactions.find((t) => t.id === side.id) : undefined;
        if (side.id && !existing) throw new UserFacingError("Transaction not found");
        const tx = {
          id: side.id ?? id(),
          accountId: side.accountId,
          date: side.date,
          amount: side.amount,
          payee: side.payee,
          memo: side.memo,
          isTransfer: true,
          isIncome: false,
          transferId,
          voided: false,
          allocations: [],
          importKey: existing?.importKey ?? null,
          reconciled: existing?.reconciled ?? false,
        };
        if (existing) Object.assign(existing, tx);
        else b.transactions.push(tx);
      }
      b.transactions.sort((x, y) => y.date.localeCompare(x.date));
    },
    async deleteTransaction(transactionId) {
      releaseTransfer(transactionId);
      const b = budget();
      b.transactions = b.transactions.filter((t) => t.id !== transactionId);
    },

    // The memory store keeps no created_at or source: an import key stands
    // for "came from a bank file", as in `release` above.
    async exportBackup() {
      const b = budget();
      return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exported_at: new Date().toISOString(),
        app_version: APP_VERSION,
        household: { name: b.household.name },
        accounts: b.accounts.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          opening_balance: a.openingBalance,
          opening_date: a.openingDate,
          on_budget: a.onBudget,
          closed_at: a.closedAt,
          import_format: a.importFormat && structuredClone(a.importFormat),
          created_at: null,
        })),
        category_groups: b.groups.map((g) => ({ ...g, created_at: null })),
        categories: b.envelopes.map((e) => ({
          id: e.id,
          group_id: e.groupId,
          name: e.name,
          position: e.position,
          card_account_id: e.cardAccountId,
          created_at: null,
        })),
        category_months: b.envelopeMonths.map((m) => ({
          category_id: m.envelopeId,
          month: m.month,
          assigned: m.assigned,
          released: m.released,
          planned: m.planned,
        })),
        transactions: b.transactions.map((t) => ({
          id: t.id,
          account_id: t.accountId,
          date: t.date,
          amount: t.amount,
          payee: t.payee,
          memo: t.memo,
          is_transfer: t.isTransfer,
          is_income: t.isIncome,
          transfer_id: t.transferId,
          voided: t.voided,
          import_key: t.importKey,
          reconciled: t.reconciled,
          source: t.importKey === null ? ("manual" as const) : ("csv" as const),
          created_at: null,
        })),
        transaction_allocations: b.transactions.flatMap((t) =>
          t.allocations.map((a) => ({
            transaction_id: t.id,
            category_id: a.envelopeId,
            amount: a.amount,
          })),
        ),
        income_rules: b.incomeRules.map((r) => ({
          pattern: r.pattern,
          account_id: r.accountId,
          created_at: null,
        })),
      };
    },
    async restoreBackup(_householdId, backup) {
      const b = budget();
      if (!isEmptyHousehold(b)) throw new UserFacingError(NOT_EMPTY);
      const file = withFreshIds(validateBackup(structuredClone(backup)));
      const linesOf = (transactionId: string) =>
        file.transaction_allocations
          .filter((x) => x.transaction_id === transactionId)
          .map((x) => ({ envelopeId: x.category_id, amount: x.amount }));
      data = {
        household: { id: b.household.id, name: file.household.name.trim() },
        accounts: file.accounts.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          openingBalance: a.opening_balance,
          openingDate: a.opening_date,
          onBudget: a.on_budget,
          closedAt: a.closed_at,
          importFormat: asImportFormat(a.import_format ?? null),
        })),
        groups: file.category_groups.map((g) => ({ id: g.id, name: g.name, position: g.position })),
        envelopes: file.categories.map((e) => ({
          id: e.id,
          groupId: e.group_id,
          name: e.name,
          position: e.position,
          cardAccountId: e.card_account_id,
        })),
        envelopeMonths: file.category_months.map((m) => ({
          envelopeId: m.category_id,
          month: m.month,
          assigned: m.assigned,
          released: m.released,
          planned: m.planned,
        })),
        transactions: file.transactions
          .map((t) => ({
            id: t.id,
            accountId: t.account_id,
            date: t.date,
            amount: t.amount,
            payee: t.payee,
            memo: t.memo,
            isTransfer: t.is_transfer,
            isIncome: t.is_income,
            transferId: t.transfer_id,
            voided: t.voided,
            allocations: linesOf(t.id),
            importKey: t.import_key,
            reconciled: t.reconciled,
          }))
          .sort((x, y) => y.date.localeCompare(x.date)),
        incomeRules: file.income_rules.map((r) => ({
          id: id(),
          pattern: r.pattern,
          accountId: r.account_id,
        })),
      };
    },
  };
}
