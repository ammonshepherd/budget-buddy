import { useMemo, useState } from "react";
import { CsvError, parseCsv } from "../models/csv";
import { UserFacingError } from "../models/dataStore";
import {
  columnLabels,
  formatFor,
  formatProblem,
  previewTransactionImport,
  readTable,
  type CsvTable,
  type ImportFormat,
} from "../models/transactionImport";
import { monthOf } from "../models/month";
import { accountsHref } from "../models/routes";
import type { BudgetData } from "../models/types";
import type { Budget } from "./useBudget";

const MAX_FILE_BYTES = 2_000_000;

type Loaded = { fileName: string; table: CsvTable };
type Done = {
  accountName: string;
  added: number;
  /** Typed-in transactions matched to bank rows. */
  matched: number;
  alreadyThere: number;
  /** The account's page on Accounts, where the imported rows wait for review. */
  reviewHref: string;
};

/**
 * Settings → Import transactions: choose an account and a bank CSV, check
 * (or fix) which column is which, review the preview, then import. The
 * column choices start from the account's saved format when the file
 * matches it, otherwise from what detectFormat guesses. Rows that match a
 * typed-in transaction are matched to it unless the user keeps them separate.
 */
export function useTransactionImport(budget: Budget, data: BudgetData, startAccountId?: string) {
  const openAccounts = data.accounts.filter((a) => !a.closedAt);
  const [accountId, setAccountId] = useState(startAccountId ?? openAccounts[0]?.id ?? "");
  const [file, setFile] = useState<Loaded | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  /** The user's column changes; null = use the saved or detected format. */
  const [edited, setEdited] = useState<ImportFormat | null>(null);
  /** Lines of matched rows to import as new transactions instead. */
  const [separate, setSeparate] = useState<ReadonlySet<number>>(new Set());
  const [done, setDone] = useState<Done | null>(null);

  // Falls back to the first open account (e.g. one added after this page opened).
  const account = openAccounts.find((a) => a.id === accountId) ?? openAccounts[0];
  const suggested = useMemo(() => (file ? formatFor(account, file.table) : null), [account, file]);
  const format = edited ?? suggested?.format ?? null;
  const problem = format && formatProblem(format);
  const preview = useMemo(
    () =>
      account && file && format && !problem
        ? previewTransactionImport(data, account, file.table, format, separate)
        : null,
    [data, account, file, format, problem, separate],
  );

  return {
    openAccounts,
    accountId: account?.id ?? "",
    fileName: file?.fileName ?? null,
    columns: file ? columnLabels(file.table) : [],
    format,
    /** True when the columns come from this account's last import. */
    usingSavedFormat: !edited && suggested?.saved === true,
    problem,
    preview,
    error: fileError,
    done,

    chooseAccount: (id: string) => {
      setAccountId(id);
      setEdited(null);
      setSeparate(new Set());
      setDone(null);
    },

    chooseFile: async (chosen: File | null) => {
      setFile(null);
      setEdited(null);
      setSeparate(new Set());
      setFileError(null);
      setDone(null);
      if (!chosen) return;
      if (chosen.size > MAX_FILE_BYTES) {
        setFileError("That file is too large (over 2 MB). Export a shorter date range.");
        return;
      }
      try {
        setFile({ fileName: chosen.name, table: readTable(parseCsv(await chosen.text())) });
      } catch (error) {
        if (!(error instanceof CsvError)) throw error;
        setFileError(error.message);
      }
    },

    /** Changes one or more column choices. */
    updateFormat: (change: Partial<ImportFormat>) => {
      if (format) setEdited({ ...format, ...change });
    },

    /** Matches a row to its typed-in transaction, or imports it as new. */
    setMatched: (line: number, matched: boolean) => {
      const next = new Set(separate);
      if (matched) next.delete(line);
      else next.add(line);
      setSeparate(next);
    },

    clear: () => {
      setFile(null);
      setEdited(null);
      setSeparate(new Set());
      setFileError(null);
    },

    importNow: async () => {
      const matches = preview?.matches.filter((m) => !m.separate).map((m) => m.row) ?? [];
      if (!account || !format || !preview || preview.rows.length + matches.length === 0) {
        throw new UserFacingError("There are no new transactions to import.");
      }
      const rows = [...preview.rows, ...matches].map(
        ({ date, amount, payee, memo, importKey, isIncome, matchId }) => ({
          date,
          amount,
          payee,
          memo,
          importKey,
          isIncome,
          matchId,
        }),
      );
      let saved = 0;
      await budget.change(async (store) => {
        saved = await store.importTransactions(account.id, format, rows);
      });
      setFile(null);
      setEdited(null);
      setSeparate(new Set());
      const newest = rows.reduce((latest, row) => (row.date > latest ? row.date : latest), "");
      // Every match is saved or the import fails, so the rest were added.
      setDone({
        accountName: account.name,
        added: saved - matches.length,
        matched: matches.length,
        alreadyThere: rows.length - saved,
        reviewHref: accountsHref(account.id, monthOf(newest)),
      });
    },
  };
}
