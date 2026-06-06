# MAP BUILD — PHASE C — DISPATCH D1: type-system (MapType recognition + key-check + E-MAP-BRACKET-WRITE gate)

(Verbatim archive of the dispatch prompt, per S136.)

---

# MAPS — REQUIRED FIRST READ

Before any other context, read `.claude/maps/primary.map.md` in full. Its "Task-Shape Routing" names the maps for a compiler-source **type-system** change — follow it. Map currency: maps reflect HEAD `4c8063b6` as of 2026-06-06; source is current (the D0 commit + §59.8 amendment are the only newer source changes — both are in your base). Feedback in your final report: `Maps consulted: [list]; load-bearing finding: <one sentence>` OR `Maps consulted but not load-bearing`.

**Read `docs/changes/map-build-phase-c-2026-06-06/SURVEY-SYNTHESIS.md` (the D1 section) — it carries the exact fire-sites + the pattern-to-mirror for every item below.**

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

(identical to the D0 brief — reproduced)

1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. If under any OTHER repo, STOP (S90). Save as `WORKTREE_ROOT`.
2. `git rev-parse --show-toplevel` == `WORKTREE_ROOT`.
3. **`git merge main` (S112 merge-startup) — your worktree branches from the session-start commit; you MUST merge main to inherit the D0 landing (union-`not` normalization in `type-system.ts`) + the §59.8 amendment.** Confirm `normalizeUnion` exists in `type-system.ts` after the merge. If merge conflicts, STOP and report.
4. `git status --short` clean.
5. `bun install` (worktrees don't inherit node_modules).
6. `bun run pretest` (populates `samples/compilation-tests/dist/`).

**Path discipline (S99/S126):** apply ALL edits via Bash (`perl -0pi`/`python`/heredoc) on worktree-absolute paths including the `.claude/worktrees/agent-<id>/` segment — NOT Edit/Write. NEVER `cd` into main; use `git -C "$WORKTREE_ROOT"`, `--cwd "$WORKTREE_ROOT"`, worktree-absolute paths. First commit message includes verbatim `pwd`: `WIP(d1): start at <pwd>`.

---

# TASK — register the value-native `map` type in the type system (§59)

Read SPEC §59 IN FULL (lines ~31583-31767; grep `## 59.`) + the SURVEY-SYNTHESIS D1 section FIRST (Rule 4). This dispatch is the **type-system foundation** — everything downstream (parser, runtime, codegen) keys on `rt.kind === "map"`. It does NOT touch parser/runtime/codegen.

## Scope (the 6 pieces — file:line anchors in SURVEY-SYNTHESIS)

1. **`MapType` in the `ResolvedType` union** (`compiler/src/type-system.ts` ~357-374) — add `interface MapType { kind: "map"; key: ResolvedType; value: ResolvedType; ordered: boolean }`; add to the discriminated union; add a `tMap(key, value, ordered)` constructor (~577-601, beside `tArray`/`tUnion`). Also add to `compiler/src/types/ast.ts` if `ResolvedType` is mirrored there.

2. **`resolveTypeExpr` recognizer branch** (~1812; mirror the inline-struct branch @1939-1972) — recognize `[KeyT: ValT]`:
   - A bracketed annotation `[ ... ]` is a MAP type iff it contains a **depth-1 entry-colon** that is NOT a ternary alternative-colon (§59.3 discipline: a depth-1 `:` not preceded at the same depth by an unmatched `?`). `[:]` = empty map (key/value resolve from context or `asIs`/`asIs` — for a typed decl `<m>: [K:V] = [:]` the K/V come from the annotation, so `[:]` only appears as the RHS literal, NOT the annotation; the annotation is always `[K:V]`).
   - Split the inner body at the depth-1 entry-colon into KeyT / ValT; recurse `resolveTypeExpr` on each.
   - **Slot this branch BEFORE the unresolvable fallthrough (~1989) and AFTER the `[]` array branch (~1907)** — `T[]` ends in `[]` (no internal colon) so the array branch still wins for arrays; only an internal-depth-1-colon bracket is a map.
   - Return `tMap(key, value, ordered)`.

3. **`@ordered` postfix affix** — §59.2: a trailing `@ordered` on the map type (e.g. `[string: Money]@ordered`). `collectTypeAnnotation` (`ast-builder.js` ~3815) should already carry it through as string text (bracketDepth-aware). In `resolveTypeExpr`'s map branch, **strip a trailing `@ordered`** (set `ordered: true`); mirror the `[]`-strip mechanic. **VERIFY** (Bash probe + a test): the lexer / `collectTypeAnnotation` does NOT treat the post-`]` `@` as the §6 reactive sigil or a boundary — if it does, that's a small ast-builder fix (report it). The leading `@` of `@ordered` here is part of the affix spelling, NOT reactive-`@`.

4. **`formatTypeForDiagnostic` map arm** (~2864, beside the array `+ "[]"` arm) — format a map type as `[Key: Value]` (+ `@ordered` if ordered).

5. **Key-comparability check** — §59.4. Add an `isComparable(resolvedType)` walk and run it on `MapType.key` **at the decl-binding sites** (~5807 let/const, ~6074 state-decl — these have a span + the `errors` array; `resolveTypeExpr` is intentionally error-free, do NOT put the check there):
   - key type contains a **function field** (walk structs deep via the type registry — do NOT reuse the gauntlet regex `structBodyHasFunctionField`, it's too weak) → **`E-EQ-003`** (reuse the existing code + diagnostic family; the message names the map-key context).
   - key type is itself a **map** → **`E-MAP-KEY-IS-MAP`**.
   - any other non-§45-comparable key (asIs/function/unresolved) → **`E-MAP-KEY-NOT-COMPARABLE`**.
   - comparable (no error): primitives (number/string/boolean), structs whose fields are ALL comparable (deep), enums (tag + comparable payloads), arrays of comparables.
   - All 3 codes already exist in §34 (landed S168) — wire the FIRE sites.

6. **`E-MAP-BRACKET-WRITE` gate** — §59.7. In `case "reactive-nested-assign"` (~7230-7269), at ~7244 where `rt = entry?.resolvedType` is already looked up: **if the receiver `rt.kind === "map"`, fire `E-MAP-BRACKET-WRITE`** (fatal; fix-it names `.insert(k, v)`). Because it's fatal, the COW lowering at `emit-logic.ts:3026` is never reached for a map cell — codegen needs ZERO change. **v1: shallow receiver check** (the top-level receiver cell is map-typed). DEFER deep `@outer[k1][k2]=v` nesting (note it as a deferred item). Handle the S168-widened heterogeneous `path` shape (`(string|{index})[]`) correctly — do not assume `string[]`.

## DEFER (explicit — these are v1 design defaults, do NOT implement)
- **`@m[k]` bracket-READ type-flow** — do NOT add a `case "index"` map arm that types `@m[k]` as `V | not` in the typer. Map reads stay the existing permissive path in v1 (runtime/codegen lower `@m[k]` to `_scrml_map_get` returning `V|not` correctly; only static typer-level exhaustiveness on a map-read value is deferred). Document this in your report.
- **Deep-nesting `E-MAP-BRACKET-WRITE`** (`@outer[k1][k2]=v`) — v1 shallow receiver check only.
- Parser (`[:]`/`[k:v]` literal), runtime (the map structure + hasher + codec), codegen (lowering) — ALL out of scope (D2/D3/D4).

## VERIFICATION (before DONE)
1. Full `bun run test` — baseline **23,108 pass / 0 fail / 220 skip / 1 todo / 917 files** (post-D0). ZERO regressions. Report exact counts.
2. **NEW typer-unit tests** (there is NO parser for map literals yet — D2 — so test at the TYPER level, NOT end-to-end source):
   - `resolveTypeExpr` on `[string: Money]` / `[int: User]` / `[Route: Money]` (struct key) / `[string: Money]@ordered` → `MapType` with correct key/value/`ordered`.
   - key-comparability: a struct-with-fn-field key → `E-EQ-003`; a map-typed key → `E-MAP-KEY-IS-MAP`; an unresolvable/non-comparable key → `E-MAP-KEY-NOT-COMPARABLE`; a primitive/struct/enum key → no error.
   - `E-MAP-BRACKET-WRITE`: a map-typed receiver cell with a bracket-write → fires (construct the AST node / a map-typed state-decl + a `reactive-nested-assign` node as the existing typer tests do; the agent picks the harness shape).
3. **Recognizer false-catch canary:** confirm the new `[K:V]` branch does NOT mis-resolve existing annotation forms — array `T[]`, refinement `[label]` suffixes, nested generics-ish brackets. There are ZERO existing `[K:V]` annotations in the corpus (maps don't exist yet), so the branch only fires on genuine internal-depth-1-colon brackets; verify with a grep of existing annotation strings + a test that `T[]` and a `[label]`-suffixed type still resolve as before.
4. **R26 does NOT apply** — there is no map SOURCE to compile yet (the parser is D2). Do NOT claim an R26 empirical pass; the 0-regression full suite + the typer-unit tests are the D1 gate. (Say so explicitly.)
5. within-node parity 1005/0 unchanged (a typer-only change should not shift it; verify).

## COMMIT DISCIPLINE (S83 two-sided)
Commit per logical unit (MapType+ctor; resolveTypeExpr branch+@ordered; key-check; bracket-write gate; tests). After EVERY edit: `git diff`, `git add`, commit immediately — don't batch. `git status` clean before DONE. Update `docs/changes/map-build-phase-c-2026-06-06/progress.md` after each step.

## REPORT (final message — raw structured text)
`WORKTREE_PATH` · `FINAL_SHA` · `FILES_TOUCHED` · merge-startup result (did `normalizeUnion` exist post-merge?) · full-suite counts · per-piece status (1-6) · the `@ordered`/reactive-`@` probe result · recognizer false-catch canary result · DEFERRED items (read-type, deep-nesting) · maps feedback.
