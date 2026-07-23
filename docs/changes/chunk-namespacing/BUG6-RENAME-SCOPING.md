# BUG-6 rename-approach scoping

**status:** `current` · **authored:** 2026-07-23 · **base** `e8fdd44c` · **branch** `worktree-agent-a91ad13968b46ab5d` @ `0581f480`
**scoping only — no fix code in this session.** The fix runs next session; this doc exists to make that session open straight into execution.

---

## 0. Verdict up front

| question | answer |
|---|---|
| **ESM crux — is the renamed-accessor scope sound?** | **SOUND.** Grounded in `emit-client-esm.ts:359-362` (import-set computation), not assumed. A renamed local (`_scrml_cs_reactive_get`) has a name distinct from the runtime accessor it wraps, so it never shadows it, so its initializer references the accessor cleanly — as a global (classic) or a read-only import (ESM). No IIFE is needed for the accessor mechanism under ESM; module scope already isolates the body. |
| **Does the rename make §C10.1 pass?** | **YES.** `_scrml_cell_scope` leaves core, so the core string no longer names `_scrml_message_for` et al. |
| **Does the rename make the 16 KB gzip test pass?** | **ONLY with ZERO net core residue** — inline the key-derivation into each chunk's prologue, drop `_scrml_cell_name` from core, trim the banner comment. Measured: zero-residue = **16,255 B gzip** (129 under). The *naive* rename (remove `_scrml_cell_scope`, keep `_scrml_cell_key`+`_scrml_cell_name` in core) = **17,531 B gzip** — **FAILS by 1,147**. This is a hard constraint, not a nice-to-have. See §2. |
| **Rename surface** | ~**959** emitted accessor-call occurrences across **37** files (`_scrml_reactive_get` alone 470). This forces a **post-hoc callee-rename pass** over the assembled body, NOT per-emitter edits. |
| **Test migration** | **46 files / 160 failures** per-file · **129 new** vs the authoritative 31-name base set · **0** base failures masked. The rename does NOT force re-migrating the ~75 already-migrated files IF the shared helpers (`captureInsideChunkScope`, `unwrapChunkScope`) are made rename-aware — see §3. |
| **N3 + N4 under the rename** | **PRESERVED.** Confirmed by reading: the IIFE wrap (`index.ts:1901`) and `nsName` (`emit-engine.ts:355+`) are independent of accessor names; the rename touches neither. See §4. |

**The one thing that could sink the ruling:** the size budget is a knife-edge. The base runtime already sat at 16,257 B gzip — **127 B under the 16,384 budget** — *independent of this arc*. A zero-residue rename lands at 16,255, i.e. it JUST fits with ~2 B of margin over base. Any future core addition (from any arc) re-breaks it. This is an §6 open question for bryan, flagged but not blocking: the rename CAN pass, it just cannot pass with any slack.

---

## 1. The mechanism, exactly

### 1.1 What the prologue emits under the rename

Today (shadow design — the reverted-to state at `0581f480`), a namespaced chunk opens with a destructure that **shadows** the runtime accessors, and calls the core `_scrml_cell_scope` factory (`runtime-template.js:850`):

```js
// current, at index.ts:520 buildCellScopePrologue
const { _scrml_reactive_get, _scrml_reactive_set, _scrml_init_set } = _scrml_cell_scope("00rc2iah");
...
_scrml_reactive_set("count", 0)          // BARE call site, shadowed name
```

Under the rename, the prologue emits **differently-named locals** — a fixed `_scrml_cs_` prefix (mnemonic: **c**ell **s**cope) — plus an **inlined** key-derivation function, and **nothing in core is called**:

