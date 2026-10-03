# BRIEF — s446-spec-dpa063-termination (SPEC text: statement termination + `when` re-trigger + W-LIFECYCLE-006)

Docs/SPEC-only dispatch. You change `compiler/SPEC.md`, regenerate `compiler/SPEC-INDEX.md`, and file gaps in
`docs/known-gaps.md`. NO compiler source (`compiler/src/**`, `compiler/self-host-v2/**`, `compiler/native-parser/**`)
and NO conformance cases in this unit — those are follow-on builds.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (incidents to date: report 0 or N)
1. `pwd` MUST start with `/home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` ==
   `pwd`; clean tree; `git fetch origin && git merge --ff-only origin/main` if behind (HEAD must contain origin/main).
2. `bun install`. Absolute worktree paths only; never write into or `cd` into the main checkout; Edit/Write for edits;
   never `git stash`; never `pkill -f`. First commit `WIP(s446-spec-063): start at $(pwd)`; second commit: copy this
   brief verbatim to `docs/changes/s446-spec-dpa063-termination/BRIEF.md`.

## Authority (read IN FULL before writing)
- Rulings: `/home/bryan/scrmlMaster/scrml-support/user-voice-scrml.md` — the `## S446` section (all entries) and the
  `## S445` entry "Does nothing — (1), no exemption" (E-STMT-NO-EFFECT definition of an effect).
- Deep-dive: `/home/bryan/scrmlMaster/scrml-support/docs/deep-dives/statement-termination-dpa-063-2026-09-30.md`
  (Approach B, the cross-cutting locus table, C1 SPEC sites, Route-to-PA R1–R8). The dd is ADVISORY; where it and the
  S446 rulings differ, the RULINGS win.
- The bootstrap U0 design note for the re-trigger fork lives on an unlanded branch:
  `git show worktree-agent-a49bf613dc0ee6c05:docs/changes/s446-bootstrap-u0-when-effects/DESIGN.md` (fetch it from
  `/home/bryan/scrmlMaster/scrml` if needed: `git fetch /home/bryan/scrmlMaster/scrml worktree-agent-a49bf613dc0ee6c05`).

## What to write
1. **One normative statement-termination section** (place it where statement grammar belongs — §7.2/§7.3 area; choose
   and justify). It states dpa-063 pole B as ruled: a newline ends a statement at statement level; continuation only
   by a line-END token (binary operators, `.`, `?.`, `?`, `:`, `=`, `,`, `=>` — derive the exact closed list from the dd
   and state it) or inside an open `(` `[` `{` / template; a line that STARTS with a token that can only continue an
   expression is a compile error (new code — name it, e.g. `E-STMT-LEADING-OPERATOR`; leading `.`/`?.` and leading
   `+`/`-` are IN the set, Call 4 (i) / Call 5); a line starting with an expression-start token (`(`, `[`, template,
   regex, `!`) starts a new statement and never joins; `;` is a legal separator, line-final `;` legal (Call 4b (i)); two
   statements on one line without `;` = `E-STMT-MISSING-SEMICOLON` (existing). The error message text SHOULD suggest
   "move the operator to the end of the previous line, or wrap the expression in `( )`".
   Cover every locus in the dd's cross-cutting table (function/`fn` bodies, `${}`, handler blocks, `^{}`, code-default
   bodies, body top; `:`-shorthand = one expression, newlines insignificant between `:` and `>`; `?{}`/`_{}` exempt;
   match/`!{}` arms newline-separated per §18.2). Address the `.Variant :>` arm head inside `match` (a line starting
   `.Variant :>` is an arm, not a leading-`.` error — state the rule structurally).
2. **E-STMT-NO-EFFECT language-wide** (Call 5): every logic body, effect = call (any call) / assignment / `++`/`--` /
   `send`; an expression statement whose value the NEXT statement reads through `~` (§32.2) is used, not dead. Find
   where S445 put E-STMT-NO-EFFECT (§40.8 / §34) and widen it there with a cross-ref, don't duplicate.
