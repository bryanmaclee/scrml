# A-4.6 — §47 content-addressing integration (FNV-1a base36 chunk hashes + chunks.json manifest)

**Status:** STAGED (ready to fire AFTER A-4.5 lands — though FILE-DISJOINT with A-4.3/A-4.4/A-4.5/A-4.7 so technically parallelizable post-A-4.2 per SCOPING §7.1's dependency graph).
**Authored:** S91 mid-session (2026-05-14).
**Sequence:** ideal order is post-A-4.5 (after the full tier ladder is shipped); minimum viable is post-A-4.2 (chunks have deterministic content to hash). A-4.6 replaces the placeholder `"00000000"` hash that A-4.1 stamped on every chunk filename with a real content-addressed FNV-1a base36 hash per SPEC §47.1.3, AND fills the chunks.json manifest with the hash-keyed mapping.
**Estimated walltime:** **10-18h** per A-4 SCOPING §3.6.
**Dispatch agent:** `scrml-js-codegen-engineer` with `isolation: "worktree"`.

---

# What's already on the shelf

**Existing FNV-1a helper at `compiler/src/codegen/type-encoding.ts:284`** — exports `fnv1aHash(input: string): string` returning 8-char base36 zero-padded. Used today for per-binding name encoding (§47.1.3). **A-4.6 reuses this directly OR extracts it to a shared util** per SCOPING §3.6 phrasing ("extract FNV-1a helper into a shared util — no semantic change to existing per-binding name encoding"). The shared-util extraction is the cleaner architecture; both call sites stay byte-identical to current behavior.

**A-4.1 + A-4.2 already shipped:**
- `CHUNK_HASH_PLACEHOLDER = "00000000"` constant in `compiler/src/codegen/route-splitter.ts` — deliberately distinct from any real FNV-1a base36 output so A-4.6 tests can assert the placeholder has been REPLACED.
- `chunks.json` manifest emission is wired (always-emit per OQ-A4-A) but currently contains placeholder-hashed entries. A-4.6 fills in real hashes.
- Per-chunk byte-deterministic `payloadJs` — A-4.2's R1 dive-A determinism test proves chunks are byte-identical across builds. **Necessary precondition for content-addressing.**

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4 — RE-EMPHASIZED)

Your worktree path MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`.

## CRITICAL: F4 LEAK PREVENTION

**F4 path-discipline leak occurred in S91 once** — a sibling dispatch wrote work to MAIN's working tree while ALSO committing to its worktree branch. PA cleaned via `git checkout HEAD --`; the agent's work landed properly when it completed.

**Defense for THIS dispatch:**

- Save `WORKTREE_ROOT` from `pwd` at startup verification.
- For EVERY Write/Edit call, the file path MUST start with `$WORKTREE_ROOT/`.
- NEVER use absolute paths starting with `/home/bryan-maclee/scrmlMaster/scrmlTS/` directly.
- Before EACH Write/Edit, audit the absolute path begins with `$WORKTREE_ROOT/`.

## Startup verification (BEFORE any other tool call)

1. `pwd` — MUST equal worktree path AND MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. If under another repo: STOP and report. Save as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` — must equal WORKTREE_ROOT.
3. `git status --short` — confirm tree clean.
4. `bun install`.
5. `bun run pretest`.

If ANY check fails: STOP. Report. Exit.

---

# MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` (~118 lines).

Relevant maps:
- `primary.map.md` — project orientation + S91 status
- `domain.map.md` — Task-Shape Routing; A-4.x status
- `dependencies.map.md` — codegen pipeline graph
- `structure.map.md` — `compiler/src/codegen/` layout + type-encoding.ts position

Feedback in final report: "Maps consulted: [list]; load-bearing finding: <one sentence>" OR "Maps consulted but not load-bearing".

---

# ANTI-PATTERNS + KICKSTARTER (mandatory pre-read)

- `scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md`
- `docs/articles/llm-kickstarter-v1-2026-04-25.md`

**Absolute rules** (HARD):
- `null` and `undefined` do NOT exist in scrml. TS impl is JS-host; JS-host null/undefined are fine there. For emitted runtime JS, canonical absence is JS `null` per §42.5/§42.8.
- Self-host is from-scratch rewrite.
- try/catch is NOT in scrml's vocabulary.

---

# Commit discipline — TWO-SIDED RULE (mandatory)

> After EVERY edit: `git diff <file>`; `git add <file>`; commit IMMEDIATELY. Don't batch.
> Before reporting DONE: `git status` MUST be clean.
> NO `--no-verify` without explicit user authorization. **This brief does NOT authorize it.**

