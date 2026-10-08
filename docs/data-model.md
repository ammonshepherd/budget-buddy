# Data model and money rules

All amounts are signed integer cents (two-decimal currencies). Account inflows are positive; outflows are negative. Allocation amounts use the same sign as their parent. Each record belongs to one household; composite foreign keys prevent references to another household’s accounts/categories. Auth users are managed by Supabase, not a duplicate password table.

| Table | Columns and purpose |
| --- | --- |
| `households` | `id`: shared-budget identity; `name`: display name; `currency`: one display currency; `start_month`: first category-budget month; `revision`: optimistic concurrency counter; `created_at`: setup timestamp. Starting month/currency are fixed after setup. |
| `household_members` | `household_id`, `user_id`: connect a managed Auth user to the shared budget; `role`: owner or member. Each user belongs to one household in this initial release. Both can edit finances; only the owner adds members or transfers ownership. |
| `accounts` | `id`, `household_id`: identity/ownership; `name`: label; `type`: cash, credit or tracking; `on_budget`: whether it participates in envelopes; `opening_balance`: signed baseline; `opening_date`: inclusive start of new account movements; `archived`: hide from new-entry choices while retaining history. Only on-budget cash funds Assignable. |
| `category_groups` | `id`, `household_id`: identity/ownership; `name`: group heading; `position`: display order; `archived`: preserve the group while retiring it. Categories must be moved or archived before their group is archived. |
| `categories` | `id`, `household_id`: identity/ownership; `group_id`: change this to reassign a group; `name`: envelope label; `kind`: spending or card_payment; `card_account_id`: unique linked budget card for automatic payment reserves; `position`: display order; `archived`: preserve financial history/reservations. Category kind/card link are immutable. |
| `category_months` | `household_id`, `category_id`, `month`: one row per envelope/month; `assigned`: manually committed funds, including explicit Saved moves; `planned`: forecast without moving cash; `saved_used`: cumulative Saved moved into Assigned during this month. Spent, Remaining and Saved are derived, not editable balances. |
| `transactions` | `id`, `household_id`, `account_id`: account ledger identity; `date`: purchase/budget date; `posted_date`: optional bank settlement date/baseline cutoff; `amount`: single signed account movement; `payee`, `note`, `check_number`, `tags`: user details; `kind`: expense, refund, income, transfer or adjustment; `funding`: funded, needs_funding or not_required; `status`: active, voided or merged; `transfer_id`: links exactly two equal opposite active entries; `merged_into_id`: retained match parent; `source`: manual or csv; `external_id`: unique active bank ID per account; `original_description`, `import_data`: bank text and all original CSV fields; `created_at`, `updated_at`: record timestamps. Only active rows affect balances. |
| `transaction_allocations` | `household_id`, `transaction_id`, `position`: child identity/order; `category_id`: split envelope; `amount`: signed part of the parent. All splits total exactly the parent amount. Pending imports can have no allocation until resolved. Only funded allocations participate in category spending. |

There is no separate transfer, reconciliation or import-batch table. Transfers are paired ledger rows; matches retain both source rows; original CSV columns are saved as JSON. The Auth user’s `user_metadata.display_name` stores the profile name. Supabase manages passwords and email changes.

## Equations

For an account, eligible active entries satisfy `opening_date ≤ posted_date-or-date ≤ today`:

```
Account balance = Opening balance + Σ eligible transaction amounts
Budget cash = Σ balances of on-budget cash accounts
Split total = Σ allocation amounts = parent transaction amount
```

For a category/month (all spending terms below use funded eligible budget transactions only):

```
Spent = −Σ category allocation amounts
Effective Assigned = Manual Assigned + Automatic card reserve additions
Remaining / Available = Effective Assigned − Spent
Saved at start of month = Previous Saved + Previous Remaining
Saved displayed = Saved at start of month − Saved used this month
Total reserved = Σ(Saved + Remaining) at the latest budget month
Assignable = Budget cash − Total reserved
```

The latest month includes future assignments; money cannot be assigned again just by changing the selected month. Planned changes no balance. Saved accumulates untouched across months. Moving Saved to Assigned increases manual Assigned and Saved used by the same amount; Remaining increases, Saved decreases, and Assignable stays unchanged. Ordinary reallocation decreases donor manual Assigned and increases recipient manual Assigned equally, with the donor’s Available checked first. Automatically reserved card-purchase money cannot be redirected by making manual Assigned negative.

## Credit cards and actual cash

A funded card purchase spends its chosen envelope and adds the same amount to that card’s payment category’s Assigned. Account cash stays unchanged, so this reserves actual cash for the eventual payment. A checking-to-card transfer spends the payment category on the outgoing side and lowers card debt on the incoming side; it does not count the original purchase again. Opening card debt can be funded by manual assignments to the payment category. Prior-month payment reserves are Saved and require the same explicit move into Assigned before payment.

A categorized card refund reverses envelope spending and releases a matching available card reserve. If that reserve is in Saved, move it into Assigned first. If the charge has already been paid and no reserve can be released, record the card credit as a balance adjustment: it reduces debt or creates a card credit, without inventing cash in envelopes. An actual refund deposited into a cash account can then be recorded in that cash account.

Unfunded imported charges affect their account balances immediately, even when there is no category allocation. They are excluded from Spent and remain flagged until resolved. A real cash shortage may therefore make Assignable negative, while all category Remaining/Saved stay nonnegative. New assignments cannot deepen that shortage by increasing reservations. Existing bank facts are not discarded to make the budget appear funded.

## Atomic writes and security

`save_budget_state` verifies the signed-in membership and expected revision, locks that household row, applies normalized changes in one transaction, then independently validates split sums, transfer pairs, account/card links, all affected monthly balances, and available budget cash. Any error rolls back all rows. A stale edit cannot overwrite another user’s newer snapshot. IDs cannot be used to update another household; omission cannot delete history. Direct financial table writes are revoked from browser roles. Read policies use membership checks, with indexes on household/account/category references.

Archive flags implement reversible deletion for accounts/categories/groups, and void flags remove transactions from the active ledger. A void/edit of an old transaction is rejected when it would make a later balance negative; reallocate/release affected reserves first. A confirmed match retains the user’s canonical row/splits and a separate non-counting merged bank record. A bank ID cannot appear twice among active rows for one account.

Deleting a regular sign-in user retains the shared budget. Deleting a sole owner deletes their household data inside the same database transaction as the Auth deletion. An owner with other members must transfer ownership first. The privileged deletion credential is confined to the Edge Function.