3. **Supersede S440 #6** (Call 7): find its SPEC text (if any landed) and replace it with a pointer to the one rule; the
   `return⏎expr` case is covered (return ends at newline; orphan → E-STMT-NO-EFFECT).
4. **Fix the stale sites:** §7.2's JS-inheritance sentence (state termination is NOT inherited from JS ASI); §5.2.3
   "separated by `;` or by a newline" (consistent with the new section); §17.6 grammar comment "semicolon optional per
   §3 ASI rules" (§3 has no ASI rules — point at the new section); the r5 "`;` is source formatting" body-top rule if it
   landed on main (`;` is now the defined separator).
5. **Migration (Call 6):** a short normative note: immediate error pre-1.0 via the §63.7 route; a `scrml migrate --fix`
   rule ships with the impl (leading operator → end of previous line; leading-`.` chains may be paren-wrapped),
   verified by emit diff. State it does NOT go through a §63 warning window.
6. **`when` re-trigger (§6.7.4):** add a normative bullet: if a `when` effect is triggered while a previous run of the
   SAME effect is suspended (e.g. at a server call, §13.2), the previous run's continuation is cancelled and never
   resumes (newest run wins), consistent with §6.7.7.1. Cancellation is not a rollback (mirror §6.7.7.1's transport-only
   wording).
7. **W-LIFECYCLE-006 (§6.7.4):** condition 2 additionally requires that the RHS does NOT read the assigned cell
   (`@hits = @hits + 1` is an accumulator; the derived form would be circular). Add that exclusion.
8. **§34 rows** for every new or widened code, and the conformance pins that flip: the dd names the three S437
   `markup-handler/s437-r4-continuation-*` cases — record in the SPEC/§34 text or a note that they become negatives
   (do NOT edit conformance cases in this unit; list them in your report).
9. **Provenance (Rule 4b):** every amended/new section carries `> **Provenance:** ruling:user-voice-scrml.md S446 …`
   with the verbatim line, `dd:` the deep-dive, and `supersedes:` where applicable (S440 #6; S437 pins; the
   body-top-only scope of S445 #2).
10. **Gaps** (`docs/known-gaps.md`, a new `§S446` block; each entry with `@gap` marker incl. `locus=` and `prov=`):
    the dd's R1 (native parser drops inline-handler statements after the first — HIGH, silent), R2 (native rejects a
    trailing-operator multi-line ternary), R3 (bootstrap accepts two statements on one line), plus build-owed entries:
    dpa-063 termination rule unbuilt in bootstrap / impl#1-legacy / impl#1-native, E-STMT-NO-EFFECT language-wide
    unbuilt, the codemod unbuilt, `when` re-trigger (b) unbuilt. Reproduce R1–R3 yourself first
    (`bun compiler/src/cli.js compile` with/without `--parser=scrml-native`); mark any you cannot reproduce UNVERIFIED.
11. Regenerate: `bun run scripts/regen-spec-index.ts`, `bun scripts/state.ts --write`, `bun scripts/facts.ts` if it has a
    write mode; then `--check` each. Do NOT summarise the SPEC change in SPEC-INDEX by hand beyond what the regen
    preserves — but add Quick Lookup topic lines for the new section/codes.

## Verification
- `bun test compiler/tests/{unit,integration,conformance} --bail` green via the pre-commit hook (never `--no-verify`).
  Some tests may grep SPEC text or §34 rows (catalog-consistency tests) — make them pass by correct SPEC text, not by
  editing the tests unless a test asserts a now-superseded sentence (then say so explicitly).
- Every normative sentence you add is checkable against the rulings — list each with its ruling line in progress.md.
- If a ruling leaves a genuine gap the SPEC must fill (e.g. the exact END-token list, `.Variant :>` disambiguation),
  write your best reading, mark it `PA reading — for veto` inline in progress.md, and list it in your report.

## Report
worktree · branch · FINAL SHA · files touched · new/changed codes · every "PA reading — for veto" · R1–R3 reproduction
results · conformance cases that must flip (by path) · test counts · path-discipline incidents.
