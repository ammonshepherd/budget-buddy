import { useCallback, useEffect, useState } from "react";
import type { DataStore } from "../models/dataStore";
import type { BudgetData } from "../models/types";
import { messageOf } from "./errors";
import { requireName } from "./input";

export type BudgetState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "noHousehold" }
  | { status: "ready"; data: BudgetData };

export interface Budget {
  state: BudgetState;
  /**
   * Runs a change against the store, then reloads so every page sees it.
   * With `predict`, pages show the predicted data at once (an optimistic
   * update); the reload then replaces it, or undoes it if the change failed.
   */
  change: (
    apply: (store: DataStore, data: BudgetData) => Promise<void>,
    predict?: (data: BudgetData) => BudgetData,
  ) => Promise<void>;
  createHousehold: (name: string) => Promise<void>;
  reload: () => Promise<void>;
}

const toState = (data: BudgetData | null): BudgetState =>
  data ? { status: "ready", data } : { status: "noHousehold" };

/**
 * Loads the signed-in household's budget and applies changes to it. After
 * each change the data is reloaded from the store, so what the pages show is
 * always what was saved.
 */
export function useBudget(store: DataStore): Budget {
  const [state, setState] = useState<BudgetState>({ status: "loading" });

  const reload = useCallback(async () => {
    try {
      setState(toState(await store.load()));
    } catch (error) {
      setState({ status: "error", error: messageOf(error) });
    }
  }, [store]);

  // First load. `active` ignores a result that arrives after unmounting.
  useEffect(() => {
    let active = true;
    store.load().then(
      (data) => active && setState(toState(data)),
      (error: unknown) => active && setState({ status: "error", error: messageOf(error) }),
    );
    return () => {
      active = false;
    };
  }, [store]);

  const change = useCallback(
    async (
      apply: (store: DataStore, data: BudgetData) => Promise<void>,
      predict?: (data: BudgetData) => BudgetData,
    ) => {
      if (state.status !== "ready") throw new Error("Budget is not loaded");
      if (predict) setState({ status: "ready", data: predict(state.data) });
      try {
        await apply(store, state.data);
      } finally {
        await reload();
      }
    },
    [store, state, reload],
  );

  const createHousehold = useCallback(
    async (name: string) => {
      await store.createHousehold(requireName(name, "Household name"));
      await reload();
    },
    [store, reload],
  );

  return { state, change, createHousehold, reload };
}
