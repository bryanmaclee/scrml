# scrmlTS — Session 169 (CLOSE)

**Date:** 2026-06-06
**Previous:** `handOffs/hand-off-173.md` (= S168 CLOSE).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-174.md` at next OPEN.
**Profile:** opened **A (FULL)** ("read pa.md"; default A). Autonomous land+push grant for the arc (S164-style) granted mid-session.

## 🏁 S169 CLOSE — VALUE-NATIVE MAP (§59) BUILT END-TO-END — phase c COMPLETE (D0–D4 + D2b + D2c + currency, all PUSHED) · `wrap`

Opened on **"start the map arc phase c"** → 4-parallel infra survey (→ `SURVEY-SYNTHESIS.md`) → grounded decomposition → the `<each ... as e>` iteration ruling (S169) → built the §59 map type **end-to-end on the default pipeline + native-parser parity + the sugar**. The value-native map is now in main. Also: copied the language-inspiration audit into scrmlTS (separate user request).

### SYNC / REPO STATE AT CLOSE
- **scrmlTS:** HEAD = the S169 wrap commit(s) atop **`40679720`** (D2b). **PUSHED this wrap** (incl. maps + §59 banner currency).
- **scrml-support:** user-voice S169 (iteration ruling + close addendum). **PUSHED this wrap.**
- **Version:** v0.7.0 (no tag — §59 was Nominal, now Implemented; reactivity/compiler-internal; no cross-repo notice — maps newly available but ZERO adopter demand yet, surface in a future dogfood).
- **Tests:** **23,330 pass / 0 fail / 220 skip / 1 todo** (~928 files) — **+239 across the arc** (S168 baseline 23,091). within-node **1006/0** (+1: the re-added `map-001-fare-by-lane.scrml` parity sample, allowlisted).
- **known-gaps:** HIGH **1** (Bug B — structural-compound deep-set mistarget, codegen, OPEN, unchanged) · MED **9** · LOW **18** (+2 S169 D4-surfaced: inline-handler `onclick=${@m=@m.insert()}` RHS not lowered + `@ordered`-literal-init unordered).
- **Maps:** refreshed for the §59-impl (project-mapper `a1e8cdc7c55de5324` — the schema/error/domain headers were stale saying §59 SPEC-ahead/no-impl). Watermark advanced. **[verify at the maps-commit step.]**
- **Worktrees:** **main ONLY** (all 7 dispatch worktrees cleaned at wrap). **Inbox:** empty. **Hooks:** Config B.

### THE MAP ARC — what landed (all PUSHED, each S67 file-delta + S138 verify)
| Piece | Commit | What |
|---|---|---|
| D0 | `2ad329ba` | §42.3.1 union-`not` normalization (`normalizeUnion` in `tUnion`; dedup-`not`-only; canary on the `[T,not]` recognizers). +17 |
| §59.8 | `cb5a8e71` | iteration ruling amendment (rides `<each ... as e>`, `.entries()`→`[{key,value}]` structs; `(k,v) in` tuple-opener rejected) |
| D1 | `fbb3c208` | type-system: `MapType`+`tMap`+`resolveTypeExpr [K:V]` recognition (`findMapEntryColon`) + `@ordered` + key-comparability (`isComparableType`/`classifyMapKey` → E-EQ-003/E-MAP-KEY-IS-MAP/E-MAP-KEY-NOT-COMPARABLE) + E-MAP-BRACKET-WRITE gate. +35. Additive `isFunctionField` sidecar (R28-8 precedent). |
| D2a | `5beb1f55` | legacy parser: `preprocessMapLiterals` scanner + `MapLitExpr`/`MapEntry` node + unmask + E-MAP-LITERAL-MALFORMED/W-MAP-STRUCT-KEY-LITERAL/W-MAP-DUPLICATE-LITERAL-KEY. +24 |
| D3 | `c7bcecf1` | runtime: `_scrml_fnv1a`+`_scrml_value_canonical` (§59.5 hasher) + tagged `{__scrml_map}` structure + 14-method surface + lossless §57-codec + order-indep map-`==` in `_scrml_structural_eq` + `'map'` chunk. +59 **[NUL-byte in its test caught + stripped — see process]** |
| D4 | `18c61c99` | codegen capstone: `collectMapVarNames`/`fileHasMapUsage` + `mapVarNames` threaded → emit-expr map-lit/read/method/`.size` lowering + chunk-trigger + `W-MAP-ITERATION-ORDER`. **END-TO-END R26 PASS.** +60 |
| §59 currency | `8963ae52` | banner Nominal→Implemented + §59.10 `@ordered`-wire clarification + §6.2 cross-ref + known-gaps +2 |
| D2c | `19712a07` | `<each in=@m.entries() as (k,v)>` destructure sugar (both paths + codegen). R26 PASS byte-identical. +17 |
| D2b | `40679720` | native-parser map literal parity (token-level; cleaner than D2a's unmask). +22 + the parity sample. |

### §59 DESIGN DISPOSITIONS RATIFIED/RESOLVED THIS SESSION
1. **Iteration form (S169 user ruling, user-voice S169):** `<each in=@m.entries() as e>` + `e.key`/`e.value`; `.entries()`→`[{key:KeyT, value:ValT}]` structs; optional `as (k,v)` positional sugar (§14.11). The `(k,v) in` tuple-opener REJECTED (no tuple type).
2. **§59.10 @ordered-wire (PA-ratified, spec-consistent):** the codec is bit-stable (canonical key order); an `@ordered` map's insertion order is NOT wire-preserved — "lossless" = `==`-preserving (§59.9 decouples order from value-identity); the two are mutually exclusive for `@ordered`. §59.10 clarified.
3. **struct-key literal codegen = emit-if-trivial** (the runtime hashes any §45-key; W-MAP-STRUCT-KEY-LITERAL is advisory, not a hard defer).

### OPEN / NEXT (S169 → next arc)
1. **D5 = a separate next arc (user chose wrap):** (a) **`set` — UNRATIFIED design.** §59.12 deferred it; S166 flagged it as the "thinner warrant — maybe not needed" (array + `scrml:data` helpers may cover it; the user's "baby with the bathwater" doubt). Wants a deep-dive/debate (no-batch-ratify) on warrant + shape (first-class `set` vs derived-from-map [map-keyed-to-self] vs `scrml:data` array helpers vs drop). (b) **self-host migration** — 130 `new Map`/`new Set` → value-native map; P3 bridge; NOT a v1 blocker.
2. **Carry-forward gaps (all LOW/deferred):** inline-handler `onclick=${@m=@m.insert()}` RHS not lowered (fix = thread `mapVarNames` into `rewrite.ts`); `@ordered`-literal-init unordered (documented v1 limit); native bracket-write→COW promotion (orthogonal native parity); native `[string:int]` type-annotation whitespace normalization (orthogonal); **§6.2 Shape-4 canonical-empty-for-map UNVERIFIED** (does a no-RHS `<m>: [K:V]` decl resolve to `[:]`? D1 didn't explicitly cover it — adopters write `= [:]` for now).
3. Bug B (HIGH, structural-compound deep-set mistarget at `emit-logic.ts:3003`) — unchanged, queued.

### PROCESS NOTES (durable for the next PA)
- **Autonomous land+push grant held end-to-end** (review→file-delta→independent-verify→push per dispatch; surfaced only on the iteration ruling + the milestone/D5 checkpoints). The pre-commit + pre-push gates ARE the independent re-verify in main.
- **2 background-agent stalls recovered (S149 class):** D2 watchdog-stall mid-scanner → SPLIT D2 into D2a (legacy, focused) + D2b (native) + D2c (sugar) to shrink per-agent scope; D3 socket-death mid-startup → re-dispatched fresh. Both lost ZERO landed work (incremental commits + the dead-worktree inspection).
- **★ NUL-byte catch (S138 independent-verify earned its keep):** D3's test file carried a stray NUL byte → git flagged it binary → the full-suite DISCOVERY silently SKIPPED 59 tests (the agent's "23,143" baseline was the tell vs +59). Caught pre-landing via the "Bin"-flag + count-mismatch; stripped → integrated (23,226). **Lesson: NUL-check new test files on landing (now in the file-delta defensive step).**
- CWD slipped into worktrees post-dispatch ~3× (S159) — caught each time via the reset-before-main-op reflex; no damage.
- 3 agents used `--no-verify` on docs-only WIP commits + self-corrected; the PA file-delta re-gates the content regardless.

## pa.md directives in force
- Rules R1–R5. `---` delimiter. Profile A/B. `full wrap`/88% floor. wrap 6c maps refresh.
- Dispatch: S88 isolation · F4 · S112 merge-startup · S99/S126 Bash-edit+no-`cd` (S100 hook) · S136 BRIEF.md · S138 R26/independent-verify · S147 coherence · S164 bg-commit-race. `feedback_no_batch_ratify_foundational_axioms` (the set-design fork honors this).

## Tags
#session-169 #profile-a-full-start #map-build-arc-COMPLETE #value-native-maps-shipped #s169-iteration-ruling #nul-byte-catch #stall-recovery #d5-set-deferred #wrap
