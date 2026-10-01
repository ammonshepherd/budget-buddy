import { setPageStatus } from "./pageController.js";

export function initializeBudgetPage() {
  document
    .querySelector("#budget-action")
    ?.addEventListener("click", () => {
      setPageStatus("Budget actions will be added in a future version.");
    });
}
