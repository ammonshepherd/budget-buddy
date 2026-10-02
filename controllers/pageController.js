export function setPageStatus(message) {
  const status = document.querySelector("[data-page-status]");

  if (status) {
    status.textContent = message;
  }
}
