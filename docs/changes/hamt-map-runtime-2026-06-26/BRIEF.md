# BRIEF — ss38: HAMT / structural-sharing swap for the §59 value-native map runtime (FBIP increment 1)

**Dispatched by:** sPA ss38 · **Branch to land on:** `spa/ss38` · **Agent:** scrml-js-codegen-engineer, `isolation:"worktree"`, model opus.

## Goal (one sentence)
Swap the §59 value-native **map** runtime's internal representation from **COW-clone-the-whole-entries-object** (O(n) per write) to a **HAMT** (hash-array-mapped-trie, persistent structural-sharing, O(log n) shared-path write), preserving EVERY observable behavior. Still pure/immutable (structural sharing, NOT in-place mutation) → **no uniqueness analysis, zero soundness risk.** This is FBIP increment 1 AND the standing fix for the **S94 super-linear blow-up**.

## Why this is bounded + zero-soundness-risk
The source-level form is UNCHANGED: `@m = @m.insert(k, v)` still reassigns a NEW map value (reassignment-canonical, §59.7). Only the internal structure gets cheap. Codegen lowering is almost certainly UNCHANGED (it emits `_scrml_map_insert(...)` calls; the function body is what changes). No new compiler pass.

## Set comes for FREE — do NOT build a separate set structure
A `set[K]` is a **THIN DESUGAR over the §59 map** (`[K: bool]`) — confirmed at `compiler/src/codegen/reactive-deps.ts:331`. There is NO separate `_scrml_set_*` data structure; set methods lower to map operations. **So swapping the map runtime covers Set automatically.** Just keep the map's method surface identical and the set tests stay green. (This is why ss38 says "swap map+set together" now that ss37's Set already landed on COW.)

---

## PHASE 0 — SURVEY + OBSERVABLE-PRESERVATION GATE (STOP-report before building)

Before writing the HAMT, CONFIRM in writing that a HAMT can preserve ALL of these. If ANY cannot be preserved without changing an observable, **STOP and report** (do not guess):

1. **Value-canonical hashing (§59.5) — UNCHANGED.** `_scrml_value_canonical(v)` (runtime-template.js:4246) produces the canonical KEY STRING. The HAMT keys on this SAME string (hash it with `_scrml_fnv1a` at line 4211 to derive the trie path; the canonical string remains the collision-free identity — two §45-equal values still produce byte-identical strings). The canonical walker itself does NOT change.
2. **Order-independent `==` (§59.9).** `runtime-template.js:2833-2850` compares two maps by reading `a.entries` / `b.entries` DIRECTLY. A HAMT swap MUST keep this correct (compare by canonical-key-set + per-key value `==`, order-independent).
3. **Lossless codec round-trip (§59.10).** `_scrml_map_encode` (4527) / `_scrml_map_decode` (4544) read `m.entries` + `Object.keys(m.entries).sort()` directly and encode in canonical-key order for bit-stability. Round-trip must stay value-lossless (== holds across encode→decode), incl. the §57 absence-envelope for a stored `not` value, and the `ordered` flag.
4. **@ordered iteration order (§59.8).** The `order` sidecar array (insertion order) drives `_scrml_map_key_order` → keys()/values()/entries() positional correspondence. HAMT must preserve the ordered/unordered distinction AND the positional-correspondence guarantee.
5. **Full method surface — identical signatures + return values.** `_scrml_map_empty / _from_entries / _get / _has / _get_or / _insert / _remove / _update / _insert_all / _size / _keys / _values / _entries / _sorted / _sorted_by` (runtime-template.js:4302-4503). Key-miss still returns `null` (the `not` sentinel), `.has` still disambiguates a stored `not`.

### The load-bearing sub-fork to SURFACE in your Phase-0 report (do NOT decide blind)
The internal `{ entries: { [canonicalKey]: {k,v} } }` shape is read **DIRECTLY** (not via accessors) in THREE places that a naive HAMT swap would silently break:
- **`compiler/src/runtime-template.js`** — `==` (line 2833), `_scrml_value_canonical` nested-map branch (4267), `_scrml_log_render` map branch (4603), `_scrml_map_sorted` (4487), the codec (4529).
- **`compiler/runtime/stdlib/data.js`** — `_data_value_canonical` (lines 172-177) is a **REPLICATED copy** of the canonical walker reading `v.entries[ck].v`.
- **`compiler/src/codegen/log-loc.ts`** — `Object.keys(v.entries)` (lines 198-199) is a compile-time copy of the log render.

