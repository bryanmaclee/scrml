# BRIEF — s462-is-some-deprecate

Change-id: `s462-is-some-deprecate`. Dispatched S462 (2026-10-09) by the PA. Agent: scrml-js-codegen-engineer, isolation worktree.

## The ruling (quote it, do not reinterpret)
bryan, S462, "a, validator too, go" (scrml-support/user-voice-scrml.md §S462): the expression form `x is some` is SOFT-DEPRECATED through the SPEC §63 lifecycle — W-lint (parses and runs identically), a reserved E-code in §34, a `scrml fix` rewrite → `x is given`. AND the §55.1 universal-core validator predicate `is some` retires on the same window to `is given`. Corpus migrates in the same landing (PA estimate: 241 sites, 94 in stdlib — MEASURE).
PA readings (bryan veto window): codes `W-IS-SOME-DEPRECATED` (fires) + reserved `E-IS-SOME-DEPRECATED` — one pair for both surfaces unless you show they must differ. The `ValidationError.NotSome` runtime tag is NOT renamed in this landing (a matchable runtime tag rename is a separate break) — leave it, and report what the tag would naturally be called.
Context: S460 a′ — bare `x` on `T | not` in a condition is the presence test; `x is given` / `x is not` is the explicit pair; `is some` was accepted as an alias of `is given` (SPEC §42.2.2a / §42.2.4 / §42.3.5 item 2).

## Governing sentences (read IN FULL before any edit)
- SPEC §63.2 + §63.4 + §63.5 (`compiler/SPEC.md`, grep `### 63.`): a well-formed deprecation co-lands {W-lint parsing IDENTICALLY} + {reserved E-code in §34} + {a `scrml fix` rule}; MUST NOT name a removal version; deprecated form runtime-identical; the W-code is conformance-required.
- SPEC §42.2.2a, §42.2.4, §42.2.5 (`is some` vs `req`), §42.3.5, §42.4; §55.1 (universal-core vocabulary), §55.9 (ValidationError), §55.12 (short-circuit on `req`/`is some`), §39.5.7/§53.6.1 if `is some` appears in schema/refinement position — find every locus the word is normative and handle each (expression, validator, refinement, schema). Report the full list.
- First verify `is given` is implemented on impl#1 in EVERY position `is some` is (expression, compound, narrowing, validator, refinement). Where `is given` is missing, the canonical form must be made to work FIRST (that is conformance restoration under the S460 ruling) — else the fix rule would rewrite to a form that doesn't compile. Report each gap you closed.

## Deliverables (one logical unit)
1. SPEC: soft-deprecation banners at each normative locus + `> **Provenance:** ruling:user-voice-scrml.md S462 "a, validator too, go"`; §34 rows; add to the retired-forms table (§66.21 / §63.7 — find the existing table, do not invent one); §42.2.5's `is some` vs `req` table re-worded around `is given`. Regenerate SPEC-INDEX, FACTS, bootstrap-conformance and any doc whose `--check` goes red.
2. impl#1: emit `W-IS-SOME-DEPRECATED` at every `is some` (expression + validator + any other locus). Mirror an existing deprecation lint (precedents: `W-GIVEN-ARROW-LEGACY`, `W-PURE-DEPRECATED` — PA-located-verify in `compiler/src/ast-builder.js` / `compiler/src/type-system.ts`; report held/refined/wrong). Ensure no duplicate-firing per site.
3. `scrml fix` rule (`compiler/src/commands/fix*.js`): AST/span-driven (overlay Rule 7 — no regex over source text in a post-AST stage), idempotent, fail-closed on anything it cannot rewrite safely. Includes the validator form.
4. Migrate the whole corpus with the rule (samples/, examples/, stdlib/, conformance/, compiler/tests fixtures not deliberately testing `is some`). Tests that test `is some` keep it and assert the W-code. MEASURE + report count/files.
5. INERT proof: emitted artifacts across the corpus byte-identical before/after the migration (or differing only in ways you explain); diagnostics differ only by the new W-code on un-migrated deliberate sites.
6. Conformance: W-code on expression + validator forms; runtime identity deprecated vs canonical.
7. Bootstrap (`compiler/self-host-v2/`): if it parses `is some`, owe the W twin — implement if small, else file a gap with `locus=`. Stdlib/bootstrap `.scrml` sources migrate too if they use it.

## Interaction with in-flight work
A sibling agent (`s462-given-presence-deprecate`) is concurrently deprecating in-place `given` — it edits SPEC §42.2.3, §34, the `scrml fix` registration, generated docs, and possibly the same lint file. Keep your edits to your own loci; expect a 3-way merge of shared files at landing (the PA does it). Do NOT touch `given` handling. PR #1380 (another session) fixes `given @cell` lowering — don't touch.

## Process (non-negotiable)
- F4 startup gate. `bun install` + `bun run pretest` from the worktree CWD.
- Commit after each change; `docs/changes/s462-is-some-deprecate/progress.md` append-only, timestamped. First commit: `WIP(s462-is-some-deprecate): start at $(pwd)`.
- Never `git stash`; never pattern `pkill`; never `--no-verify`; never touch hooksPath. TMPDIR unset or `~/.cache/scrml-agent-tmp/s462-is-some-deprecate/`.
- Run the browser-tier gate step exactly as `.github/workflows/ci.yml` runs it, and `bun run types:check`, before reporting.
- Context budget: past ~70%, commit, write progress.md, report.

## Report
WORKTREE_PATH · FINAL_SHA · files touched · normative-locus list · `is given` gaps closed · measured corpus count (command + files) · inert proof · locus hypothesis held/refined/wrong · bootstrap disposition · every direction-setting choice (for bryan's veto).
