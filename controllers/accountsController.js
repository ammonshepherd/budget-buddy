import { setPageStatus } from "./pageController.js";

export function initializeAccountsPage() {
  document
    .querySelector("#accounts-action")
    ?.addEventListener("click", () => {
      setPageStatus("Account management will be added in a future version.");
    });
}
