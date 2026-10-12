/**
 * DataStore that keeps everything in memory. Used only for UI tests
 * (`VITE_DATA_STORE=memory`), so Playwright can exercise every screen without
 * a real Supabase project. It mirrors the database rules the UI relies on.
 */
import { UserFacingError, type DataStore, type UserSession } from "./dataStore";
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
      budget().accounts.push({ id: id(), ...account, onBudget: true, closedAt: null });
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

    async saveTransaction(_householdId, input) {
      const b = budget();
      if (input.isTransfer && input.envelopeId) {
        throw new UserFacingError("A transfer cannot be assigned to an envelope");
      }
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
      };
      const index = b.transactions.findIndex((t) => t.id === tx.id);
      if (index >= 0) b.transactions[index] = tx;
      else b.transactions.unshift(tx);
      b.transactions.sort((x, y) => y.date.localeCompare(x.date));
    },
    async deleteTransaction(transactionId) {
      const b = budget();
      b.transactions = b.transactions.filter((t) => t.id !== transactionId);
    },
  };
}
