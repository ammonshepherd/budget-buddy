-- v0.17.2: the service role can delete a whole household. Deleting one
-- cascades through triggers that call functions in the private schema, which
-- only `authenticated` could use. The test-database seed script
-- (scripts/seed-test-db.ts) resets the test households this way. The service
-- role already bypasses Row Level Security; this only lets it run those checks.
grant usage on schema private to service_role;
