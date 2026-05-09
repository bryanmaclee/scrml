---
title: A1c C3 Phase 0 SURVEY — render-spec expansion at `<x/>` use site
date: 2026-05-08
session: S73
worktree: agent-a32259110ec3b4011
branch: <harness-assigned>
baseline-head: e62bb5a (S70 wrap; clean tree at startup)
status: SURVEY COMPLETE — verdict PROCEED-AS-BRIEFED
---

## §0 Methodology + worktree state

Read in full: BRIEF.md, SPEC §6.4 (verbatim), SPEC §5.4.1 (verbatim), C1 SURVEY.md (full),
C2 SURVEY.md (full), `compiler/src/codegen/emit-html.ts` (915 LOC, full),
`compiler/src/codegen/binding-registry.ts` (167 LOC, full), `compiler/src/codegen/emit-bindings.ts`
(lines 1-505, full),
`compiler/src/codegen/emit-logic.ts` lines 600-980 (state-decl shape dispatch),
`compiler/src/codegen/emit-lift.js` lines 470-570 (`emitCreateElementFromMarkup`),
`compiler/src/codegen/usage-analyzer.ts` lines 90-290, 500-700 (state-decl walker + renderSpec
descent), `compiler/src/codegen/context.ts` (CompileContext shape),
`compiler/src/symbol-table.ts` lines 6260-6730 (`runSYM` + `_scope` annotation,
`lookupStateCell`, `getCellKind`, `isCellBindable`), `compiler/src/symbol-table.ts` lines
1700-1840 (B6 walker reference for the legality predicate C3 mirrors).

PA-PRIMER §13.7 B5/B6 specifics + §11 absorbed for context.

### Worktree state
- WORKTREE_ROOT: `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a32259110ec3b4011`
- Tree clean at startup; HEAD: `e62bb5a` (S70 wrap)
- `bun install` → 114 packages, clean
- `bun run pretest` → 12 samples 0 errors
- Baseline `bun run test` → **9,872 pass / 60 skip / 1 todo / 0 fail / 34,278 expects**

Two flake fails (ECONNREFUSED on bootstrap + happy-dom integration) appeared on first run;
re-running gave 0 fails. Will treat baseline as 9,872 / 60 / 1 / 0; flakes re-trigger via
network noise and are out of scope.

---

## §1 Locus confirmation — file authority

**BRIEF §file-locus authorization:** "agent is authorized to correct the locus." Survey verdict:
**locus is `compiler/src/codegen/emit-html.ts`** (the markup walker `generateHtml`).
Justification:

1. `emit-html.ts:generateHtml` (lines 155-915) is the SOLE consumer of markup AST nodes for HTML
   output. Every `<tag/>` in markup body lands at the `node.kind === "markup"` branch (line 323).
