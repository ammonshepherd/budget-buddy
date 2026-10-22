import { describe } from "vitest";
import { createMemoryStore } from "./memoryStore";
import { storeRuleTests } from "./storeRules.shared";

describe("memory store follows the database rules", () => {
  storeRuleTests(async () => {
    const store = createMemoryStore();
    await store.signIn("test@example.com", "password123");
    await store.createHousehold("Home");
    return store;
  });
});
