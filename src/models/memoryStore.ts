/**
 * DataStore that keeps everything in memory. Used only for UI tests
 * (`VITE_DATA_STORE=memory`), so Playwright can exercise every screen without
 * a real Supabase project. It mirrors the database rules the UI relies on.
 */
import { UserFacingError, type DataStore, type UserSession } from "./dataStore";
import { nameKey } from "./envelopePlan";
import type { BudgetData } from "./types";

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
      budget().accounts.push({
        id: id(),
        ...account,
        onBudget: true,
        closedAt: null,
        importFormat: null,
      });
    },
    async updateAccount(accountId, { name, openingBalance, openingDate }) {
      const account = budget().accounts.find((a) => a.id === accountId);
      if (!account) throw new UserFacingError("Account not found");
      Object.assign(account, { name, openingBalance, openingDate });
    },
    async closeAccount(accountId) {
      const account = budget().accounts.find((a) => a.id === accountId);
      if (account) account.closedAt = new Date().toISOString();
    },

    async addGroup(_householdId, name, position) {
      budget().groups.push({ id: id(), name, position });
    },
    async addEnvelope(_householdId, groupId, name, position) {
      budget().envelopes.push({ id: id(), groupId, name, position });
    },
    async deleteEnvelope(envelopeId) {
      const b = budget();
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
          };
          b.envelopes.push(envelope);
        }
        envelopeMonth(envelope.id, month).planned = row.planned;
      }
    },

    async saveTransaction(_householdId, input) {
      const b = budget();
      if (input.isTransfer && input.envelopeId) {
        throw new UserFacingError("A transfer cannot be assigned to an envelope");
      }
      const previous = b.transactions.find((t) => t.id === input.id);
      const tx = {
        id: input.id ?? id(),
        accountId: input.accountId,
        date: input.date,
        amount: input.amount,
        payee: input.payee,
        memo: input.memo,
        isTransfer: input.isTransfer,
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
    async deleteTransaction(transactionId) {
      const b = budget();
      b.transactions = b.transactions.filter((t) => t.id !== transactionId);
    },
  };
}