---

# Required prior reading

1. **`docs/changes/a-4-per-route-artifact-splitter-SCOPING/SCOPING.md`** — §3.6 (A-4.6 row) IN FULL + §5 OQ-A4-A ratification (chunks.json always-emit) + OQ-A4-C ratification (chunk filename `<route>/<RoleVariant>.<tier>.<8-char-hash>.js`).
2. **`compiler/src/codegen/route-splitter.ts`** at HEAD (post-A-4.1 + post-A-4.2) — the orchestrator scaffold + initial-chunk composition + tier-1/2/N empty payloads (A-4.3/4.4/4.5 fill those). Note `CHUNK_HASH_PLACEHOLDER = "00000000"` constant.
3. **`compiler/src/codegen/type-encoding.ts`** lines ~275-310 — existing `fnv1aHash(input: string): string` 8-char base36 zero-padded. **Read carefully**: the shape is locked by §47.1.3 (parameters: FNV prime 16777619, offset basis 2166136261, 32-bit hash, lowercase base36 zero-padded to 8 chars). A-4.6 must reuse this exact behavior.
4. **SPEC §47** in full (around L18907+):
   - §47.1.3 — Hash algorithm (FNV-1a parameters; canonical-string normalization)
   - §47.1.4 — Canonical-String Normalization
   - §47.5 — Scope of Application (closure-analysis content-addressing cross-ref; amended S86 v0.3 Approach A)
   - §47.1.5 — Length and Collision Trade-off (informational)
5. **SPEC §40.9.8** (L17794) — Determinism preservation. Quoted normative:
   > *"The analysis output SHALL be incorporated into per-route content addresses (§47) such that two builds of the same source produce identical content addresses for the same per-tier chunks."*

---

# THE TASK — A-4.6 content-addressing

## Sub-task 1 — Extract `fnv1aHash` to shared util

`compiler/src/codegen/type-encoding.ts` currently exports `fnv1aHash` at line ~284. SCOPING §3.6 phrasing: "extract FNV-1a helper into a shared util — no semantic change to existing per-binding name encoding."

Options:
- **(a) New file `compiler/src/codegen/fnv1a-hash.ts`** exporting `fnv1aHash` standalone. `type-encoding.ts` re-imports it (`export { fnv1aHash } from "./fnv1a-hash.ts"` for backwards-compat). `route-splitter.ts` imports from the shared util directly.
- **(b) Re-export from `type-encoding.ts`** without moving — A-4.6 imports it where needed; future polish dispatch moves if/when needed.

**Choose (a)** — extraction is the load-bearing cleanup per SCOPING. Separates the cross-cutting hash primitive from the type-encoding-specific normalization.

Behavior MUST be byte-identical to current `type-encoding.ts:fnv1aHash`. Existing test surface for type-encoding (`compiler/tests/unit/output-encoding.test.js` or similar) MUST stay green throughout.

LOC estimate: extract is mechanical (~20 LOC moved + 1 re-export line).

## Sub-task 2 — Canonical chunk-input + hash computation

In `compiler/src/codegen/route-splitter.ts`, add a function:

```ts
function computeChunkHash(chunk: ChunkOutput, contents: ChunkContents): string {
  // Per SCOPING §3.6 + SPEC §47.5 / §40.9.8:
  //   canonical_chunk_input := <serialized ChunkContents (ordered)> | <chunk_js_bytes>
  //   chunk_hash := fnv1a_base36(canonical_chunk_input)[0..8]
  //
  // Determinism contract: same source produces same chunk produces same hash.
  // ChunkContents is serialized in canonical order (stratified comparator
  // mirrors A-2.8 `sortedArrayFromSet`).
  ...
}
```

Canonical serialization shape (per §47.1.4 analogue):
- Sort each Set member array via the stratified comparator (numbers < strings < other) per A-2.8 patterns.
- Concatenate in fixed field order: `componentNodeIds` → `reactiveCellNodeIds` → `serverFnNodeIds` → `vendorUnitNames` → `chunk_js_bytes`.
- Separator: a single non-collision-prone delimiter (e.g., `\x1F` Unit Separator or ``). Document the choice inline.
- Hash the resulting string via the extracted `fnv1aHash`.

**Determinism is load-bearing.** The §40.9.8 normative statement quoted above is the contract — two builds → identical content addresses. A-4.2's R1 determinism test (`compiler/tests/integration/initial-chunk-emission.test.js`) ALREADY proves chunk JS byte-identity; A-4.6's tests prove hash byte-identity on top of that.

