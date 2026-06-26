# sPA ss37 → PA — re-integration: value-native Set LANDED

**List:** `spa-lists/ss37-value-native-set.md` (value-native Set §59.12 un-defer — SURVEY-FIRST).
**Branch:** `spa/ss37` — **tip `70b11383`** (`origin/main...spa/ss37` = `0 1`; 1 commit ahead, no leak).
**Date:** 2026-06-26. **Status: COMPLETE — 1/1 landed, 0 parked, 0 dropped.**

## Items

| # | Item | Status | SHA |
|---|------|--------|-----|
| 1 | value-native Set `set[K]` §59.12 (B2 map-alias) | **landed-on-branch** | `70b11383` |

## What landed (`70b11383` — single squash commit, 19 files, +1047/-21)

`set[K]` value-native Set as a **thin desugar over the §59 value-native map** — NO new runtime structure / literal / codec. Mirrors the S169 Map landing D1-D4:

- **D1 type-system:** `MapType.set` flag + `tSet()` (`set[K]`→map `[K:bool]` w/ internal `true` marker) + `set[K]` resolution/diagnostic display/leaf-scan + set-aware `E-MAP-BRACKET-WRITE`. A set IS a map → inherits key-comparability §59.4, bracket-write gate §59.7, order-independent `==` §59.9, §57 codec.
- **D2 parser:** NO-OP by design (native `collectTypeAnnotation` captures `set[K]` generically — verified empirically; no ast-builder change, no `.scrml` mirror re-sync needed).
- **D3/D4 codegen:** `collectSetVarNames` (strict subset) + `isSetTypeAnnotation` (set cells join `collectMapVarNames` → `.has`/`.remove`/`.size`/bracket-read ride `_scrml_map_*` free) + `fileHasSetAlgebraUsage` (precise stdlib-data chunk gate) + emit-expr set-method interception (`.add`→`_scrml_map_insert(s,k,true)`; `.elements`/`<each in=@s>`→`_scrml_map_keys`; `.union`/`.intersect`/`.difference`→delegate to shipped `scrml:data` algebra, rebuilt via `_scrml_map_from_entries`).
- **SPEC:** §59.12 set bullet NOMINAL→IMPLEMENTED; §59 banner + SPEC-INDEX §59 row currency. Worked example `examples/34-value-native-set.scrml` (freight-lane certification; full surface + algebra).
- **Adjacent root-cause fix (Rule 3):** `deepEqualExprNode` had no `case "map-lit"` (fell to `default:return false`) → the examples-corpus idempotency invariant rejected ANY `[:]`/`[k:v]` init. Latent (no example used a map-lit init until ex.34). Fixed + regression coverage.

## sPA verify — TWO things for PA awareness

1. **R26 adversarial catch (allowlist re-baseline):** the dev-agent's "full suite" run covered `unit+integration+conformance` subdirs — **the same scope as the pre-commit hook** (`bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance`). That scope EXCLUDES the top-level `compiler/tests/parser-conformance-*.test.js`. On the TRUE full `bun test compiler/tests/` (25,689 tests) the M6.5.b.0 within-node parser-conformance gate flagged `examples/34` over-budget (residual 191, no allowlist entry). I diagnosed it as ORDINARY native-vs-within-node span/field divergence (class breakdown SPAN-COORD 84 / MISSING-FIELD 63 / FIELD-SHAPE 30 / EXTRA-FIELD 11 / KIND-NAME 3 — normal for an example this size; **NOT** a set-specific parser divergence — KIND-NAME only 3, and the parser was a verified no-op). Re-baselined per the brief mandate → full suite **0 fail / 25474 pass**. **Allowlist entry committed in the land commit.**
   - **Process note for PA:** the pre-commit hook scope ≠ the true full suite. Top-level parser-conformance gates only fire on `bun test compiler/tests/` (or CI). Any fixture-adding landing needs the full-suite check, not just the hook.

2. **ss37↔ss38 sequencing — DISSOLVED, not deferred.** The list's S25 correction said "sequencing still live (build HAMT+Set in sequence)." Because B2 Set is a **pure desugar to map calls** (adds no runtime structure), it is **rep-agnostic** — it rides whatever the map rep is (COW today, HAMT after ss38). Landing on COW now is explicitly sanctioned by the ss38 list ("if ss37 landed on COW, HAMT-swap map+set together"). **ss38 has NOTHING set-specific to do**: swapping the map rep automatically covers set. No blocker, no follow-up coupling.

## PA actions

- FF-merge `spa/ss37` (`70b11383`) → `main` when ready; push.
- No parked items, no open forks. The B2 shape ruling (S222) is fully implemented + SPEC banner flipped.
- The dead agent worktree `af02d2a2d5cbd78ee` (locked) + the squash-merged branch `worktree-agent-af02d2a2d5cbd78ee` can be pruned at re-integration. (Stale: `worktree-agent-a409e8bad30aa78b2` = already-landed ss31 fixes; `worktree-agent-ab768e048f3be4faf` = empty.)