```js
// --- chunk cell scope (00rc2iah) ---
const _scrml_cs_key = (n) => {           // INLINED: no core _scrml_cell_key
  const d = n.indexOf(".");
  const r = d === -1 ? n : n.slice(0, d);
  return "00rc2iah$" + (d === -1 ? r : r + n.slice(d));   // owner map spliced when non-empty (see 1.4)
};
const _scrml_cs_reactive_get = (n) => _scrml_reactive_get(_scrml_cs_key(n));
const _scrml_cs_reactive_set = (n, v) => _scrml_reactive_set(_scrml_cs_key(n), v);
const _scrml_cs_init_set     = (n, fn) => _scrml_init_set(_scrml_cs_key(n), fn);
```

Only the accessors the chunk actually references are emitted (same scan as today: `CELL_SCOPE_ACCESSORS.filter(n => body matches \bn\b)`, `index.ts:526`).

**Per-accessor key-argument positions** must be encoded, because they differ. This metadata already existed in the reverted attempt-b and must be re-introduced — as prologue-wrapper shapes, not a core registry:

| positions | accessors | wrapper shape |
|---|---|---|
| arg 0 | the 28 common accessors (`_scrml_reactive_get/set`, `_scrml_init_set`, `_scrml_derived_declare/get`, all `_scrml_engine_*`, `_scrml_machine_*`, `_scrml_reset`, `_scrml_replay`, …) | `(n, ...r) => IMPL(_scrml_cs_key(n), ...r)` |
| args 0 AND 1 | `_scrml_derived_subscribe` (registers a dirty edge BETWEEN two cells) | `(d, u) => IMPL(_scrml_cs_key(d), _scrml_cs_key(u))` |
| arg 2 | `_scrml_message_for` (§41.12 lookup takes the cell LAST; its register-side sibling `_scrml_messages_register_inline` takes it first — the split-key pair BUG 2/4 were) | `(e, f, c) => IMPL(e, f, (typeof c === "string" && c) ? _scrml_cs_key(c) : c)` |
| none | `_scrml_ssr_seeded` (seed wire-format is bare) | `(n) => IMPL(n)` — passthrough |
| special | `_scrml_ssr_seed_apply` | `(skipShell) => _scrml_ssr_seed_apply_scoped(_scrml_cs_key, skipShell)` — threads the keyFn; `_scrml_ssr_seed_apply_scoped` STAYS in core |

The authoritative per-accessor logic is exactly what `runtime-template.js:850-897` `_scrml_cell_scope` encodes today — the executing session lifts those bodies verbatim into the prologue wrappers.

### 1.2 What codegen emits at each cell-access site — before → after

```
BEFORE  _scrml_reactive_get("rows")
AFTER   _scrml_cs_reactive_get("rows")
```

Every emitted cell-accessor CALL in the chunk body is rewritten to the `_scrml_cs_`-prefixed name. This is the **rename surface** (§3.1). It does NOT change the key argument (`"rows"` stays bare) — the wrapper applies the namespace.

**Implementation: a post-hoc callee-rename pass, NOT per-emitter edits.** The ~959 emit occurrences (§3.1) are spread across 37 emitters; editing each is unmaintainable and re-opens the moment an emitter is added. Instead, one pass over the **assembled chunk body** (the same place `addCellScopePrologue` runs, `index.ts:556`) rewrites each used accessor's calls to the renamed form. This is the deleted `cell-namespace-pass.ts` machinery resurrected — but renaming the **callee** (a `CallExpression` whose `callee` is an `Identifier` in the accessor set) instead of the key argument. Acorn is required for the same reason it was there: distinguishing a real call from the same characters in a comment or an author string.

**Ordering (load-bearing):** the callee-rename pass runs on the body **before** the prologue is prepended, so the prologue's own references to the real accessors (`_scrml_reactive_get` inside the wrapper) are never seen by the pass and are never renamed. The current pipeline already adds the prologue before the esm transform (`index.ts:1853` comment); the rename pass slots in just ahead of the prologue insertion.

### 1.3 The ESM crux — walked separately, both formats

This is the section that decides the ruling. Attempt (a) died because a prologue `const _scrml_reactive_get = …` **shadowed** the runtime accessor for the whole chunk block, so (i) the initializer supplying the impl couldn't reference the (now-shadowed) name — TDZ — and (ii) ESM couldn't wrap the body in an IIFE to relocate that initializer because `export`s must stay at module top level.

