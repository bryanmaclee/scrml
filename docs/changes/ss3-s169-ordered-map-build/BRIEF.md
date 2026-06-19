# BRIEF — ss3 item2 `s169-ordered-unordered-build`

**Dispatched by:** sPA ss3 · **Agent:** scrml-js-codegen-engineer · **isolation:** worktree · **model:** opus
**Land target:** the agent commits on its own worktree branch; the sPA file-deltas the changed files onto `spa/ss3`.

## The bug (R26-reproduced on real source a99246e2)

An `@ordered` value-native map (§59.2/§59.8) is built **UNORDERED** because codegen hardcodes the
runtime `ordered` flag to `false` at every map-literal emit site. `@ordered` is a postfix TYPE affix
on the CELL (`<m>: [string: int]@ordered = [...]`); codegen drops it.

§59.8 is **normative** ("`@ordered` opts a map into insertion-order iteration"). §59 phase-c is
**shipped (S169)** — this is a real bug in shipped behavior, NOT a SPEC-sanctioned v1 cut (§59.12
cuts only map-as-key / struct-key-literal / `set` — NOT `@ordered`-init). The runtime ALREADY
honors `ordered=true` fully (`_scrml_map_from_entries(pairs, ordered)` → `_scrml_map_empty(ordered)`
+ `_scrml_map_set_inplace` maintains the `m.order` sidecar — runtime-template.js:4314/4327).

### Reproducers (all emit `false`, should emit `true`)

1. **decl-init literal** — `<m>: [string: int]@ordered = ["b": 2, "a": 1]`
   → `_scrml_reactive_set("m", _scrml_map_from_entries([...], false))` + the `_scrml_init_set` sidecar.
2. **decl-init `[:]` then `.insert`** — `<m>: [string: int]@ordered = [:]` → `_scrml_map_from_entries([], false)`;
   because the cell is born unordered, subsequent `.insert` clones preserve `ordered:false` → inserts also lose order.
3. **reassignment literal** — `@m = ["b": 2, "a": 1]` (m an `@ordered` cell) → reassign site also emits `false`.

All three share ONE root: every `emitMapLit` emission passes `false`.

## The fix (single emit point + name-set-keyed threading; mirrors the existing `mapVarNames` infra)

The ordered-ness of a map VALUE is a property of the TARGET CELL's type, not of the literal. So thread
the target cell's `@ordered`-ness to the (outermost) literal emission. Use the EXACT pattern the
existing `mapVarNames` set already uses.

1. **`compiler/src/codegen/reactive-deps.ts`** — add + export `collectOrderedMapVarNames(fileAST): Set<string>`.
   Mirror `collectMapVarNames` (:353) but include a cell ONLY when its `state-decl` `typeAnnotation` is an
   `@ordered` map type — i.e. `isMapTypeAnnotation(ann)` AND `ann.trim().endsWith("@ordered")`. A bare
   `<m> = [:]` / `<m> = ["a":1]` with NO annotation is UNORDERED (correct — only the affix orders it).

2. **`compiler/src/codegen/emit-expr.ts`** —
   - `EmitExprContext` (:86): add `orderedMapVarNames?: Set<string>` (file-level set) and a transient
     `emitMapLitOrdered?: boolean` (per-emission flag).
   - `emitMapLit` (:585): `const ordered = ctx.emitMapLitOrdered === true;` emit
     `_scrml_map_from_entries([...], ${ordered})` (and the empty `[]` branch). **Recurse into entry keys
     AND values with the flag CLEARED** (`{...ctx, emitMapLitOrdered: false}`) so NESTED map-VALUE
     literals stay unordered — the cell's `@ordered` applies only to the outermost map. (Nested
     `@ordered`-VALUE types are a separate known v1 gap — codegen has no per-value annotation; OUT OF SCOPE.)
   - `emitAssign` (:1073): when the target is a reactive `@<name>` and `name ∈ ctx.orderedMapVarNames`,
     emit the RHS with `emitMapLitOrdered: true`. (Precedent: emit-event-wiring.ts:517 already keys a
     reassignment branch on `mapVarNames.has(target.name.slice(1))`.)

