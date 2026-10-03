---
from: S450-peter (P-Tech1 — PA)
to: bryan
date: 2026-10-02
subject: "S450 — your 'stamp all' is built (5 rulings, 3 drafts landed); 2 policy-exception asks on hold refs; 3 rulings needed; 1 data-loss HIGH routed"
needs: reply
status: unread
re: 2026-10-01-from-S447-bryan-to-peter-stamp-all.md
---

Everything below is reviewed (S239 adversarial pass, findings reproduced before acting) and one word answers each.

## Landed (your "stamp all")
#1208 defer + Part A (`7d35194c`) · #1210 imported-enum, the 38 newly-loud rows (`ec0c0d48`) · #1211 client-JS helper copy (`865065d8`) ·
#1241 ruling (iv) headless serve targets → loopback, prod all-interfaces (`19eecc06`) · ruling (iii) nested-sequence await = **#1242** ·
rulings (i)+(ii) schema = **#1243** · ruling (v) E-ATTR-MULTI-STATEMENT = **#1244**.

## A. Readings the builds had to make — veto any with a word ("veto R2", etc.); silence = stands
1. (iv) The opt-in is env `SCRML_HOST` (unset → loopback, `0.0.0.0` → all incl. `::`, empty refused). Alternative was a `<program host=>` attribute. `scrml serve`/prod don't read it. **Rec: keep.**
2. (iii) A closure `${() => { @x = save() }}` whose whole body is the write keeps fire-and-forget (its body = the handler's root). **Rec: keep.**
3. (iii) Newly-awaited writes no longer reach `_scrml_error_boundary_log` on a failed call (browser unhandled rejection instead) — widens the ruling-gated `g-handler-level-rejection-bypasses-scrml-logging`. **Rec: route an async listener's rejection to `_scrml_error_boundary_log` (one emit change); say "yes" and it's built.**
4. (ii) Bare `LIKE tmpl` / `like TEXT` followed by `,`/`)` is a template reference (your stamped shape, literally) — `like TEXT NOT NULL`, `like VARCHAR(50)`, `"like" TEXT` stay columns.
5. (i) R1 names compared case-insensitively · R2 a raw declaration with no readable column is not a declaration · R3 heads inside a SECURITY-DEFINER `"""` fn body count (two loud false positives documented).
6. (v) Not yet detected (loud gap filed, rec = error, fail closed): newline-separated / juxtaposed statements in `${…}`/`{…}`, statements inside `(…)` without `;`, component-definition bodies, markup values in logic. **Rec: all are errors.**

## B. S435 policy-exception asks — two aM-driven impl#1 fixes, reviewed, parked (one word each)
- **`hold/s450-transaction-in-function-body` @69cdaa98** — `transaction {}` inside a `!` function (§19.10.2's OWN example) fails E-SCOPE-001 on main; a `fail` nested in the block leaves the transaction OPEN. Built + 2 review rounds (LAND-WITH-NITS; last nit a676c61a post-review). Interim E-TRANSACTION-CONTROL-FLOW refuses return/break/continue leaving the block and a fail inside a statement-match arm. **Rec: exception (silent wrong data, same grounds as your S439 #12).** ⚑ Rulings it needs: (a) do return/break/continue commit or roll back? (b) top-level `transaction` — §19.10.4 says only in `!` functions; corpus has 0 top-level uses → reject? ⚑ Does NOT make aM's db.js migration safe — see C.
- **`hold/s450-each-row-interp-whitespace` @d5500e69** — `${a} ${b}` in an `<each>` row renders `PeterOliver` (§4.18.5 says whitespace kept). Review LAND-WITH-NITS; corpus +1610 whitespace-only text nodes, 0 removed. Weaker ask (aM can write `${a + " " + b}`). **Rec: exception, or leave to the bootstrap — your call.** Also undecided by §4.18.1: whitespace directly in an `<each>` body.

## C. ⚑ HIGH data loss on main — routed (runtime/integrity, your lane)
`g-shared-sql-connection-concurrent-handlers-share-transaction`: one module-level `_scrml_sql` serves every request. A plain write that returns **200** is rolled back by a concurrent request's failing implicit transaction (§8.9.2); two concurrent transactions → "cannot start a transaction within a transaction"; dirty reads. `begin()` doesn't fix it. Reproduced on main `865065d8`. **Rec: a per-connection async mutex around every implicit/explicit transaction envelope (smallest correct fix), or a connection per transaction.**

## D. Ruling needed
`g-implicit-handler-tx-commits-on-fail`: the §8.9.2 implicit envelope COMMITS when the handler `fail`s — that is the SPEC's literal text ("ROLLBACK on exception") but the opposite of `transaction {}` (§19.10.3). **Rec: `fail` rolls back the implicit envelope too.**

## E. Filed this session (all reproduced on main, traced loci) — FYI
quoted `else-if`/`show` conditions ignored (HIGH, `tokenizer.ts:782`) · `title=f()` wired as an event listener (MED) · a `!` helper reached by `helper(x)?` from a server fn is never emitted server-side → ReferenceError (HIGH) · single-statement handler `@x = match …` misses payload variants (HIGH) · `${children}` duplicated into preceding siblings (HIGH) · `${...}` spread → E-COMPONENT-021 (HIGH, unverified-by-PA) · samples/ whole-dir compile aborts on one recursive component (addendum).

— S450-peter
