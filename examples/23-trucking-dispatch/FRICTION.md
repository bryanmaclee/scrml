# Trucking Dispatch — Friction Findings

Living log of friction surfaced while writing the dispatch app. Format per scoping §9. Severity: P0 = silent failure / validation-principle violation; P1 = working but awkward; P2 = minor DX paper cut.

---

## F-AUTH-001 — `auth="role:X"` is silently inert (P0)

**Surfaced in:** M1 design (scoping §5 + §11); applies to every M2-M4 role-gated page.

**M2 confirmation:** All 6 dispatcher pages (board, load-new, load-detail,
drivers, customers, billing) now use the F-AUTH-001 server-side fallback
pattern: each page declares `<program auth="required">` and an inline
`getCurrentUser(sessionToken)` server fn that resolves the cookie + reads
the users row, plus a per-server-fn `if (!user || user.role != "dispatcher")
return { unauthorized: true }` guard. The page-level `auth="role:dispatcher"`
attribute (when written) is documentation only — no compiler effect, no
runtime gating. M2 ships with the attribute deliberately omitted from the
`<program>` openers (because the original `<page route= auth=>` wrapper
hits multi-error parse cascades when it lives inside `< db>`) — the role
check is server-side only. The result: the F-AUTH-001 friction is now
exercised six times in the codebase, exactly as intended by the scoping
doc's stress-test framing. No design change.

**What I tried:**
```scrml
<page route="/dispatch" auth="role:dispatcher">
  ...
</page>
```

**What didn't work:** Compiler accepts `auth="role:dispatcher"` as a generic HTML attribute with no error, no warning, and no runtime role-gating effect. Adopters reading the kickstarter or working from intuition will assume the attribute does what its name says — and the app will silently authorize everyone.

**Workaround used:** Server-side fallback. Every page that declares `auth="role:X"` must also call `checkRole(getCurrentUser(req.headers.cookie), "X")` from a server fn and `navigate("/login?reason=unauthorized")` if it fails. The `checkRole` helper is in `models/auth.scrml`. M1 documents the pattern but doesn't exercise it (only `/login` + `/register` are open).

**Suggests:** Either:
- Compiler should recognize `auth="role:..."` and emit role-gating codegen (preferred: makes the attribute do what it says); or
- Compiler should emit a warning (e.g. `W-AUTH-002`) when it sees an `auth=` value other than `required` / `optional` / `none` so adopters know the attribute is being ignored.

The current behavior — silent acceptance — directly contradicts the S49 validation principle ("if the compiler accepts something but it doesn't work at runtime, that's a P0 friction finding").

**UVB-W1 status (2026-04-30): SILENT-FAILURE WINDOW CLOSED.** VP-1 emits W-ATTR-002 on every `auth="role:X"` attribute on `<page>`, `<program>`, and `<channel>`. The role-gating semantics themselves remain unimplemented (this stays an ergonomic gap for a future ergonomic-completion track) — but the silent acceptance the validation principle flagged is closed: adopters now see a warning at compile time instead of silently-authorized-everyone behavior at runtime. See `compiler/SPEC.md` §52.13 + deep-dive `systemic-silent-failure-sweep-2026-04-30`.

---

## F-AUTH-002 — Cross-file server functions with SQL access are not portable (P0) — **PARTIALLY RESOLVED W5 (2026-04-30)**

**Resolution status (W5, 2026-04-30):**

W5 landed:
- **Layer 1** — `ast-builder.js` export-decl branch now correctly handles
  `pure`/`server` modifier prefixes. `export server function NAME` /
  `export pure function NAME` / `export pure server function NAME`
  (and `fn` variants) properly register `exportedName` + `exportKind` and
  carry `isPure` / `isServer` flags. Pre-fix, `collectExpr` stopped at
  `function` STMT_KEYWORD after consuming `server`, leaving the export-decl
  with raw=`"export server"` and `exportedName=null` — every cross-file
  import of such a name fired E-IMPORT-004.
- **SPEC §21.5.1** — formalizes the modifier-carrying export grammar with
  normative statements on isPure/isServer flag semantics.
- **SPEC §44.7.1** — documents the module-with-db-context contract
  (Shape B+A from the deep-dive). Defines `E-SQL-009` for cross-file
  pure-fn `?{}` without proper `< db>` declaration.
- **Tests** — `tests/integration/f-auth-002-export-modifiers.test.js`
  (13 tests, all passing). Covers all modifier permutations + module-resolver
  registry interaction.

**Still deferred to W5-FOLLOW dispatches:**

The full closure of F-AUTH-002 (~450 LOC inline-duplication unblocked)
requires two more dispatches:

- **W5a (auto-detect-library):** SPEC §21.5 says "the compiler SHALL
  recognize this pattern automatically; no special file extension or
  pragma is required" — currently NOT IMPLEMENTED. Pure-fn files
  compiled in browser mode produce empty `.client.js` — even simple
  `export function helper(x) { ... }` doesn't survive cross-file. The
  fix is to auto-detect `!hasProgramRoot && no markup && no CSS` and
  emit library-style ES module output regardless of `--mode` flag.
  Without this, no cross-file import from a pure-fn file works at runtime.

- **W5b (cross-file-?{}-resolve):** Implement the §44.7.1
  module-with-db-context machinery. Pure-fn files that contain a
  top-level `< db src=>` block become db-context modules. The compiler
  annotates the block's children with `_dbVar` (extending the existing
  `<program db=>` annotateDbScopes pass), routes their `?{}`-containing
  server functions, and emits a server.js that the importing page's
  client.js fetches via the standard server-route mechanism. Hard error
  E-SQL-009 fires when a pure-fn file uses `?{}` without a `< db>`
  declaration. Depends on W5a.