## Sub-task 3 — Replace `CHUNK_HASH_PLACEHOLDER` with real hash

In `route-splitter.ts`'s `emitPerRouteChunks` (or wherever ChunkOutput is constructed):
- AFTER composing `payloadJs`, compute the real hash via `computeChunkHash(chunk, contents)`.
- Set `chunk.hash = computeChunkHash(...)`.
- Set `chunk.filename = composeFilename(route, role, tier, chunk.hash)` (the filename helper exists post-A-4.1).

Empty-payload chunks (tier-1/2/N with empty admission per the v0.3 floor) get a hash of the canonical-empty-input — still deterministic, still distinct from `"00000000"` placeholder. Per OQ-A4-A always-emit they appear in chunks.json even when empty (no payload file written; manifest entry maps to a hash-name that points to "no chunk").

**Actually defer the empty-chunk-name decision** to surface as an open question if you encounter it — current A-4.1 behavior skips writing empty chunk files; A-4.6's hash for the empty chunk could either (a) be omitted from chunks.json (no file → no manifest entry) or (b) appear with a sentinel `{ chunkUrl: null }` shape. Pick whichever produces cleaner adopter-tooling consumption and document inline.

## Sub-task 4 — chunks.json manifest hash population

A-4.1 emits chunks.json with placeholder hashes. A-4.6 fills in real hashes.

