# ss52 — non-reactive local map/set method lowering (the (c) bug) — DEV BRIEF

**Dispatched:** sPA ss52, 2026-06-27 · agent `scrml-js-codegen-engineer`, isolation:worktree, opus.
**Branch base:** local `main` `2310b53a` (NOT origin/main — local main carries the landed ss43
`emit-expr.ts` change; basing on stale origin/main would conflict). Your worktree branches from this.
**Change-id:** `nonreactive-local-map-set-2026-06-27`. **MED · Road-B-critical · VERIFY-FIRST.**

## The bug (PA-VERIFIED S225)
Value-native maps/sets **do not work in non-reactive / pure code.** A pure-fn local map:
```scrml
fn probe(): int {
    let m = [:]
    m = m.insert("k", 1)
    return m.size
}
```
emits **raw** `m.insert(...)` / `m.size` (method/property syntax) — but the runtime map API is
**free functions** (`_scrml_map_insert(m,k,v)`) and the HAMT struct carries `.count`, NOT `.size`
→ **runtime `TypeError: m.insert is not a function`**. It **compiles clean** (`node --check`
passes — valid JS *syntax*) and crashes silently at runtime. The §59 "Implemented / R26-verified"
banner only ever exercised **reactive** (`@`) maps.

**Root cause:** the map/set method lowering keys on the **`@`-cell sigil (reactivity)** + the
`ctx.mapVarNames`/`ctx.setVarNames` registries — which collect **only `@`-prefixed reactive
cells**, NOT by type. A non-reactive local map (`let m`, no `@`) is absent from those registries
AND excluded by the `@`-prefix gate → the method call falls through to raw emission. The reactive
`@m.insert` path lowers correctly (`_scrml_map_insert(_scrml_reactive_get("m"),…)`).

## Footprint (exact loci — confirmed by sPA scope)
**The 3 `@`-gated dispatch sites — `compiler/src/codegen/emit-expr.ts`:**
- **emitCall — map methods** (~**line 1818**): `ctx.mapVarNames && ... (callee.object).name.startsWith("@") && ctx.mapVarNames.has(bareName)` → `MAP_METHOD_HELPERS` (`_scrml_map_*`, defined ~line 361).
- **emitCall — set methods** (~**line 1763**): the mirror `ctx.setVarNames && ... .startsWith("@")` gate (`.add`→`_scrml_map_insert(s,k,true)`, `.elements()`→`_scrml_map_keys`, `.has`/`.remove`/`.size` shared via mapVarNames).
- **emitMember — `.size`** (~**line 1578**): `ctx.mapVarNames && ... .name.startsWith("@") && ctx.mapVarNames.has(...slice(1))` → `_scrml_map_size`.
- **emitIndex — bracket-read `m[k]`** (~**lines 1618 + 1631–1641**): `if (!rootName.startsWith("@")) return null;` then `ctx.mapVarNames.has(bare)` → `_scrml_map_get`.

**The collectors (DEFINITIONS — the list named the call sites; the defs are here):**
`compiler/src/codegen/reactive-deps.ts` — **`collectMapVarNames` @ line 373**, **`collectSetVarNames` @ line 463** (+ `collectOrderedMapVarNames`). These currently gather only reactive `@`-declared cells.
**Call sites that consume them** (already thread the sets into `ctx`): `emit-functions.ts:446/453`, `emit-reactive-wiring.ts:290/294`, `emit-event-wiring.ts:532/536`; threaded via `scheduling.ts:378`.
**Pattern precedent:** `emit-logic.ts:2391` — "codegen keys on the collected name-set."

## The fix (two parts — per the PA fill-note)
**(1) Extend the collectors to gather non-reactive LOCAL map/set bindings — SCOPE-AWARE.**
Locals are fn/block-scoped (unlike module-level reactive cells), so this is the crux/risk. Seed a
local map/set name-set from:
- `= [:]` / `= [k:v]` map-literal initializers (`let m = [:]`, `const m = ["a":1]`);
- `: [K:V]` map type annotations and `set[K]` / set annotations (`let m: [string:int]`);
- map/set-returning expressions + reassignments (`m = m.insert(...)`, `let m2 = otherMapFn()`).

