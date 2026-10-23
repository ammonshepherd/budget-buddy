/**
 * Backs up the production database before a merge: the same JSON file that
 * Settings → Export makes (the `export_backup` SQL function), saved in
 * .backups/ (ignored by git). Only the 5 newest backups are kept.
 *
 * It runs on the database through the Supabase CLI's login (`supabase
 * login`), with no browser, app password or database password. The query
 * acts as the household's owner for that one statement, because
 * export_backup only exports for a member of the household. The CLI stays
 * linked to the test project: `--project-ref` applies to this command only.
 *
 * Restore: Settings → Restore in an empty household, choosing the file.
 * Run: npm run backup
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PRODUCTION_REF = "lkaurrcarzzkbqdwqfge";
const KEEP = 5;
const root = join(import.meta.dirname, "..");
const dir = join(root, ".backups");

// One statement: the inner query sets who is asking (the owner), then the
// outer one runs the export as them.
const SQL = `
select (select count(*) from public.households)::int as households,
       public.export_backup(s.household_id) as backup
from (
  select m.household_id,
         set_config('request.jwt.claims',
                    json_build_object('sub', m.user_id, 'role', 'authenticated')::text,
                    true) as claims
  from public.household_members m
  order by m.role = 'owner' desc
  limit 1
) s`;

function exportBackup(): Record<string, unknown> {
  const out = execFileSync(
    "npx",
    [
      "supabase",
      "db",
      "query",
      "--linked",
      "--project-ref",
      PRODUCTION_REF,
      "--output-format",
      "json",
      SQL,
    ],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 100_000_000 },
  );
  const result = JSON.parse(out) as {
    rows?: { households: number; backup: Record<string, unknown> | null }[];
    error?: { message?: string };
  };
  if (result.error) throw new Error(`The export failed: ${result.error.message ?? "unknown"}`);
  const row = result.rows?.[0];
  if (!row?.backup) throw new Error("The export returned nothing (is there a household?)");
  if (row.households !== 1) {
    throw new Error(`Expected one household, found ${row.households}; back up each by hand.`);
  }
  return row.backup;
}

const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const stamp =
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
  `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  version: string;
};
// Like the app's export: the database's JSON plus the app version.
const backup = { ...exportBackup(), app_version: version };

mkdirSync(dir, { recursive: true });
const name = `budget-buddy-backup-${stamp}.json`;
writeFileSync(join(dir, name), `${JSON.stringify(backup, null, 2)}\n`);

// The names sort by date and time, so the oldest come first.
const old = readdirSync(dir)
  .filter((f) => /^budget-buddy-backup-.*\.json$/.test(f))
  .sort()
  .reverse()
  .slice(KEEP);
for (const f of old) {
  rmSync(join(dir, f));
  console.log(`Deleted old backup ${f}`);
}

// Counts only: the file holds the household's data.
const counts = Object.entries(backup)
  .flatMap(([key, value]) => (Array.isArray(value) ? [`${value.length} ${key}`] : []))
  .join(", ");
console.log(`Backed up to .backups/${name}: ${counts}`);