Manifest shape (per A-4.1's serializeChunksManifest + OQ-A4-A):

```json
{
  "version": 1,
  "compiler": "scrml-0.3.0",
  "entryPoints": {
    "/loads": {
      "Driver": {
        "initial": "/loads/Driver.initial.<8-char-hash>.js"
      },
      "Admin": {
        "initial": "/loads/Admin.initial.<8-char-hash>.js"
      }
    }
  }
}
```

(Field shape may differ — read what A-4.1 + A-4.2 actually produced. Don't restructure unless required.)

Per OQ-A4-A always-emit: chunks.json is written next to other outputs in `<outputDir>/chunks.json` (already wired at A-4.1).

**A-4.6 polish:** the `compiler` field is currently hard-coded to `"scrml-0.3.0"` (per A-4.1 agent note). A-4.6 has the opportunity to read the compiler version from `compiler/package.json` instead of hard-coding. Small win; do it if trivial, defer otherwise.

## Sub-task 5 — Output write loop hash integration

In `compiler/src/api.js`, the chunk-file write loop currently uses the placeholder-hash filename from A-4.1. A-4.6's real hashes flow through automatically since `chunk.filename` is set before the write loop fires. **Verify no hard-coded "00000000" string anywhere.**

LOC estimate: ~30 (per SCOPING §3.6).

## Sub-task 6 — Tests

Create `compiler/tests/unit/chunk-content-addressing.test.js` (NEW or extend A-4.2's test files):

1. **Determinism**: compile same source twice; assert chunk filenames are byte-identical (same hash); chunks.json identical.
2. **Source-change → hash-change**: compile fixture A, then a modified fixture A' (one byte different in a reachable component); assert hash differs at the affected chunk.
3. **Per-role hash variance**: compile §40.9.9 worked example; assert Driver chunk and Admin chunk have DIFFERENT hashes (because admission sets differ).
4. **Hash format**: assert all chunk hashes are exactly 8 chars, lowercase, base36 alphabet `[0-9a-z]`.
5. **No placeholder leak**: grep emitted output for `"00000000"`; assert ZERO occurrences (placeholder is fully replaced).
6. **chunks.json well-formed**: parse-as-JSON; assert version=1; assert every manifest entry's filename matches an actual emitted chunk file.
7. **`fnv1aHash` regression**: assert extracted helper produces byte-identical output to pre-extraction inputs (use existing type-encoding test fixtures).
8. **SPEC §40.9.8 contract**: assert determinism via 5-run replay; assert no source-environment-input axis (timestamp, env var, CI flag) leaks into the hash.
9. **§47.1.3 parameter conformance**: assert FNV prime 16777619, offset basis 2166136261 are the values used (regression-guard against accidental drift).
10. **Empty-chunk hash determinism**: empty tier-1/2/N admission produces canonical empty-input hash (whatever the disposition is per sub-task 3).
11. **Synthetic-test mode**: confirm test fixtures using the synthetic ChunkContents shape still produce deterministic hashes.

Aim for 8-12 tests.

## Sub-task 7 (polish) — PIPELINE.md Stage 8 + maps polish

Update `compiler/PIPELINE.md` Stage 8 with A-4.6 wire-in note. ~3-5 lines.

Update `.claude/maps/domain.map.md` Task-Shape Routing + v0.3.0 Status with A-4.6 closure entry.

---

# What NOT to do

- DO NOT touch per-route HTML emission (A-4.7's job).
- DO NOT add `_scrml_chunk_mount` / `_scrml_vendor_require` runtime helpers (A-4.7's territory per A-4.2 forward-looking gap).
- DO NOT modify the SPEC.md §47 prose (algorithm is normative-locked; this dispatch implements, doesn't amend).
- DO NOT change `fnv1aHash`'s parameters (FNV prime 16777619, offset basis 2166136261, 32-bit, 8-char base36, lowercase, zero-padded). Per §47.1.3 these are normative.
- DO NOT remove `CHUNK_HASH_PLACEHOLDER` constant — A-4.6's tests use it as the regression-guard "no longer present" sentinel.
- DO NOT touch `compiler/src/auth-graph.ts`, `compiler/src/reachability-solver.ts`, `compiler/src/reachability/*` (S91 closed; READ-ONLY).

# Sibling-dispatch awareness

At brief authorship: A-4.3 (Q task — tier-1 idle-prefetch) in flight; A-4.4 + A-4.5 briefs staged. Verify HEAD state at startup. A-4.6 is FILE-DISJOINT with A-4.3/A-4.4/A-4.5:
- A-4.3 touches: route-splitter.ts (composeTier1Chunk), runtime-template.js, runtime-chunks.ts, emit-client.ts. **route-splitter.ts overlap — additive only**; A-4.6 hash field is independent of tier-1 payload field; cherry-pick auto-merges.
- A-4.4 + A-4.5 same pattern.

If A-4.3 is still in flight at A-4.6 dispatch time: cherry-pick recovery may be needed on route-splitter.ts. Per `feedback_file_delta_vs_cherry_pick.md` auto-merge of additive changes preserves both. Verify after landing.

---

# Reporting

When DONE, report:

1. Sub-task 1 — fnv1a-hash.ts extraction (line numbers, byte-identity verification).
2. Sub-task 2 — computeChunkHash shape + canonical serialization order + separator choice.
3. Sub-task 3 — CHUNK_HASH_PLACEHOLDER → real-hash wire-in (line numbers).
4. Sub-task 4 — chunks.json manifest hash population + compiler-version source.
5. Sub-task 5 — api.js write loop verification.
6. Sub-task 6 — test file path + test count delta + determinism verification.
7. Sub-task 7 — PIPELINE.md + domain.map.md edits.
8. **WORKTREE_PATH** + **FINAL_SHA**.
9. **FILES_TOUCHED** list.
10. Maps-consulted statement.
11. Deferred items.

---

# Crash recovery

Per pa.md "Crash Recovery: Incremental Commits + Progress Reports":
- Commit per sub-task. Don't batch.
- Update `docs/changes/a-4-6-content-addressing/progress.md` after each step.

---

# Authority chain

- SPEC §47 (Output Name Encoding — normative algorithm)
- SPEC §47.1.3 (FNV-1a parameters + base36 8-char zero-padded)
- SPEC §47.1.4 (Canonical-String Normalization)
- SPEC §47.5 (closure-analysis content-addressing cross-ref — amended S86 v0.3 Approach A)
- SPEC §40.9.8 (Determinism preservation — normative two-builds-same-hash contract)
- OQ-A4-A ratification: chunks.json always-emit
- OQ-A4-C ratification: `<route>/<RoleVariant>.<tier>.<8-char-hash>.js` filename
- A-4 SCOPING §3.6
- Existing `fnv1aHash` at `compiler/src/codegen/type-encoding.ts:284`
- A-4.1's `CHUNK_HASH_PLACEHOLDER = "00000000"` constant
- A-4.2's R1 dive-A determinism test (precondition: chunk JS byte-identical across builds)

---

# Estimated effort

10-18h walltime. Most of the surface is mechanical (extract helper + add one function + replace placeholder + tests). The careful part is canonical-string normalization for the hash input — get the field order + separator + serialization wrong and the determinism breaks. Use S83 commit-discipline two-sided rule; commit per sub-task; `git status` clean before terminal report.

Good luck. A-4.6 unlocks **immutable cacheable chunks** for adopter apps — once content-addressed, browser cache + CDN caching + service-worker caching all work without invalidation logic. This is the foundation for production-grade per-route delivery.
