import { useMemo, useState } from "react";
import { CsvError } from "../models/csv";
import { UserFacingError } from "../models/dataStore";
import { previewEnvelopePlan, type PlanPreview } from "../models/envelopePlan";
import { currentMonth, formatMonth, isMonth, type Month } from "../models/month";
import { budgetHref } from "../models/routes";
import type { BudgetData } from "../models/types";
import type { Budget } from "./useBudget";

const MAX_FILE_BYTES = 1_000_000;

type Loaded = { fileName: string; text: string };
type Done = { month: Month; count: number };

/**
 * Settings → Import envelope plan: pick a month and a CSV, see a preview,
 * then import. The preview is recomputed whenever the month or the saved
 * budget changes, so it always compares against what is stored now.
 */
export function useEnvelopePlanImport(budget: Budget, data: BudgetData) {
  const [month, setMonth] = useState<Month>(currentMonth);
  const [file, setFile] = useState<Loaded | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const result = useMemo((): { preview: PlanPreview } | { error: string } | null => {
    if (!file) return null;
    try {
      return { preview: previewEnvelopePlan(data, month, file.text) };
    } catch (error) {
      if (error instanceof CsvError) return { error: error.message };
      throw error;
    }
  }, [data, month, file]);

  const preview = result && "preview" in result ? result.preview : null;

  return {
    month,
    monthLabel: formatMonth(month),
    fileName: file?.fileName ?? null,
    preview,
    error: fileError ?? (result && "error" in result ? result.error : null),
    done: done && {
      ...done,
      monthLabel: formatMonth(done.month),
      href: budgetHref(done.month),
    },

    /** Accepts a month input's value ("YYYY-MM"); ignores a cleared field. */
    chooseMonth: (value: string) => {
      if (isMonth(value)) setMonth(value);
    },

    chooseFile: async (chosen: File | null) => {
      setDone(null);
      setFileError(null);
      setFile(null);
      if (!chosen) return;
      if (chosen.size > MAX_FILE_BYTES) {
        setFileError("That file is too large for a plan (over 1 MB).");
        return;
      }
      setFile({ fileName: chosen.name, text: await chosen.text() });
    },

    clear: () => {
      setFile(null);
      setFileError(null);
    },

    importPlan: async () => {
      if (!preview || preview.rows.length === 0) {
        throw new UserFacingError("There are no valid rows to import.");
      }
      const rows = preview.rows.map(({ group, envelope, planned }) => ({
        group,
        envelope,
        planned,
      }));
      await budget.change((store) =>
        store.importEnvelopePlan(data.household.id, preview.month, rows),
      );
      setFile(null);
      setDone({ month: preview.month, count: rows.length });
    },
  };
}
