# BRIEF — s462-data-rules-as-data

Change-id: `s462-data-rules-as-data`. Dispatched S462 (2026-10-09). Agent: scrml-js-codegen-engineer, isolation worktree.

## The ruling (quote, do not reinterpret)
bryan S462 "a, b" (scrml-support/user-voice-scrml.md §S462, Q17): `scrml:data` validator rules become DATA — an enum of predicates mirroring the §55 universal-core vocabulary (`.Min(3)` / `.Pattern(re)` / `.OneOf(set)` …) that `validate(data, schema)` matches on; `custom(fn)` becomes a named function PASSED at validate time (`validate(data, schema, { checks: [checkSku] })` — note: an array of functions in an options object is itself a stored function; design the passing so no function lands in a value: e.g. a trailing variadic/positional argument, `validate(data, schema, checkSku, checkX)`, or a single `check` function argument — report your choice), never stored. Context: S462 "no value holds a function" (§14.3 extended) and its Q16/Q17 migration package; this lands BEFORE the E-VALUE-FUNCTION-STORED refusal. Public API redesign of scrml:data.

## Read first
SPEC §41 (scrml:data sections incl. validate/isValid/firstError/predicate builders, §41.12 registerMessages if adjacent), §55.1 (universal-core vocabulary — the enum MUST mirror it word-for-word where it overlaps), §55.9 (ValidationError), §53.14.4 (the zod-bridge / synonym-detection note), the B3 audit `../scrml-support/docs/deep-dives/b3-stdlib-data-validate-vocab-audit-2026-05-11.md` (READ-ONLY; it explains why scrml:data rule-builders are a fourth library layer). stdlib/data/*.scrml + compiler/runtime/stdlib/data.js (the runtime shim — both must agree; the .scrml gives the export table).

## Scope
- Rule enum (name it; e.g. `Rule`) covering every existing builder (`makeRule`-based): the §55.1 predicates + the library builders (email/url/numeric/integer…). Schemas are data (struct/map of field → Rule[]). `validate` / `isValid` / `firstError` match on the enum; error output unchanged in shape (ValidationError tags) — prove identical results on every existing test.
- `custom(fn)` replaced per the ruling (passed, never stored).
- Migrate every caller (stdlib, examples, samples, conformance, docs/kickstarter/website code, tests). Adopter repos READ-ONLY (flogence/giti/6nz): report sites.
- No §63 window (stdlib API change, changelog note) unless you find a reason; report.
- Re-run the Phase-1 prototype (`/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-af4160785d7ecd763/docs/changes/s462-no-function-in-value/phase1-prototype.patch`, apply in a scratch copy only, never commit) — stdlib/data must be 0.
- Sibling: s462-stdlib-closure-factories (http/auth/store/oauth) and s462-register-messages-templates (stdlib/data/messages.scrml comments, runtime messages) are unmerged — stay out of those files except where unavoidable; expect a 3-way merge.

## Gates (ALL — two sibling PRs went red on CI-only gates)
pre-commit · conformance · browser tier as ci.yml · `bun run types:check` · the `tracking` tiers (integration + lsp + commands) as ci.yml · `bun scripts/s34-census.ts --check-new --base <origin/main SHA>` · facts/spec-index --check.

## Process (non-negotiable)
F4 startup gate · `bun install` + `bun run pretest` from the worktree CWD · commit after each change + append-only timestamped `progress.md` · first commit `WIP(s462-data-rules-as-data): start at $(pwd)` · never `git stash` / pattern `pkill` / `--no-verify` / hooksPath · TMPDIR unset or `~/.cache/scrml-agent-tmp/s462-data-rules-as-data/` · anti-pattern briefing: read `../scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md` + `docs/articles/llm-kickstarter-v2-2026-05-04.md` before writing scrml · past ~70% context: commit, progress.md, report.

## Report
WORKTREE_PATH · FINAL_SHA · API before/after · Rule enum definition · custom-check passing design · migrated sites · adopter sites · prototype re-measure · gates · direction-setting choices for bryan's veto.
