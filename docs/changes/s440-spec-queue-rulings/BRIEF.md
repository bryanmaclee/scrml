change-id: s440-spec-queue-rulings

## CRITICAL — STARTUP + PATH DISCIPLINE (incident counter: 0)
1. `pwd` starts with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; toplevel equals it; clean tree. Else STOP.
2. `git fetch origin && git merge --ff-only origin/main`; assert merge-base == origin/main; report base SHA.
3. `bun install`. Absolute worktree paths for every Read/Edit/Write; never a main-checkout path; never `cd` into main; Edit/Write only (no heredocs/scripts for edits). No `git stash`, no `pkill -f`.
4. First commit archives THIS PROMPT verbatim to `docs/changes/s440-spec-queue-rulings/BRIEF.md` (`WIP(s440-spec-queue-rulings): start at $(pwd)`). Incremental commits + append-only progress.md there. Commit hook runs the core suite (~5 min): Bash timeout 600000. Never `--no-verify`.

## TASK — SPEC TEXT ONLY (compiler/SPEC.md + regen SPEC-INDEX). No compiler code, no tests beyond what the SPEC regen touches.
bryan ruled these at S440. The ledger is `/home/bryan-maclee/scrmlMaster/scrml-support/user-voice-scrml.md`, section `## S440` — READ the entries "all recs #2", "duplicate keys are an error in ANY struct literal", and "the S440 22-item queue" IN FULL (read-only; sibling repo). The ANSWERED TEXT there is the authority — do not widen a ruling in your prose (three S437/S439 briefs widened rulings by paraphrase; quote, don't embellish). For each item, find the governing section (Rule 4: quote the sentence you amend), write the normative text, and add `> **Provenance:** ruling:user-voice-scrml.md S440 (<entry>, item <n>)` inline. Where a ruling names a new code, add the §34 row AND the §66.20 row where it is a §66 construct; mark each new code "named; impl pending" (impl#1 carries under the S435 policy; the bootstrap implements).

Items (numbers as in the ledger entry "the S440 22-item queue"):
- 1: cell/field write type mismatch = E-TYPE-031 → a §66.20 row + a "cell/field write" position row in §7.5.1's position table.
- 3: `<each in=>` over a value that is not a sequence → new code `E-EACH-NOT-SEQUENCE` (§17.7 normative statement + §34 row).
- 6: duplicate top-level `function` of one name → E-SCOPE-010: amend §7.6 so it names `function` (not only `let`), and reconcile §19.16.6's "§7.3.3 deliberately does not reject duplicate `function` declarations in general" and §7.3.3's routing bullet so the three agree.
- 7: a handle in an `<each>` row MAY shadow a program-level handle/declaration — make §66.7.4 say so explicitly.
- 8: a bare `when` at the top of a `<channel>` body is lifted by its grammar head, as S439 #2 did for program/page bodies (find the S439 #2 text in SPEC, from #1120, and extend it to `<channel>`).
- 9: the reserved `_scrml_` namespace (S439 #7 text from #1120): extend to REFERENCES as well as declarations; stdlib is exempt by path.
- 10: `initial=` payload arguments take any value (not required static) — resolve the #1120 OPEN item.
- 11: a plain `single` declaration inside an `<each>` row is refused, as S439 #10 refuses an `<engine>` in a row — resolve the #1120 OPEN item; name the code the S439 #10 text uses, or add one.
- 12: the #1120 OPEN item "whether impl#1 fixes or carries each newly-named error" → carries unless security or bootstrap-serving (S435 policy) — state once, where #1120 raised it.
- 13: strike the page-level `session-secure` form (gap `g-page-session-secure-three-way-disagreement` in docs/known-gaps.md explains the three-way disagreement — read it) from SPEC.
- 19: §41.14.3 — a `formFor` submit handler's error routes to the nearest enclosing `<errorBoundary>`; with none, E-ERROR-005.
- Duplicate keys: a duplicate key in ANY struct literal (plain, nested, or the spread-override shape `{ ...@x, f: a, f: b }`) is a compile error — name ONE code (e.g. `E-STRUCT-DUP-KEY`) in §14 (struct literals) + §66.11.3 cross-ref + §34 (+§66.20).
- Also write into §66.11.3 item 1 (after its existing provenance) this ratified paragraph VERBATIM (it was drafted against the rulings and is the authority text for the spread atomicity + strict snapshot rulings):
```
   **One snapshot, all or nothing.** Every read of `@x` inside the shape sees ONE snapshot of `@x` taken at the
   start of the statement, before any override expression is evaluated — so `@p = { ...@p, x: @p.y, y: @p.x }`
   swaps, and in `@p = { ...@p, x: bump(), y: @p.z }` the read of `@p.z` sees the value from before the statement
   even when `bump()` writes `@p.z`. The same field SHALL NOT be overridden twice in one shape
   (`{ ...@g, phase: .Gone, phase: .Live }` is a compile error).
   And the write is ALL-OR-NOTHING: every overridden field's contract is checked against the new value before any
   field is written; if any check refuses at runtime, NO field is written and `@x` is unchanged — a spread write
   never leaves a partial apply behind.

   > **Provenance:** ruling:user-voice-scrml.md S440 — *"all recs"* (spread all-or-nothing) and all recs #2
   > items 2 and 3 (duplicate override key; strict snapshot). Origin: Peter's #1109 review F1 (S438) and the S440
   > adversarial reviews of the re-land.
```
   (Use the one duplicate-key code you name in place of the phrase "is a compile error" if you want, consistently.)

EXCLUDED — another agent owns these sections right now; DO NOT edit: §19.4.3, §19.6.6 (E-ERROR-002 / errorBoundary), §9.1 and §66.17 / the §66.20 token-cell row (CSS work). Do not touch items 2, 4, 5, 14, 15, 16, 17, 18, 20, 21, 22.

Every new code's §34 row gets the ruling as provenance and "impl pending". If a ruling's text cannot be placed without deciding something it did not decide, write it as `⚑ OPEN` beside the ruled part and report it — do not decide.

VERIFY: `bun run scripts/regen-spec-index.ts`; `bun scripts/facts.ts --check`; grep that every code you named appears in §34 exactly once. REPORT: FINAL_SHA, per-item section + quoted before/after sentence, any OPEN you had to leave, clean tree.
