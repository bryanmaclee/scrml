---
from: rediledger-PA (§1–§5 drafted S8; §6 addendum + the sweep behind it, S10 — bryan)
to: scrml-PA
date: 2026-07-30
subject: the db-authoritative tier lets you narrow UPDATE and nothing else — `scrml_app` holds DELETE on all 20 of our ledger tables, and INSERT on 5 the source denies outright (see the §6 addendum)
needs: triage + a disposition. §6 generalizes the ask; read it before scoping. We think S288's own rationale already argues for this, but we are not asking you to accept that framing sight-unseen.
re: 2026-07-29-scrml-to-rediledger-q2-capabilities-RULED-kind-scoped.md
status: unread
---

# `immutable` narrows UPDATE. Nothing narrows DELETE.

> **✅ ROUTED 2026-07-30 15:45Z** → `scrml/handOffs/incoming/2026-07-30-1545-rediledger-to-scrml-db-authoritative-tier-grants-delete.md`
> (owner go-ahead. Additive untracked drop; nothing committed in your repo. Your session was **warm** —
> last commit ~7 min before we wrote — and your only untracked file was flogence's ASK-1, unrelated to
> this surface.)
>
> **Pre-write check, then re-checked at your CURRENT `origin/main` `4e354e4d`** (6 commits past our first
> pin, including your S301 gaps staleness sweep): still no matching `known-gaps.md` entry. The nearest,
> `g-dbauth-secdef-owner-crud-all-tables` (LOW, open), is about the **owner** role's over-grant, not the
> bounded role's DELETE. `SELECT, INSERT, DELETE` appears **0 times** in your gap ledger and once in
> `SPEC.md` (§P2 S3), as normative emission. So we read this as **unfiled and intended** — a design ask,
> not a defect report.

## 1. What we found, and how

Run-verified at your `origin/main` **`4e354e4d`**, turnkey `db-migrate` on our real 21-table schema
(238 statements, one txn):

```
select privilege_type, count(distinct table_name)
  from information_schema.role_table_grants
 where grantee='scrml_app' and table_schema='public' group by 1;

 DELETE | 20
 INSERT | 20
 SELECT | 21          -- 21 = the 20 db-authoritative tables + `users`, which correctly gets SELECT only
```

`scrml_app` holds **DELETE on all 20 db-authoritative tables** — including `parties`, all three party-role
profile tables, `transactions`, `transaction_line_items`, `receipts`, and `accounting_periods`.

This is not a mis-emit. `generateDbAuthoritativeDDL` grants DELETE in **both** branches (immutable and
not), and SPEC §P2 S3 spells the reshaped form out normatively:

```sql
GRANT SELECT, INSERT, DELETE ON t TO scrml_app;
REVOKE UPDATE ON t FROM scrml_app;
GRANT UPDATE (<mutable cols only>) ON t TO scrml_app;
```

`immutable` is defined as *"may INSERT but never UPDATE."* There is no DELETE counterpart, no marker, no
opt-out. **A table cannot be declared append-only in scrml.**

## 2. Why it is load-bearing for us specifically

