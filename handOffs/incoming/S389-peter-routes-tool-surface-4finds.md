# ROUTE → bryan (S389-peter): 4 findings from the §64 tool + error-state/enum dog-food (flogenceP)

All PA-confirmed by execution on HEAD. Found dog-fooding a surface aM never exercises. Routed as a
consolidated batch (Peter's call — the HIGH carries a §52.4 design check, and the tool-codegen ones are
§64 language-machinery). Each is root-traced with a fork/fix direction; none is fixed here.

---

## 1. `@cell = fn() !{ arms }` (failable cell-load) → fire-and-forget IIFE → stale read + dead error-arm return (HIGH, silent-wrong)

A cell-assigned FAILABLE call lowers to `(async () => { … })().catch(_scrml_error_boundary_log)` with
**no `await`**, and the statements AFTER it are left OUTSIDE the IIFE. So:
```scrml
@fleet = loadFleet() !{ | ::SQLError e :> { @phase = .Failed(e.message); return } | _ e :> { … return } }
@needsAttention = @fleet.length   // runs SYNCHRONOUSLY, against the STALE (pre-fetch) @fleet
@phase = .Ready
```
**PA-confirmed by execution** (`scratchpad/tool-dogfood/t2/refresh.scrml` + `run-refresh.mjs`, mirrors
flogenceP `app.scrml refresh()`): happy-path write order is `needsAttention=0 · phase="Ready" ·
fleet=[2 items]` → `@needsAttention` is **0**, computed over the still-empty initial `@fleet` (expected
2). Two silent consequences: (a) any post-assign read of `@cell` gets the pre-fetch value — in the real
cockpit the "N need attention" header (`app.scrml:1953/2017/2318`, rendered :2966) is **permanently 0**;
(b) the error-arm `return` returns only from the IIFE, so `@phase=.Ready` + `setTimeout(hydrate,0)` run
anyway on a load failure. **Contrast:** a bare/const failable (`ensureSchema() !{…}`) is `await`ed
inline in the same fn (`refresh.client.js:115`), and its `return` aborts correctly — only the
CELL-ASSIGNMENT target is fire-and-forget. **Root:** `emit-client.ts:3386-3423` (the cell-assigned
`!{}` rewrite: `(async()=>{…})().catch()`, continuation left outside per its own :3400 comment).
**Fork:** A = sequence the continuation (await the IIFE, or hoist following statements inside it) so the
error-arm `return` is live and reads see the resolved cell — PA lean, and the presence of `!{}` arms
with `return` implies CPS sequencing is intended. B = if §52.4 immediate-local-landing must be
preserved for a cell-assign, then this form should be REFUSED/diagnosed rather than silently mis-order.
**The one-line ruling owed:** does a cell-assigned `!{}` `await` (A) or is the fire-and-forget landing
intended and the form refused (B)? ⚑ **Related family (converge, not separate fixes):**
`g-reactive-write-member-server-call-no-autoawait` (S267, `@cell = fn().field` unawaited) and
`G-HANDLER-RECOVERY-INTO-CELL` (S236) are the same fire-and-forget-cell substrate — this is the `!{}`
+ continuation-sequencing facet.

## 2. `match` in a non-async `fn` in `<program kind="tool">` → `await` emitted in a non-async function → runtime crash (MED-HIGH, clean-compile → crash)

`fn roleLabel(role) { match role { … } }` in a tool emits
`function roleLabel(role) { return await (async function() { … })(); }` — **`await` in a non-async
function** → `ReferenceError: await is not defined`, exit 1. **PA-confirmed** (`tool-simplematch.scrml`,
0 errors, emit shows `return await (async function()`). The PAGE/client path emits a **synchronous**
IIFE for the same match (`return (function(){…})()`), so this is TOOL-codegen-specific. Every tool that
uses `match` in a helper `fn` crashes — the surface is un-dogfooded because the real flogenceP tools
express all branching via `_={ … ? … : … }=` foreign blocks instead. **Fork:** make the tool-context
match emitter mark the wrapping fn `async` (or emit the sync IIFE the page path uses when the arms are
sync). Likely the SAME root as #3 (the tool-context match emitter is a separate, incomplete path).

## 3. Payload-variant positional bind in a tool-context `match` → "cannot positionally bind" → undefined binder (MED, clean-compile → crash / silent drop)

`match p { .FileLine(pa, ln) :> \`${pa}@${ln}\` }` in a tool emits
`if (_scrml_tag === "FileLine") { /* §1a: cannot positionally bind 'pa' — variant 'FileLine' field
order unknown */ … = \`${pa}@${ln}\`; }` → `ReferenceError: pa is not defined` (or, if the arm doesn't
use its binders, the payload is silently DROPPED). **PA-confirmed** (`enum-match.scrml`,
`tool-inmain.scrml`, 0 errors, emit carries the "cannot positionally bind" comment). The PAGE path binds
correctly (`const pa = _match.data.path; const ln = _match.data.lineNo`), so the TOOL codegen has lost
the enum field-order table. **Fork:** thread the enum field-order table into the tool-context match
emitter (mirror the page path). ⚑ **Likely the same incomplete tool-match emitter as #2 — one arc, not
two patches.**

## 4. Inline `_={ … }=` value block whose single expr has a depth-0 `.return` → no injected return → `undefined` (MED, silent-wrong)

A value-position foreign block whose single expression is a member access named `.return`
(most notably an iterator/generator `.return()`) yields `undefined`:
```scrml
const res = _={ in: { g } g.return(99) }=   // res === undefined; expected {value:99,done:true}
```
**PA-confirmed** (`scratchpad/tool-dogfood/t1/r3b.scrml`, 0 errors): emit is
`const res = await (async (g) => { g.return(99) })(g)` — **no injected `return`**. Control `g2.next()`
correctly emits `return (g2.next())`. **Root:** `emit-logic.ts:3095` in `scanForeignSliceShape` — the
top-level `return`-keyword discriminator uses `!isWord(src[i-1])`, and `.` is not a word char, so a
member `.return` (and `?.return`) reads as the `return` keyword → flips `singleExpression` false → the
slice is spliced verbatim with no injected return. **Violates §23.2.4a rule 1** (single-expression slice
gets an injected return). **Fix (compute):** in the depth-0 `return` match, additionally require the
preceding non-ws char is not `.` (exclude member-access `.return`/`?.return`). No change to what
compiles/is refused/means. ⚑ Same scanner (`scanForeignSliceShape`) as the filed
`g-multi-statement-foreign-block-in-statement-position` (#68) and `g-foreign-multistmt-value-block-mislowers`
(#6973) — a third distinct trigger in that one function; worth hardening the scanner's tokenization
(string/comment/member-access awareness) once rather than per-trigger.

---

Gaps filed: `g-failable-cell-load-fire-and-forget-stale-read-dead-return` (HIGH),
`g-tool-context-match-emits-await-in-non-async-fn` (MED), `g-tool-context-match-loses-enum-field-order`
(MED), `g-foreign-value-block-dot-return-misread-as-keyword` (MED). Repros in
`scratchpad/tool-dogfood/{t1,t2}/`.
