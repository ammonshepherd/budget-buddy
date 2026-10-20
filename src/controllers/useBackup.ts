import { useState } from "react";
import {
  backupFileName,
  BackupError,
  isEmptyHousehold,
  NOT_EMPTY,
  parseBackup,
  summarizeBackup,
  type Backup,
  type BackupSummary,
} from "../models/backup";
import { UserFacingError } from "../models/dataStore";
import { todayIso } from "../models/month";
import type { BudgetData } from "../models/types";
import type { Budget } from "./useBudget";

/** Large enough for years of a household's transactions. */
const MAX_FILE_BYTES = 20_000_000;

type Chosen = { fileName: string; backup: Backup; summary: BackupSummary };

/** Hands the browser a file to save. */
function download(fileName: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  // Give the browser a moment to start the download before freeing it.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Settings → Backup: export everything to one JSON file, or restore such a
 * file into this household while it is still empty.
 */
export function useBackup(budget: Budget, data: BudgetData) {
  const [exported, setExported] = useState<{ fileName: string; summary: BackupSummary } | null>(
    null,
  );
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [restored, setRestored] = useState<BackupSummary | null>(null);

  return {
    exported,
    chosen,
    fileError,
    restored,
    /** Restoring only works before anything has been added. */
    canRestore: isEmptyHousehold(data),

    exportAll: async () => {
      const result: { backup?: Backup } = {};
      await budget.change(async (store) => {
        result.backup = await store.exportBackup(data.household.id);
      });
      const { backup } = result;
      if (!backup) throw new Error("The export returned nothing");
      const fileName = backupFileName(todayIso());
      download(fileName, `${JSON.stringify(backup, null, 2)}\n`);
      setExported({ fileName, summary: summarizeBackup(backup) });
    },

    chooseFile: async (file: File | null) => {
      setChosen(null);
      setFileError(null);
      setRestored(null);
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) {
        setFileError("That file is too large for a Budget Buddy backup (over 20 MB).");
        return;
      }
      try {
        const backup = parseBackup(await file.text());
        setChosen({ fileName: file.name, backup, summary: summarizeBackup(backup) });
      } catch (error) {
        if (error instanceof BackupError) setFileError(error.message);
        else throw error;
      }
    },

    clear: () => {
      setChosen(null);
      setFileError(null);
    },

    restore: async () => {
      if (!chosen) throw new UserFacingError("Choose a backup file first.");
      if (!isEmptyHousehold(data)) throw new UserFacingError(NOT_EMPTY);
      await budget.change((store) => store.restoreBackup(data.household.id, chosen.backup));
      setRestored(chosen.summary);
      setChosen(null);
    },
  };
}