**SYM annotations are UNRELIABLE at codegen** (codegen re-parses exprs — SYM is absent there). Use
a **syntactic local-scope collector mirroring the `mapVarNames` pattern** (per-function tracking).
Set rides the same machinery (a set IS a map — `collectSetVarNames` mirror).

**(2) Relax the `@`-prefix gate** in emitCall (map + set) / emitMember (`.size`) / emitIndex
(bracket-read) to ALSO fire for the local names from (1), emitting the receiver as the **bare
local** (`m`, NOT `_scrml_reactive_get("m")`). The reactive `@`-path must stay byte-identical;
only the new non-reactive-local branch emits the bare receiver.

## VERIFY-FIRST (mandatory — before writing the fix)
Compile the repro above. **Confirm** (a) the emitted JS contains raw `m.insert(...)` / `m.size`
(not `_scrml_map_*`), AND (b) running it throws `TypeError: m.insert is not a function`. Report the
raw emit + the throw. (This is the (c) bug PA-verified S225 by emit inspection + the free-fn API +
`.count`-not-`.size` deduction — confirm it empirically.)

## R26 + adversarial acceptance (must ALL hold)
- A pure `fn` using a **local map** AND a **local set** → `node --check` clean **AND RUN it**
  (execute the emitted JS — must NOT TypeError; assert the actual return value is correct).
- `.size` returns the count; `m[k]` bracket-read works; `m = m.insert(...)` reassignment works.
- **Set:** `.add` / `.elements()` / `.has` / `.remove` / set algebra on a non-reactive local set
  all lower + run correctly.
- **Adversarial:** nested local maps (a map whose value is a map); a local map **passed to** a fn
  and **returned from** a fn; **single-use vs reassigned** local; **ordered** maps (`@ordered` /
  ordered-literal — `collectOrderedMapVarNames` must extend too); a local map in a block scope.
- **Zero regression on reactive maps/sets** — the `@`-path lowering is unchanged (diff the reactive
  fixtures' emit).
- **Full §59 map/set test suite** green (incl. `compiler/tests/integration/value-native-map-e2e-d4.test.js`).
- **Full `bun run test` GREEN** before DONE. If a parser/codegen-shape shift bumps a within-node
  fixture, re-baseline the M6.5.b.0 allowlist IN THE SAME LANDING (report which + why).

## SPEC re-verification
The §59 "Implemented / R26-verified" banner + the **§59.12 set note** get an **"incl. non-reactive
locals"** re-verification line (they previously only covered reactive maps/sets). Update the banner
text to reflect that non-reactive local maps/sets now lower + run. No new §34 codes expected (this
is a lowering completeness fix, not a new diagnostic) — but if the fix surfaces a case that SHOULD
error (e.g. a genuinely untyped local), name it and flag for PA ruling, do not invent a code.

## Discipline
- **Native-parser FROZEN** — live Acorn pipeline only; do NOT touch `compiler/native-parser/**`.
- **Reconciliation:** the list flags `emit-expr.ts` is shared with **ss50** — ss50 is NOT in flight
  (no branch/worktree exists), so no reconciliation needed; build on current `emit-expr.ts`.
- Commit incrementally in your worktree (crash-recovery anchor). Do NOT push, do NOT touch main,
  write ONLY inside your worktree checkout (`git status` must show no main-checkout leakage).
- Pre-commit hook runs the full unit+integration+conformance suite (~108–124s) — generous timeout
  on foreground commits.

## Report back
1. VERIFY-FIRST findings (raw emit + the runtime throw, with evidence).
2. The fix: how the scope-aware collector works (per-fn seeding) + which gates you relaxed + how the
   bare-receiver branch emits.
3. R26 results: the compile + **RUN** evidence (actual return values), per acceptance bullet.
4. Adversarial-case results (each: pass/fail + evidence).
5. `bun run test` final result + any allowlist re-baseline.
6. §59 / §59.12 banner re-verification text.
7. Final commit SHA(s) + worktree branch name.