3. **`compiler/src/codegen/emit-logic.ts`** — the `state-decl` arm (the `_scrml_reactive_set("name", <RHS>)`
   emission) AND the C5 `_scrml_init_set` sidecar (:807-901, both `emitExpr(node.initExpr, _makeExprCtx(opts))`
   sites at :876 and the fallback :897): when the decl's `typeAnnotation` is an `@ordered` map, build the
   expr ctx with `emitMapLitOrdered: true` so the init RHS literal lowers ordered. (You may compute
   ordered-ness directly from `node.typeAnnotation` here — no set lookup needed for the decl's own init.)

4. **Thread `orderedMapVarNames` into the ctx at EVERY site `mapVarNames` is threaded** — mirror exactly:
   `emit-functions.ts` (:445-446 collect, :797/:841/:997 spread), `emit-event-wiring.ts` (:390-391 collect,
   :394 spread, + the :505-517 reassignment branch needs ordered awareness for `@m = [...]` in event handlers),
   `scheduling.ts` (:326 param, :350 spread — add an `orderedMapVarNames` param alongside `mapVarNames`),
   `emit-client.ts` (import + collect). Grep `mapVarNames` across `compiler/src/codegen/` and add a parallel
   `orderedMapVarNames` everywhere it appears. Gate identically (`...(orderedMapVarNames.size > 0 ? {orderedMapVarNames} : {})`).

## Verify (R26 — empirical, on real source)

- Recompile the 3 reproducers (the agent re-creates them; see shapes above) and grep the emitted
  `*.client.js` for `_scrml_map_from_entries`: decl-init + `[:]` + reassign to an `@ordered` cell ALL emit `true`;
  a non-`@ordered` map and a NESTED map-value literal still emit `false`.
- Runtime correctness: an `@ordered` cell's `.keys()` returns INSERTION order; a plain map's returns canonical.
- Full `bun run test` (incl. browser) GREEN. The existing map suites are the canaries:
  `compiler/tests/unit/value-native-map-codegen-emit-d4.test.js`, `value-native-map-runtime-s169.test.js`,
  `compiler/tests/integration/value-native-map-e2e-d4.test.js`. Add a focused test asserting the `true`
  flag for an `@ordered` decl-init + reassignment, and `false` for nested-value + non-ordered.
- `node --check` the emitted JS for all reproducers.

## Mandatory dispatch blocks

**F4 startup-verification (run FIRST):** `pwd` and `git rev-parse --abbrev-ref HEAD` — confirm you are in
YOUR isolated worktree, NOT `/home/bryan-maclee/scrmlMaster/scrml` (main) and NOT `../scrml-spa-ss3`. If
`node_modules` is absent, symlink it: `ln -s /home/bryan-maclee/scrmlMaster/scrml/node_modules ./node_modules`
and `ln -s /home/bryan-maclee/scrmlMaster/scrml/compiler/node_modules ./compiler/node_modules` so `bun test` resolves.

**Path discipline (S88/S99/S126):** ALL Write/Edit/Bash file writes use your worktree-absolute paths. NEVER
write to a `/home/bryan-maclee/scrmlMaster/scrml/...` (main) absolute path. NEVER `cd` into main. Use
Bash-edits/heredocs rooted in your worktree. After each step, `git status` to confirm only intended files changed.

**Commit discipline (S83/S113/S164):** Commit after each meaningful unit (collector → ctx field → emitMapLit →
emitAssign → emit-logic → threading → tests). Coupled code+test = ONE commit. WIP commits expected. `git status`
clean before you report DONE. NEVER `--no-verify`. Update `docs/changes/ss3-s169-ordered-map-build/progress.md`
after each step (append-only, timestamped). Report your branch name + final SHA + the changed-file list when done.

**Scope guard:** stay within the codegen subsystem files named above. Do NOT touch the runtime (it already
works), the type-system recognizer, or the parser. If the fix wants to spill outside codegen, STOP and report back.
