import { clone, demoState, validateState } from "./budget.js";
import { rpc } from "./auth.js";
const DEMO_KEY = "budget-buddy-demo-v1";
let state;
let demo = false;
let saving = false;
export const getState = () => state;
export const isDemo = () => demo;
export function clearState() { state = undefined; demo = false; }
export function enterDemo() {
  demo = true;
  try { state = JSON.parse(localStorage.getItem(DEMO_KEY)) || demoState(); validateState(state); }
  catch { state = demoState(); }
  return state;
}
export async function loadState() {
  if (demo) return state;
  state = await rpc("get_budget_state"); return state;
}
export async function changeState(mutator) {
  if (saving) throw new Error("Wait for the current save to finish.");
  saving = true;
  try {
    const draft = clone(state);
    await mutator(draft);
    validateState(draft, state);
    if (demo) {
      draft.household.revision++;
      localStorage.setItem(DEMO_KEY, JSON.stringify(draft)); state = draft;
    } else {
      state = await rpc("save_budget_state", { p_expected_revision: state.household.revision, p_state: draft });
    }
    return state;
  } finally { saving = false; }
}
