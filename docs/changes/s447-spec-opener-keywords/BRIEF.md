change-id: s447-spec-opener-keywords

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-discipline incidents to date: track yours, report 0 or N)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` equals it; clean tree; `git merge-base HEAD origin/main` == `git rev-parse origin/main`. Any failure: STOP, report, exit.
2. `bun install`.
3. EVERY Write/Edit uses an absolute path UNDER your worktree root. Never `cd` into /home/bryan-maclee/scrmlMaster/scrml (main). NEVER `git stash`. NEVER bare `pkill -f`.
4. First commit: this prompt verbatim → docs/changes/s447-spec-opener-keywords/BRIEF.md, message `WIP(s447-spec-opener-keywords): start at $(pwd)`. Then commit after each section; progress.md append-only. Never --no-verify; never touch core.hooksPath.

## Task — SPEC TEXT ONLY (do NOT edit compiler/src, compiler/self-host-v2, conformance cases, stdlib)
Write bryan's S447 ruling into compiler/SPEC.md §66 (Nominal / spec-ahead; impl#1 does not implement §66; the bootstrap at compiler/self-host-v2 does — its parser migration is a SEPARATE later dispatch, out of your scope).

**The ruling (authority: /home/bryan-maclee/scrmlMaster/scrml-support/user-voice-scrml.md, heading "RULED — \"your recs\": validated top-level cells get a validity surface …; keywords go OUTSIDE the declaration opener (option b) (S447)" — read it verbatim; item 2 is yours):**
- Words that say what kind of thing a declaration is go BEFORE the `<`: `export`, `let`, in JS order — `let <darkMode:bool=false/>`, `export let <on:bool=false/>`, `export <toggle …/>`.
- Inside the opener: only the name, `:Type`, `=value`, typed attributes, and flags true by presence (`req` and validators, `single`, `server`, `pinned`, `prepaint`, valued modifiers). No word inside an opener modifies the word after it.
- After the closer: `renders <markup>` (unchanged, §66.5.1).
- Sub-ruling 2: `renders` inside an opener → its own named error (message: "`renders` follows the closer (`/>` or `</>`)").
- Sub-ruling 3: `let <x/>` / `export <x/>` are recognized ONLY where declarations are items (program body, declaration body); elsewhere (e.g. inside a markup body) it is an error, never guessed as text.
- Sub-ruling 4: writable attributes become CHILD declarations; attributes are always locked data; §66.4 rule 6 retires. A use-site attribute still sets a child (O43, ruled S437).
- supersedes: ruling S435 "writable cells spelled `let`" — POSITION ONLY (the word `let`, `const` retiring, derived/seeded semantics all stand) — and §66.4 rule 6 (former O53).

**Read first:** the deep-dive /home/bryan-maclee/scrmlMaster/scrml-support/docs/deep-dives/opener-keyword-vs-attribute-2026-10-01.md IN FULL (Approach B is ruled; its worked program is the model; its "class" table enumerates every keyword; it lists the sections to touch: §66.0, §66.4, §66.9, §66.14, §66.19, §66.20, §66.21 and others). Then SPEC §66 in full (grep -n "^## 66\|^### 66" compiler/SPEC.md; ~1,900 lines — read it all in chunks).

**Do:**
1. Rewrite every §66 example and rule to the ruled form (24 `<let ` occurrences + attribute `let`/`export let` forms). Keep §66's "Notation" paragraph accurate. Rewrite §66.9 rule 2 (the prefix sentence) — keep `let` = the `replace` grant.
2. §66.4: retire rule 6 with a dated ⚑ banner + `> **Provenance:** ruling:user-voice-scrml.md S447 … · supersedes: ruling:S435 …` line; restate writable/exported attributes as child declarations; show the toggle example from the DD.
3. §66.19 worked programs (incl. §66.19.4 swatch) rewritten; note the cost honestly where a one-liner grows.
4. §66.20: name the new diagnostics (named only; §34 rows land with the impl per Rule 4): renders-in-opener; `let`/`export` before a tag outside an item position; `let` inside an opener (the S435 spelling) — choose clear E-codes consistent with the §66.20 naming scheme; also add the missing `E-GRANT-LET-ON-SEQUENCE` row the DD found absent.
5. Inline `> **Provenance:**` at each amended normative section (pa-base Rule 4b).
6. docs/PA-SCRML-PRIMER.md: update the §66 banner sentence that shows `<let count:int=0/>` (and any other §66 `let` example) to the ruled form; one line noting the S447 ruling.
7. `bun run scripts/regen-spec-index.ts`; update the §66 row summary in compiler/SPEC-INDEX.md if it names the `let` prefix; `bun scripts/facts.ts` if it gates line counts (run `bun scripts/facts.ts --check`).
8. Do NOT touch any other section's semantics. If you find a sentence elsewhere (e.g. §6, §15) that shows the S435 `<let` form, update it too and list it.
9. File the deep-dive's side findings as ONE new docs/known-gaps.md entry (bootstrap, sev=MED, locus=compiler/self-host-v2/<the parser file — find it>, prov=dd:opener-keyword-vs-attribute-2026-10-01): the bootstrap accepts `<let signup>` with no type as a declaration; `<n:int[append]=0/>` passes with no error; `<let/>` passes silently; plus "bootstrap parser still implements the S435 opener `let` — migration owed to the S447 ruling (b)". Then `bun scripts/state.ts --write` and `--check`.

Verify: `grep -n '<let ' compiler/SPEC.md` → only in explicitly-labelled superseded/legacy text; `bun test compiler/tests/unit --bail` passes (spec-text tests, e.g. SPEC-INDEX/FACTS gates, live there and in compiler/tests/*.test.js — run any test that greps SPEC.md).

Final report: worktree path, FINAL_SHA, files touched, sections amended, new diagnostic names, any place you were unsure (flag, don't decide), path-discipline incidents.
