/**
 * Runs once before the integration tests (vitest "globalSetup"): reseeds the
 * test database so every run starts from the same data. Skips quietly when the
 * test database is not configured; the tests then skip themselves too.
 */
import { seedTestDb } from "../scripts/seed-test-db";
import { missingForTests, readTestEnv } from "../scripts/testEnv";
import { assertTestTarget } from "../scripts/testTarget";

export default async function setup() {
  const env = readTestEnv();
  const missing = missingForTests(env);
  if (missing) {
    console.warn(`\nIntegration tests skipped: ${missing}\n`);
    return;
  }
  assertTestTarget(env.url);
  if (!env.serviceRoleKey) {
    console.warn("\nSUPABASE_SERVICE_ROLE_KEY not set: using the data already seeded.\n");
    return;
  }
  await seedTestDb();
}
