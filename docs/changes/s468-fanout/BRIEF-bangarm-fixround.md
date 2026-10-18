# unit-id: s468-bang-arm-block-value  — FIX ROUND 1 (from the S239 review of frozen 684420b36)
Work ON the existing branch `s468-bang-arm-block-value` (PR #1440): `git fetch origin s468-bang-arm-block-value && git
checkout -B s468-bang-arm-block-value origin/s468-bang-arm-block-value`; assert HEAD == 684420b366b1a69802ea557d42d5b21fa503f206.
(COMMON step 6 "create from origin/main" is overridden.) Read the branch's docs/changes/s468-bang-arm-block-value/progress.md
first — it is the previous dev's record. Policy limb: SECURITY.
Reviewer artifacts (read-only): $HOME/.cache/scrml-agent-tmp/s468-rev-bangarm/ — h3/n1.mjs,n2.mjs,s4.mjs,cps.mjs,exec.mjs;
h2/probe*.mjs call armBlockStatementsDetailed directly. Findings are RELAYED — reproduce each first.
1. HIGH, fail-open on the CLIENT (pre-existing, but the gap is marked RESOLVED): when `armBlockStatementsDetailed` cannot
   read a braced arm body in a VALUE position, the client silently falls back to the old lowering that drops the value
   → a wrong password LOGS IN. Shapes: `const ok = check(p) !{ .Denied :> { @note = "d"⏎ !yes } }` (and `!true`,
   `true && check(p) !{…⏎ !yes }`), `{ @note = "d"⏎ 0 }`, `{ @note = "d"⏎ "" }`, `{ plain(1)⏎ @note = "d"⏎ 0 }`,
   `{ plain(1)⏎ !yes }`, a block-armed `!{}` nested inside the arm (newline and `;` forms), and
   `{ const y = check2(p) !{ .Locked :> {…⏎ false } ⏎ .Denied :> false }⏎ y }`. The reader refuses statements starting
   with a number/string/`!`/`[` after a newline and arms containing block-armed handlers. The SERVER already refuses these
   texts at compile time (E-STMT-UNEXPECTED-TOKEN) — fails closed. FIX: in a value position a non-empty braced arm the
   reader cannot read is REFUSED on the client too (a compile error naming the arm) — never a fallback. Teaching the
   reader the missing statement starts by construction is better, but the fallback MUST become a refusal regardless.
   Tests for every shape; execute wrong + right password.
2. LOW: `_anchorSpansAt` overwrites every statement's line with the arm's first line (two `log()`s on lines 20/22 both
   print app.scrml:20) — anchor each statement to its own line.
3. Ledger: g-block-bodied-bang-arm-drops-value-s467 stays resolved only with item 1 landed. FILE a NEW HIGH gap (locus=
   + prov= fields): a DERIVED cell ignores its `!{}` handler — `const <okc> = check(@pw) !{ .Denied :> false }` logs a
   wrong password in on base and head (the derived thunk recomputes check(...) with no handler; the handler runs only
   against `_scrml_cs_derived_declare(...)`'s return). Do NOT fix it here. In progress.md record: `{ if…{true} else
   {false} }` / `{ false }` / `x = false` tails fall through (= open g-impl1-value-position-arm-fallthrough-s451); two
   benign behaviour changes (an arm with `fail` inside an `if` now compiles correctly; a leading line starting
   `(`/`[`/template now joins the previous statement as in function bodies).
Gates: your tests, unit suite, security-await-pack classify (FAIL set must equal base's 10), `bun conformance/run.ts`,
pre-commit hook. Push after every commit. Report the new SHA.
