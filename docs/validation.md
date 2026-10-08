# Version 0.1.0 validation

The implementation adds household sign-in and sharing, accounts, categories/groups, monthly assignments/plans, split transactions, linked transfers, CSV review/matching, and protected user deletion. The demo exercises the same calculations and state changes while making its separate device storage explicit.

## Executed checks

| Check | Result and coverage |
| --- | --- |
| Node unit tests | **18 passed.** Exact cents, strict funding, Saved rollover/use, reallocation, split totals, card purchase reserves/payments, unfunded imports, transfers and bank-pair conversion, opening cutoffs, future-baseline rejection, later-month validation, group reassignment, CSV quoting/dates/mapping, and retained matching evidence. |
| Build and module parsing | Static PWA build succeeds; app/model/controller/tooling modules parse; git whitespace check passes. Build requires no dependency installation and rejects privileged browser keys. |
| PostgreSQL 17 | Both migrations apply. Integration tests pass for table-write denial, household RLS, membership sharing, revision rejection, funding enforcement, exact split totals, history preservation, ownership transfer/deletion guards, member deletion retaining shared history and sole-owner cleanup. Independent SQL-vs-JavaScript comparisons pass for Saved, card reserves, card payments, split purchases, adjustments and pending bank charges. |
| Mobile and desktop browser tests | **12 passed** across Pixel 7 and Desktop Chrome projects. Four pages, form interactions, blocked purchase → reallocation → save, one ledger parent for splits, category searches, account/card setup, category reassignment, CSV preview/import/funding, real REST-adapter sign-in/setup/save/refresh/profile/sign-out, Saved movement and month persistence. |
| Automated accessibility | Axe WCAG 2 A/AA, 2.1 AA and 2.2 AA scans report no violations in the tested pages and dialogs. Native dialog Escape handling/focus return and keyboard focus containment are tested. Viewport overflow is checked. |
| PWA cache behavior | Installed service worker caches the explicit shell. API paths do not enter the cache and API failures do not fall back to HTML. The demo shell reloads offline. All built assets contribute to the cache version, including logo files. |

The passing implementation run is [Checks, 2026-10-08](https://github.com/ammonshepherd/budget-buddy/actions/runs/37712931619). Its **browser-report-12-passed** artifact includes the HTML test report and mobile/desktop Settings screenshots. Later commits add input validation/documentation; their checks are visible on [PR #4](https://github.com/ammonshepherd/budget-buddy/pull/4).

## Practical limits

The Browser plugin was unavailable in this workspace. Package/browser downloads and PostgreSQL installation were also unavailable locally, so Node/build checks ran locally and the actual PostgreSQL/browser checks ran in GitHub Actions. Browser Auth tests use an HTTP fixture; database calculations and permissions run against real PostgreSQL. No live Supabase project or production data was touched.

Automated accessibility tests are not full WCAG certification. Physical iOS/Android installation, launcher-icon behavior, VoiceOver/TalkBack, and real SMTP/password-reset delivery still need device/project review. Live use also requires the Supabase configuration, migrations, manually created users and deletion Edge Function described in the README. Dates use UTC in this initial release.
