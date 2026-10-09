import { initializeAccountsPage } from "./accountsController.js";
import { initializeActivityPage } from "./activityController.js";
import { initializeBudgetPage } from "./budgetController.js";
import { initializeSettingsPage } from "./settingsController.js";

export const APP_VERSION = "0.0.1";

const routes = {
  budget: {
    title: "Budget",
    view: "./views/budget.html",
    initialize: initializeBudgetPage
  },
  accounts: {
    title: "Accounts",
    view: "./views/accounts.html",
    initialize: initializeAccountsPage
  },
  activity: {
    title: "Activity",
    view: "./views/activity.html",
    initialize: initializeActivityPage
  },
  settings: {
    title: "Settings",
    view: "./views/settings.html",
    initialize: initializeSettingsPage
  }
};

export function initializeApp() {
  document.querySelector("#app-version").textContent = `v${APP_VERSION}`;

  window.addEventListener("hashchange", renderRoute);
  renderRoute();
}

async function renderRoute() {
  const requestedRoute = window.location.hash.slice(1).toLowerCase();
  const routeName = routes[requestedRoute] ? requestedRoute : "budget";
  const route = routes[routeName];
  const app = document.querySelector("#app");

  updateNavigation(routeName);
  document.title = `${route.title} | Budget Buddy`;
  app.innerHTML = '<p class="loading-message">Loading...</p>';

  try {
    const response = await fetch(route.view);

    if (!response.ok) {
      throw new Error(`Could not load ${route.view}`);
    }

    app.innerHTML = await response.text();
    route.initialize();
  } catch (error) {
    console.error("Page loading failed:", error);
    app.innerHTML = `
      <section class="page-view error-page">
        <p class="eyebrow">Something went wrong</p>
        <h1>Page unavailable</h1>
        <p>Budget Buddy could not load this page. Please try again.</p>
      </section>
    `;
  }
}

function updateNavigation(activeRoute) {
  document.querySelectorAll("[data-route]").forEach((link) => {
    const isActive = link.dataset.route === activeRoute;
    link.classList.toggle("active", isActive);

    if (isActive) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}
