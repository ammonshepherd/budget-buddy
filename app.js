const installButton = document.querySelector("#install-button");
const startButton = document.querySelector("#get-started-button");
const statusMessage = document.querySelector("#status-message");

let deferredInstallPrompt;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.error("Service worker registration failed:", error);
    });
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;

  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.hidden = true;
});

startButton.addEventListener("click", () => {
  statusMessage.textContent = "The budget dashboard is coming next.";
});

window.addEventListener("appinstalled", () => {
  installButton.hidden = true;
  statusMessage.textContent = "Budget Buddy was installed.";
});
