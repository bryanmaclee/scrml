# ss54 sPA re-integration → PA

**List:** `spa-lists/ss54-token-set-emit.md` (single item, SURVEY-FIRST, flogence-coordinated)
**Branch:** `spa/ss54` · **tip:** `f30f79da` · **base:** `origin/main` @ `2f8d2bd0` (1 commit ahead, 0 behind)
**Date:** 2026-06-28 · **Built:** PA-direct in worktree `.claude/worktrees/spa-ss54` (single contained item)

## Landed
| item | status | SHA |
|---|---|---|
| `token-set-emit` (`--emit-token-set`) | **landed-on-branch** | `f30f79da` |

**Parked:** none. **Dropped:** none.

## What landed
The scrml-side half of the flogence S17 docs↔code-drift DD (ratified). A new
`--emit-token-set` CLI flag emits ONE `token-set.json` per compile — a cheap read-only
projection flogence consumes as a second flograph currency pass to flag a doc citing a
now-dead symbol. Mirrors the `--emit-reachability` / `--emit-engine-graph` precedent
(lazy `result.tokenSetJson()` on the api.js return; CLI-only write in `commands/compile.js`;
no flag → no artifact, zero overhead).

Files: `compiler/src/token-set.ts` (new, 252L) · `tokenizer.ts` (export `KEYWORDS`) ·
`api.js` (lazy result fn) · `commands/compile.js` (flag + usage + emit) ·
`tests/unit/token-set.test.js` (14 tests, R26 real-compiled-AST) ·
`docs/changes/token-set-emit-2026-06-28/BRIEF.md`.

## Verification
- 14/14 new unit tests green; 45+61 targeted regression (api/block-analysis/tokenizer) green.
- **Full pre-commit suite GREEN** (the hook commits only on pass; `f30f79da` is a green landing).
- R26 CLI on `examples/02-counter.scrml`: `token-set.json` well-formed — 5 symbols with kind
  (3 `function`, 2 `state-cell`), 461-entry §34 code set (E/W/I), keyword vocab + `scrml:` stdlib
  namespaces, version `01ifuy50`. Without the flag: no artifact.

## OQ resolutions (2 from the list + 1 surfaced — confirm before forwarding to flogence)
1. **version / identity key = fnv1a CONTENT FINGERPRINT** (8-char base36, §47.1.3 machinery).
   The re-check invariant flogence stated ("changes when the symbol set changes; stable when
   source unchanged") IS a content hash. A monotonic / commit-SHA key would churn on every
   commit even when symbols don't → false "re-check needed" churn. It is semantically a
   FINGERPRINT, not a version number — flag this to flogence so its re-check stores the hash a
   doc was validated against and re-checks on hash-change.
2. **per-symbol `kind` = YES.** v1 enum: `function|component|engine|type|channel|state-cell`.
   `enum-variant` / `server-fn` (vs pure) / `stdlib-export` granularity DEFERRED — a removed
   function is dead regardless of server-ness; stdlib vocab rides the `keywords` field.
3. **⚠ SURFACED (not anticipated by the list): §34 has NO programmatic catalog.** 461 `(E|W|I)-*`
   codes scattered as string literals; §34 is SPEC prose. Chose **LIVE SOURCE-SCAN** of
   `compiler/src` (`import.meta.url`-relative; bun runs from source). Rationale: over-inclusion
   is SAFE (the oracle flags codes ABSENT from the set → an over-broad set only loses
   true-positives, never adds false ones); a committed registry would impose a per-diagnostic
   refactor-tax (co-location axiom) AND be a second identity store (constraint ii); live-scan is
   drift-free + anti-ouroboros. **Risk flagged:** depends on the run-from-source distribution
   model — a future bundled package without `compiler/src` would need a generated-constant
   fallback. **PA call wanted:** ratify the scan, or escalate the catalog question.

## Coordination-back to flogence (PA-owned at re-integration — draft below)
> scrml ships `--emit-token-set` → `token-set.json` (one per compile, in outputDir). FINAL contract:
> - `version` = **content fingerprint (fnv1a 8-char)**, NOT a monotonic version. Store it; re-check a
>   doc's citations when the fingerprint changes.
> - `symbols`: `[{name, kind}]`, kind ∈ {function, component, engine, type, channel, state-cell}.
>   (enum-variant / server-fn / stdlib-export deferred — ask if tiering needs them.)
> - `errorCodes`: the §34 (E|W|I)-* set (live source-scan; over-inclusive-by-design).
> - `keywords`: tokenizer reserved words ∪ `scrml:<module>` stdlib namespaces.
> Wire the consuming currency pass to this shape. Confidence-tiering (code-form high / bare-prose
> low) + absence≠currency stay flogence-side (DD constraints iii/iv).

## Notes for the PA
- The worktree `.claude/worktrees/spa-ss54` is left in place (clean tree). Remove at re-integration.
- The 6 `gauntlet-s20/__fixtures__/import-resolution/*.scrml` deletions in MAIN's working tree are a
  full-suite test-run side-effect (same 6 were already deleted at session start) — NOT from this
  work; the landed commit `f30f79da` contains exactly the 6 token-set files.
- `spa-lists/ss54-token-set-emit.md` marked landed; `spa-lists/ss54.progress.md` written.
