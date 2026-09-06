# progress — native-bridge-field-carrying-survey-2026-09-06

SURVEY dispatch. Nothing under `compiler/` was modified; every artifact and every instrument
lives under this change-dir (plus `scripts/native-parser-flip-harness.ts`, imported
byte-identical from `c7d46179` and not modified — it is not in `origin/main`, so the worktree
did not have it).

## Instruments (all survey-only)

| file | what it does |
| --- | --- |
| `bridge-survey-codes.ts` | STAGE 1 — per-case control-vs-native diagnostic code diff over the whole 897-case corpus, through `compileScrml` with the `scrml-native` parser option, `I-PARSER-NATIVE-SHADOW` filtered so it matches the harness's `--mode=routing`. |
| `parse-raw-attribution.ts` | Attributes each of the 271 harness failures to its assertion site, resolving line -> assertion name by reading `corpus-bridge.test.js`. |
| `bridge-survey-astdiff.ts` | STAGE 2 — parses each failing case through BOTH front-ends and reduces the two FileASTs to a key/type divergence signature set. |
| `bridge-survey-repair.ts` | STAGE 3 — the CAUSAL test. Injects a repaired native AST via the `selfHostModules.buildAST` override in `compileScrml` (no file patch, no `parser` option) and re-measures. Includes ORACLE repairs that copy from the live AST — measurements, not implementable fixes. |
| `bridge-survey-valuediff.ts` | STAGE 4 — closes stage 2's blind spot: same key, same type, different VALUE produced no signature. |
| `inspect-case.ts` | Dumps LIVE vs NATIVE FileAST for one named case. |
| `tab-exclusive-codes.sh` | Which diagnostic codes are emitted ONLY from `compiler/src/ast-builder.js`. |

## Log

- Startup verified: worktree root, clean tree, `merge-base HEAD origin/main == origin/main`,
  `bun install`, `bun run pretest` (34 artifacts in `samples/compilation-tests/dist/`).
- Reproduced the headline with the committed harness, `--tier
  compiler/tests/conformance/corpus-bridge.test.js --mode=routing --no-pretest`:
  **CONTROL 0 fail / FLIPPED 271 fail**. `verified by execution`.
- Full pre-commit suite at HEAD: 29662 pass / 0 fail / 84 skip / 10 todo. `verified by execution`.
- STAGE 1: 897 cases; **156** with a newly-missing required code; **124** distinct codes;
  **0** cases where the flipped compile threw.
- Assertion attribution of the 271: 156 `r.missing` / 56 THREW in `runCaseRuntime` /
  23 `r.prefixViolations` / 23 runtime-half failures / 13 `r.forbidden`.
- STAGE 2 + 4 + 3: see `PREDICTIONS.md` for the three falsifiable predictions and their
  measured outcomes. Headline: every field-level repair recovers **0**; the text-field ORACLE
  recovers **8 of 156**.
- Found the third mechanism: 37 diagnostic codes are emitted ONLY from
  `compiler/src/ast-builder.js` — the live TAB stage the flip replaces wholesale, so the CHECK
  never runs. 21 are in the 124; 28 of the 156 cases affected; 11 of those have no other
  divergence.
