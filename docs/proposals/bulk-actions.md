# Proposal: selecting several transactions and acting on them at once

Status: **not decided, not built.** Written 2026-10-15 against v0.25.0.
Nothing here changes the app until the owner answers the open decisions below.

## The request

Select several transactions (say five) and apply one action to all of them:
delete, move to a different account, clear, reconcile, or assign to the same
envelope. The actions show on a bar above the bottom navigation; when there
are too many for the screen, a ⋯ menu pops up a list of them. Every action
asks for confirmation first.

## What it would take

### Shared groundwork (needed for any action)

- **A select mode on Activity.** Tapping a payee opens the edit dialog today,
  so selecting needs its own mode: a "Select" button near the month band. In
  select mode, a checkbox takes the place of the status mark, tapping a row
  toggles it, and Cancel or Escape leaves the mode. (Long-press is harder to
  discover, and on iPhone it fights the system's text-selection menu.)
- **The action bar above the bottom nav.** It shows "N selected", two main
  actions (Envelope, Delete) and a ⋯ menu for the rest (Move to account, Mark
  cleared, Reconcile, Mark as Income, Select all or none). At phone width
  that is about all that fits. The floating + button sits in the same corner,
  so it should hide while selecting. Mind the iOS safe area at the bottom.
- **A confirmation dialog for every action.** It gives the count, the total,
  and what will be skipped and why (for example "2 of 7 can't take an
  envelope: 1 transfer, 1 card credit"). The existing "Mark all as Income"
  uses `window.confirm`, which can't show that much, so this should be a real
  `<dialog>`.
- **Each action saves as one all-or-nothing step.** That means one new SQL
  function per action, the matching rules in `memoryStore.ts`, and
  integration tests. This follows the existing pattern (`markIncome(ids)`
  already works this way), and the page reloads once per action.

### Per action, from easiest to hardest

| Action                  | Difficulty              | What gets in the way                                                                                                                                                                                            |
| ----------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mark as Income          | Trivial                 | `store.markIncome(ids)` already takes a list; it only needs a button.                                                                                                                                           |
| Delete                  | Easy                    | Problems 1–3 below.                                                                                                                                                                                             |
| Assign to one envelope  | Hard                    | The cover prompt (problem 4) and mixed selections (problem 5).                                                                                                                                                  |
| Clear                   | Needs a database change | There's no stored cleared status. Activity's mark only reflects whether a row was imported (`src/models/activity.ts`, `tx.importKey ? "cleared" : "uncleared"`), so this needs a status column and a migration. |
| Reconcile               | Needs a design first    | Reconciliation isn't designed (SPEC §9).                                                                                                                                                                        |
| Move to another account | Hard and risky          | Problem 6 below.                                                                                                                                                                                                |

## Problems to expect

1. **Deleting an imported row means it can come back.** Duplicate prevention
   relies on the row's `import_key`. Once the row is deleted, the next import
   of an overlapping CSV adds it again. This already happens with single
   deletes, but deleting in bulk makes it much more likely. One option is to
   keep imported rows as "voided": the `transactions.voided` column already
   exists in the schema and is never used.

   **This is already a problem today, without bulk actions** (checked
   2026-10-15, v0.25.0). Deleting a single imported row also removes its
   import key, and the app keeps no other record of it. So the next CSV
   covering that date shows the row as new and adds it again: as an
   Uncategorized purchase (to review), or as a card credit when money comes
   into a card. A card credit only lowers what is owed and never shows in To
   review, so it is easy to miss. A deleted card payment comes back as a card
   credit, not a transfer: the user has to make it a transfer again from the
   paying account (the automatic transfer match should link the returned
   row). The preview can't skip a single row either; it only has the Match
   checkbox. Fixing this (voiding instead of deleting, or a per-row "skip" in
   the import preview) helps single deletes too, so it could ship before bulk
   actions.

   A related weakness: without a bank ID column, the key is date + amount +
   description. If the bank changes a description between exports (a pending
   charge renamed once it posts), or the file switches between having an ID
   column and not, the same transaction is imported twice.

2. **A transfer row is two transactions.** Activity shows a transfer once, but
   it's stored as two linked rows. A trigger
   (`private.on_transfer_side_deleted`) deletes a typed-in other side and
   keeps an imported one as Uncategorized. The confirmation should say which
   will happen.
3. **Deleting can break the "never negative" rule.** Deleting a refund or an
   Income inflow can leave an envelope below zero or push the budget into
   Over Assigned. Today's single delete doesn't check this either
   (`deleteTransaction` in `supabaseStore.ts` just deletes). Doing it in bulk
   makes the gap worse, so bulk delete should check it.
4. **Assigning many transactions to one envelope can overdraw it, possibly in
   several months.** The cover prompt (`useTransactionEntry.ts`) was built for
   one transaction, or one split covered one envelope at a time. Twenty
   selected transactions can overdraw the same envelope in three different
   months, each with its own Remaining. This needs a new function in
   `budgetMath.ts` that adds up the shortfall per envelope per month, and a
   cover prompt that steps through the months. That's a new rule for how
   covering works, so it needs the owner's approval.
5. **Mixed selections.** When assigning an envelope:
   - card credits and transfers can't take one;
   - a card's payment envelope can't be chosen;
   - Income inflows would lose their Income mark, which lowers Available to
     Assign;
   - splits would collapse into a single envelope;
   - already-categorized rows move money out of their old envelope, which can
     overdraw it if they were refunds.

   Each of these needs a decision: skip it, block the action, or warn.

6. **Moving to another account breaks several rules:**
   - import keys are unique per account, so a move can collide with a key
     already there;
   - an imported row that leaves its bank's account gets re-imported into the
     original account next time;
   - moving between checking and a card changes what the transaction means
     (purchases fill the payment envelope, inflows become card credits that
     can't have an envelope or be Income);
   - a transfer moved into its other side's account would have both sides in
     the same account;
   - a transaction can't be dated before its account's opening date;
   - closed accounts can't be targets.

   Suggestion: limit it to typed-in transactions that aren't transfers, or
   leave it out.

7. **Selection scope.** Clear the selection when the month or account filter
   changes, so nothing selected is ever hidden at the moment you confirm.
   Selection should also work in the "To review" list, because categorizing a
   batch of imported rows is probably the most useful case. A transaction can
   show in both lists, so the two lists should share one selection (by
   transaction id). A split is selected as a whole, not by its parts.
8. **Accessibility.** Each checkbox needs a label, the "N selected" count
   should be announced to screen readers (`aria-live`), the bar should be a
   toolbar (`role="toolbar"`), and the menu needs keyboard support (arrow
   keys, Escape).

## Decisions for the owner

- **Clear and Reconcile:** should a stored status be added now (a new data
  model, so a feature version)? And does Reconcile need a statement-balance
  check, plus locking reconciled rows against edits, or is it just a mark?
- **Bulk assign:** approve a multi-month cover prompt, or block bulk assign
  whenever it would overdraw an envelope (simpler: you'd fix the shortfall
  first)?
- **Move to account:** limit it to typed-in transactions that aren't
  transfers, or drop it?
- **Deleting imported rows:** delete them for real, or void them so they
  can't come back on the next import?

## Suggested order

1. Select mode, the action bar, Delete and Mark as Income (no change to the
   budget math).
2. Assign to an envelope, with the bulk shortfall function and cover prompt.
3. A stored cleared status and Clear.
4. Reconciliation, designed as its own feature.
5. Move to account, if still wanted.

A phone-width mockup of select mode and the action bar (like those in
`docs/mockups/`) would be a good first step before building.