**Two strategies — pick + JUSTIFY in the Phase-0 report:**
- **(A) Keep a compatibility `.entries` view** (HAMT internal, but expose a derived `entries`-shaped object). LOWER blast radius, but if it materializes O(n) on every access it can undercut the perf win — measure.
- **(B) Add a structural accessor** (e.g. `_scrml_map_canonical_pairs(m)` → ordered `[ck, {k,v}]`, and `_scrml_map_each(m, cb)`) and route ALL direct readers (incl. the 2 replicas) through it. Higher touch, cleaner, full perf win.

State which you chose and why. Either way, the 3 direct-reader sites (esp. the 2 REPLICAS) MUST be handled — a missed replica = a silent `==`/codec/hash divergence.

---

## PHASE 1 — BUILD (only after Phase 0 confirms preservation)

1. Implement the HAMT (or a comparable persistent structural-sharing trie — e.g. CHAMP/bitmap-indexed nodes) keyed on `_scrml_fnv1a(_scrml_value_canonical(k))` with the canonical string retained for collision-free identity. Insert/remove/update share unchanged subtrees (the whole point — kill `_scrml_map_clone`'s O(n) full-copy at line 4311).
2. Preserve the `ordered` semantics (order sidecar or an order-aware trie). Unordered stays "unordered + loud" with zero order cost.
3. Route the 3 direct-`.entries` readers (incl. both replicas) per your chosen strategy.
4. Keep `_scrml_fnv1a` / `_scrml_value_canonical` exactly as-is unless you have a STOP-reported reason.

## VERIFICATION (mandatory, all of it)
- **Differential test vs the current COW map (THE soundness gate — this IS the FBIP soundness pattern in miniature):** add a test that exercises insert / remove / update / insert_all / get / has / get_or / keys / values / entries / sorted / `==` / encode→decode over randomized + adversarial key sets (nested-map keys, struct keys, enum keys, stored-`not` values, ordered + unordered, empty `[:]`, last-wins duplicate keys, -0/+0, large N for the S94 blow-up case) and asserts the HAMT result is **observably identical** to the COW behavior. Any diff is a BUG.
- **Full suite:** `bun run test` MUST be fully green (it includes `value-native-map-e2e-d4`, `value-native-set-e2e`, the `value-native-map-codegen-*-d4` trio, `data-set-algebra`, `inline-map-assign-handler-s169`, `native-map-literal-d2b`, and ~17.6k others). Pre-existing stdlib "statement boundary not detected" warnings are known noise — ignore.
- **R26 discipline:** verify against the REAL runtime source (recompile + run), not synthesized AST. The map runtime is exercised end-to-end through compiled examples — confirm `examples/34-value-native-set.scrml` and a map-heavy example still compile + behave.
- (Optional but valued) a micro-benchmark showing the S94 super-linear insert loop is now sub-quadratic — this is the standalone win.

## COMMIT DISCIPLINE
- Work in YOUR isolation worktree. **Commit INCREMENTALLY** (Phase-0 findings doc → HAMT core → reader-routing → tests) — your branch + commits are the crash-recovery anchor. Do NOT batch into one giant commit.
- Do NOT bypass the pre-commit hook (`--no-verify`) — it runs the full suite and is the gate.
- Do NOT touch `main`. Do NOT push. The sPA lands your branch onto `spa/ss38`.
- If Phase 0 finds an observable CANNOT be preserved, STOP and report — that's a design fork for the PA/user, not something to force.

## RETURN (your final message = structured data for the sPA)
Report: (a) Phase-0 verdict + which `.entries`-strategy you chose + why; (b) files changed (full paths); (c) your branch name + tip SHA; (d) full-suite result (pass/fail counts); (e) differential-test result; (f) any STOP/park items; (g) the perf delta if measured.