**The rename removes the shadow.** `_scrml_cs_reactive_get` is a *different name* from `_scrml_reactive_get`, so:

**Classic** (chunk body wrapped in an IIFE for N3/N4):
```js
// Requires: scrml-runtime.HASH.js         (core loaded as a prior classic <script>; accessors are globals)
(function() {
  const _scrml_cs_key = (n) => "00rc2iah$" + n;                         // inlined
  const _scrml_cs_reactive_get = (n) => _scrml_reactive_get(_scrml_cs_key(n));   // refers to the GLOBAL — no shadow
  ...
  _scrml_cs_reactive_get("count")
})();
```
`_scrml_cs_reactive_get`'s initializer references the global `_scrml_reactive_get` (already defined, prior script) and the local `_scrml_cs_key` (defined above). No shadow, no TDZ. ✓

**ESM** (NO IIFE — module scope isolates N3/N4; an IIFE would illegally enclose top-level `import`/`export`):
```js
// Requires: scrml-runtime.HASH.js
import { _scrml_reactive_get, _scrml_reactive_set, _scrml_init_set, _scrml_effect, ... } from "./scrml-runtime.HASH.js";

const _scrml_cs_key = (n) => "00rc2iah$" + n;                          // inlined, module-top-level const
const _scrml_cs_reactive_get = (n) => _scrml_reactive_get(_scrml_cs_key(n));   // refers to the IMPORT — no shadow
...
_scrml_cs_reactive_get("count")
```
`_scrml_cs_reactive_get`'s initializer references the imported `_scrml_reactive_get` (a read-only ES binding — legal to READ) and the local `_scrml_cs_key`. No shadow of the import, no TDZ, no wrap needed. ✓

**Grounded in the real import-set code**, `emit-client-esm.ts:359-362`:
```js
const referenced = new Set(out.match(/[$A-Za-z_][$\w]*/g) ?? []);
const runtimeSurface = [...runtimeExports]
  .filter(n => referenced.has(n) && !chunkOwnDecls.has(n) && !SHARED_MUTABLE_RUNTIME_GLOBALS.has(n));
```
- `_scrml_reactive_get` — a runtime export, **referenced** (in the wrapper), **not** a chunk-own-decl → **imported**. ✓
- `_scrml_cs_reactive_get` — a chunk-own-decl (declared in the prologue), and not a runtime export → **not imported**. ✓
- No name collision between the import and any local. The accessors are plain functions, absent from `SHARED_MUTABLE_RUNTIME_GLOBALS` (which holds `_scrml_lift_target` + the reactive-get override slot, `runtime-esm.ts:57/71`), so they are imported read-only, never globalThis-bridged. ✓

The prologue is already inserted **before** the esm transform (`index.ts:1853`), so its `_scrml_reactive_get` reference is present when the import set is computed. This behaviour is unchanged by the rename; the rename only changes the CALL-site names (which are chunk-own or non-exports either way) — never what gets imported.

**ESM-crux verdict: SOUND, no hole.**

### 1.4 The owner map

Imported cells key under the EXPORTER's token (§51.0.A/§51.0.D singleton — `buildCellOwnerMap`, `chunk-namespace.ts`). Today the owner map is passed as the second arg to `_scrml_cell_scope`. Under the rename it is spliced into the inlined `_scrml_cs_key`:
```js
const _scrml_cs_owners = {"appPhase":"0eeeffff$appPhase"};   // omitted entirely when empty
const _scrml_cs_key = (n) => {
  const d = n.indexOf("."); const r = d === -1 ? n : n.slice(0, d);
  const owned = _scrml_cs_owners[r];
  if (owned) return d === -1 ? owned : owned + n.slice(d);
  return "00rc2iah$" + n;
};
```
When the chunk imports no stateful cells (the common case), the owner branch is omitted and `_scrml_cs_key` collapses to the two-line dotted-root form above.

