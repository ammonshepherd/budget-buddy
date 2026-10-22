/**
 * The shared store rules (src/models/storeRules.shared.ts) against the real
 * database, as test user A in the test project (never production). The
 * integration setup reseeds before every run, clearing what these add.
 */
import { describe } from "vitest";
import { createSupabaseStore } from "../src/models/supabaseStore";
import { storeRuleTests } from "../src/models/storeRules.shared";
import { skipReason, testEnv } from "./testDb";

describe.skipIf(!!skipReason)("database follows the store rules", () => {
  storeRuleTests(async () => {
    const store = createSupabaseStore(testEnv.url, testEnv.anonKey);
    await store.signIn(testEnv.users.a.email, testEnv.users.a.password);
    return store;
  });
});