**Why W5 stopped at Layer 1:** During diagnosis, the cross-file
emission pipeline was found to be broken even for non-SQL exports
(`export function helper(x) { ... }` produces an empty `module.client.js`).
This is a foundational gap in pure-fn-file emission that the W5-medium
scope does not cover. Per the W5 brief's stop-and-surface instruction
("If diagnosis reveals the resolution requires architectural changes
to the import system beyond pure-fn-with-db-context"), the auto-detect
piece is being surfaced for its own dispatch (W5a).

**Original friction below:**

**Surfaced in:** M1, when attempting to put `login()` / `register()` / `getCurrentUser()` in `models/auth.scrml` so multiple pages could import them.

**M2 confirmation:** Each of the 6 dispatcher pages duplicates the
~7-line `getCurrentUser(sessionToken)` server fn body inline. Total
duplication: ~42 LOC across the 6 pages doing the same session →
user-id → users-row lookup. Refactoring this into a shared helper file
hits E-SQL-004 the moment the helper has a `?{}` SQL block, so the
duplication is unavoidable. M2 confirms the friction is sharp and
load-bearing on every multi-page scrml app touching auth.

**What I tried:** Make `models/auth.scrml` a pure-fn file (§21.5) exporting `server function login(email, password)` etc., with `?{}` SQL blocks reading the `users` table.

**What didn't work:**
- E-SQL-004 fired at compile time: `?{}` block has no `db=` declaration in any ancestor `<program>`.
- Pure-fn files (no markup, no CSS) by definition have no `<program>` root, so they cannot host any `< db>` block, and any `?{}` they contain has no ancestor `<program db=>` to resolve against.
- Adding `<program db="./dispatch.db">` + `< db src="./dispatch.db" tables="users, customers">` to the file would make it a full page, not a pure-fn file — and would also create a separate program lifecycle that the importing page can't share session state with.

**Workaround used:** Inline `login()`, `register()`, and `getCurrentUser()` into `app.scrml`'s `< db>` block (M1). For M2-M6 pages that also need these, copy the function bodies into each page's own `< db>` block, OR wrap them in middleware (§40 `handle()`). Exporting non-SQL helpers (cookie parsing, role checks, constants) from `models/auth.scrml` works fine — the friction is specifically with `?{}`-using server fns.

**Suggests:** Either:
- §21 should be extended so that an exported `server function` carrying `?{}` is "portable" — at import time, the compiler resolves the `?{}` against the importing file's `< db>` block (or fails if absent); or
- A new file mode "module-with-db-context" that lets a non-page file declare `< db>` for its own server fns; or
- Document the gap explicitly in §21 + §44 so adopters know server fns with SQL must live in their using page.

The friction is sharp because the obvious abstraction (factor out auth into `models/auth.scrml`) is exactly what every multi-page app wants. Inlining session/user logic into every page is duplicative, error-prone, and undermines §21's promise of multi-file scrml.

---

## F-EQ-001 — `===` is not valid scrml (P2 — DX paper cut)

**Surfaced in:** M1, first draft of `models/auth.scrml`.

**What I tried:** `if (k === name)` — out of JS/TS instinct.

**What didn't work:** E-EQ-004 — *"`===` is not a valid scrml operator. Use `==` instead — scrml equality is always strict."*

**Workaround used:** Replaced `===` with `==`. Per §45.7, scrml `==` IS strict (lowers to `===` for primitives and `_scrml_structural_eq` for compound types in server bundles). No semantic change, but the sigil is different.

**Suggests:** This is well-documented in the kickstarter §3 anti-pattern table and the error message itself is excellent. Logging it not as a defect but as a data point on JS-instinct collisions — anyone porting JS to scrml will hit this within minutes. The error is already top-tier (clear code, clear message, clear suggestion). No action needed.

---

## F-SCHEMA-001 — `< schema>` block doesn't satisfy E-PA-002 (P1)

**Surfaced in:** M1, first compile of `app.scrml`.

**What I tried:** Declared all 9 tables in a `< schema>` block per §39, alongside `< db src="./dispatch.db" tables="...">`. Expected the compiler to use the `< schema>` declaration as the schema source for `?{}` PA validation.

**What didn't work:** E-PA-002 fired:
> "Database file `./dispatch.db` does not exist and no CREATE TABLE statement was found in any `?{}` block for tables `users, customers, ...`. Either create the database file first, or add a CREATE TABLE statement in a `?{}` block so the compiler can validate the schema at compile time."

The PA pass apparently looks for either a live DB file OR CREATE TABLE statements inside `?{}` blocks. It does NOT consult the `< schema>` declaration as a third source.

**Workaround used:** Bootstrap `dispatch.db` once at example-setup time using `bun -e "..."` with raw `CREATE TABLE IF NOT EXISTS` SQL (now committed alongside the example). Subsequent compiles see the live DB and pass PA. This works but defeats the "schema is code" promise of §39 — adopters can't just declare and compile.

**Suggests:** PA should treat a `< schema>` declaration as authoritative for table shape when no live DB file exists. The flow should be: declared schema → PA validation → compile → `scrml migrate` (or first run) materializes the DB. Currently §39 + PA disagree on which schema source is canonical.

Alternatively, the compiler could auto-bootstrap the DB from `< schema>` on first compile (writing the empty schema into a fresh SQLite file), so PA always has a live target.

---

## F-EXPORT-001 — `export server function` is not a recognized form (P1)

**Surfaced in:** M1, first draft of `seeds.scrml`.

**What I tried:**
```scrml
${
    export server function runSeeds() {
        ?{`INSERT ...`}.run()
    }
}
```

**What didn't work:** Compiler emits E-IMPORT-004 in the importing file: `runSeeds is not exported by ./seeds.scrml`. The `export` modifier is silently dropped (or never recognized) when followed by `server function`. Per §21.2 the valid forms are `export type`, `export function`, `export fn`, `export const`, `export let`. `export server function` isn't listed and isn't accepted.

**Workaround used:** Replace `export server function name() { body }` with `export function name() { server { body } }`. The wrapping client-side `export function` carries the export, and the inner `server { }` block makes the body server-only. Compiles clean and the `?{}` SQL inside resolves against the importing file's `< db>` ancestor.

**Suggests:** Either:
- Extend §21.2 to accept `export server function` as a valid declaration form, or
- Document the workaround in §21.2 + the kickstarter so adopters know to wrap server fns with `export function name() { server { ... } }`.

The workaround is mechanical but non-obvious — and the error message ("not exported") points to the wrong cause (the file isn't missing the export — it's the *form* that isn't recognized).

---

## F-AUTH-003 — W-AUTH-001 fires even when `auth=` IS explicit (P2)

**Surfaced in:** M1, login.scrml + register.scrml.

**What I tried:** Both pages have `<program db="../../dispatch.db" auth="optional">`. The `auth=` attribute is explicit and a recognized value (`optional`), and the page also declares `protect="password_hash"` on its `< db>` block.

**What didn't work:** Compiler emits W-AUTH-001:
> "File has protect= fields but no explicit auth= attribute. Auth middleware auto-injected (auth="required", csrf="auto"). Add `<program auth="required">` to control auth settings explicitly."

The warning explicitly says "no explicit auth= attribute" — but `auth="optional"` IS explicit. Either the check is reading `<program>` from the wrong scope (e.g. only the inner `< db>` block's auth), OR the warning logic is `protect= && auth != "required"` rather than `protect= && !has_explicit_auth`.

**Workaround used:** Live with the warning — behavior is correct (the page is reachable without a session, login works), only the diagnostic is wrong.

**Suggests:** Tighten the W-AUTH-001 trigger so it only fires when there's no `auth=` attribute on `<program>` at all. `auth="optional"`, `auth="none"`, and any other recognized value should suppress it.

---

## F-COMPONENT-001 — Bare `lift <ImportedComponent/>` hits E-COMPONENT-020; HTML wrapper required (P0)

**Surfaced in:** M2 first compile of `pages/dispatch/board.scrml`. Reproduces in any file that imports a component and uses it as the direct body of `lift`.

**What I tried:**
```scrml
${
    import { LoadCard } from '../../components/load-card.scrml'
    ...
}
${
    for (let l of @loads) {
        lift <LoadCard load=l customerName=l.customer_name/>
    }
}
```

**What didn't work:**
```
error [E-COMPONENT-020]: Component `LoadCard` is not defined in this file.
Define it with `const LoadCard = <element .../>` before using it, or check the
spelling.
  stage: CE
```

The error fires even though the `import` statement resolves cleanly (the
referenced file exists, the export name matches, no `E-IMPORT-*` errors).
Reproduces with the canonical `examples/22-multifile/components.scrml` shape
when consumed in any file other than the original `app.scrml`. Confirmed
minimal repro: copy `22-multifile/types.scrml` + `components.scrml` into a
fresh dir, add a new file with the imports + bare `lift <UserBadge/>` —
fails. Wrap the `<UserBadge/>` in any HTML element (e.g. `<li>`,
`<div>`) — succeeds.

**Workaround used:** Wrap the imported component call site inside a
`${ lift <wrapper>...</wrapper> }` block in markup position:
```scrml
${ lift <div><LoadCard load=l customerName=l.customer_name/></div> }
```
And inside `${ for ... }` loops:
```scrml
${
    for (let l of @loads) {
        lift <div><LoadCard load=l customerName=l.customer_name/></div>
    }
}
```
Both compile clean. **What does NOT work:**
- Bare `lift <Component/>` (no HTML wrapper) — fails E-COMPONENT-020.
- Direct markup `<div><Component/></div>` outside any `${ ... lift }` block — fails E-COMPONENT-020.
- Component as direct child of `<div>` outside a `lift` context — fails.

The component must be inside an HTML element AND inside a `lift` expression.

**Special case — `<tr>`-shaped components in tables:** Wrapping a `<tr>`-rooted
component in `<div>` breaks HTML semantics (a `<table>` body must contain
only `<tr>` rows). For `<DriverCard>`, `<CustomerCard>`, `<InvoiceCard>` —
the M2 workaround is to **import only the helper `fn`s** from the component
file (not the component itself), then inline the row markup at the call
site. The helpers (`driverStatusClasses`, `paymentTermsLabel`, etc.)
factor cleanly across files; only the markup has to be copied.

This is duplicative — the same `<tr><td>...</td>...</tr>` shape appears in
both the component file and the consuming page. The component-as-shared-row
abstraction is exactly what every list view wants and the gap kills it.

**Suggests:** Either:
- The component-expander pass (CE) should accept a directly-lifted
  imported component the same way it accepts an imported component
  embedded inside HTML markup; or
- The error message should explain the wrapper requirement so adopters
  don't think their import is broken.

This is sharp because the failure mode (`is not defined in this file`)
points the adopter toward the import statement, but the import is fine —
the lookup is a markup-position issue. Severity P0: silent acceptance of
the import + apparent-undefined at the use site is the validation-principle
failure (S49 row 169 — *"if compiler accepts X, X must do something"*).

The 22-multifile/app.scrml example escapes this gap because every
`<UserBadge>` use is already wrapped in `<li>`. M2's load card / status
badge / driver card usages all need the same wrapper or they fail.

**EXPANDED + ARCHITECTURAL (2026-04-30, S50):** Triage dispatch
discovered F-COMPONENT-001's visible failure is the **loud surface
of a much bigger architectural defect**: cross-file component
expansion does not work end-to-end on current scrmlTS. Three
intersecting faults: (F1) `hasAnyComponentRefsInLogic` doesn't
recurse into nested markup — wrapped patterns silently skip CE;
(F2) `runCEFile` looks up `exportRegistry.get(imp.source)` by raw
import-path string while production registries are keyed by absolute
filesystem path — lookup always misses; (F3) CLI reads `inputFiles`
only, never auto-gathers files reachable through imports.

**The wrapper "workaround" is a silent failure.** Wrapping a
component call in `<div>` makes the COMPILE succeed (Fault 1's
recursion guard skips CE entirely) but the emitted JS contains
`document.createElement("ComponentName")` — a phantom custom
element. The browser sees an unknown HTML element and renders
blank. Confirmed by independent reproduction:
`examples/22-multifile/dist/app.client.js` line 12 contains
`document.createElement("UserBadge")` (verified 2026-04-30).
**The canonical "multi-file scrml" example is silently broken.**

**Existing tests mask the bug.** `compiler/tests/unit/cross-file-components.test.js`
synthesizes key-matched `exportRegistry`/`fileASTMap` fixtures (the
test file's header documents this convention as "test-only key
synthesis"); they assert "no `isComponent: true` markup remains"
which passes when CE silently skips, AND they never diff emitted
JS for actual template expansion. Net: a passing test suite that
hides a P0 architectural defect.

**Affected surface:**
- `examples/22-multifile/` — silently broken, renders blank
- `examples/23-trucking-dispatch/components/` — every imported
  component in M2 is silently broken at runtime
- Any future multi-file scrml app that imports components

**Conservative fix is not viable.** Three rejected options
documented in `docs/changes/f-component-001/diagnosis.md`:
- Fix Fault 1 alone → wrapped cases START failing E-COMPONENT-020
  (regression on canonical examples)
- Fix Fault 2 alone → multi-stage propagation across module-resolver
  + api.js + AST contract; not narrow
- Silence the bare error → leaves output broken (validation-principle
  violation reinforced)

**Plan B disposition (2026-04-30, S50):**
- Cross-file component expansion is **known-broken** until a proper
  end-to-end deep-dive ships the architectural fix.
- M2 dispatch app's components live in `components/` but are NOT
  used by the consumer pages — M2's pages all inline their row
  markup directly (helper functions imported, markup inlined). This
  is the only pattern that actually renders correctly. Going
  forward: kickstarter v1 + master-list note flag the gap; M3-M6
  continue with inline-only.
- Post-M6, dispatch a deep-dive on cross-file component expansion
  with the full pattern catalog from M2-M6 in scope.


**UVB-W1 status (2026-04-30): SILENT-FAILURE WINDOW CLOSED.** VP-2 (post-CE invariant) emits hard E-COMPONENT-035 on every residual `isComponent: true` markup node. Before W1, an unresolved component reference silently became `document.createElement("LoadCard")` at runtime; after W1 the compile fails loudly with the component name + a pointer to the lift+wrap workaround. The architectural fix (cross-file CE accepting bare `lift <ImportedComp/>`) is a separate W2 track; UVB-W1 closes only the silent-emission window. See `compiler/SPEC.md` §15.14 + `compiler/PIPELINE.md` Stage 3.3 + deep-dive `systemic-silent-failure-sweep-2026-04-30`.

**W2 status (2026-04-30): ARCHITECTURALLY RESOLVED for the canonical case.**
The cross-file CE machinery now works end-to-end for the
`examples/22-multifile/` shape (single-file or directory invocation;
both produce expanded markup with no E-COMPONENT-035 / no phantom
`createElement`). Three faults closed in commit `6536f7a`:

- **F1** — `hasAnyComponentRefsInLogic` now walks the full markup
  subtree of a lift target; `walkLogicBody` descends into wrapper
  children. Wrapped form (`lift <li><Comp/></li>`) expands correctly.
- **F2** — CE consumes `moduleResult.importGraph` for canonical
  absolute-path lookups into `fileASTMap` / `exportRegistry`. Mirrors
  the TS-pass pattern at `api.js:626-660` and the LSP workspace
  pattern at `lsp/workspace.js`.
- **F3** — `compileScrml` runs an auto-gather pre-pass before
  BS+TAB, expanding `inputFiles` to the transitive `.scrml` import
  closure. `--no-gather` opt-out flag plumbed through `compile.js`
  and `dev.js`. Sane-limit guard at 5000 files (E-IMPORT-007).
- **Bonus fix** — cross-file `${ export const X = <markup/> }` now
  works (CE scans `ast.exports` for the markup body when
  `ast.components` doesn't carry it; pre-W2 this was silently
  invisible to CE because TAB classifies it as `export-decl`, not
  `component-def`).

**Out-of-scope nested case (separate dispatch needed):** when an
exported component body contains nested PascalCase references (e.g.
`<LoadCard>` containing `<LoadStatusBadge>`), `parseComponentBody`'s
BS-on-tokenized-raw step produces 0 blocks (Phase 1 limitation per
`parseComponentDef` docstring). This blocks
`examples/23-trucking-dispatch/pages/dispatch/board.scrml`'s direct
use of `<LoadCard>` even with W2 in place. The same-file path has
the identical limitation. Tracked as F-COMPONENT-001-FOLLOW (or new
ticket) — NOT a W2 regression. The dispatch app's existing
`lift <div><LoadCard.../></div>` workaround still works.

See `compiler/SPEC.md` §15.14.4 + §15.14.5 + §21.7,
`compiler/PIPELINE.md` Stage 3.2 (W2 amendments), and
`docs/changes/f-component-001-w2-fix/` for the full W2 trail.

---

## F-COMPONENT-002 — Component prop names at call site become spurious local declarations (P1)

**Surfaced in:** M2 first compile of `pages/dispatch/load-detail.scrml` consuming the `<AssignmentPicker>` component.

**What I tried:**
```scrml
<AssignmentPicker
    drivers=@drivers
    tractors=@tractors
    trailers=@trailers
    currentDriverId=(@assignment == null ? 0 : @assignment.driver_id)
    currentTractorId=(@assignment == null ? 0 : @assignment.tractor_id)
    currentTrailerId=(@assignment == null ? 0 : @assignment.trailer_id)
    onAssign=saveAssignment
/>
```

The component declares those names in its `props={ ... }` spec. The
expressions on the right-hand side are valid (the @vars exist).

**What didn't work:**
```
error [E-MU-001]: Variable `currentTractorId` was declared but never used
before this scope closes.
error [E-MU-001]: Variable `currentTrailerId` was declared but never used
before this scope closes.
error [E-MU-001]: Variable `onAssign` was declared but never used before
this scope closes.
  stage: TS
```

The TypeScript-pass treats the prop names on the call-site as fresh
identifier *declarations* rather than as parameter-name labels for the
component. Since the page doesn't reference `currentTractorId` /
`currentTrailerId` / `onAssign` again, they're flagged as unused.

The errors don't even point to a file (the diagnostic emits `stage: TS`
with no `--> path:line:col` cursor), so reproducing or tracking them
required commenting out call sites one by one to bisect.

**Workaround used:** Declare a parallel `@var` for each prop name on the
consuming page, give it a real assignment in the `refresh()` body, and
pass `propName=@propName` instead of an inline expression:
```scrml
@currentDriverId  = 0
@currentTractorId = 0
@currentTrailerId = 0

function refresh() {
    ...
    const a = data.assignment
    @currentDriverId  = a ? a.driver_id  : 0
    @currentTractorId = a ? a.tractor_id : 0
    @currentTrailerId = a ? a.trailer_id : 0
}

<AssignmentPicker
    currentDriverId=@currentDriverId
    currentTractorId=@currentTractorId
    currentTrailerId=@currentTrailerId
    onAssign=saveAssignment
/>
```
This compiles clean. Note: I did NOT need a `@onAssign` — passing the
client function directly works once the rest is `@`-prefixed.

**Suggests:** The TS-pass should know that prop-name attributes on a
component opener (e.g. `currentTractorId=expr`) are call-site labels,
not new declarations. Severity P1: workaround is mechanical (~3 LOC per
component) but every call site has to know the gap exists. The error
without a file path makes diagnosis disproportionately hard — adopters
will spend 10x time hunting "what file is `currentTrailerId` in?"

---

## F-COMPONENT-004 — Prop refs inside component-body logic blocks fire E-SCOPE-001 (P1) — **RESOLVED S52 (2026-04-30)**

**Resolution:** S52 dispatch on top of P2-wrapper baseline (`966a493`). The fix
extends `substituteProps` in `compiler/src/component-expander.ts` to walk into
ExprNode subtrees of LogicNode bodies (and MetaNode bodies). A new helper
`substitutePropsInExprNode` clones the ExprNode tree and replaces every
non-shadowed `IdentExpr` reference whose name matches a declared prop with
the typed prop value. A parallel `propsExprMap` is built alongside the
existing string-form `props` map: string-literal caller attrs become LitExpr
nodes (e.g. `"Alice"`); variable-ref attrs become IdentExpr nodes
(e.g. `@globalUser`); declared defaults are parsed via `parseExprToNode` once.

Shadowing tracking covers: lambda parameters (within lambda body), local
declarations (`let`, `const`, `tilde`, `lin`, `@reactive`, `function`)
appearing earlier in the same scope, for-stmt loop variables, match-arm
bindings, when-message bindings, propagate-expr bindings.

Member-access expressions only substitute the leftmost identifier:
`name.length` substitutes `name` (the object) and leaves `.length` alone.
Template-literal interpolations are rewritten in raw text by walking
top-level `${...}` segments and substituting matching identifiers in the
interpolation contents.

SPEC §15.10.1 added (normative paragraph + worked examples).
Tests at `compiler/tests/unit/f-component-004-substituteProps-logic-block.test.js`
and `compiler/tests/integration/f-component-004-form1-form2-parity.test.js`.
The earlier `p2-export-component-form1-cross-file.test.js` §X2 parity test
was updated to assert SAME success (instead of SAME errors) — both Form 1
and Form 2 now compile cleanly with `${name}` body interpolation.

---

### Original report (preserved for context)

**Surfaced in:** S52 P2-wrapper dispatch (`966a493`). When `export <Name ...>`
(Form 1) is byte-equivalent to `export const Name = <element ...>` (Form 2),
component bodies that interpolate prop references inside `${ ... }` logic
blocks fire E-SCOPE-001 — even though the props are declared.

**What I tried:**
```scrml
// Form 1
export <UserCard name:string role:UserRole>
  <div class="card">
    <h2>${name}</h2>
    ${
      const greeting = `Hello ${name}, you are a ${role}`
    }
    <p>${greeting}</p>
  </div>
</UserCard>

// Form 2
export const UserCard = <div class="card" name:string role:UserRole>
  <h2>${name}</h2>
  ${
    const greeting = `Hello ${name}, you are a ${role}`
  }
  <p>${greeting}</p>
</div>
```

Both forms hit E-SCOPE-001 on `name` and `role` inside the logic block.
The markup-text `${name}` (in `<h2>`) ALSO fires the same error because
TAB parses `${name}` in markup text as a LogicNode with body
`[BareExprNode { exprNode: IdentExpr "name" }]` — and the existing
substituteProps walker recursed through the LogicNode but never descended
into the BareExprNode's `exprNode` field.

**What didn't work:** Pre-fix, the existing `substituteProps` only handled
text-node `value` and markup attr string-literal text. Its fallback for
"other node kinds" walked only top-level array fields with `kind` items,
which meant LogicNode.body entries were visited but their ExprNode
subtrees were never inspected. Identifier references to props remained
unresolved.

**Workaround used (pre-fix):** Manually pull the prop into a local binding
via a wrapper `<div data-name=name>` then re-extract via `getAttribute`.
Ugly and not scalable.

**Suggests:** Pre-fix triage classified this as pre-existing CE territory
exposed by P2 (not introduced). Severity P1 (architectural) until S52 fix
landed. Now P0-RESOLVED.

## F-COMMENT-001 — HTML comments leak content into the parser/scope checker (P1)

**Surfaced in:** M2 first compiles of board.scrml + customers.scrml.

**What I tried:**
```scrml
<!-- F-AUTH-001 carryover: `auth="role:dispatcher"` documents intent; the
     runtime fallback in loadBoardData() does the actual gating.
     The `<page>` wrapper hits E-COMPONENT-020 ... -->
<div>...</div>
```

```scrml
<!-- Inline expanded detail row, visible when this customer's id matches @expandedId -->
${ if (c.id == @expandedId) { lift <tr>...</tr> } }
```

**What didn't work:**
- The first comment fired E-CTX-001 and E-CTX-003 — the BS pass tracked
  `<page>` from the comment text as if it were an open tag.
- The second fired E-SCOPE-001 on the bare word `when` — the TS pass
  parsed comment text as logic.

**Workaround used:** Remove any HTML-tag-like content (`<page>`,
`<for>`, etc.) and keyword-like words (`when`, `if`) from `<!-- ... -->`
comments. Use `//` JS-style comments inside `${ ... }` blocks instead;
they're never parsed as markup.

Better practice: keep HTML comments to short single-purpose annotations
that don't mention scrml or HTML keywords. Move documentation prose to
file-level `//` comments at the top.

**Suggests:** The lexer / BS pass should treat `<!-- ... -->` as a true
opaque comment region. Currently it appears the comment is consumed by
the markup-tokenizer but its content is also being lex-checked or
scope-checked in ways the `// ... ` JS comment isn't.

Severity P1: the failure mode is reliably reproducible but the error
messages point to the wrong line (the `<div>` or `${ ... }` *after* the
comment, not the comment itself), so adopters spend time chasing the
wrong code.

---

## F-RI-001 — Server-fn return-value branching escalates the wrapping client function to server (P0, RESOLVED 2026-04-30 W4)

**Surfaced in:** M2 `transition()` and `saveAssignment()` in `load-detail.scrml`.

**What I tried:**
```scrml
function transition(target) {
    const tok = getSessionToken()
    const result = transitionStatusServer(tok, @load.id, target)
    if (result.unauthorized) {
        window.location.href = "/login?reason=unauthorized"
        return
    }
    if (result.error) {
        @errorMessage = result.error
        return
    }
    refresh()
}
```

**What didn't work:**
```
error [E-RI-002]: Server-escalated function `transition` assigns to a
`@` reactive variable. Reactive state is client-side; server functions
cannot mutate it directly. Move the reactive assignment to a client-side
callback, or restructure the function so the reactive mutation occurs on
the client.
  stage: RI
```

The compiler escalated `transition` to "server" because it calls a
server fn (`transitionStatusServer`), then complained that the same
function reassigns `@errorMessage`. Refactoring into a separate
`handleTransitionResult(result)` helper didn't help — that helper got
escalated instead. The 03-contact-book pattern (call server fn → assign
@var → done) compiles clean, but only when the server-fn return is
NOT inspected on the client side.

**Workaround used:** Restructure to:
```scrml
function transition(target) {
    @errorMessage = ""                              // 1. assign first
    const result = serverFn(tok, ...)               // 2. server call
    if (result.unauthorized) {                      // 3. exit early
        window.location.href = "..."
        return
    }
    if (!result.error) {                            // 4. happy path
        refresh()
        return
    }
    setError(result.error)                          // 5. setError helper
}

function setError(msg) {
    @errorMessage = msg
}
```

Key insight: an extra `@var = ""` BEFORE the server call seems to anchor
the function as client-side. Then the negative path delegates the @var
assignment to `setError()` (a separate client function), keeping the
escalation analysis happy.

Also: `if (result.error == null)` and `if (result.error is not)` both
fail (E-SYNTAX-042 + E-SCOPE-001 respectively). `if (!result.error)`
is the form that compiles.

**Suggests:**
- The escalation rule should accept "client function calls server fn,
  then conditionally assigns @vars" as canonical client-side. This is
  the Promise-chain pattern every full-stack framework uses. Adopters
  will write it 10x per app.
- E-SYNTAX-042's prescribed replacement (`x is not`) doesn't work for
  field access (`obj.error is not` → E-SCOPE-001). Either extend `is`
  to support field access or document `!field` as the correct form.

Severity P0: the canonical "call server fn, dispatch on result, update
UI" pattern doesn't compile. Adopters cannot ship without finding the
workaround through trial-and-error.

**RESOLVED (2026-04-30, W4):** root cause located and fixed. The bug was
in `compiler/src/route-inference.ts` `collectReferencedNames`, which used
a regex `/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g` against the flat-stringified
form of each ExprNode. The regex matched identifier-shaped tokens INSIDE
string-literal contents, polluting the function's `closureCaptures` set
with names that happened to also be peer server-fn names. The capture-taint
loop (Step 5b) then resolved those names against the global cross-file
`fnNameToNodeIds` map and falsely tainted client functions.

**The dispatch-app reproduction:** `transition()` in
`pages/dispatch/load-detail.scrml` contains the string literal
`"/login?reason=unauthorized"`. `app.scrml` declares
`server function login(...)`. The regex extracted `login` as a "captured"
identifier; the cross-file taint loop matched it; transition was tainted;
E-RI-002 fired on the `@errorMessage = result.error` assignment. This bug
only manifested in directory (multi-file) compile mode — the S50 narrow
regression tests use single-file fixtures with no peer file declaring a
colliding server-fn name, so they did not catch it.

**The W4 fix:** replace the regex-on-flat-string approach with a structural
walk over the ExprNode tree via `forEachIdentInExprNode`
(`compiler/src/expression-parser.ts`). The structural walker visits only
`IdentExpr` nodes — string-literal content is not scanned, member-access
property names are not treated as free variables, and lambda bodies are
not descended into (they are new scopes). Test-fixture compatibility is
preserved via a string-fallback path used only when the AST node lacks
the structured ExprNode field (production AST always populates ExprNode).

**Verification:**
- `compiler/tests/unit/route-inference-f-ri-001-deeper.test.js` — 6 new
  regression tests covering: (§D) cross-file string-literal tokens vs.
  peer server-fn names; (§D negative control) bare-ident reference
  still propagates capture-taint; (§E) per-fn analysis isolation;
  (§F) `result.error` member access does not pollute captures.
- M2 workaround removed from 10 dispatch-app pages (the two named files
  + 8 M3-M6 pages: dispatch/billing.scrml, dispatch/load-detail.scrml,
  customer/load-detail.scrml, customer/quote.scrml, customer/invoices.scrml,
  driver/load-detail.scrml, driver/home.scrml, driver/hos.scrml,
  driver/messages.scrml, driver/profile.scrml). Full directory compile
  returns the same 161-error count as pre-revert (no new errors; no
  E-RI-002 fired).
- `bun test`: 8367 pass / 0 fail (baseline 8361 + 6 new W4 tests).

**SPEC.md §12.4 amendment:** added a normative statement that route
inference is per-function and string-literal content is not a reference.

**Carryforward:**
- F-RI-001-FOLLOW (`is not` member access) — separate finding below; W8 territory.
- F-CPS-001 (CPS architectural limit, repro4) — separate finding below;
  M10 deferred-indefinitely architectural.

References: `docs/changes/f-ri-001-deeper/diagnosis.md`,
`docs/changes/f-ri-001-deeper/repro-multi-fn.scrml`.

---

## F-RI-001-FOLLOW — `is not` doesn't support member-access targets (P1)

**Surfaced in:** F-RI-001 triage 2026-04-30 (S50). Split out as a separate finding.

**What I tried:**
```scrml
if (obj.error is not) { ... }    // intended: "obj.error is not assigned"
```

**What didn't work:** E-SCOPE-001 fires on `error` — the TS pass treats
the member-access right-hand side as a free identifier rather than as a
property name on `obj`.

**Workaround used:** `if (!obj.error)` compiles clean and has the same
semantics for nullable fields.

**Repro:** `docs/changes/f-ri-001/repro-follow.scrml`.

**Suggests:** Either:
- Extend `is`/`is not` to recognize `obj.field` and `obj.path.field` as
  valid LHS targets (would mirror the bare-identifier path through the
  TS pass), or
- Document `!field` as the canonical form for nullable member-access
  presence checks; demote `is not` to identifier-only.

Severity P1: workaround is one character (`!`) but the diagnostic
points to the wrong cause (`error` is unrecognized → wrong; the issue
is the LHS shape).

---

## F-CPS-001 — CPS-eligibility skips nested control-flow when finding reactive assignments (P1)

**Surfaced in:** F-RI-001 triage 2026-04-30 (S50). Adjacent finding the triage agent surfaced as out-of-scope for T2.

**What I tried (theoretical):**
```scrml
function loadAndShow() {
    const data = ?{`SELECT * FROM users WHERE id = ${id}`}.get()
    if (data == null) {
        @users = []                     // nested @var assignment
        return
    }
    @users = [data]                     // nested @var assignment
}
```

**What doesn't work:** When a function has BOTH a direct server trigger
(SQL `?{}` in body) AND a `@var` assignment buried inside an if/while/for
body, E-RI-002 fires. The reactive-assignment finder (`findReactiveAssignment`)
recurses into nested bodies; the CPS-eligibility analyzer
(`analyzeCPSEligibility`) only inspects top-level statements. CPS could
potentially split this shape, but the protocol currently carries only
one server-side intermediate (`_scrml_server_result`).

**Behavior is correct as-is** — the function IS server-bound (by the SQL
trigger) and CAN'T mutate client reactive state directly. So E-RI-002
firing is technically right. The friction is that CPS could potentially
rescue this shape but doesn't.

**Repro:** `docs/changes/f-ri-001/repro4.scrml`.

**Suggests:** Architectural — extend the CPS protocol to carry multiple
server-side intermediates to the client, then teach `analyzeCPSEligibility`
to recurse into nested statement bodies. Out of scope for any conservative
fix; would change the codegen contract.

Severity P1: not blocking (workaround is to lift the assignment out of
the conditional, or keep the flatter pattern of separate functions).
Logged for future deep-dive consideration.

---

## F-DESTRUCT-001 — Array destructuring inside `for-of` may confuse type-scope (P2)

**Surfaced in:** M1 first draft of `_readCookie` helper.

**What I tried:**
```scrml
for (const p of parts) {
    const [k, v] = p.trim().split("=")
    if (k === name) return v
}
```

**What didn't work:** E-SCOPE-001 fired for `k` and `v`: *"Undeclared identifier `k`/`v` in logic expression."* The destructuring binding wasn't recognized by the type-scope analyser inside the `for-of` body, even though it's a perfectly valid JS pattern.

**Workaround used:** Replaced array destructuring with explicit `indexOf("=")` + `substring()` calls:
```scrml
const eqIdx = piece.indexOf("=")
if (eqIdx < 0) continue
const k = piece.substring(0, eqIdx)
```
This compiles clean.

**Suggests:** Either:
- Type-scope pass should recognize array/object destructuring inside `const`/`let` declarations and bind the destructured names; or
- If destructuring is intentionally unsupported, document it in §6 + the kickstarter anti-pattern table.

The kickstarter doesn't mention this gap. Adopters will write destructuring liberally (it's idiomatic modern JS) and hit this. Severity P2 only because the workaround is short.

(Update: not 100% sure the root cause is destructuring vs. something else in my original snippet — needs an isolated repro before opening a compiler fix. Logging it here so M2-M6 watch for it.)

---

## F-ENGINE-001 (formerly F-MACHINE-001) — `<engine for=Type>` rejects imported types — **RESOLVED P3.B (2026-05-02)**

**Resolution:** Closed by P3.B per [P3 deep dive](../../scrml-support/docs/deep-dives/p3-cross-file-inline-expansion-2026-05-02.md) §3.1, §5, §6.5. TAB now synthesises a `type-decl` AST node alongside the `export-decl` whenever it parses `export type X = {...}` (mirroring how `export function` already produces both `function-decl` and `export-decl`). The `api.js` cross-file `importedTypesByFile` seeding then sees the type, the TS pass registers it in `typeRegistry`, and `<engine for=ImportedType>` resolves cleanly across files. The misleading `imported via 'use'` hint in E-ENGINE-004 was also corrected to reference the actual `${ import { Type } from './path.scrml' }` form.

**Adopter integration:** `pages/driver/hos.scrml` workaround removed. The local `type DriverStatus:enum = {...}` block (~6 LOC) is replaced with `${ import { DriverStatus } from '../../schema.scrml' }`. Schema is now the single source of truth for the enum spelling. Workaround-removal commit lands alongside this resolution status.

**Spec changes:** SPEC §21.2 normative addition (export type produces both nodes); SPEC §51.16 NEW (Cross-File Type Resolution for `<engine for=ImportedType>`); SPEC §51.3.2 normative bullet corrected; PIPELINE.md Stage 3 Amendment 7 + version 0.6.1.

**Tests added (P3.B):** TAB type-decl synthesis across all 4 type kinds (enum, struct, tuple, map); local-type regression pinning; cross-file `<engine for=ImportedEnum>` + `<engine for=ImportedStruct>`; deprecated `<machine for=ImportedType>` + W-DEPRECATED-001 cross-file path. Test count delta 8491 → 8512 (+21, 0 regressions).

---

### Original report (preserved for context)

**Surfaced in:** M3 `pages/driver/hos.scrml`. The HOS state machine declares
`<machine name=HOSMachine for=DriverStatus>` where `DriverStatus` is imported
from `schema.scrml` (where every other M3 file reads it from).

**What I tried:**
```scrml
${
    import { DriverStatus } from '../../schema.scrml'
}

< machine name=HOSMachine for=DriverStatus>
    .OffDuty      => .OnDuty | .SleeperBerth
    ...
</>
```

**What didn't work:**
```
error [E-ENGINE-004]: Machine 'HOSMachine' references unknown type
'DriverStatus'. The 'for' clause must name an enum or struct type
declared in this file or imported via 'use'.
  stage: TS
```

The error message says "imported via 'use'" — suggesting a capability
import is the recognized form. But §41.2 `use scrml:X` is for stdlib
capability imports, not for cross-file user types. There is no
`use ./schema.scrml` syntax.

**Workaround used:** Re-declare `DriverStatus` in `hos.scrml` as a local
enum (lifted from `schema.scrml` verbatim):

```scrml
${
    type DriverStatus:enum = {
        OffDuty
        OnDuty
        Driving
        SleeperBerth
    }
}

< machine name=HOSMachine for=DriverStatus>
    ...
</>
```

The duplication is ~6 LOC. The bigger problem is conceptual: the `schema.scrml`
file exists precisely so M2-M6 share enum spellings; the `<machine>` block
forces a violation of that contract.

**Suggests:** Either:
- `<machine for=>` should resolve through the same import scope as logic-block
  identifiers, accepting `import { Type } from './path.scrml'` declarations; or
- The error message should say which import forms it WILL accept (currently
  "imported via 'use'" is misleading for cross-file user types); or
- Document the gap explicitly in §51 (machine spec) so adopters know the
  type must be locally declared.

This is sharp because the cross-file type abstraction is the canonical
multi-file pattern. Severity P1: workaround is mechanical but the
duplication breaks the "single source of truth" promise of `schema.scrml`.

---

## F-NULL-001 — Files containing `<machine>` reject `null` literals/comparisons in client-fn bodies (P1) — **RESOLVED W3 (2026-04-30)**

**Resolution:** Closed as part of W3 paired fix with F-NULL-002. Diagnosis at `docs/changes/f-null-001-002/diagnosis.md` revealed the M3 "machine-context-dependent" trigger was incidental — at the post-W1 baseline, both with-machine and without-machine client-fn bodies fired E-SYNTAX-042 equally. The true root cause was an incomplete walker in `compiler/src/gauntlet-phase3-eq-checks.js`: `forEachEqualityBinary` descended through 11 hard-coded JS-AST keys (`test`, `arguments`, `properties`) and missed scrml-AST keys (`condition`, `args`, `props`); `walkAst` never visited `attrs[*].value.exprNode` on markup nodes. The fix replaces the hard-coded key list with a generic ExprNode descent and extends `walkAst` to cover attribute expressions. SPEC §42.7 amended with a uniform-rejection clause to lock the contract.

---

### Original report (preserved for context)


**Surfaced in:** M3 `pages/driver/hos.scrml`. Client-side `function`s with
`null` literals or `== null` / `!= null` comparisons fire E-SYNTAX-042 in
GCP3 — but only in this file. Identical patterns in M2 dispatch pages
(load-detail, board, drivers, customers) compile clean.

**What I tried:**
```scrml
function computeHoursIn(target) {
    if (@driver != null && @driver.current_status == target) return 24
    return 0
}

function parseFromPayload(payload) {
    if (payload == null || payload == "") return ""
    ...
}
```

**What didn't work:** Five E-SYNTAX-042 errors fire, all in GCP3 stage,
none with line numbers:
```
error [E-SYNTAX-042]: `null` is not a scrml token — scrml uses `not` for
absence (§42). Replace `!= null` with `x is some` (checks for presence)
or `x is not` for absence.
  stage: GCP3
```

The errors only appear when the file also contains a `<machine>` block.
Removing the machine made identical null-checks compile fine. Adding the
machine back (with a locally-declared enum, per F-MACHINE-001) brings them
back. So the trigger is "machine present + null literals in client-fn
bodies".

**Workaround used:** Replace every `== null` / `!= null` with truthiness
checks (`if (!x)` / `if (x)`) and avoid `null` as a value (use empty
string sentinels for nullable strings, omit nullable fields from object
literals where possible). Concretely:

```scrml
// before
const lastAt = lastChange == null ? null : lastChange.at
return { lastChangeAt: lastAt }

// after
const lastAt = lastChange ? lastChange.at : ""
return { lastChangeAt: lastAt }
```

```scrml
// before
if (@driver != null && @driver.current_status == target) return 24

// after
const driver = @driver
if (!driver) return 0
if (driver.current_status == target) return 24
```

```scrml
// before
@lastChangeAt = null
@driver = null

// after — keep @driver = null at declaration (works); switch lastChangeAt
// to empty string + truthiness instead.
@driver = null
@lastChangeAt = ""
```

Note `@var = null` at declaration position still works in this file.
The trigger is specifically `null` in client-fn bodies and ternary
expressions — not the literal anywhere.

**Suggests:** Either:
- The E-SYNTAX-042 detector should treat the file the same way regardless
  of `<machine>` presence (and either continue to allow `== null` /
  `!= null` everywhere, or reject it everywhere — the current asymmetry is
  the validation-principle violation); or
- Document in §51 that `<machine>` files have stricter null syntax rules,
  and what the canonical alternative is.

The kickstarter v1 §3 anti-pattern table doesn't mention `null` as
forbidden. The error message recommends `is some` / `is not`, but both
forms have their own friction (F-RI-001-FOLLOW: `is not` doesn't support
member-access targets). The actual workaround that compiles is the truthiness
check — which is well-established JS but isn't what the error message
prescribes.

Severity P1 because the trigger is unpredictable (file gains or loses a
`<machine>` block and behavior of identical client-fn null-checks flips)
and the recommended fix path doesn't quite work. Not P0 because the
workaround is mechanical and short.

**Repro:** Remove `<machine>` block from hos.scrml → null-checks compile.
Re-add the block → the same null-checks fail. Smallest reproducible:
a file with just `<program>` + `${ }` containing a client `function f() { if (x == null) return 0 }` and a sibling `<machine>` block.

---

## F-PAREN-001 — `a + (b - c)` paren-stripping idempotency invariant (P2 — data point)

**Surfaced in:** M3 `pages/driver/hos.scrml` — both client-fn arithmetic
expressions and the home.scrml `cur == X && (newStatus == Y || newStatus == Z)`
pattern (M3 day 1).

**What I tried:**
```scrml
ms = ms + (atMs - prevMs)        // simple addition with a parenthesized subtraction
ms = ms + (nowMs - prevMs)
const hours = ms / (60 * 60 * 1000)
const mins = Math.floor((sinceMs - hours * 60 * 60 * 1000) / (60 * 1000))
```

**What didn't work:** The `compiler/tests/integration/expr-node-corpus-invariant.test.js`
"corpus invariant" test fires per-file and asserts the round-trip parse →
emit → reparse leaves the AST shape unchanged. My parens get stripped on
emit, then on reparse the result is no longer the same shape.

Pre-commit hook fails:
```
error: IDEMPOTENCY FAILURE in hos.scrml
  Field: initExpr (string field: init)
  AST node kind: tilde-decl
  ExprNode kind: binary
  Reparsed kind: binary
  Emitted string: ms + atMs - prevMs
```

The emitted string `ms + atMs - prevMs` is semantically equivalent to
`ms + (atMs - prevMs)` for primitive addition — but the AST shape is
different (the parens ARE in the original ExprNode), and the invariant
test refuses to accept the divergence.

**Workaround used:** Lift sub-expressions into intermediate `const`
bindings:
```scrml
const diff = atMs - prevMs
ms = ms + diff

const tail = nowMs - prevMs
ms = ms + tail

const hourMs = 60 * 60 * 1000
const hours = ms / hourMs
```

Same calculation; no parens needed.

**Suggests:** The invariant test is being faithful to the AST shape, which
is the right thing to do. The friction is that adopters write parens for
human-readability, not for precedence reasons, and don't expect the AST
to record them as load-bearing. The fix path is one of:
- The emitter should preserve trivial parens (cosmetic) so round-trip is
  faithful; or
- The invariant test should ignore cosmetic-only paren differences when
  the AST normalizes to the same precedence-aware shape; or
- Document in the kickstarter that adopters should avoid wrapping sub-
  expressions in parens unless required for precedence.

Severity P2 because the workaround (intermediate vars) is mechanical AND
arguably improves readability anyway. Logging this as a data point for
the future paren-handling debate. The same idempotency invariant fired
on M3 day 1 with `cur == "off_duty" && (newStatus == "on_duty" || newStatus == "sleeper_berth")` — split into separate conjuncts there.

---

## F-AUTH-001 — M3 RECONFIRMATION (P0)

All 6 driver pages use the same server-side fallback as M2: each page
declares its own `<program auth="required">` and inline `getCurrentUser()`
+ `if (!user || user.role != "driver")` guard. The page-level
`auth="role:driver"` attribute is documentation only.

Total reconfirmations across M2 + M3: **12 pages** (6 dispatcher + 6
driver). Every server fn that needs role gating has the same 4-line
copy-pasted guard. The friction is now exercised at scale.

No design change.

---

## F-AUTH-002 — M3 RECONFIRMATION (P0)

Each of the 6 driver pages duplicates the ~7-line `getCurrentUser`
server fn body inline. Combined with M2's 6 pages, the cumulative
inline-duplication is ~84 LOC across 12 pages doing the same session →
user-id → users-row lookup. M3 confirms the friction is sharp and
load-bearing on every multi-page scrml app touching auth.

No design change.

---

## F-COMPONENT-001 — M3 RECONFIRMATION (P0, architectural)

M3 ships zero cross-file component imports per kickstarter v1 + S50 plan
B. Every page imports helper functions (`driverStatusClasses`,
`driverStatusLabel`, `formatRate`, `formatPickupAt`, `statusBadgeClasses`,
`statusLabel`) and inlines the markup directly. The component-as-row
abstraction every list/card view wants remains broken; M3 reaffirms the
inline-only workaround works for app code.

No design change.

---

## F-NULL-002 — `!= null` / `== null` in server-fn bodies fires E-SYNTAX-042 (P1) — **RESOLVED W3 (2026-04-30)**

**Resolution:** Closed as part of W3 paired fix with F-NULL-001. The "no line number" diagnostic-quality sub-bug also closed: `spanFromExprNode` now prefers the AST-node fallback span for line/col (since the expression-parser hard-codes `line: 1, col: 1` per `spanFromEstree`), and `GauntletPhase3Error` lifts span fields to top-level error props so the CLI formatter renders them. Markup-side and function-body null comparisons now BOTH error E-SYNTAX-042 with proper source location. Diagnosis at `docs/changes/f-null-001-002/diagnosis.md`.

**Cascade note:** Pre-existing markup-attribute null-comparison patterns in `pages/dispatch/load-detail.scrml`, `pages/driver/home.scrml`, and elsewhere previously passed silently and now correctly error. Adopters should switch to truthiness checks (`if=@x`) or `is some`/`is not` per spec §42.

---

### Original report (preserved for context)


**Surfaced in:** M4 `pages/customer/invoices.scrml::markPaidServer`. The
server fn checked `if (inv.paid_at != null && inv.paid_at != "")` after a
`SELECT i.id, i.customer_id, i.paid_at FROM invoices ...`. The compiler
fired E-SYNTAX-042 in GCP3 with no line number.

**Distinct from F-NULL-001:** F-NULL-001 documents the trigger as "file
contains `<machine>`". F-NULL-002 reproduces in plain server-fn bodies
with no `<machine>` block in the file (or in the project). Minimal repro:

```scrml
<program>
${
  server function test() {
    const x = "hello"
    if (x != null) return { ok: true }   // E-SYNTAX-042 fires
    return { ok: false }
  }
}
<div>test</div>
</program>
```

Fails with `error [E-SYNTAX-042]: ... stage: GCP3` (no line/column).

**Markup-side null comparisons compile fine** in the same file:
```scrml
<div if=(@x != null && @x != "")>${@x}</div>   // OK
```

So the GCP3 detector is asymmetric: it inspects server-fn body
expressions but NOT markup `if=` attribute expressions or template
interpolations. This is the inverse of F-NULL-001 (which is the
machine-presence trigger affecting client-fn bodies).

**What I tried:**
```scrml
server function markPaidServer(sessionToken, invoiceId) {
    ...
    const inv = ?{`SELECT id, customer_id, paid_at FROM invoices WHERE id = ${invoiceId}`}.get()
    if (!inv) return { error: "Invoice not found." }
    if (inv.customer_id != customer.id) return { unauthorized: true }
    if (inv.paid_at != null && inv.paid_at != "") {        // ← fails here
        return { error: "Invoice already paid." }
    }
    ...
}
```

**Workaround used:** truthiness check.

```scrml
if (inv.paid_at) {
    return { error: "Invoice already paid." }
}
```

For a column that's TIMESTAMP (text or null in SQLite) this is fine —
empty-string and null both coerce to falsy. For numeric or boolean
columns the semantics may differ; in those cases the workaround is to
test against an obvious sentinel (`if (inv.x != 0)`).

**Suggests:**
- Bring the server-fn-body GCP3 detector in line with what's allowed in
  markup. Right now `!= null` / `== null` are accepted inside markup
  `if=` attributes and `${ ... ? ... : ... }` interpolations but rejected
  inside server-fn bodies. Either both should be allowed (if the language
  position is "JS-style null checks are pragmatic") or both should be
  rejected with a single uniform diagnostic.
- The error has no line/column. Adopters writing the repro above with a
  100-line server fn body will spend disproportionate time bisecting.

Severity P1: workaround is mechanical (one character `!`), but the
asymmetry between markup-OK and server-fn-not-OK is unpredictable and
the missing source location compounds the confusion. Not P0 because the
fix path is short once you know it.

**Repro:** `/tmp/null-test.scrml` shape above. Six-line minimal. Reproduces
in any version of the compiler that runs the GCP3 stage (every M2-M4
build).

---

## F-CONSUME-001 — `@var` in attribute-string interpolation isn't recognized as consumption (P2)

**Surfaced in:** M4 `pages/customer/invoices.scrml`. The page declared
`@highlightLoadId` (read from `?load=<id>` query param) and used it in
the row class:

```scrml
lift <tr class="border-b border-slate-200 hover:bg-slate-50 ${(inv.load_id == @highlightLoadId) ? 'bg-yellow-50' : ''}">
```

**What didn't work:** E-DG-002:
> "Reactive variable `@highlightLoadId` is declared but never consumed
> in a render or logic context. Consider removing the unused variable,
> or prefix with `_` (e.g., `@_highlightLoadId`) to suppress this
> warning."

The variable IS read — inside the `${ ... ? ... : ... }` ternary embedded
in the `class=` attribute string. The DG (declaration-graph) pass doesn't
treat this kind of interpolation as a consumption site.

**Workaround used:** lift the conditional class into a `const` binding in
the for-loop body before the `lift`:

```scrml
${
    for (let inv of @invoices) {
        if (!matchesFilter(inv, @filter, TODAY_ISO)) continue
        const rowClass = (inv.load_id == @highlightLoadId)
            ? "border-b border-slate-200 bg-yellow-50"
            : "border-b border-slate-200 hover:bg-slate-50"
        lift <tr class="${rowClass}">
            ...
        </tr>
    }
}
```

The `const rowClass = ... @highlightLoadId ...` line counts as a logic-block
read and silences the warning. The lifted `class="${rowClass}"` then drops
to a single-variable interpolation.

**Repro:** minimal:
```scrml
<program>
${ @x = 0 }
<div class="abc-${@x}">test</div>
</program>
```
→ fires E-DG-002 on `@x` despite the visible read.

**Suggests:**
- The DG-pass consumption finder should walk into attribute-value
  template-literal interpolations the same way it walks into `${}` body
  expressions. The compile output already serializes the `@x` read in the
  emitted JS, so the read IS happening — the false-negative is in the
  warning logic.
- Alternatively, document the pattern explicitly: "for `@var` reads
  inside attribute interpolations, lift to a logic-block const first."

Severity P2: the workaround is mechanical and the const-lift arguably
improves readability. Logging because it's the third "@var read site
that the analyzer doesn't recognize" finding (after F-RI-001's nested
control-flow exclusion + F-CPS-001's nested-statement-body exclusion).

The pattern feels load-bearing on apps that style rows / cells based on
reactive selection state — sortable columns, expanded rows, highlighted
search hits — so adopters will hit this near-immediately when building
list views.

---

## F-AUTH-001 — M4 RECONFIRMATION (P0)

All 6 customer pages use the same server-side fallback as M2 + M3: each
page declares its own `<program auth="required">` and inline
`getCurrentUser()` + `if (!user || user.role != "customer")` guard.
The page-level `auth="role:customer"` attribute is documentation only;
M4 (like M2 + M3) deliberately omits it from the `<program>` opener
because the original `<page route= auth=>` wrapper hits multi-error
parse cascades when nested in `< db>`.

**Cumulative reconfirmations:** 18 pages (6 dispatcher + 6 driver + 6
customer). Every server fn that needs role gating has the same 4-line
copy-pasted guard. Across M2 + M3 + M4 the duplicated `if (!user || user.role != X)`
guards now appear ~30+ times across the app.

The friction is exercised at full scale — three slices, each persona
consistently re-implementing the same fallback because the compiler
attribute is silently inert.

No design change.

---

## F-AUTH-002 — M4 RECONFIRMATION (P0)

Each of the 6 customer pages duplicates the ~7-line `getCurrentUser`
server fn body inline. Combined with M2 + M3, the cumulative inline-
duplication is **~126 LOC across 18 pages** doing the same session →
user-id → users-row lookup. M4 confirms F-AUTH-002 is consistently
load-bearing on every page touching auth.

The single-source-of-truth file `models/auth.scrml` exists, exports
non-SQL helpers (`readSessionCookie`, `checkRole`, `rolePath`,
`SESSION_DB_PATH`, `SESSION_COOKIE_NAME`, `SESSION_TTL_SECONDS`,
`DISPATCH_DB_PATH`), but cannot host the SQL-reading `getCurrentUser`
fn that every page actually needs. The cross-file `?{}` portability gap
(E-SQL-004) blocks the abstraction.

No design change.

---

## F-COMPONENT-001 — M4 RECONFIRMATION (P0, architectural)

M4 ships zero cross-file component imports per kickstarter v1 + S50
plan B. Every customer page imports helper functions (`formatRate`,
`formatPickupAt`, `statusBadgeClasses`, `statusLabel`,
`accountStatusClasses`, `accountStatusLabel`, `paymentTermsLabel`,
`invoiceStatus`, `invoiceStatusClasses`, `invoiceStatusLabel`,
`formatIsoDate`) and inlines all markup directly. Helpers refactor
clean across files; markup must be copied or written inline at every
consumer site.

**Cumulative reconfirmations:** every M2 + M3 + M4 page (18 of 18) uses
the inline pattern. Zero cross-file component instances ship in the
app. The components directory exists with `LoadCard`, `LoadStatusBadge`,
`CustomerCard`, `InvoiceCard`, `DriverCard`, `AssignmentPicker`,
`StatusPicker`, `AddressForm`, but they are documentation / type-export
hosts only. None render correctly when imported as components.

No design change. The deep-dive on cross-file component expansion
remains queued post-M6.

---

## F-IDIOMATIC-001 — Canonical `is not` / `is some` presence-guard syntax saw zero adopter reach (P2 — observation)

**Surfaced in:** Audit at M4 close (2026-04-30, S50). User-prompted grep across all 5,650+ LOC of dispatch app code (M1+M2+M3+M4).

**What I found:** Across `examples/23-trucking-dispatch/` 32 .scrml files (~5,650 LOC of natural scrml writing by 4 distinct dispatch agents working from kickstarter v1):

| Search | Hits |
|---|---|
| `is not` as operator | **0** |
| `is some` as operator | **0** |
| `is not` in comments | 1 (citing F-RI-001-FOLLOW workaround) |
| `is not` in natural English | 1 (comment "the load is not yet delivered") |
| `is not` in string literals | 1 (UI message "Account is not active") |

**What adopters reached for instead:**
- `!x` truthiness checks for nullable refs and undefined fields (predominant)
- `== null` / `!= null` literal comparisons (until F-NULL-001 + F-NULL-002 forced retreat to truthiness)
- `==` / `!=` for value comparisons (predominant)

**Why this matters:**
SPEC §42.2 + kickstarter v1 §3 anti-pattern table both document `is not` / `is some` as the **canonical scrml presence-guard syntax** — the form scrml prefers over the JS-style `== null` / `!= null` nullability dance. The dispatch app was deliberately written by general-purpose agents reading the kickstarter as their primary onboarding doc, and producing realistic adopter-shaped code. **None of them reached for the canonical syntax.** They wrote `!x` instead.

This is a soft observation but a real signal about which idioms actually land in practice. Three plausible reasons (not mutually exclusive):

1. **Familiarity bias.** `!x` is universal across JS/TS/most languages. `is not` is scrml-specific. Adopters write what's in muscle memory.
2. **F-RI-001-FOLLOW chilling effect.** When `obj.error is not` fails E-SCOPE-001 for member-access targets, the path of least resistance is `!obj.error`. Once an adopter learns "use `!` for member-access," they generalize to "use `!` everywhere."
3. **F-NULL-001 + F-NULL-002 chilling effect.** Both push adopters AWAY from `== null` patterns. The fastest replacement that compiles in all contexts is `!x` truthiness, not `is not`.

**Suggests:**
- The kickstarter could promote `is not` / `is some` MORE aggressively — e.g. show it as the recommended idiom in every recipe rather than only in the §3 anti-pattern reference table.
- F-RI-001-FOLLOW (extending `is not` to member-access) becomes more important: until member-access works, `is not` is identifier-only and adopters generalize to `!` for consistency.
- Documentation alone may not be enough. The canonical syntax needs first-class compiler support across all positions adopters expect (member-access, nested expressions, chained checks). Without that, adopters flow toward the JS-instinct `!` and the canonical form becomes dead documentation.

Severity P2: not blocking, no functional impact. But it's a long-term signal about ecosystem identity. If `is not` / `is some` is supposed to be the scrml way, it currently isn't winning adoption — including in the very example app intended to demonstrate the language.

This finding doesn't have a clean fix; it's a data point worth tracking. Re-grep at M6 close to see if the trend holds.

---

## F-CHANNEL-001 — Channel name interpolation is silently inert (P0)

**Surfaced in:** M5, day 1 of channel wiring. The scoping doc named four
per-id channels (`driver-:id`, `load-:id`, `customer-:id`) plus one
broadcast (`dispatch-board`). The natural scrml form is
`<channel name="driver-${driverId}">`. Tested in isolation before any
real wiring.

**What I tried:**
```scrml
${
  let driverId = 7
}

<channel name="driver-${driverId}">
  ${
    @shared events = []
    server function postEvent(body) {
      events = [...events, { body: body, ts: Date.now() }]
    }
  }
</>
```

**What didn't work:** Compiles clean. But the emitted JS shows the
channel name is mangled to a literal underscore-string, not the
runtime value of `driverId`:

```javascript
// emitted (excerpt):
const _scrml_ws_driver___driverId_ = (() => {
  let _ws, _reconn;
  function _connect() {
    _ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/_scrml_ws/driver___driverId_`);
    ...
```

Every client ends up on the same `/_scrml_ws/driver___driverId_` URL
regardless of the value of `driverId`. **All "per-id" channels collapse
to a single broadcast topic** — no actual scoping happens.

**Tested variants:**
- `<channel name="driver-${@driverId}">` — same, mangles `${@driverId}` to `____driverId_`.
- `<channel name="driver-${driverId}">` (bare let) — same, mangles to `___driverId_`.
- `<channel name="driver-events" topic="driver-${driverId}">` — `topic=` attribute
  appears in the source comment but the WebSocket URL is built from `name=` only.
  No filtering effect.

**Workaround used:** Replace per-id channels with a single global
broadcast channel + payload-side filtering:
- Use `<channel name="driver-events">` (static name).
- Every event payload carries `targetDriverId: number`.
- Client-side, the subscriber filters: only render events where
  `payload.targetDriverId == @driver.id`.
- Same pattern for `load-events` (filter on `loadId`) and
  `customer-events` (filter on `targetCustomerId`).

This works but breaks the per-id channel contract from the scoping
doc. Network-wise, every client receives every event and discards
the irrelevant ones — fine for the demo, NOT scalable.

**Suggests:**
- Either: extend the channel-element compiler pass to evaluate
  attribute-string interpolations at runtime so `<channel name="driver-${id}">`
  picks up the live `id` value and the WebSocket URL becomes
  `/_scrml_ws/driver-7` for driver 7 etc.
- Or: document explicitly in §38 that channel names are static
  identifiers and per-instance scoping must be done via payload
  filter (with a recipe).
- Or: extend the `topic=` attribute to actually filter pub/sub
  delivery (currently it's a no-op visible only as a code comment).

Severity P0: this is a SILENT failure mode — compiles clean, runs
without error, BUT the auth/privacy contract the adopter believed
they had ("driver 7 only sees driver-7 messages") is broken
silently. A driver whose UI doesn't filter properly will see other
drivers' events. The validation principle says: if the compiler
accepts `<channel name="driver-${id}">`, that pattern must do what
its name suggests, OR the compiler must reject/warn.

**UVB-W1 status (2026-04-30): SILENT-FAILURE WINDOW CLOSED.** VP-3 emits hard E-CHANNEL-007 on `<channel name=>` (or `<channel topic=>`) values containing `${...}` interpolation. Before W1, the literal `${id}` was emitted as a static substring of the WebSocket URL — every per-id channel collapsed to `/_scrml_ws/driver-___id_`. After W1, this is a compile-time error with a pointer to the static-name + payload-side-filter pattern (§38.11.3). The runtime per-channel-scoping fix remains open; UVB-W1 closes only the silent-acceptance window. See `compiler/SPEC.md` §38.11.

**Repro:** `/tmp/channel-name-test.scrml`, `/tmp/channel-name-test2.scrml`,
`/tmp/channel-name-test3.scrml` (three variants, all show the same
mangling).

---

## F-CHANNEL-002 — `@shared` mutation does not provide an on-change effect hook (P1)

**Surfaced in:** M5, designing dispatch/board.scrml to refresh the
kanban when status changes are pushed via the `dispatch-board` channel.

**What I wanted:**
```scrml
<channel name="dispatch-board">
  ${
    @shared events = []
    on events.change {     // hypothetical
      refresh()
    }
  }
</>
```

**What scrml provides:** `@shared` syncs the value across clients (via
WebSocket); reading `${@events.length}` in markup re-renders that part
of the DOM when the value changes (via the auto-generated `_scrml_effect`
wrapper). But there's no language-level "run this side-effect when
@events grows" hook.

**Workaround used:**
1. Render `${@boardEvents.length}` somewhere in the markup so the count
   updates live (a "Live events: N" badge).
2. Maintain a separate `@lastSeenEventCount` reactive that the user-
   facing "Refresh" button updates: `@lastSeenEventCount = @boardEvents.length`.
3. The button is shown via `if=(@boardEvents.length > @lastSeenEventCount)`
   — appearing only when new events arrive. Click triggers a manual
   `refresh()` that re-fetches DB state.

This compiles clean and demos correctly. But it's a degraded UX
compared to "live, automatic" — the dispatcher has to click "Refresh"
to merge live state into the visible list. Without an on-change hook,
the only fully-automatic alternative is to put the data INSIDE the
`@shared` array (which means turning every db state into a channel
state — impractical for `<channel>` payloads carrying server-fetched
table rows).

**Suggests:**
- Provide a language-level on-change hook for `@shared` (e.g.
  `on @sharedVar.change { ... }`) that fires when the channel sync
  pushes a new value.
- Alternatively: provide a `useEffect`-shaped primitive that runs a
  client-side function whenever any of its inputs change. (scrml's
  derived-reactive `const @x = expr` re-COMPUTES but doesn't fire
  side-effects.)
- Or: document the manual-refresh pattern as the canonical M5+
  recipe for "channel pushed event → refresh tab".

Severity P1: workaround is mechanical and the UX gap is acceptable
for many use-cases. The dispatch app exercises this 8 times across 8
subscriber pages — every one has the same `@lastSeen + Refresh button`
shape. Adopters will reach for an on-change effect within minutes
of writing their first channel page.

---

## F-CHANNEL-003 — Channels are per-page, not cross-file (P1) — **FULLY RESOLVED 2026-05-02 (P3.A + P3.A-FOLLOW)**

**Surfaced in:** M5, when wiring 4 channels across 12 publishing/
subscribing pages. Discovered F-AUTH-002-style duplication for channels.

**What I tried (theoretical):** factor the channel decl into a shared
file:
```scrml
// models/channels.scrml
${
  export <channel name="dispatch-board">
    ...
  </>
}
```

**What didn't work:** there's no syntax for exporting a `<channel>`.
Channels are bound to a `<program>` scope and the `@shared`
declaration inside is part of that page's reactive graph.

**Workaround used:** every page that wants to publish or subscribe
to a channel MUST declare its own `<channel name="X">` block. The
WebSocket endpoint is shared across pages BY NAME, so the broadcast
works — but the in-source declaration is duplicated.

For the dispatch app:
- `dispatch-board` channel decl appears in: dispatch/board.scrml,
  dispatch/load-detail.scrml, dispatch/load-new.scrml,
  driver/load-detail.scrml, customer/quote.scrml — **5 copies**.
- `load-events` channel decl appears in: dispatch/load-detail.scrml,
  driver/load-detail.scrml, customer/load-detail.scrml — **3 copies**.
- `driver-events` channel decl appears in: driver/messages.scrml,
  driver/home.scrml — **2 copies**.
- `customer-events` channel decl appears in: dispatch/billing.scrml,
  driver/load-detail.scrml, customer/loads.scrml,
  customer/invoices.scrml, customer/home.scrml — **5 copies**.

Total: ~15 channel-block copies across 12 files. Each block is ~12
LOC of identical-shape `@shared events = [] ... server function
publishX(...) { ... }`. ~180 LOC of boilerplate on the M5 contribution.

**Suggests:**
- Allow `export <channel name="X">` and `import 'X' from './path'` so
  the channel + its publish helper come from one source.
- Or: treat channel names as ambient — declaring `<channel name="X">`
  once project-wide is enough; importing pages can publish/subscribe
  via a stdlib `channel.publish(name, payload)` / `channel.subscribe(name, handler)`
  API without re-declaring the block.
- Or: accept the per-page redundancy and document the canonical
  copy-paste shape in the kickstarter.

Severity P1: the friction is sharp because the obvious abstraction
(factor a channel block into a shared file) is exactly what every
multi-page app wants. ~180 LOC of boilerplate on a 600-LOC milestone
is a meaningful tax.

### Resolution — P3.A (2026-05-02)

**Status: ARCHITECTURALLY RESOLVED.**

P3.A ships the **CHX (Channel-Expander)** mechanism — channels MAY now be
exported via Form 1 (`export <channel name="X" attrs>{body}</>`) and
imported by name in any consumer file. The compiler inlines the channel
markup body at every consumer's import-reference position before codegen
runs; the wire-layer identity (the WebSocket route `/_scrml_ws/X`) is
shared across all importers by virtue of the `name=` attribute. See SPEC
§38.12 for the full mechanism, worked examples, and `name=` attribute
requirements.

The architectural mechanism is shipped + 28 new tests pass + the
`F-CHANNEL-003` synthetic fixture (cross-file `<channel>` import with the
canonical chat pattern) compiles cleanly.

### Sweep — P3.A-FOLLOW (2026-05-02)

**Status: FULLY RESOLVED — 4 of 4 channels migrated; 0 channels left per-page; 15 channel decl sites swept.**

The dispatch app's channels were centralized into `examples/23-trucking-dispatch/channels/`
pure-channel-files (one file per topic, per SPEC §38.12.6):

| Channel | Pages migrated | Path |
|---|---|---|
| `dispatch-board` | 5 (dispatch/board, dispatch/load-new, dispatch/load-detail, customer/quote, driver/load-detail) | `channels/dispatch-board.scrml` |
| `customer-events` | 5 (customer/home, customer/loads, customer/invoices, dispatch/billing, driver/load-detail) | `channels/customer-events.scrml` |
| `load-events` | 3 (customer/load-detail, dispatch/load-detail, driver/load-detail) | `channels/load-events.scrml` |
| `driver-events` | 2 (driver/home, driver/messages) | `channels/driver-events.scrml` |

Each consumer page now `import`s the channel via the kebab-case quoted-name
form and references the alias as a markup tag:

```scrml
${ import { "dispatch-board" as dispatchBoard } from '../../channels/dispatch-board.scrml' }
<dispatchBoard/>
```

CHX (CE phase 2) inlines the channel markup body at every consumer's tag
reference before codegen runs. The wire-layer identity (the WebSocket route
`/_scrml_ws/<name>`) is shared across all importers; each importer has its
own local `@shared` mirror, kept in sync via the wire layer.

**Net delta:** 15 channel decls (~205 LOC of inline `<channel>...@shared
events = []...server function publishX(...)</>`) replaced with 4 canonical
files (~30 LOC each, including comments) plus 17 import lines + 15 alias-tag
calls in consumer pages. Roughly **−205 LOC of inline boilerplate eliminated.**

**Test impact:** 8539 → 8547 (+8 from new expression-audit checks against
the 4 channel files; 0 regressions). bun test compiler/tests/ remains clean.

No channels were skipped — every channel in the dispatch app had at least
2 redeclarations and zero consumer-scope-bound `topic=` references that
would have required leaving them per-page (per the SPEC §38.12 worked-example
scoping caveat documented in the kickstarter). The dispatch app uses the
default `topic=name` semantics throughout, which is the safe path.

**Branch:** `changes/p3.a-follow`. Artifacts archived at `scrml-support/archive/changes/p3.a-follow/` (moved from `docs/changes/p3.a-follow/` in S61 curation pass).

**See also:** P3 deep-dive (`scrml-support/docs/deep-dives/p3-cross-file-inline-expansion-2026-05-02.md`),
SPEC §38.12, PIPELINE.md Stage 3.2 Phase 2, `compiler/src/state-type-routing.ts`.

---

## F-CHANNEL-004 — `<channel>` body @shared decl + page-level reactives don't share scope cleanly (P2)

**Surfaced in:** M5 driver/load-detail.scrml when adding the
sendLocationPing() helper that needs to read both `@load` (page reactive,
declared in `< db>` block) and call `publishLoadEvent(...)` (channel-
scope server fn).

**What works:** A page-level `function` can call a channel-scope
`server function` (e.g. `publishLoadEvent`). The compiler resolves the
name across the channel boundary.

**What's awkward:** The `@shared` reactive itself (`@loadEvents`) is
read in the page-level markup interpolations and conditional `if=`
attributes (`${@loadEvents.length}`, `if=(@loadEvents.length > X)`).
This works but feels coincidental — there's no documentation
explaining that `<channel>`-internal `@shared` vars are accessible
as page-level reactives. The example 15 + kickstarter recipe shows
it implicitly but doesn't state it.

The reverse direction also works (channel-scope `publishX` uses
`new Date()` etc. without explicit imports), but this asymmetry is
not documented.

**Workaround used:** none needed; the unspoken contract is that
channel-scope is "merged" into page-scope for both directions. But
it's a footgun the first time you assume otherwise.

**Suggests:** Document explicitly in §38 (channel spec) the scope
rules:
- `@shared` decls inside `<channel>` body are visible as page-level
  reactives outside (read with `@varname`).
- Page-level `function`s can call channel-scope `server function`s
  by name.
- Channel-scope `server function`s can use any global JS API +
  imported helpers + page-level `@vars`.

Severity P2: not blocking, just a documentation gap. Recording for
the §38 spec polish.

---

## F-CHANNEL-005 — Per-channel auth scoping is not declarative (P1)

**Surfaced in:** M5 design phase. The scoping doc + kickstarter §7
imply that channels can be auth-scoped at declaration time
(e.g. `<channel name="dispatcher-board" auth="role:dispatcher">`).
The dispatch app's four channels have natural auth boundaries:
- `dispatch-board` — dispatchers only
- `driver-events` — driver + their dispatcher
- `load-events` — load owner (customer) + assigned driver + dispatcher
- `customer-events` — customer + their dispatcher

**What I tried:**
```scrml
<channel name="dispatch-board" auth="role:dispatcher">
  ...
</>
```

**What didn't work:** the compiler accepts the `auth=` attribute as
a generic HTML attribute (no error, no warning), but channel runtime
doesn't appear to enforce it. Every WebSocket client connecting to
`/_scrml_ws/dispatch-board` is subscribed regardless of role. (Per
F-AUTH-001 — `auth="role:X"` is silently inert across all element
types.)

**Workaround used:** Auth-scope on the SUBSCRIBE side via the page-
level `getCurrentUser` + role check (the existing F-AUTH-001
fallback). Each subscribing page checks the cookie + redirects to
`/login?reason=unauthorized` if the user isn't the right role.
The CHANNEL itself remains an open broadcast.

**Network exposure risk:** any authenticated user who knows the
WebSocket URL `/_scrml_ws/dispatch-board` could open a connection
and receive every dispatch-board event. The page-side auth check
doesn't prevent that. For the demo this is fine; for production
this is a P0 security gap.

**Suggests:**
- Implement `<channel auth=...>` to actually scope subscribes (the
  WebSocket handshake should verify cookie + role before accepting
  the upgrade). This is a runtime change, not a codegen change.
- Until that ships, document the gap in §38 + the kickstarter so
  adopters know channels are open-broadcast at the wire level.

Severity P1: workaround is the existing F-AUTH-001 server-side
gate, which is already exercised across every page. The new wrinkle
is the wire-level exposure for adopters who assume channel auth
attributes work.

**UVB-W1 status (2026-04-30): SILENT-FAILURE WINDOW PARTIALLY CLOSED.** VP-1 emits W-ATTR-002 on `<channel auth="role:X">` (same surface as F-AUTH-001). The wire-level enforcement remains unimplemented (this is the architectural gap covered by future runtime work); UVB-W1 closes the silent-acceptance window: adopters now see a warning instead of silent inert-attribute behavior. See `compiler/SPEC.md` §52.13.

---

## F-CHANNEL-006 — `<channel>` body declarations not consumed → E-DG-002 noise (P2)

**Surfaced in:** M5 design. Repeatedly while building the channel
blocks I'd write a `<channel>` decl that compiles cleanly but emits
E-DG-002 because I hadn't yet read the `@shared` value in markup.

**What I tried:**
```scrml
<channel name="dispatch-board">
  ${
    @shared boardEvents = []
    server function publishBoardEvent(...) { boardEvents = [...boardEvents, ...] }
  }
</>
```
With NO `${@boardEvents.length}` / etc. in the page markup, the
compiler emits:
> warning [E-DG-002]: Reactive variable `@boardEvents` is declared
> but never consumed in a render or logic context.

Even though `boardEvents` IS consumed (by the channel sync
infrastructure that reads/writes it via WebSocket), the DG analyzer
only looks at markup interpolations + page-level logic-block reads.

**Workaround used:** add a "live events" badge in the markup:
`<span>Live events: ${@boardEvents.length}</span>`. Every page now
has this badge, which doubles as user feedback ("things are happening
in real time").

**Suggests:** The DG analyzer should treat a `@shared` variable's
declaration inside a `<channel>` as a self-contained consumer (the
channel itself is the consumer), and not require an additional
markup read to silence E-DG-002.

Severity P2: workaround is mechanical and arguably improves the UX
(adopters get a live activity indicator for free). But the friction
is a small cognitive tax during channel design — adopters write the
channel block, see the warning, hunt for what's missing, and end up
adding a probably-redundant markup read.

---

## F-AUTH-001 — M5 RECONFIRMATION (P0)

All channel-using pages still rely on the existing F-AUTH-001 fallback
(server-side getCurrentUser + role check). M5 adds 12 more publish/
subscribe sites; each new page entry is gated only by the existing
in-line `if (!user || user.role != X) return { unauthorized: true }`
guard. The channel runtime adds NO additional auth surface — the
WebSocket endpoint accepts any authenticated client per F-CHANNEL-005.

**Cumulative reconfirmations:** 18 pages from M2-M4 + 12 channel-using
amendments in M5. Same fallback pattern repeated ~30 times for
authentication and ~12 times for channel publish/subscribe gates.
F-AUTH-001 friction is now exercised across the full channel surface.

No design change.

---

## F-AUTH-002 — M5 RECONFIRMATION (P0)

M5 introduces NO new SQL-using server fns in cross-file shared
helpers. The new channel-scope `publishXEvent(...)` server fns are
duplicated INLINE per page (per F-CHANNEL-003 + F-AUTH-002): each
page that publishes redeclares the same publish helper signature +
body. ~12 inline copies of the channel-publish helper across the
12 amended pages.

The combined inline-duplication footprint of M2-M5:
- ~126 LOC `getCurrentUser` (M2-M4, 18 pages × 7 LOC)
- ~30 LOC `if (!user || user.role != X)` guards (M2-M4)
- ~144 LOC channel-publish helpers (M5, 12 pages × 12 LOC) — F-CHANNEL-003
- Total: ~300 LOC of mechanical inline duplication that the obvious
  cross-file abstraction would consolidate.

No design change.

---

## F-COMPONENT-001 — M5 RECONFIRMATION (P0, architectural)

M5 ships ZERO new cross-file component imports. All channel-related
markup (live event lists, badge counters, refresh buttons) is inlined
at every consumer site. The component-as-reusable-channel-display
pattern (e.g. an `<EventBadge>` showing live counter + ack button
that could be shared across all 8 channel-subscribing pages) cannot
be extracted because of the architectural defect.

Repeated wiring instead: every channel-subscribing page has the same
8-LOC pattern: `@lastSeenXEventCount = 0`, `function ackXEvents() { ... }`,
markup `<span>Live: <strong>${@xEvents.length}</strong></span>` +
`<button if=(...) onclick=ackXEvents()>Refresh</button>`. ~10 such
sites.

No design change. The deep-dive on cross-file component expansion
remains queued post-M6.

---

## F-IDIOMATIC-001 — M5 OBSERVATION (P2)

M5 added ~600 LOC. Quick grep for canonical `is not` / `is some`
across the new code:

| Search | Hits |
|---|---|
| `is not` as operator | **0** |
| `is some` as operator | **0** |

The trend from F-IDIOMATIC-001 holds at M5. New channel-using code
written directly against the kickstarter v1 + example 15 reference
exclusively uses `!x` truthiness checks. Specifically, channel
publish guards (`if (!@load)`, `if (!@driver)`, `if (!@customer)`)
all reach for `!x` rather than `@load is not` / `@load is some`.

Re-grep at M6 close to see if the trend continues.

---

## F-COMPILE-001 — `scrml compile <dir>` flattens output by basename, silently overwriting collisions (P0) — RESOLVED 2026-04-30 (S51, W0a)

> **RESOLVED 2026-04-30 (S51, W0a).** Compiler now preserves source-tree
> structure in `dist/`. `pages/customer/home.scrml` emits to
> `dist/pages/customer/home.html`; `pages/driver/home.scrml` emits to
> `dist/pages/driver/home.html`. Collisions are no longer silent — `E-CG-015`
> is emitted as a defense-in-depth backstop per SPEC.md §47.9.
>
> Post-fix audit on this app: 32 sources → 21 HTML / 32 client.js / 21 server.js
> in nested dist/ tree (was 17 / 28 / 17 flat with 15 silent overwrites).
> All 32 distinct outputs are now present. Fix commits: `05dc7fb`, `99d4909`,
> `287c1d7`, `7776907`. SPEC normative section at §47.9.

**Surfaced in:** Audit at M5 close (2026-04-30, S50). User-prompted: "are we actually compiling all code?"

**What I found:** Running `bun ./compiler/src/cli.js compile examples/23-trucking-dispatch/` against 32 source `.scrml` files produces only **17 HTML / 17 CSS / 46 JS files** in `dist/`. Math: 5 HTML + 10 JS = **15 silent overwrites.**

**The basename collisions:**

| Basename | Source files (3 personas) | Output | Lost |
|---|---|---|---|
| `home.scrml` | `pages/customer/home.scrml` + `pages/driver/home.scrml` | 1× `home.html` (DRIVER won) | Customer home |
| `load-detail.scrml` | `pages/customer/`, `pages/dispatch/`, `pages/driver/` | 1× `load-detail.html` | Two of three personas |
| `profile.scrml` | `pages/customer/profile.scrml` + `pages/driver/profile.scrml` | 1× `profile.html` (DRIVER won — has CDL fields) | Customer profile |

**Independent verification:**
```sh
$ find examples/23-trucking-dispatch -name '*.scrml' | wc -l
32
$ ls examples/23-trucking-dispatch/dist/*.html | wc -l
17
$ grep -m1 "driver-events" dist/home.server.js
4 matches  # confirms driver/home.scrml won the home.* race
$ grep -m1 "cdl_number" dist/profile.server.js
1 match    # confirms driver/profile.scrml won the profile.* race
```

**What didn't work:** Source dir structure (`pages/customer/` vs `pages/driver/`) was discarded by the codegen step; output uses raw basename for `dist/<basename>.{html,css,client.js,server.js}`. Last file in iteration order wins; earlier files silently overwritten.

**Impact:**
- The dispatch app, as compiled, has no `/customer/home` page — dist/home.html is the driver version.
- Customer load-detail tracking — gone.
- Customer profile — gone.
- Adopters running the seeded customer login (`customer-1@dispatch.local`) would see driver UI at `/customer/home`, hit role-check redirect, and experience the customer flow as broken.

**The "compile clean" verdict from M3-M5 dispatches was misleading.** Each dispatch reported "32 files compiled clean" but didn't audit input-file count vs output-file count. The validation principle says: *if compile is clean, the program should be good.* Here, compile is clean and 5 pages are missing from dist.

**Workaround:** Either:
- Rename source files to unique basenames: `pages/customer/customer-home.scrml`, `pages/driver/driver-home.scrml`, etc. Massive rename + import-path churn across all M1-M5 work.
- Compile per-subdirectory with `--out` per-dir (CLI may not support this).
- Accept dist/ as flat and route at the server layer to the correct source — but with overwrites, only the WINNING source is in dist anyway.

**Suggests:**
- Codegen should preserve source directory structure in `dist/` — emit `dist/pages/customer/home.html` rather than `dist/home.html`. Routing then maps URL paths to dist paths cleanly.
- OR: compiler should emit a hard error when basename collisions are detected. Silent overwrite is the worst possible behavior.
- OR: per-subdirectory compilation should be a first-class CLI option (`scrml compile <dir> --preserve-tree`).

**Severity P0 — blocking:** the example app cannot actually run as advertised. Multi-page scrml apps with any nested directory structure (which is the natural pattern for personas/sections/admin-vs-public) hit this immediately.

This is the largest validation-principle violation surfaced by the dispatch app — a 15-output-collision silent failure. Compounds with F-AUTH-001 (silent attribute), F-CHANNEL-001 (silent name interpolation), and F-COMPONENT-001 (silent phantom elements) as the systemic pattern: scrml repeatedly accepts inputs that produce silently-wrong outputs.

**Reconfirms:** The post-M6 deep-dive scope must include a sweep of "what does the compiler silently accept that doesn't do what its name suggests." This is at least the 4th instance of the pattern.

---

## F-LIN-001 — SQL `?{}` interpolation does NOT count as `lin` consume per §35.3 (P1)

**Surfaced in:** M6 first lin token integration. The 3 lin token use
sites (acceptance / BOL / payment) all pass `lin token: string` to a
server fn whose body needs to UPDATE `lin_tokens SET consumed_at = NOW
WHERE token = ${token}` to consume the token via DB single-use guard.

**What I tried (verbatim adopter intent — natural pattern):**
```scrml
server function consumeAcceptance(loadId, lin token: string) {
    const result = ?{`
        UPDATE lin_tokens
        SET consumed_at = CURRENT_TIMESTAMP
        WHERE token = ${token} AND consumed_at IS NULL
    `}.run()
    ...
}
```

**What didn't work:**
```
error [E-LIN-001]: Linear variable `token` declared but never consumed
before scope exit. Pass it to a function, return it, or remove the
'lin' qualifier if single-use isn't needed.
  stage: TS
```

The compiler's lin-tracker doesn't recognize `${token}` inside a SQL
`?{}` block as a consumption event. Per example 19's working pattern,
template-literal `${ticket}` in a regular backtick string DOES count
(per §35.3 rule 1, post-A4 fix commit `330fd28`). The asymmetry:

| Position of `${linVar}` | Counts as consume? |
|---|---|
| `\`Redeemed ticket=${ticket}\`` (template literal) | YES (§35.3 rule 1) |
| `?{\`UPDATE ... WHERE token = ${token}\`}.run()` (SQL) | NO |

**Workaround used:** Copy the lin var into a regular template literal
first to consume it, then `.substring()` the prefix back out:
```scrml
server function consumeAcceptance(loadId, lin token: string) {
    const consumeMarker = `consume:${token}`
    const result = ?{`
        UPDATE lin_tokens SET consumed_at = CURRENT_TIMESTAMP
        WHERE token = ${consumeMarker.substring(8)}
          AND consumed_at IS NULL
    `}.run()
    ...
}
```

The template-literal `\`consume:${token}\`` consumes `token` per §35.3
rule 1; the resulting string `consumeMarker` carries the original
token value (with the 8-char `consume:` prefix), and `.substring(8)`
strips it back out for the SQL bind. Adds 1 LOC + 1 cognitive step
per consume site (M6 has 3 such sites: `signRateConfirmationServer`,
`uploadBolServer`, `markPaidServer`).

> **S441 correction (s441-ex23-run-changes).** The shipped M6 sites bound
> this `.run()` and then tested `result.changes == 0`. `.run()` returns
> **void** (SPEC §8.5.1 — "Source code that previously read `result.changes`
> … no longer works"), so `.changes` was always undefined and the guard never
> fired: replayed, concurrent, and never-issued tokens were all accepted
> (reproduced by execution against the compiled handlers). The sites now use
> the §8.5.1-sanctioned `RETURNING` form — `UPDATE … AND consumed_at IS NULL
> RETURNING token` with `.get()` and an `is not` check. The compiler accepted
> the void-field read with no diagnostic; filed as
> `g-run-result-field-read-compiles-silently`.

**Suggests:** Either:
- Extend §35.3's consume-detection to recognize `${linVar}` inside SQL
  `?{}` interpolation as a consume event (this is the obvious
  generalization — SQL interpolation is template-literal-shaped at the
  lex level). Sites that need lin tokens are precisely the sites that
  do durable single-use guards via SQL UPDATE; the friction lands on
  every adopter writing the canonical pattern.
- Or document the workaround in §35.3 + the kickstarter so adopters
  know SQL interpolation needs the workaround dance.

The friction is sharp because the obvious lin use case — DB-backed
single-use idempotency — exactly hits this gap. The example 19
template-literal demo doesn't expose it because example 19 doesn't
do a database write. Every real lin-token usage will need the
workaround.

Severity P1: workaround is 1 LOC + 1 cognitive step. Not P0 because
the fix path is short once you know it. Logging because the §35.3
post-A4 fix specifically claimed template-literal `${var}` counts —
SQL `${var}` is a natural extension that adopters will assume works.

**Repro:** any server fn taking `lin token: string` whose only intended
consume site is inside `?{}` SQL.

---

## F-DG-002-PREFIX — `@_var` prefix doesn't suppress E-DG-002, despite the warning text (P2)

**Surfaced in:** M6 first compile of `pages/dispatch/load-detail.scrml`
when the page's refresh() pulls `tokenInfo.issuedAt` from the server
fn's return but doesn't render it (the issuedAt field is included
"for diagnostic visibility but not currently shown").

**What I tried:** Followed the warning text's recommendation:
```
warning [E-DG-002]: Reactive variable `@acceptanceIssuedAt` is
declared but never consumed in a render or logic context. Consider
removing the unused variable, or prefix with `_` (e.g.,
`@_acceptanceIssuedAt`) to suppress this warning.
```
So I renamed `@acceptanceIssuedAt` → `@_acceptanceIssuedAt`.

**What didn't work:** The warning fires AGAIN, now recommending
*another* underscore prefix:
```
warning [E-DG-002]: Reactive variable `@_acceptanceIssuedAt` is
declared but never consumed in a render or logic context. Consider
removing the unused variable, or prefix with `_` (e.g.,
`@__acceptanceIssuedAt`) to suppress this warning.
```

The warning's own suppression suggestion doesn't suppress the warning.
The compiler appears to check "is the variable referenced anywhere?"
without an exception for the conventional `_`-prefix-means-deliberately-unused.

**Workaround used:** Just delete the unused @var (the issuedAt field
isn't rendered anywhere, so nothing's lost).

**Suggests:**
- Either the suppression mechanism (`_` prefix) should actually work,
  matching the warning text's promise; or
- Remove that line from the warning text — recommend only "remove the
  unused variable" since the suppression form doesn't actually
  suppress.

Currently the warning is misleading: adopters following the
prescribed fix path get the same warning back at infinite recursion
depth (`@___var`, `@____var`, ...).

Severity P2: workaround is "delete the var", which is fine. Logging
because it's a small but sharp DX paper cut on what should be a
trivial path.

**Repro:** Declare `@_anyName = "value"` in any scrml file with a
`<program>` root and don't read it in markup or logic. The warning
fires anyway.

---

## F-AUTH-001 — M6 RECONFIRMATION (P0)

M6 amends 5 existing pages (dispatch/load-detail, dispatch/billing,
driver/load-detail, customer/load-detail, customer/invoices) with lin
token mint/consume server fns. Every amended page keeps its inline
`getCurrentUser()` + `if (!user || user.role != X)` guard pattern. No
new pages added — just inline server-fn additions.

**Cumulative reconfirmations:** 18 pages from M2-M4, 12 channel
sites in M5, 5 lin-token amendments in M6 = 35+ exercises of the
F-AUTH-001 inline fallback pattern across the dispatch app.

No design change.

---

## F-AUTH-002 — M6 RECONFIRMATION (P0)

M6 introduces NEW SQL-using server fns inline:
- `getActiveAcceptanceTokenServer` (dispatch/load-detail)
- `signRateConfirmationServer` (customer/load-detail)
- `getActiveBolTokenServer` (driver/load-detail)
- amended `transitionLoadServer` + `uploadBolServer` (driver/load-detail) with lin_tokens DB ops
- amended `ensureInvoicesServer` + `fetchInvoicesServer` (dispatch/billing) with lin_tokens DB ops
- amended `markPaidServer` + `fetchInvoicesServer` (customer/invoices) with lin_tokens DB ops

All 5 amended pages had to inline their lin token mint/consume helpers
because cross-file `?{}` portability still fails (E-SQL-004). The
canonical refactor target — `models/lin-tokens.scrml` exporting
`mintToken(loadId, kind)` + `consumeToken(token, kind)` helpers —
remains blocked.

Concretely the M6 lin-token integration would have been ~30 LOC if a
`models/lin-tokens.scrml` could host the SQL. Inline, it's ~150 LOC
spread across 5 pages.

**Cumulative inline-duplication footprint M2-M6:**
- ~126 LOC `getCurrentUser` (M2-M4)
- ~30 LOC `if (!user || user.role != X)` guards (M2-M4)
- ~144 LOC channel-publish helpers (M5)
- ~150 LOC lin-token mint/consume helpers (M6)
- **Total: ~450 LOC** of mechanical inline duplication that the
  obvious cross-file abstraction would consolidate.

No design change.

---

## F-COMPONENT-001 — M6 RECONFIRMATION (P0, architectural)

M6 ships ZERO new cross-file component imports. The components/
directory continues to host helper functions only; markup is inlined
at every consumer site. The lin-token UI elements (rate-confirmation
pill, BOL submission gate, payment token availability badge) are all
inline at their respective pages — the obvious abstraction
(`<LinTokenBadge token=@token kind="acceptance"/>`) cannot be
extracted because of the architectural defect.

No design change. Deep-dive on cross-file component expansion remains
queued post-M6.

---

## F-COMPILE-001 — M6 RECONFIRMATION (P0)

M6 adds NO new source files. Input count: 32 .scrml files (unchanged
from M5). Output count: 17 HTML / 28 client.js / 17 server.js
(unchanged from M5). M6's amendments to existing pages preserve the
basename collision pattern.

**Verified post-M6 (2026-04-29):**
```
$ find examples/23-trucking-dispatch -name '*.scrml' | wc -l
32
$ ls examples/23-trucking-dispatch/dist/*.html | wc -l
17
$ ls examples/23-trucking-dispatch/dist/*.client.js | wc -l
28
$ ls examples/23-trucking-dispatch/dist/*.server.js | wc -l
17
```

15 silent overwrites preserved. The dispatch app, as compiled, still
loses customer/home, customer/load-detail, customer/profile,
dispatch/load-detail, driver/load-detail (whichever loses the
basename race in iteration order). M6's lin-token additions on the
amended pages are technically present in dist/<basename>.* — but only
for the page that wins each basename race.

No new collisions introduced by M6 (no new files).

No design change. F-COMPILE-001 remains the chief blocker for
running this app.

> **RESOLVED 2026-04-30 (S51, W0a) — see top of F-COMPILE-001 entry above.**

---

## F-IDIOMATIC-001 — M6 OBSERVATION (P2)

M6 added ~500 LOC across 5 amended files. Quick grep:

| Search | Hits |
|---|---|
| `is not` as operator | **0** |
| `is some` as operator | **0** |

The trend from F-IDIOMATIC-001 (zero adopter reach for canonical
presence-guards) holds at M6. Lin token mint/consume code reaches
exclusively for `if (!token)` and `if (token == "")` truthiness checks.

The pattern is now stable across all 6 milestones:
| Milestone | LOC range | `is not` hits | `is some` hits |
|---|---|---|---|
| M1 | ~850 | 0 | 0 |
| M2 | ~2,200 | 0 | 0 |
| M3 | ~2,260 | 0 | 0 |
| M4 | ~1,800 | 0 | 0 |
| M5 | ~600 | 0 | 0 |
| M6 | ~500 | 0 | 0 |
| **Total** | **~8,200** | **0** | **0** |

Zero adopter reach across the entire dispatch app. The canonical
syntax is dead-letter documentation in practice.

No design change.

---

## Summary — what this exercise produced

**26 friction entries logged across M1-M6:**
- **6 P0** entries (silent failure / validation-principle violations)
- **10 P1** entries (working but awkward)
- **5 P2** entries (DX paper cuts)
- **5 P2** observations / data points
- **5 milestone reconfirmations** (M3 + M4 + M5 + M6 of existing P0s — same pattern at scale)
- **1 partial-resolution** (F-RI-001 split into narrow + file-context + follow + CPS findings)

### Severity-grouped index

#### P0 — silent failure / validation-principle violation (6)
- **F-AUTH-001** — `auth="role:X"` is silently inert; per-route role gate has no compiler effect.
- **F-AUTH-002** — cross-file `server function` with `?{}` SQL access fails E-SQL-004; can't factor auth into a shared module.
- **F-COMPONENT-001** — bare `lift <ImportedComponent/>` fails E-COMPONENT-020; HTML wrapper "fix" produces phantom-element silent runtime failure (architectural).
- **F-RI-001** — server-fn return-value branching escalates wrapping client fn to server, violating canonical Promise-chain pattern. Partial fix lands isolated cases; file-context contamination remains.
- **F-CHANNEL-001** — channel name interpolation (`<channel name="driver-${id}">`) is silently inert; per-id scoping collapses to single broadcast (privacy/auth contract silently broken).
- **F-COMPILE-001** — `scrml compile <dir>` flattens output by basename, silently overwriting collisions. 32 source files → 17 HTML in dispatch app. 15 silent overwrites.

#### P1 — working but awkward (10)
- **F-SCHEMA-001** — `< schema>` doesn't satisfy E-PA-002; adopters must pre-create DB before compile.
- **F-EXPORT-001** — `export server function` form is silently unrecognized; workaround is `export function name() { server { ... } }`.
- **F-COMPONENT-002** — component prop names at call site become spurious local declarations (E-MU-001 with no source location).
- **F-COMMENT-001** — HTML comments leak content into parser/scope checker.
- **F-RI-001-FOLLOW** — `is not` doesn't support member-access targets; `obj.field is not` fires E-SCOPE-001.
- **F-CPS-001** — CPS-eligibility skips nested control-flow when finding reactive assignments (architectural).
- **F-ENGINE-001 (formerly F-MACHINE-001)** — RESOLVED P3.B (2026-05-02). TAB now synthesises `type-decl` alongside `export-decl` for `export type X = {...}`; cross-file `<engine for=ImportedType>` works; misleading `imported via 'use'` error message corrected. `pages/driver/hos.scrml` workaround removed. Tests +21, 0 regressions.
- **F-NULL-001** — files with `<machine>` reject `null` literals/comparisons in client-fn bodies (asymmetric trigger).
- **F-NULL-002** — `!= null` / `== null` in server-fn bodies fires E-SYNTAX-042 in GCP3 with no line number; markup-side null comparisons accepted.
- **F-CHANNEL-002 / F-CHANNEL-003 / F-CHANNEL-005** — no on-change hook for `@shared`; channels are per-page (not cross-file); per-channel auth scoping is not declarative.
- **F-LIN-001** — SQL `?{}` interpolation does NOT count as `lin` consume per §35.3; example-19 template-literal pattern doesn't generalize to DB-backed single-use guards (NEW M6).

#### P2 — DX paper cut (5)
- **F-EQ-001** — `===` is not valid scrml (E-EQ-004 with excellent message; logging as data point).
- **F-AUTH-003** — W-AUTH-001 fires even when `auth=` IS explicit.
- **F-DESTRUCT-001** — array destructuring inside `for-of` may confuse type-scope (needs isolated repro).
- **F-PAREN-001** — `a + (b - c)` paren-stripping idempotency invariant; lift sub-expressions to const bindings.
- **F-CONSUME-001** — `@var` in attribute-string interpolation isn't recognized as consumption.
- **F-CHANNEL-004 / F-CHANNEL-006** — channel/page scope rules undocumented; channel `@shared` decls fire E-DG-002 noise.
- **F-DG-002-PREFIX** — `@_var` underscore-prefix doesn't suppress E-DG-002 despite the warning text saying it does (NEW M6).

#### P2 observations / data points (varies)
- **F-IDIOMATIC-001** — canonical `is not` / `is some` presence-guard syntax saw **0 adopter reach across all 6 milestones (~8,200 LOC)**. The scrml way is dead-letter documentation in practice; adopters reach for `!x` truthiness universally.

### Meta-finding — systemic silent-failure pattern

Across the 6-milestone exercise, **at least 5 P0 findings fit a single
pattern**: the compiler accepts syntactically-valid input that produces
silently-wrong output. The pattern:

| Finding | Compiler accepts | Adopter expects | Actually happens |
|---|---|---|---|
| F-AUTH-001 | `auth="role:X"` | role-gating | nothing |
| F-COMPONENT-001 | `<Component/>` (wrapped) | rendered component | phantom element / blank |
| F-CHANNEL-001 | `<channel name="x-${id}">` | per-id scoping | single broadcast |
| F-COMPILE-001 | `scrml compile <dir>` | per-file output | basename overwrites |
| F-CPS-001 | `if (cond) { @v = x }` (with server trigger) | conditional reactive set | E-RI-002 (inverse silent — fails to compile, but adopters can't tell which arm fired) |

The S49 validation principle ("if the compiler accepts X, X must do
something — silent runtime failure is a P0 friction finding") is the
right framing. Each individual finding is a P0; collectively they
indicate a systemic gap in the validation-pass design that warrants a
unified deep-dive.

**Proposed deep-dive scope (post-M6):**
- Catalog every "silently-accepted-but-inert" syntactic pattern in
  current scrml across all element types, attributes, and stdlib
  imports.
- Classify by failure mode (no-op / phantom / wrong-default / silent
  overwrite / collapse-to-broadcast / etc).
- Propose a uniform "validation pass" or "diagnostic pass" that warns
  on every pattern in the catalog rather than the current case-by-case
  approach.
- Use the dispatch app's FRICTION.md as the reference catalog seed.

This unified deep-dive would address all 5 P0s above as instances of
a single architectural principle: *the compiler should never accept
input that produces silently-wrong output*.

### LOC tally per milestone

| Milestone | LOC | Files added/amended |
|---|---|---|
| M1 — schema + auth scaffold | ~850 | 7 new (app, schema, seeds, models/auth, pages/auth × 2, README) |
| M2 — dispatcher slice | ~2,200 | 6 new pages + 8 components |
| M3 — driver slice | ~2,260 | 6 new pages |
| M4 — customer slice | ~1,800 | 6 new pages |
| M5 — real-time integration | ~600 | 12 amended pages (4 channels × per-page redeclaration) |
| M6 — lin tokens + README | ~500 | 5 amended pages (3 lin token use sites) + schema delta + README rewrite |
| **Total** | **~8,200** | **33 .scrml files** + bootstrapped dispatch.db + comprehensive README + FRICTION.md |

### Closing — the load-bearing artifact

This **`FRICTION.md` IS the chief output of the entire 6-milestone
exercise.** The dispatch app source code is the corpus that produced it;
the scope, diversity, and persistence of the friction findings are the
data the user committed 8,200+ LOC to surface.

Six P0 silent-failure findings, ten P1 awkward-but-working findings,
five P2 paper-cuts, plus zero adopter reach for the canonical
presence-guard syntax — all collected from agents writing real scrml
to a fixed brief, with no compiler changes during the build. The
findings now feed into the post-M6 deep-dive and the kickstarter v2
revision (when those scope are opened).

The dispatch app will not run end-to-end as a web service until
F-COMPONENT-001 is resolved (the bare-`lift` phantom-element bug). The
two adjacent compiler-level blockers are now both resolved:
F-COMPILE-001 (RESOLVED 2026-04-30 S51 W0a — output tree preservation)
and OQ-2 (RESOLVED 2026-04-30 S51 W0b — `scrml:*` runtime resolution
via shim bundling + import rewrite). One pre-existing codegen bug
also surfaced during W0b smoke-test: emitted JS imports user-authored
`./*.scrml` files by source extension instead of rewriting to the
compiled output extension. That is **NOT OQ-2**; it is a separate gap
in `rewriteRelativeImportPaths` (which only handles `.js`) — surfaced
for the supervisor to scope.

Until F-COMPONENT-001 is resolved, this file IS the value the build
produced.

---

## OQ-2 — `scrml:NAME` stdlib imports unresolvable at runtime (P0) — RESOLVED 2026-04-30 (S51, W0b)

> **RESOLVED 2026-04-30 (S51, W0b).** Compiler now bundles a runtime
> shim for each referenced `scrml:NAME` stdlib module into
> `<outputDir>/_scrml/NAME.js` and rewrites emitted
> `import { ... } from "scrml:NAME"` to a relative path
> `import { ... } from "<rel>/_scrml/NAME.js"` (where `<rel>` is
> computed from the file's actual location in the dist tree, so
> nested-output files emit `../../_scrml/...`).
>
> Pre-fix audit on this app: every `*.server.js` and every
> `*.client.js` that imported `scrml:auth`, `scrml:crypto`, or
> `scrml:store` failed at `await import()` time with `Cannot find
> package 'scrml:NAME'` (Bun has no resolution for the `scrml:`
> scheme). Post-fix: zero `scrml:` specifiers remain in emitted JS;
> all 3 hand-written shims (`auth.js`, `crypto.js`, `store.js`) are
> bundled at `dist/_scrml/`; smoke tests against the previously-Class-A
> failure files (`app.server.js`, `login.server.js`, `register.server.js`,
> `profile.server.js`) now pass the stdlib-import phase. They surface a
> separate, pre-existing `.scrml`-import codegen issue (out of scope —
> see standing caveat above), but the OQ-2 stdlib path is closed.
>
> Why hand-written shims (not truly-compiled stdlib): stdlib `.scrml`
> sources contain `server {}` blocks that today's compiler does not
> lower at TS time (separate M16 gap). The shim path is the smallest
> viable runtime artefact and can be replaced by truly-compiled output
> once that gap is closed. Names without a hand-written shim are left
> verbatim in emitted code so the gap surfaces as a loud runtime
> failure rather than silent degradation.
>
> Fix commits: `7cdf938` (3 hand-written shims), `84b78a0` (bundling +
> import rewrite), `56c1082` (regression test). Coverage:
> `compiler/tests/integration/oq-2-stdlib-runtime-resolution.test.js`
> (9 tests across 4 sections).

---


## F-COMPILE-002 — codegen does not rewrite user `./*.scrml` imports to compiled-output extension (P0) — surfaced 2026-04-30 (S51, W0b smoke-test) — RESOLVED 2026-04-30 (paired F-BUILD-002 dispatch)

**Status: RESOLVED.** Paired dispatch with F-BUILD-002. Branch
`worktree-agent-aa8c40c8744a6c38d`. Two-layer fix:

1. **`compiler/src/codegen/emit-server.ts:111-127`** now rewrites local
   `.scrml` imports to `.server.js` in-place during emit, mirroring the
   pre-existing `emit-client.ts` pattern. After this fix, server-side
   `import { rolePath } from './models/auth.scrml'` emits as
   `from "./models/auth.server.js"` directly.

2. **`compiler/src/api.js:283-308` (`rewriteRelativeImportPaths`)** now
   skips `.server.js` and `.client.js` paths in its post-emit relocation
   pass. These are scrml output-tree artefacts (siblings of the importing
   file in the dist tree per §47.9 tree-preservation), NOT source-tree
   sidecar files; relocating them mis-pointed the path back into the source
   tree where the compiled artefact does not exist. `.js` sidecar imports
   continue to be relocated as before (regression coverage in
   `tests/unit/giti-009-import-rewrite.test.js` — 16/16 pass).

**SPEC §47.10 added:** Relative Import Path Rewrites — codifies the per-emit-target
rewrite contract and the post-emit relocation skip for `.server.js` /
`.client.js`. §47.11 documents stdlib bundling (W0b). §47.12 documents
F-BUILD-002 server-entry deduplication.

**Tests added** (`compiler/tests/integration/f-compile-002-scrml-import-rewrite.test.js`,
8 tests): server emit produces `.server.js` import; client emit retains
`.client.js` rewrite (regression); rewriter skips compiled-output extensions;
`.js` sidecar relocation regression; default-import rewrite; emitted server.js
contains no relative `.scrml` lines.

**Note** (out-of-scope of F-COMPILE-002): pure-helper `.scrml` files (e.g.
the dispatch app's `models/auth.scrml`) currently compile to a near-empty
`.client.js` and no `.server.js` — the imports are EXTENSION-rewritten
correctly by F-COMPILE-002, but the IMPORTED FILE may still not provide
the named exports at runtime. That's a separate cross-file pure-helper
emission bug (visible in the canonical `examples/22-multifile/` test where
`types.client.js` and `components.client.js` are also empty), to be filed
separately.

---

## F-BUILD-002 — duplicate `_scrml_session_destroy` import per server.js → SyntaxError on load (P0) — surfaced 2026-04-30 (S51, W0a smoke-test) — RESOLVED 2026-04-30 (paired F-COMPILE-002 dispatch)

**Status: RESOLVED.** Paired dispatch with F-COMPILE-002. Branch
`worktree-agent-aa8c40c8744a6c38d`. Single-fix in
`compiler/src/commands/build.js`:

`generateServerEntry` now tracks a `Set<string>` of already-imported names
across modules. For each module, names already seen are filtered from its
import line — first-importer wins. If a module's entire export set has
already been imported, no import line is emitted for that module (no
syntactically-empty `import {}` lines).

Chose option (d) "skip the duplicate-emit" over (a) namespace imports per
the dispatch's stated default — the imported binding is identical-shape
across files (compiler-generated boilerplate), so no per-module disambiguation
is needed. `_scrml_session_destroy` registers a single endpoint
(`/_scrml/session/destroy` POST); only one binding is needed.

The routes registry array (`const routes = [...]`) is also de-duplicated;
registering the same route binding multiple times is correctness-equivalent
(same path / method / handler) but wasteful.

**SPEC §47.12 added:** Server Entry Generation — Name De-duplication —
codifies the first-importer-wins contract and the routes-registry dedupe.

**Tests added** (`compiler/tests/integration/f-build-002-server-entry-dedup.test.js`,
7 tests): two modules with shared name → one import line; first-importer
wins; entry passes `node --check`; routes registry de-duplicates; WS handler
names also dedupe; no empty `import {}` for fully-duplicated modules;
disjoint-name regression coverage.

---

## F-SQL-001 — `?{}` boundary parsing failures emit `sql-ref:-1` placeholders that fail `node --check` (P0) — surfaced 2026-04-30 (S51, W0b smoke-test) — RESOLVED 2026-04-30

**Status: RESOLVED.** F-SQL-001 dispatch (T2 worktree, branch `worktree-agent-a3a8d6756b5a7af04`) replaced the defective regex `/\?\{[^}]*\}/g` in `compiler/src/expression-parser.ts` (lines 137 and 169) with a context-mode-stack scanner (`replaceSqlBlockPlaceholder`). The new scanner respects template-literal boundaries and JS-expression nesting inside `${expr}` interpolations.

**Root cause** (diagnosis: `docs/changes/f-sql-001/diagnosis.md`):
The dispatch's reference to `sql-ref:-1` was a slight mis-statement of the actual symptom. The real bug shape was: (a) the regex `[^}]*` non-greedy match stops at the first `}` (the inner `${}` interpolation's close brace), so any `?{...${expr}...}` template was truncated mid-stream; (b) acorn either parsed the residue as a single placeholder identifier (with the rest as silently-dropped trailing content + soft warning) or failed entirely (escape-hatch fallback). The `sql-ref:-1` sentinel exists in `expression-parser.ts:712` as a deliberate parser-stage marker (downstream codegen resolves it via `stmt.sqlNode`), not the bug itself.

**Fix shape (C):** ergonomic + hard-error (default per dispatch).
- **(A)** ergonomic: `replaceSqlBlockPlaceholder()` walks `?{...}` with a frame stack — opening `?{` enters JS-context (depth=1), `\`` enters template, `${` inside template enters nested JS-context, etc. Single-, double-, and template-quoted strings are respected (braces inside string literals don't affect depth).
- **(B)** hard-error: when the scanner reaches end-of-input with the outer JS-frame still open, `ParseResult.sqlDiagnostic` carries an E-SQL-008 diagnostic. `parseExprToNode` propagates this to an escape-hatch ExprNode with `sqlDiagnostic` attached. `safeParseExprToNode` (closure-scoped in `parseLogicBody`) and `safeParseExprToNodeGlobal` (in `parseAttributes`) push a TABError so the error surfaces in the standard compile error list.

**Test results:**
- `bun test`: 8329 → 8346 (+17 new tests, 0 regressions, 0 fail).
- Pre-fix `[scrml] warning: statement boundary not detected` count: 146 occurrences. Post-fix: 30 (all 30 are non-SQL pre-existing ASI cases; 19 unique SQL-related warning shapes eliminated).
- `examples/23-trucking-dispatch/pages/customer/home.scrml` no longer emits the F-SQL-001 boundary warning when compiled. (The page still fails for unrelated `E-SYNTAX-042` null-token errors — out of F-SQL-001 scope.)

**SPEC amendments:**
- §44.7 error table: added `E-SQL-008`. (E-SQL-007 is `?{}` in non-async context — already reserved.)
- §44.8 (NEW): "Parser: Bracket-Matched `?{` Scanner (F-SQL-001)" — codifies scanner semantics, failure mode (E-SQL-008), rationale.
- §8.6 master error table: E-SQL-008 added.
- `SPEC-INDEX.md`: §44 line range and summary updated.

**Test fixtures:** `compiler/tests/integration/sql-001-bracket-matched.test.js` (17 tests):
- 9 positive controls (simple, single interp, multi-clause + IN, JOIN + multi interp, subquery, .get(), bare, multiple, single-quoted with braces).
- 2 parseStatements multi-statement bodies.
- 4 E-SQL-008 hard-error cases (no matching `}`, unterminated backtick, unmatched `${`, escape-hatch surfaces sqlDiagnostic).
- 2 end-to-end compilation tests (no SQL boundary warnings on the previously-broken patterns).

**Files touched:**
- `compiler/src/expression-parser.ts` — scanner + diagnostic plumbing.
- `compiler/src/ast-builder.js` — TABError integration in safeParseExprToNode + safeParseExprToNodeGlobal.
- `compiler/SPEC.md` — E-SQL-008 in two error tables; new §44.8.
- `compiler/SPEC-INDEX.md` — §44 line range + summary.
- `compiler/tests/integration/sql-001-bracket-matched.test.js` — new fixture file.
- `examples/23-trucking-dispatch/FRICTION.md` — this RESOLVED note.

---

## F-NULL-003 — bare `null` / `undefined` literals in value position silently pass §42.7 (P1) — surfaced 2026-04-30 (S51, W3 follow-on) — RESOLVED 2026-04-30 (W3.1)

**Status: RESOLVED.** W3.1 (paired W3.2 dispatch, branch `changes/f-null-003-004`) added a `forEachLitNull` walker to `compiler/src/gauntlet-phase3-eq-checks.js`. The walker emits E-SYNTAX-042 on every `lit{ litType: "null" | "undefined" }` (and `ident{ name: "null" | "undefined" }`) reachable from any exprNode in the AST.

**Suppression rules implemented:**
- Direct lit-null operands of binary `==` / `!=` / `===` / `!==` are skipped (handled by `checkEqNode` — not double-emitted).
- Direct lit-null operands of binary `is-not` / `is-some` / `is-not-not` are skipped (synthetic — generated by parser desugar, not real source tokens).

**Tests added** (`compiler/tests/unit/gauntlet-s19/null-coverage-bare.test.js`, 26 tests): per-position negative coverage (declaration init, return, object prop, array element, ternary branch, assignment RHS), plus suppression and positive controls.

**SPEC §42.7 amendment:** added explicit enumeration of bare value-position literal as category (2) of E-SYNTAX-042 rejection.

**Cascade discovered & fixed (within W3.1+W3.2):**
- `benchmarks/todomvc/app.scrml`: `@editingId = null` (3 sites) → `= not`.
- `compiler/tests/unit/fn-expr-member-assign.test.js`: 3 fixtures using `null` as placeholder for object-slot or array-slot before reassignment to a function → `not`. (Semantically equivalent placeholder.)

The dispatch-app pages (plan-B-parked) still use bare null patterns; those will surface E-SYNTAX-042 if/when the parking is lifted, as expected.

---

## F-NULL-004 — `${...}` interpolation in attribute string-literals silently passes null comparisons (P1) — surfaced 2026-04-30 (S51, W3 follow-on) — RESOLVED 2026-04-30 (W3.2)

**Status: RESOLVED.** W3.2 (paired W3.1 dispatch, branch `changes/f-null-003-004`) implemented option (b) — the tactical re-parse — in `compiler/src/gauntlet-phase3-eq-checks.js`:

1. New `extractTemplateInterpSegments(raw)` scans an attribute string-literal value's raw text for `${...}` segments, correctly handling nested braces (depth counter).
2. In `inspectAttrs`, when an attribute value has `kind: "string-literal"`, each extracted segment is parsed via `parseExprToNode` (the existing public expression-parser entry).
3. The resulting exprNode is fed back through `inspectExprNode` — both the equality detector (W3) and the bare-null detector (W3.1) run on the parsed segment.

**No AST shape change** — the markup AST `string-literal` value remains as-is. The re-parse is local to GCP3 stage.

**Tests added** (`compiler/tests/unit/gauntlet-s19/null-coverage-template-interp.test.js`, 13 tests): equality null in attribute interp, bare null in attribute interp, multiple interps in one attribute, diagnostic quality, positive controls (`is some`, plain interp, static attr), edge cases (empty interp, nested braces).

**SPEC §42.7 amendment:** added explicit category (3) for `${...}` interpolation segments inside attribute string-literals.

**Limitation noted:** because `parseExprToNode` is invoked with `offset=0` (the W3.2 layer doesn't have a precise source-relative offset for the segment within the attribute value's raw text), the diagnostic span falls back to the attribute's `value.span` for line/col rather than the precise `${...}` position. This is acceptable diagnostic quality (line still resolves correctly to the attribute line) and is pinned by the diagnostic-quality test.

---