---

## 2. Why it makes BOTH pinned tests pass — MEASURED

Both measured on the `SPA_COUNTER` fixture (`v0-3-x-spa-tree-shake-phase-b.test.js:48`) — one file, one chunk, the minimal SPA shape the size test uses. Method: compile, gzip the emitted `scrml-runtime.*.js`, and simulate the rename by stripping the arc's core additions.

### 2.1 §C10.1 tree-shaking (`c10-error-message-resolution.test.js`)

The test asserts `assembleRuntime(new Set(["core"]))` does NOT contain `_scrml_message_for` / `_scrml_messages_register_inline`. Today it DOES, because `_scrml_cell_scope` (in the core chunk, `runtime-template.js:850`) names all ~33 accessors in its body — including those two. Under the rename, `_scrml_cell_scope` is deleted from core; those names appear ONLY in the prologue of chunks that use the messages accessors (emitted into `*.client.js`, never into the runtime). So the core string no longer contains them. **PASS by construction.**

### 2.2 The 16 KB gzip budget (`v0-3-x-spa-tree-shake-phase-b.test.js:145`, `gzip.length < 16*1024 = 16384`)

| scenario | gzip B | vs budget 16384 |
|---|---|---|
| **BASE `e8fdd44c`** (before the arc) | **16,257** | **−127 (already a knife-edge)** |
| **HEAD `0581f480`** (current) | 18,346 | +1,962 FAIL |
| naive rename — remove `_scrml_cell_scope`, keep `_scrml_cell_key`+`_scrml_cell_name`+banner in core | 17,531 | **+1,147 FAIL** |
| keep only a tiny core `_scrml_cell_key`, drop banner + `_scrml_cell_name` | 16,589 | +205 FAIL |
| **ZERO core residue** — inline key-derivation, drop `_scrml_cell_name`, drop banner | **16,255** | **−129 PASS** |

**Conclusion: the size test passes iff the mechanism adds ZERO net bytes to the always-loaded core.** That requires all three of:
1. `_scrml_cell_scope` removed from core (the BUG-6 target) — moves to per-chunk prologue wrappers.
2. key-derivation **inlined** into each prologue's `_scrml_cs_key` — no core `_scrml_cell_key`.
3. `_scrml_cell_name` **removed from core** — it is **production-dead**: its only callers are the conformance test shim (`conformance/adapters/impl1-ts.ts:163`, guarded `typeof … === "function"`); nothing in the shipped runtime or in any emitted chunk calls it (grep-confirmed). The shim carries its own copy (a 5-line inverse), or `_scrml_cell_name` moves into the shim string.

`_scrml_ssr_seed_apply_scoped` (the SSR-seed split) STAYS in core and is already counted inside the 16,255 (it is present in the SPA runtime). The banner comment (1,942 raw B, ~250 gzip) is trimmed to a one-line reference.

**These are MEASUREMENTS on the real emitted runtime, not estimates.** The ~200 B swing across whitespace-normalization variants (16,255 vs an un-normalized 16,453) is gzip-boundary noise from stray blank lines; the executing session must whitespace-normalize the removal and re-measure, because the margin (129 B) is smaller than that noise band. See §6.

---

## 3. The full rename + migration surface — MEASURED

### 3.1 Codegen emit-site rename surface

The scan (`emitsites.mjs`, heuristic "accessor-name(` preceded by a quote/backtick on the line") over `compiler/src/`:

