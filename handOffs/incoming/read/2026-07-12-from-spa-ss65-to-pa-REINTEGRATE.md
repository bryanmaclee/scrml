# sPA ss65 → PA — RE-INTEGRATE `spa/ss65`

**List:** `spa-lists/ss65-conformance-meta-22.md` (conformance: §22 `^{}` meta / E-META-*)
**Branch:** `spa/ss65` · **worktree:** `../scrml-spa-ss65` · **base:** `origin/main` @ `40b580c5`
**Branch tip SHA:** `50039496`  (2 commits — see below)
**Status:** COMPLETE — 13/13 items landed-on-branch · **0 parked** · 0 dropped

## Commits to re-integrate (in order)
1. `6ff46b6e` — `test(conformance): mint §22 ^{} meta E-META-* cases — new meta/ category` — the 14 cases (full-suite pre-commit hook PASSED).
2. `50039496` — `chore(spa ss65): mark meta §22 cases landed + progress log` — list + `ss65.progress.md` (docs-only; hook skipped suite).

## What landed
New `conformance/cases/meta/` category (14th), **14 cases**, suite **386 → 400** (all 14 PASS, incl. 3 runtime (b) halves). First conformance coverage of the E-META-* family (corpus had 0).

| item | case-id | asserts |
|---|---|---|
| 1 | `meta-jshost-global-neg` | E-META-001 |
| 2 | `meta-invalid-token-neg` | E-META-002 |
| 3 | `meta-reflect-unknown-type-neg` | E-META-003 |
| 4 | `meta-mixed-patterns-neg` | E-META-005 |
| 5 | `meta-lift-in-block-neg` | E-META-006 |
| 6 | `meta-sql-in-runtime-block-neg` | E-META-007 |
| 7 | `meta-reflect-outside-block-neg` | E-META-008 |
| 8 | `meta-nested-block-neg` | E-META-009 |
| 9 | `meta-compiler-namespace-neg` | E-META-010 |
| 10 | `meta-reflect-clean-pos` | notCodePrefixes E-META- |
| 11 | `meta-emit-clean-pos` | notCodePrefixes E-META- |
| 12 | `meta-emit-splice-render-rt` | (b) domAnchored `#x`="hi" |
| 13 | `meta-emit-raw-escape` | (b) domAnchored `#n`="a\nb" (raw verbatim) |
| 13b | `meta-emit-normalize-escape` | (b) domAnchored `#n`="a b" (emit normalized — bonus sibling) |

E-META-004 correctly NOT authored (SPEC §22.11: Reserved).

## LOAD-BEARING FINDINGS (PA review before merge)

1. **Item 1 renamed `meta-runtime-var-in-compiletime-neg` → `meta-jshost-global-neg`.** The list's PRIMARY trigger (a runtime `@var` inside a compile-time `emit` block) fires **E-META-005**, not E-META-001 — and that's SPEC-correct: such a block is a §22.8 phase-mix, and the §22.11 condition-(1) "runtime-var-in-compile-time" E-META-001 co-requires a compile-time API + a runtime value, i.e. it is ALWAYS also a phase-mix, so E-META-005 structurally shadows it and **E-META-001 cond-(1) is not isolable from source.** Pinned E-META-001 via the list's sanctioned alt-trigger — a JS-host ambient global (`console`) in a `^{}` body (§22.11 cond-(3) / §22.12 Approach-C), which fires E-META-001 cleanly and alone. The rename avoids a permanently-misleading corpus id; the finding is documented in the case description + the list item. **Possible SPEC note for you:** if E-META-001 cond-(1) is genuinely unreachable from source, §22.11 could footnote that (not blocking; corpus is honest as-is).

2. **Item 13 realized as a PAIR** (`meta-emit-raw-escape` + `meta-emit-normalize-escape`). The `\n` normalization is invisible from a single-line `<pre>a\nb</pre>` source — the scrml string tokenizer converts `\n`→real newline before emit/emit.raw ever see it (both collapse to "a b"). The §22.4.1 distinction only surfaces with a LITERAL backslash-n (double-backslash `\\n` source): `emit.raw`→verbatim "a\nb", `emit`→"a b". Authored both so the contrast is honest (each alone is weak). Both carry mandatory `spec`+`rationale`.

## sPA-side verification (adversarial, not confirmatory)
- Independent full `bun conformance/run.ts` re-run (not the agent's) = **400/400**.
- Direct `compileScrml` code-dumps confirmed E-META-002 & E-META-009 actually fire (not a trivially-satisfied assertion); splice case emits [] codes and relies on domAnchored as designed.
- **Main checkout `git status` clean** — no worktree→main leak; cases are additions-only (no tracked file modified).

## Landing note
Consolidated per-case → **one cohesive category commit** (`6ff46b6e`) instead of 14 per-case commits, to avoid 14× full-suite pre-commit hooks under concurrent-PA (S252 held commit-lock) OOM risk. Flagging since the list said "commit per-case."

— sPA ss65
