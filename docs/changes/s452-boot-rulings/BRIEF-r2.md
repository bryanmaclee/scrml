# BRIEF-r2 — fix round (archived verbatim, as relayed by PA)

PA → rulings-round agent: FIX ROUND. Two adversarial reviews ran on your frozen tip 311b590ef. Work in your SAME worktree on `feat/s452-boot-rulings`: first `git fetch origin main` and `git merge origin/main` (resolve as a real 3-way; regenerate generated files with their scripts), then fix, commit (code+test together), push (normal push). Same path/stash/pkill/--no-verify rules as your original brief. Append a "fix round r2" section to progress.md and archive this message verbatim as docs/changes/s452-boot-rulings/BRIEF-r2.md.

These are the reviewers' claims. HIGH-1 is PA-verified against the SPEC. Verify each of the others yourself before changing anything.

HIGH-1 (MUST FIX): a `defer` directly in a VALUE-position block arm is accepted with new value-then-defer semantics. The SPEC refuses it. §19.16.2 (SPEC.md ~:19634) and the §34 E-DEFER-UNSUPPORTED-SITE rows: "a `defer` directly in an arm of a `match` / `if` / `for` used for its VALUE (a value-form expression …) — the defer block would capture the arm's result". Repros: `const r = load("x") !{ _ :> { @n = 1 \n defer @n = 99 \n @n } }` and the same inside a value-position `match load(id) { .Ok(v) :> { defer @n = 7 \n v } _ :> "e" }` both compile today.
- Fix: emit E-DEFER-UNSUPPORTED-SITE, fail closed, no Core. The reviewer suggests analyze.scrml `armBlock` (~6324).
- Apply it to value-position `match`, `!{}` handler arms, and if/for if the bootstrap has value forms of them.
- `!{}` arms are not named in the sentence. The PA reads them as the same shape (both lower to Attempt). Record that as a PA reading in DESIGN.md.
- Also refuse a value-position arm that LEAVES (`{ defer …; return "L" }`). It is syntactically an arm used for its value, and refusing is fail-closed and reversible. Record this as a PA reading too.
- Remove the value-then-defer lowering in print.scrml `branchJs` if it becomes dead.
- Change the test at error-rulings.test.js:229 to expect the error.
- Note: a `defer` inside a STATEMENT-position arm stays legal. Do not over-refuse that.

MED-1: E-ERROR-015 fails open on `?{;BEGIN}` and `?{SELECT 1; BEGIN}`, because sql.scrml `txControl` reads only the first word. Make it inspect EVERY statement in the query, skipping empty ones.

MED-2: E-ERROR-012 misses a callee that returns a value on only some paths. `function h() { if (@n == 5) { return "q" } \n @n = 4 }` then `const r = load("x") !{ _ :> h() }` compiles, and r is JS undefined. `fnYieldsValue` / `blockReturnsValue` count "any return-with-expr anywhere". Require a value on EVERY path (a fall-off end = no value). If proving every path isn't feasible for some shape, fail closed and report which.

LOW-1: also treat `START TRANSACTION`, `ABORT`, `RELEASE [SAVEPOINT]` and `PREPARE TRANSACTION` / `COMMIT PREPARED` as manual transaction control. §19.10.4's list ends in "…" — "manual transaction control (`?{BEGIN}`, `?{COMMIT}`, `?{ROLLBACK}`, `?{SAVEPOINT}`, …)" — and Postgres is a supported backend.

LOW-3: `_ err` followed by `.Ok(v)` in a `match` (and `_ err` then `_`) is refused with "this arm follows a wildcard which already took every remaining case". That's false: per §18.6.1 `_ err` never takes `.Ok`.
- An `.Ok` arm after `_ err` must be ACCEPTED.
- A plain `_` after `_ err` stays an unreachable-arm error, but with a true message.

DB-LOW-1 (from the second reviewer): E-SQL-005 echoes the full connection string, credentials included (`<db src="mongodb://SECRETpasswd@h/x">`), in analyze.scrml `dbOfAttr` (~13723). Redact the userinfo (`scheme://***@host`) in every diagnostic that echoes a db= or src= value. Add a test showing the secret is absent from the diagnostic text.

NIT: `if=` on `<db>` is reported twice (`resolveDb` + `chainHostRefused`). Report it once.

LEAVE (note in progress.md as deferred, not fixed): LOW-2 `?{/* ${x} */ BEGIN}`; LOW-4 the legacy `.V _` / `_ _` forms giving E-PARSE-ARM (fail closed — fine).

Verify (do not report done without it): each repro now behaves as specified, with a test each. All slices green by path. The pre-commit gate green. The counter PASS ≥119 (report case diffs; regenerate the doc; `--check` current). `gen-bootstrap-severity.ts --check` current.

FINAL REPORT (<500 words): FINAL_SHA (== pushed tip), per finding fixed / skipped + how, tests, counter, `git status` clean.