2. The walker has access to `fileAST` and `registry` already (constructor args + new
   CompileContext signature). It therefore has the prerequisites for tag-name → cell lookup
   (via `fileAST._scope`'s `lookupStateCell`).
3. No "markup-emit.ts" sibling exists. The brief flagged this as a possible BRIEF drift; survey
   confirms the file does not exist; canonical path is `emit-html.ts`.
4. Adding a new sibling for one branch (~80 LOC of dispatch) is over-engineering — the existing
   walker has 12+ tag-discriminating branches (errorBoundary, program, lifecycle, input-state,
   request, timeout, channel) and one more is consistent with the prevailing pattern.

**Decision:** EXTEND `emit-html.ts` with a render-by-tag detection branch added immediately
before the generic `<${tag}` emission (around line 700, just after the if= mount/unmount block).

---

## §2 Existing infrastructure map (depth-of-survey discount)

| Need | Existing infrastructure | Reuse path |
|---|---|---|
| Detect `<tag/>` resolves to a registered cell | `lookupStateCell(fileScope, tag)` exported from `symbol-table.ts:6578`. `fileScope` lives at `fileAST._scope` (`runSYM` line 6271, non-enumerable) | Import `lookupStateCell` + `getCellKind` from symbol-table; pull `fileAST._scope` at top of `generateHtml`. |
| Filter for Shape 2 bindable | B5 stamps `_cellKind === "bindable"` (`isCellBindable(decl)` returns true). B6 already gated illegal cases — at codegen time only legal uses survive | Use `getCellKind(declNode) === "bindable"` as the predicate. B6's diagnostic walker pre-filters illegal cases. |
| Emit the cell's render-spec markup at the use-site DOM position | `emitNode(node)` already walks markup AST recursively. The cell's `renderSpec.element` is a markup AST node — calling `emitNode(declNode.renderSpec.element)` ALREADY produces the correct HTML (it walks attributes, children, attaches data-scrml-bind-* placeholders for any bind:* attrs). | Direct `emitNode` re-entry on `renderSpec.element` after stamping the bindable hookpoint. |
| C4 hookpoint for bind:* dispatch | `BindingRegistry.addLogicBinding` already handles diverse-shape bindings + `data-scrml-render-by-tag-N` data-attribute placeholder pattern matches existing use cases (`data-scrml-bind-show`, `data-scrml-attr-tpl-N`, `data-scrml-bind-${name}`). | Add a new LogicBinding shape `{kind: "render-by-tag", placeholderId, cellName, declNode}` recorded into the registry. C4 reads from `registry.logicBindings.filter(b => b.kind === "render-by-tag")`. |
| Validators carry as HTML attrs (req/pattern/min/max where HTML-native) | `emitCreateElementFromMarkup` in `emit-lift.js` already walks attributes + setAttribute. emit-html's markup branch walks attributes too. **For Shape 2 the renderSpec.element ALREADY carries its declared attributes verbatim** — they were written into the markup AST at parse time. The only gap is "validator predicates lowered to HTML attrs" (e.g., `req` → `required`). Per BRIEF §scope item 3 + §6.4.2, this MAY already be wired (re-check); if not, C3 emits the carry-forward shape. | **Check first:** the renderSpec markup tree as it lands in the AST. If the validator-derived attrs (`required`, `pattern="..."`, `min="N"`) are NOT pre-attached, we add them in C3 from `decl._record.validators` or `decl.validators` directly. |
| File-scope handle for `lookupStateCell` | `fileAST._scope` is set non-enumerably by `runSYM` (line 6271). Tests that bypass SYM (raw test-helper construction) lack `_scope`; conservative default is "no expansion fired" — falls through to raw `<tag/>` emission (legacy). | Defensive guard: `if (!fileScope) skip render-by-tag`. |

**Discount:** All required infrastructure exists. No new helper functions needed. No new module
needed. The work reduces to:
1. Detect render-by-tag use sites in `emit-html.ts` markup branch (lookupStateCell + getCellKind).
2. Re-enter `emitNode(renderSpec.element)` with appropriate hookpoint annotations.
3. Record a render-by-tag LogicBinding for C4.
4. Lower a small set of validators to HTML attrs (only if not already done by ast-builder).

Estimate revision: BRIEF says ~4-5h. Survey says **~2.5-3.5h** (pure extension; reuses 4 existing
primitives without modification). The bulk is unit tests (~25-40 tests).

---

## §3 Implementation plan

### §3.1 emit-html.ts addition (~50 LOC)

At the top of `generateHtml`, after `fnBodyRegistry` line:

```ts
// Resolve fileScope from the fileAST. Set non-enumerably by runSYM (symbol-table.ts:6271).
// When the AST was constructed without SYM (raw test fixtures), fileScope is undefined and
// render-by-tag detection is skipped — the legacy emit-as-raw-tag path keeps working.
const fileScope = fileAST?._scope ?? null;
```

Inside `emitNode`, in the markup branch (line 323+), AFTER the `if-chain` / lifecycle /
input-state / request / timeout / channel / bind-validation pre-passes and BEFORE the generic
`<${tag}` open-tag emission (line 702):

```ts
// SPEC §6.4 / §5.4.1 / L17 — render-by-tag expansion. When a self-closing lowercase
// tag resolves to a registered Shape 2 `bindable` state cell, expand to the cell's
// renderSpec.element at this DOM position. B6 (symbol-table.ts:1715) has already
// fired E-CELL-NO-RENDER-SPEC / E-CELL-RENDER-SPEC-NOT-BINDABLE on illegal use
// sites, so by codegen time only legal uses survive.
//
// The expansion is identical at every use site (§6.4.4 — no per-site overrides).
// Multi-render correctness (L16): the same cell may appear at multiple use sites;
// each expansion is fresh; the underlying reactive cell (declared at C1) is shared.
//
// C3 emits the EXPANSION SHAPE only — actual bind: dispatch by render-spec element
// type is C4 (§5.4.1 dispatch table). C3 stamps a `data-scrml-render-by-tag` hookpoint
// for C4 to wire bind:value/bind:checked/bind:files/bind:group through.
if (
  isSelfClosing &&
  fileScope &&
  /^[a-z]/.test(tag) &&
  !VOID_ELEMENTS.has(tag) &&
  !LIFECYCLE_SILENT_TAGS.has(tag) &&
  !INPUT_STATE_TAGS.has(tag) &&
  !REQUEST_TAGS.has(tag) &&
  !TIMEOUT_TAGS.has(tag) &&
  tag !== "channel" &&
  tag !== "errorBoundary" && tag !== "errorboundary" &&
  tag !== "program"
) {
  const decl = lookupStateCell(fileScope, tag);
  if (decl && getCellKind(decl.declNode) === "bindable") {
    const renderSpecRoot = (decl.declNode as any).renderSpec?.element;
    if (renderSpecRoot && renderSpecRoot.kind === "markup") {
      const renderById = genVar("render_by_tag");
      // Compose an expanded markup node: clone renderSpec.element, augment its
      // attributes with (a) the render-by-tag data-attr hookpoint for C4, and
      // (b) the validator-derived HTML attrs (req → required, pattern, min,
      // max). The cell name is recorded for C4's bind:* dispatch.
      const validatorAttrs = _validatorAttrsForCell(decl.declNode);
      const renderByTagAttr = { name: "data-scrml-render-by-tag", value: { kind: "string-literal", value: renderById } };
      const expanded = {
        ...renderSpecRoot,
        attributes: [
          ...(renderSpecRoot.attributes ?? renderSpecRoot.attrs ?? []),
          ...validatorAttrs,
          renderByTagAttr,
        ],
        attrs: undefined, // normalize
      };
      emitNode(expanded);
      if (registry) {
        registry.addLogicBinding({
          kind: "render-by-tag",
          placeholderId: renderById,
          cellName: tag,
          renderSpecTag: renderSpecRoot.tag,
          renderSpecAttrs: renderSpecRoot.attributes ?? renderSpecRoot.attrs ?? [],
        } as any);
      }
      return;
    }
  }
}
```

### §3.2 BindingRegistry shape extension (~10 LOC)

Add to `LogicBinding` interface in `binding-registry.ts`:

```ts
/**
 * Phase A1c C3: render-by-tag expansion site. `<userName/>` → renderSpec
 * markup expanded inline + this binding records the cell+renderSpec metadata
 * for C4's bind:* dispatch by render-spec element type (§5.4.1).
 */
kind?: "if-chain-branch" | "if-chain-else" | "render-by-tag";

cellName?: string;
renderSpecTag?: string;
renderSpecAttrs?: any[];
```

The `kind: "render-by-tag"` discriminator extends the existing if-chain-branch pattern.

### §3.3 Validator → HTML attribute lowering (~30 LOC)

A small helper inside `emit-html.ts` (or a sibling module if cleaner). Spec §6.4.2 step 4 says
"validators are wired as HTML attributes and connected to the validity surface (§6.11)." The
validity-surface wiring is C7+; the HTML-native attribute carry-forward is C3. Only the
validators with HTML-native semantics get lowered:

| Validator | HTML attr | Notes |
|---|---|---|
| `req` (bareword) | `required` (boolean) | §55 universal-core |
| `pattern(/regex/)` or `pattern("regex")` | `pattern="<source>"` | regex source extracted from B9's escape-hatch |
| `min(N)` | `min="N"` | numeric-input only |
| `max(N)` | `max="N"` | numeric-input only |
| `length(>=N)` / `length(<=N)` | `minlength="N"` / `maxlength="N"` | RelationalPredicateNode (B9 sibling kind) |

All other validators (`is some`, `gt`, `lt`, `eq`, `neq`, `oneOf`, `notIn`, `gte`, `lte`,
custom `email`/`url`/etc) are NOT HTML-native — they stay validity-surface-only (C7+).

Helper signature:
```ts
function _validatorAttrsForCell(declNode: any): Array<{name: string, value: any}> { ... }
```

Reads `declNode.validators` (B9 contract: ValidatorEntry[] with `args: ValidatorArg[] | null`).
For each known-HTML-native validator, emits one `{kind: "string-literal"}` attribute.

### §3.4 Tests (~25-35 tests, 1 new file)

`compiler/tests/unit/c3-render-spec-expansion.test.js`:

- §C3.1 Single-use-site expansion — `<userName/>` text input
- §C3.2 Multi-use-site expansion — same cell rendered twice in different markup positions (L16)
- §C3.3 Validator carry-forward — `req` → `required`, `length(>=2)` → `minlength="2"`, etc
- §C3.4 Different render-spec shapes — `<input type="checkbox"/>`, `<input type="file"/>`,
  `<textarea/>`, `<select>...</>`, `<input type="radio"/>` (each emits with the right tag and
  retains its `type` attr)
- §C3.5 Compound child render-by-tag — `<formRes><name/></>` where `name` is a Shape 2 cell
  inside the compound (B6 gated this; render-spec lives on the child decl)
- §C3.6 Hookpoint for C4 — verifies `data-scrml-render-by-tag="<id>"` is stamped + the
  registry has a `kind: "render-by-tag"` binding
- §C3.7 Negative case — Shape 1 `<count/>` where B6 already fired E-CELL-NO-RENDER-SPEC: in a
  unit test bypassing B6, `<count/>` resolves to plain cell → no expansion (defensive)
- §C3.8 Negative case — PascalCase tag `<UserCard/>` skips render-by-tag (component territory)
- §C3.9 Negative case — HTML built-in `<br/>` skips (no resolution)
- §C3.10 Defensive — fileAST without `_scope` (no SYM run) — falls through to raw tag
- §C3.11 Output stability — non-Shape-2 markup unchanged (regression guard for Shape 1 cells
  used in `${@x}` interpolation, which is unaffected)

### §3.5 What C4 will hook into (explicit handoff)

C4 reads `registry.logicBindings.filter(b => b.kind === "render-by-tag")`. For each:
1. `placeholderId` → DOM selector `[data-scrml-render-by-tag="<id>"]`
2. `cellName` → the cell to bind reactively (e.g., `"userName"`)
3. `renderSpecTag` (`"input"`, `"textarea"`, etc) + `renderSpecAttrs` (incl. `type="text"`)
   → drives §5.4.1 dispatch:
   - `<input type=checkbox/>` → bind:checked
   - `<input type=file/>` → bind:files
   - `<input type=radio/>` → bind:group
   - `<input type=*/>` (text-shaped) → bind:value
   - `<textarea/>` → bind:value
   - `<select/>` → bind:value (or bind:selected per form table)

C4 then emits the JS that wires `inputElement.value = _scrml_reactive_get("userName"); inputElement.addEventListener("input", ...)` etc — mirroring the existing `emit-bindings.ts` pattern at lines 269-362.

---

## §4 Spec verification (Rule 4)

Re-read SPEC §6.4 (lines 1893-1942) and §5.4.1 (lines 1318-1343) verbatim. Brief claims
match spec text exactly. No drift detected. Specifically:

- §6.4.1 cell-kind table — verified
- §6.4.2 four-step expansion (lookup → emit markup → wire bind: → wire validators) — verified;
  C3 owns the first two; C4 owns the third; C7+ owns the fourth (validity surface wiring)
- §6.4.4 no per-site overrides — verified; C3 emits identical expansion at every use site
- §5.4.1 bind-dispatch table — verified; informational for C3, load-bearing for C4

Brief's spec-claim summary at §spec-verification is accurate. No amendment needed.

---

## §5 Cost decomposition + sub-step boundaries

| WIP | Sub-step | Est | Notes |
|---|---|---|---|
| WIP-1 | Pre-impl scratch: write SURVEY + progress; baseline test snapshot | 30 min | This step |
| WIP-2 | LogicBinding shape extension + lookupStateCell wiring | 30 min | binding-registry.ts + emit-html.ts imports |
| WIP-3 | Render-by-tag detection + emitNode re-entry | 45 min | The core 50 LOC dispatch |
| WIP-4 | Validator → HTML attr helper | 30 min | _validatorAttrsForCell |
| WIP-5 | Test suite c3-render-spec-expansion.test.js | 60 min | ~25-35 tests across §C3.1-§C3.11 |
| WIP-6 | Output stability validation + commit-cadence wrap | 15 min | Confirm 0 regressions on existing 9,872 baseline |

**Total: ~3.5 h** (lower end of brief's 4-5h estimate).

WIP-commit boundaries: each row gets a separate commit `WIP(c3): <topic>` per global crash-
recovery directive. Each WIP is independently testable and the suite stays green throughout.

---

## §6 Diff envelope expected

| Diff source | Cause | Magnitude |
|---|---|---|
| `<userName/>` use-sites in test inputs | NEW emission — was emitting raw `<userName />` | NEW; ~30-60 lines per test fixture (the renderSpec markup) |
| Existing `<input type="text" bind:value=@x/>`-style explicit-form usage | NO CHANGE — the legacy explicit form was always emitted directly | None |
| BindingRegistry shape | New optional fields on `LogicBinding`; existing bindings unaffected | TypeScript shape change only |
| Existing test corpus | Zero existing samples use Shape 2 + render-by-tag (per grep) | ZERO existing-output diff |

---

## §7 Verdict

**PROCEED-AS-BRIEFED** with the following clarifications (no scope changes):

1. **Locus:** `emit-html.ts` (confirmed; brief authorized correction; no sibling needed).
2. **No new runtime helpers needed.** The expansion uses existing primitives: `emitNode`
   recursion, `lookupStateCell` lookup, `BindingRegistry.addLogicBinding`. Everything else is
   purely compile-time.
3. **Validator carry-forward in scope** per BRIEF §scope item 3 — only HTML-native validators
   (`req`, `pattern`, `min`, `max`, `length(>=N)`/`length(<=N)`). Validity surface wiring deferred
   to C7+.
4. **Cost revision:** ~3.5h (vs brief's 4-5h). Discount source: existing infrastructure covers
   90% of the work; the new code is one 50-LOC dispatch + a 30-LOC validator helper + tests.

---

## §8 References

- BRIEF: `docs/changes/phase-a1c-step-c3-render-spec-expansion/BRIEF.md`
- SPEC §6.4: `compiler/SPEC.md:1893-1942`
- SPEC §5.4.1: `compiler/SPEC.md:1318-1343`
- C1 SURVEY: `docs/changes/phase-a1c-step-c1-shape-aware-cell-emit/SURVEY.md`
- C2 SURVEY: `docs/changes/phase-a1c-step-c2-derived-reactive-computation/SURVEY.md`
- emit-html.ts: 915 LOC, full read
- emit-lift.js: `emitCreateElementFromMarkup` at line 479
- binding-registry.ts: 167 LOC, full read
- symbol-table.ts: `lookupStateCell` at 6578, `getCellKind` at 6707, B6 walker at 1715
- usage-analyzer.ts: state-decl + renderSpec walk at 513-566
- runSYM `_scope` annotation: symbol-table.ts:6271 (FileAST gains non-enumerable `_scope`)

---

## §9 Tags

#a1c #c3 #phase-0 #survey-complete #proceed-as-briefed #render-spec-expansion
#depth-of-survey-discount #emit-html-locus #binding-registry-extension
