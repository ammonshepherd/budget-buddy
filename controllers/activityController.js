import { setPageStatus } from "./pageController.js";

export function initializeActivityPage() {
  document
    .querySelector("#activity-action")
    ?.addEventListener("click", () => {
      setPageStatus("Transaction activity will be added in a future version.");
    });
}