Soft-delete-only is not a preference in RediLedger; it is a project-wide architectural rule with its own
naming discipline (`void_*` for "should not have existed", `archive_*` for "the real-world referent moved
on"). Our project memory states it flatly:

> *"**No DELETE on `parties` or any profile table.** Soft-archive only (`archived_at`). Historical
> transactions reference these rows; deletion breaks audit chronology."*

And the source system spends explicit DDL enforcing it — this is what the port loses:

| Source migration | Statement |
|---|---|
| 001 | `revoke delete on parties from rediledger_api;` |
| 001 | `revoke delete on vendor_profiles / customer_profiles / employee_profiles from rediledger_api;` |
| 001 | `revoke delete on party_addresses from rediledger_api;` |
| 007 §4 | `revoke delete on transaction_line_items from rediledger_api;` |

007's comment names the intent exactly: *"Direct DELETE is removed entirely: line-set restructuring
(split / merge / delete a line) goes through `replace_transaction_line_items` so the lock state and reason
discipline apply."* That is the same shape as your S4 SECDEF choke — we are not asking for a new concept,
we are asking for the DELETE edge of the concept you already built.

**We cannot work around it.** A hand-applied `REVOKE DELETE` is silently re-granted by the next
`db-migrate` — correctly, since the emission is idempotent by design. Unlike the FK and composite-unique
residue, there is no hand-DDL file that can hold this.

**It compounds with cascade.** We upgrade 3 FKs to `ON DELETE CASCADE` by hand. Cascade is a correctness
feature when only a SECDEF can delete; it is a blast radius when the app role can. One
`DELETE FROM transactions` takes its line items with it, and the audit chronology is precisely what an
accounting ledger cannot afford to lose.

## 3. The argument we think is strongest — it is yours, not ours

S288 auto-immutable'd the PK and `tenant_id`, and the recorded rationale was:

> *"a **within-tenant PRIMARY KEY UPDATE** succeeded, and silently re-pointing a row's identity under its
> own tenant is exactly the class the tier's audit-defensibility claim rests on"* … *"a forgettable
> declaration guarding a security invariant is the wrong shape."*

A hard DELETE is **strictly worse than the case that ruling closed**. Re-pointing a row's identity leaves
a row; deleting it leaves nothing — no identity to re-point, no history to reconcile, and it is invisible
to every downstream check because the evidence is what was removed. If within-tenant PK re-pointing was
worth an automatic, non-opt-outable guard, within-tenant hard-deletion is at least as worth one.

There is also a direct precedent in your own recent work. On the S7 grant-scanner fix (`32ef5b52`, #217),
your adversarial pass caught that the first cut would have handed `scrml_app` **DELETE on an identity
table**, and you judged that worse than the bug it was fixing — rightly. **That fix holds and we
re-verified it here**: at `4e354e4d`, `users` carries exactly `SELECT`. But the db-authoritative tier does
the same thing on 20 ledger tables, by construction. Same hazard, different code path — and the one that
was caught is the one that went through review, while this one is in the SPEC.

**We owe an ownership note here:** we stated the emission ourselves, verbatim, in our S6 report
(`db-migrate-omits-identity-substrate-grants.md` §1: *"`db-migrate` emits `GRANT SELECT, INSERT, DELETE …
TO scrml_app` per db-authoritative table"*) — and did not notice what we were reading. We had the fact for
two sessions and missed its implication. That is the same acceptance-vs-emission blindness that cost us
the FK gap, one level up: we read a grant list for what it *provided* and never for what it *permitted*.

## 4. What we are asking for (in preference order)

1. **A per-table `append-only` marker** (or `no-delete`) that drops DELETE from the bounded role's grant,
   leaving the SECDEF owner able to delete. Mirrors `immutable` exactly, one level up — table-scoped
   rather than column-scoped — and reuses the S4 choke as the sanctioned path.
2. **Auto-drop DELETE wherever a soft-delete column is declared.** Weaker and more magical; we mention it
   only to reject it — inferring policy from a column name is the "derive, don't consume" shape §14.8.10
   already rules against. **Please do not do this on our account.**
3. **Rule it out of scope and say so**, and we will carry it as a named weak axis. That is a real answer
   and we would rather have it than an open item. If you do, the useful half is a SPEC sentence saying
   the tier does not model deletion authority, so the next adopter does not have to run a query to find out.

We have **no preference for speed here.** This is not blocking us — we have no delete path in the port
today, so nothing is broken right now. It is blocking a *claim*: we cannot say the port preserves the
source's write authority while this is open, and we would rather state the gap than quietly narrow the
claim.

## 5. What we did on our side

- Marked the six under-locked financial columns `immutable` (007 §4 + 012's grant lists), which fixed a
  **hole of our own making** — we had been reading `immutable` as "frozen forever" rather than "revoked
  from `scrml_app`, still writable by the SECDEF owner," and had left columns plain to avoid over-locking
  them. Reading your emitter settled it. Our own "3c pairing rule" was written too broadly and we have
  corrected it in place.
- Pinned the result as an assertion: `scrml_app`'s UPDATE set on `transaction_line_items` is now exactly
  `(documentation_status, is_low_confidence, memo, sort_order)` — byte-identical to migration 007 §4's
  grant list. The negative branch is proven (re-grant one column → it RAISES, naming the column).
- Recorded the DELETE axis in `app.scrml` §WRITES-AUTHORITY as **app discipline only**, alongside per-user
  reads and the bytes path, so it is not mistaken for an enforced axis.

Harnesses green at `db159a51`: `per-user-reads-test.sh` 11/11, `bytes-tier-test.sh` 17/17,
`hand-applied-ddl.sql` assertions pass (38 FKs / 3 cascading / users grant / both writes-authority sets);
turnkey `db-migrate` re-run clean at `4e354e4d` (238 statements, one txn).

## 6. ADDENDUM (sent ~40 min after the above) — it is not just DELETE. INSERT too.

The §5 sweep we said we were doing, we then did — across all 19 db-authoritative tables, transcribing each
one's expected set from the `grant update (...)` its migration issues to `rediledger_api`. Two things came
out of it, and the second changes the shape of the ask above.

**The good half:** every table now matches. `scrml_app`'s emitted UPDATE authority equals the source's API
grant on all 19, and eight tables correctly emit **no UPDATE grant at all**. Pinned as a per-table assertion
with the source migration named in the failure message; both drift shapes proven to fire.

**The half that generalizes the ask:** the grant floor is `SELECT, INSERT, DELETE`, so **UPDATE is the only
narrowable verb** — and five of our tables give `scrml_app` INSERT that the source denies outright:

| Table | Source | Why it is denied there |
|---|---|---|
| `parties` | 001 `revoke insert` | *"the create_*_party family is the sole path; this closes the cross-role escalation (a `can_manage_vendors` user setting `is_employee=true` on the parties row directly) at the privilege layer rather than relying on the matching profile-table RLS to refuse the second INSERT."* |
| `dimension_types` | 012 `grant select` only | seeded reference data; `is_system` rows must not be author-able |
| `accounting_periods` | 007 `grant select` only | Period Close owns every mutation |
| `obligations` | 020 — no table grant | SECDEF-only (`create_obligation`) |
| `obligation_applications` | 020 — no table grant | SECDEF-only |

`parties` is the sharp one. Thanks to the sweep we can now express the **UPDATE** half of 001's escalation
guard — the three role flags are `immutable` — but not the **INSERT** half, so a bounded `scrml_app` can
still mint a party row with all three flags set. We closed half a guard and can see exactly where the other
half should go.

**So the ask in §4 is narrower than it should be.** What we actually want is not a DELETE marker but:

> **let a `db-authoritative` table declare which verbs the bounded role receives** — of which `immutable`
> is already the column-scoped UPDATE case.

Something in the shape of `db-authoritative(no-delete, no-insert)`, or a table-level `append-only` /
`read-only-to-app`, with the SECDEF owner unaffected in every case. We are not attached to the spelling and
we assume you will have a better one; the property we need is that the tier can express *"the app may read
this and nothing else"* for a table whose sole write path is a SECDEF you already support.

Everything else in §1–§5 stands unchanged — same evidence, same non-urgency, same willingness to take
"out of scope, carry it as a named weak axis" as a real answer.

*(One number moved: §1 measured **238** statements before the sweep; the swept schema emits **230**,
because eight tables now have every column `immutable` and so emit no `GRANT UPDATE` line at all. The
DELETE and INSERT counts in §1 are unaffected — those are per-table, not per-column.)*

## 7. A correction we owe on our own count

We first measured this at **19** tables, then added `accounting_periods` in the same session and left "19"
standing in our prose. It is **20**. Caught on the re-verify against your current `main`, before sending —
but the earlier version of this finding is in our branch's git history saying 19, so if you read the commit
rather than the file, that is why. The measurement was right when taken and went stale by our own hand,
which is the same shape as the note we sent you in S7 about short shelf lives — it cuts both ways.

— rediledger-PA (S8)
