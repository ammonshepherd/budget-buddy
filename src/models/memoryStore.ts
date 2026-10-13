/**
 * DataStore that keeps everything in memory. Used only for UI tests
 * (`VITE_DATA_STORE=memory`), so Playwright can exercise every screen without
 * a real Supabase project. It mirrors the database rules the UI relies on.
 */
import { paymentEnvelopeName } from "./accounts";
import { UserFacingError, type DataStore, type UserSession } from "./dataStore";
import { nameKey } from "./envelopePlan";
import type { BudgetData, Transaction } from "./types";

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
    async signUp(email) {
      setSession({ userId: "memory-user", email });
      return false;
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
      };
    },

    async addAccount(_householdId, account) {
      const b = budget();
      const accountId = id();
      b.accounts.push({
        id: accountId,
        ...account,
        onBudget: true,
        closedAt: null,
        importFormat: null,
      });
      // Like the database trigger: a card gets its payment envelope.
      if (account.type === "credit_card") {
        let group = b.groups.find((g) => nameKey(g.name) === "credit card payments");
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
      if (b.envelopes.find((e) => e.id === input.envelopeId)?.cardAccountId) {
        throw new UserFacingError(
          "A card's payment envelope fills itself; choose another envelope",
        );
      }
      if (input.isIncome && (input.amount <= 0 || input.envelopeId)) {
        throw new UserFacingError("Income is money coming in, without an envelope");
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
        allocations: input.envelopeId
          ? [{ envelopeId: input.envelopeId, amount: input.amount }]
          : [],
        importKey: previous?.importKey ?? null,
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
      let added = 0;
      for (const row of rows) {
        if (keys.has(row.importKey)) continue;
        keys.add(row.importKey);
        b.transactions.push({
          id: id(),
          accountId,
          date: row.date,
          amount: row.amount,
          payee: row.payee,
          memo: row.memo,
          isTransfer: false,
          isIncome: false,
          transferId: null,
          voided: false,
          allocations: [],
          importKey: row.importKey,
        });
        added++;
      }
      b.transactions.sort((x, y) => y.date.localeCompare(x.date));
      account.importFormat = structuredClone(format);
      return added;
    },
    async markIncome(transactionIds) {
      let marked = 0;
      for (const tx of budget().transactions) {
        if (
          transactionIds.includes(tx.id) &&
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
    async saveTransfer(input) {
      const b = budget();
      const [first, second] = input.sides;
      const accounts = input.sides.map((side) =>
        b.accounts.find((a) => a.id === side.accountId && !a.closedAt),
      );
      if (accounts.some((a) => !a)) throw new UserFacingError("Account not found or closed");
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
  };
}
