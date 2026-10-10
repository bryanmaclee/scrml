# BRIEF — s462-decl-use-attr-refuse (dpa-069 / O18, R-now)

Change-id: `s462-decl-use-attr-refuse`. Dispatched S462 (2026-10-09). Agent: scrml-js-codegen-engineer, isolation worktree.

## The ruling (quote, do not reinterpret)
bryan S462: "I really like X so I accept your rec as a ratified path to X" (scrml-support/user-voice-scrml.md §S462 — read that entry IN FULL). Read the deep-dive `../scrml-support/docs/deep-dives/undeclared-use-site-attributes-o18-dpa-069-2026-10-08.md` IN FULL (read-only sibling repo) — §1 premise corrections, §2 governing text, §6 security, §7 rec, §9 defects D-1..D-n.
This change implements ITEMS 1-7 (R now). It does NOT build X (explicit forwarding) — X waits on the O46 spelling ruling — but it SPECIFIES X in SPEC as the ratified destination (Nominal, not built), so R is not read as permanent:
1. An undeclared attribute on a plain use, or on a `<*x>` reference (beyond the already-ruled `if=`), of a §66 declaration is **E-DECL-USE-ATTR**, fail-closed Error. Add its §34 row and §66.20 row (the bootstrap already emits it — `compiler/self-host-v2/analyze.scrml` ~L8330/L8356, `severity.scrml` "no §34 row"; PA-located-verify). Make the bootstrap's emission match the ruled scope exactly (every undeclared attribute incl. `class`, `style`, `id`, `aria-*`, `data-*`, `on…`; `key=` per item 6).
2. REVERSE §66.15.1's S435 "static-attribute class merging (§15.5, §15.7) … carry over" for class merging, out loud (keep `fixed`; leave "spread" to O46), with `> **Provenance:** ruling:user-voice-scrml.md S462 "ratified path to X" · supersedes: ruling:S435 (class merging carry-over row)`. Mark the S435 sentence superseded IN PLACE (same-landing discipline).
3. STRIKE §15.5's "`id=` makes that instance a singleton" (~L14140; never implemented); resolve the §15.10 contradiction in §15.10's direction.
4. Amend §66.14 rule 4 → "a **declared** use-site attribute is construction".
5. Scope: the §66 dialect only. impl#1's legacy `const X = <…>` form is UNCHANGED (its §63 deprecation window). Do not touch impl#1 component expansion except where the conformance-case move (item 7) requires.
6. `key=` on a component use is refused now (under the §66 dialect: E-DECL-USE-ATTR or the existing O41 code if SPEC already names one — find it; state which).
7. Move D1's two `undeclared-attr-*` sink cases (they exist only on branch `s459-d1-r8`, unmerged — `git fetch origin s459-d1-r8` read-only; on main the analogues are `declared-prop-on-attr-lift-listener-pos` / `declared-prop-srcdoc-each-lift-neg`) onto PLAIN elements so the sink coverage survives; do not delete coverage.
**X specification (Nominal, not built):** a new §66 subsection naming the ratified destination: a declared, element-typed rest (`...attrs:<button>` — spelling marked PENDING O46) on a named element in `renders`; the four security conditions verbatim from the DD §6 (desugars at ONE site into ordinary body-authored attributes; static key set per use; `on…` composes never replaces; `srcdoc` and `on…` text never forwardable); compiler-owned merge (`class` concatenates, `style` merges per property caller-wins, handlers compose component-first). Mark O18 RULED and O46 as the remaining blocker in §66.22.

## Measurement
Corpus impact of the refusal by compiling (not grepping) samples/ examples/ stdlib/ conformance/ + gauntlet-r25 + the bootstrap-dialect test corpora; the DD measured 0 adopter sites. Report every newly-refused site; non-zero beyond deliberate fixtures → report, don't migrate.

## In-flight siblings (expect merges; the PA merges)
s462-own-value-inference (§66.3/§66.9/§66.14/§66.20/§66.22 + bootstrap typer) — likely the closest overlap: keep §66 edits tight and in your subsections. Others: given/is-some/narrowing/channel-006/stmt-match-leave.

## Process (non-negotiable)
F4 startup gate · `bun install` + `bun run pretest` from the worktree CWD · commit after each change + append-only timestamped `progress.md` · first commit `WIP(s462-decl-use-attr-refuse): start at $(pwd)` · never `git stash` / pattern `pkill` / `--no-verify` / hooksPath · TMPDIR unset or `~/.cache/scrml-agent-tmp/s462-decl-use-attr-refuse/` · run ci.yml bootstrap steps + browser-tier + `bun run types:check` · regenerate SPEC-INDEX / FACTS / bootstrap-conformance · past ~70% context: commit, progress.md, report.

## Report
WORKTREE_PATH · FINAL_SHA · files · SPEC sections changed (incl. the superseded S435 sentence) · bootstrap emission scope before/after · corpus measurement · direction-setting choices for bryan's veto.