- **~959 emitted call occurrences** (a ceiling — the heuristic counts some comment/doc mentions), across **37 files**, covering **28 of the 33** accessors (5 have zero emit sites and exist only for completeness of the scope factory).
- Top accessors: `_scrml_reactive_get` **470**, `_scrml_reactive_set` **238**, `_scrml_derived_declare` 34, `_scrml_init_set` 29, `_scrml_derived_get` 26, `_scrml_derived_subscribe` 22, `_scrml_reactive_subscribe` 20, `_scrml_reset` 18, `_scrml_engine_clear_named_timer` 12, `_scrml_engine_direct_set` 10, then a long tail.
- Top emitters: `emit-logic.ts` 156, `emit-engine.ts` 88, `emit-event-wiring.ts` 68, `emit-expr.ts` 66, `emit-client.ts` 66, `emit-reactive-wiring.ts` 50, `emit-bindings.ts` 50, `emit-each.ts` 48, `emit-synth-surface.ts` 48, `rewrite.ts` 46, `emit-lift.js` 44, `emit-machines.ts` 30, `emit-variant-guard.ts` 26, `emit-validators.ts` 26, … (23 more files with ≤16 each).

**This is the argument FOR the post-hoc pass.** 959 sites × 37 files is not a surgical edit; it is a rewrite that a single Acorn pass does in one place. The pass's accessor list is the same `CELL_SCOPE_ACCESSORS` the prologue uses, so the two cannot drift. The enumeration above is for the executing session to VERIFY the pass's coverage (every accessor with an emit site must be in the pass's rename set), not a list of sites to hand-edit.

### 3.2 Assertion-migration surface — authoritative numbers

At `0581f480` (the docs-only commit after `a399555a`; test state identical):

| metric | value |
|---|---|
| per-file taxonomy | **46 files / 160 failures** |
| unique fail NAMES | 160 |
| **NEW vs the 31-name base set** | **129** |
| base failures now passing (mask check) | **0** |

**Taxonomy caveat (already found this round):** per-file counts double-count pre-existing base failures — e.g. `parser-conformance-within-node.test.js` shows 17 "failures" that are base failures, inflating the `iifeShape` class. **The name-diff against `e8fdd44c` (129 new) is authoritative; the per-file taxonomy is a routing aid only.**

Current remaining classes (per-file): harness 25 / engineName 10 / iifeShape 8 / unclassified 3.

### 3.3 How the rename CHANGES the migration — and why the ~75 done files need NOT re-migrate

The rename changes what a harness sees: the emitted CALL sites become `_scrml_cs_reactive_get`, while the runtime GLOBAL stays `_scrml_reactive_get`, and inside the chunk scope the name `_scrml_reactive_get` is NO LONGER a scoped shadow (it's the global). Naively, that regresses the two biggest recipes. **Both are fixable in the shared helper, not per-file**, so the executing session re-migrates ZERO already-done files if it updates the helpers first:

- **`captureInsideChunkScope` (64 files today).** Today it splices `globalThis.get = _scrml_reactive_get` INSIDE the scope to grab the shadow. Under the rename there is no `_scrml_reactive_get` shadow; the scoped accessor is `_scrml_cs_reactive_get`. **Fix in the helper:** before splicing, rewrite the capture snippet's accessor references `_scrml_reactive_get` → `_scrml_cs_reactive_get` (and siblings). The 64 files' snippets are unchanged on disk; the helper does the rename. Alternatively, switch the recipe to `chunkCellKey`-based key mapping (capture the global, map the key) — `chunkCellKey` already exists — but the in-helper rename is lower-churn.
- **`unwrapChunkScope` (11 files today).** Today it strips the IIFE+prologue, leaving body calls to bare `_scrml_reactive_get` which the harness shims provide. Under the rename the body calls `_scrml_cs_reactive_get`, undefined after the prologue is stripped. **Fix in the helper:** after stripping, un-rename `_scrml_cs_*` → `_scrml_*` in the body so the shims' bare accessors resolve. Per-file snippets unchanged.
- **`normalizeChunkToken` (5 files), `unNamespaceEngineNames`/`unNamespaceCellKeys` (engineName), `storeByAuthorName`:** unaffected — they operate on the token / engine names / store keys, none of which the accessor rename touches.

**Net:** the executing session updates 2 helper functions, then works the remaining 46 files with the recipes already established. The rename ADDS ~0 to the per-file migration count if the helper updates land first. It does add the helper-update step and a full re-run to confirm no regression across the 75 done files.

---

## 4. N3 + N4 under the rename — confirmed by reading

- **N3 (author top-level type names — `const Phase`, `Phase_variants`).** Closed by the IIFE in classic (`wrapChunkBodyInIife`, `index.ts:591`, called unconditionally for `moduleFormat !== "esm"` at `index.ts:1901-1902`) and by module scope in ESM. The rename changes only accessor CALL names and moves key-derivation into the prologue; it does not touch the wrap. **N3 closure UNCHANGED.**
- **N4 (engine names — the `data-scrml-engine-mount` attribute + 9 top-level engine consts).** Closed by `nsName(varName)` inside the engine name helpers (`emit-engine.ts:355/367/379/391/…`) and the mount emitter. `nsName` emits `<token>_<name>` at engine-NAME sites — a mechanism orthogonal to accessor renaming. The rename touches neither `nsName` nor the mount attr. **N4 closure UNCHANGED.**
- **Engine ACCESSOR calls** (e.g. `_scrml_engine_advance("phase", tag, __scrml_engine_<token>_phase_transitions)`) are renamed to `_scrml_cs_engine_advance(...)`; the wrapper namespaces arg 0 (the cell key `"phase"`) exactly as today, and the table-name arg is already `nsName`-namespaced at emit time. Both mechanisms compose correctly.

The rename is strictly an accessor-naming change; the two structural closures (IIFE/module-scope for N3, `nsName` for N4) that made design **B** beat design **A** are independent of it and are preserved. **No weakening found.**

---

## 5. Step-by-step execution plan (next session)

Ordered; each step names its files and its verification. **Helper updates FIRST** so no already-done file regresses.

1. **Re-introduce the per-accessor key-arg-position metadata** in `codegen/index.ts` (lift from reverted attempt-b: `"0"` / `"01"` / `"2"` / `""` / special-ssr). Files: `codegen/index.ts` (`CELL_SCOPE_ACCESSORS` → a `Record<name, positions>`). Verify: unit-compile the `wide` fixture, eyeball the prologue.
2. **Rewrite `buildCellScopePrologue`** (`index.ts:520`) to emit inlined `_scrml_cs_key` + `_scrml_cs_<accessor>` wrappers (per §1.1/§1.4) instead of the `_scrml_cell_scope(...)` destructure. Verify: prologue references only real accessors + `_scrml_cs_key`; no `_scrml_cell_scope` in output.
3. **Add the post-hoc callee-rename pass** (resurrect `cell-namespace-pass.ts` Acorn machinery, rename callee not key), run on the body BEFORE the prologue is prepended (§1.2 ordering). Files: `codegen/index.ts` + a new `codegen/cell-accessor-rename.ts`. Verify: `wide`/`engine` chunk bodies call `_scrml_cs_*`; the prologue wrappers still call the real accessors; the esm import set still imports the real accessors (`emit-client-esm.ts` unchanged).
4. **Strip core:** delete `_scrml_cell_scope` and `_scrml_cell_key` from `runtime-template.js` (the scope factory + the core key fn), and **move `_scrml_cell_name` into the conformance shim** (`conformance/adapters/impl1-ts.ts` `CONFORMANCE_SHIM`), removing it from core. Trim the banner comment to one line. Files: `runtime-template.js`, `conformance/adapters/impl1-ts.ts`. Verify: **§C10.1 green**, and **gzip-measure the SPA runtime whitespace-normalized — must be < 16384** (§2.2; the margin is ~129 B, smaller than whitespace noise, so measure carefully).
5. **Make `captureInsideChunkScope` and `unwrapChunkScope` rename-aware** (§3.3). Files: `compiler/tests/helpers/chunk-scope.js`. Verify: re-run the ~75 already-migrated files — **zero regressions** (they must stay green).
6. **Work the remaining 46 files** by the established recipes (harness/engineName/iifeShape/unclassified). **Unclassified individually** — that bucket produced all 6 bugs so far; treat each as a suspected seventh.
7. **Add the `E-CG-018` §34 catalog row** (token-collision code, `assertChunkTokensDistinct`) — lands WITH the impl per the named-codes-land-with-impl rule. Files: `compiler/SPEC.md` §34 table + the two prose blocks (mirror `E-CG-015`/`E-CG-016`).
8. **Adversarial re-review (S239), then full verification:**
   - acceptance test CLOBBERED→isolated, both formats, real Chromium (`accept.sh` + the 3 fixtures via `collision-exec.mjs`), labelled with the final commit;
   - both BUG-6 tests green (`c10-error-message-resolution`, `v0-3-x-spa-tree-shake-phase-b`);
   - full suite name-diff vs `e8fdd44c` — target the **31** unique pre-existing names, `base-only-now-passing` still **0**;
   - artifact-diff gate PASS (with the wrapper + token folds already in `artifact-diff.mjs`), report the compared file count.

**End state:** all four namespaces isolated, both BUG-6 tests green, name-diff clean, gate PASS.

---

## 6. Risks + open questions

- **[HIGH — flag to bryan] The 16 KB budget is a knife-edge, pre-existing.** BASE was 16,257 (127 under). A zero-residue rename lands at 16,255 — it fits with ~2 B of margin over base, but the margin (129 B under budget) is *smaller than the gzip whitespace-noise band* (~200 B) I hit while measuring. The executing session MUST whitespace-normalize the core-removal and re-measure; if it lands over, the mechanism is sound but the BUDGET must move (it was already nearly saturated at base, independent of this arc). **Recommend surfacing to bryan now: "the 16 KB SPA-runtime budget had 127 B headroom before chunk-namespacing; do we raise it to, say, 18 KB to give the mechanism air, or hold the line and require zero-residue forever?"** The rename can meet either answer; the knife-edge is the real risk.
- **[MED] The post-hoc callee-rename pass must be Acorn-based**, exactly as the deleted `cell-namespace-pass.ts` was, or it corrupts author strings/comments containing accessor-looking text. Regex is not safe here. The pass's accessor set must equal the prologue's (`CELL_SCOPE_ACCESSORS`) or a call gets a wrapper that is never defined (ReferenceError) or a definition that is never called (dead).
- **[MED] `_scrml_cell_name` relocation.** Moving it into the conformance shim assumes NO production caller — grep-confirmed today (only the shim, guarded). If a future feature (devtools, error-boundary labels) needs the author name at runtime, it must inline the 5-line inverse in the emitting chunk, not resurrect a core function (that re-breaks the budget). Note this in the code.
- **[LOW] Per-chunk prologue growth.** Inlining key-derivation + per-accessor wrappers adds ~6–40 lines per namespaced chunk (scaling with accessors used). This is per-`*.client.js`, an UNBUDGETED axis, and gzips well (identical text across chunks). Accepted by the always-on ruling. Not a blocker; noted for the artifact-diff gate, which already folds the prologue via `unwrapChunkScope`.
- **[LOW] Could not rule out:** interaction of the callee-rename pass with `--embed-runtime` (the runtime is inlined; the pass must still rename body calls but leave the inlined runtime's own accessor DEFINITIONS alone — the runtime-end marker split in `addCellScopePrologue`/`wrapChunkBodyInIife` already separates these, so the pass should run only on the post-marker body). The executing session should add an embed-mode fixture to the collision/artifact set.

### Closed — do NOT reopen (ratified this session)
- **Token scheme** (FNV-1a of the project-root-relative path, R2 filesystem-root third tier) — bryan RATIFIED.
- **SPEC §22.10 meta-scopeId** — bryan AMENDED to contract-not-form (deterministic + document-unique; encoding implementation-defined).

`E-CG-018`'s §34 row is the only catalog work left, and it lands WITH the impl (step 7).
