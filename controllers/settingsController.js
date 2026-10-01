import { setPageStatus } from "./pageController.js";

export function initializeSettingsPage() {
  document
    .querySelector("#settings-action")
    ?.addEventListener("click", () => {
      setPageStatus("Settings will be added in a future version.");
    });
}
