# request-id-render-bridge-2026-06-22 — progress

change-id: request-id-render-bridge-2026-06-22
bug: g-request-id-render-bridge-unwired (HIGH)
base: main acec6c10 ; worktree HEAD ca712295 (moved per S213 landings)
worktree: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a7ebad43cb09db70f
pre-commit-gate baseline (clean): 17538 pass / 68 skip / 1 todo / 0 fail / 966 files

## Phase 0 — scope finding (clean bridge, NOT architectural)

The fix is a CLEAN BRIDGE, not architectural. Three lowering seams + a reactivity
primitive already present in the runtime (_scrml_deep_reactive).

### Root cause (confirmed by reproducer, worktree HEAD)
A <#id> markup ref is parsed UNCONDITIONALLY into an input-state-ref ExprNode
(expression-parser.ts:329, :1712-1715) with no knowledge of whether id names a
<request> (par 6.7.7) or an input-state element (par 36). All three lowering seams
emit the par 36 registry lookup _scrml_input_state_registry.get("id"):
  1. emit-expr.ts:1957 emitInputStateRef (structured node — the interpolation path)
  2. emit-expr.ts:529-533 emitIdent bare _scrml_input_<id>_ recovery (TAB-preprocessed)
  3. rewrite.ts:544 rewriteInputStateRefs (string pipeline)
The request never .set("id", ...) into that registry, so the read is undefined.

rewriteRequestRefs (rewrite.ts:500, Pass 6) WAS the intended bridge (rewrites
<#id>.loading|data|error|stale|refetch -> _scrml_request_id.<m>) but it only runs on
the STRING pipeline; the structured-AST interpolation/if=/match-on= path never reaches
it. So ${<#id>.data} hits seam 1, not the string rewriter.

### Three additional defects found
- _scrml_request_<id> is a PLAIN object; mutating .data/.loading triggers no effect
  re-render (no reactivity). Bridging alone would still not re-render.
- The binding-effect-wrap decision keys on varRefs.length > 0 (@var refs only); a
  request-ref produces NO @var, so ${<#id>.data} falls to the non-reactive one-shot
  path (binding dropped/static).
- _scrml_notify(id) is emitted 4x by emitRequestNode (url= and api=) but DOES NOT
  EXIST in runtime-template.js — a latent ReferenceError on fetch resolve.

### Chosen fix shape — CLEAN BRIDGE
1. Make _scrml_request_<id> reactive via the existing _scrml_deep_reactive(...) Proxy
   (runtime-template.js:2973) — reads inside _scrml_effect auto-track at property
   granularity; .data=/.loading=/.error= writes auto-trigger. Drop the dead
   _scrml_notify(...) calls (the Proxy set-trap replaces them).
2. Thread the set of <request> ids to codegen; route <#id> refs whose id is a request
   to _scrml_request_<id> in all three seams (emitInputStateRef, emitIdent recovery,
   rewriteInputStateRefs); keep par 36 input-state lowering UNCHANGED for non-request
   ids (render-once non-reactive by design, par 36.6).
3. Recognize a request-ref as a reactive dep so the binding takes the effect-wrapped
   path (interpolation / if= / match-on=).

Keeps par 36 render-once semantics intact (only <request> ids become reactive).

## Log
- Phase 0 complete; scope = clean bridge. Beginning impl.

- Seam 1 DONE (commit f144d7b1): _scrml_request_<id> = _scrml_deep_reactive({...}); dead
  _scrml_notify removed; deep_reactive chunk pulled on <request> (CHUNKED_MARKUP_TAGS + walk).
- Seam 2+3 (interpolation) DONE: collectRequestIds(fileAST) added to reactive-deps.ts;
  EmitExprContext.requestIds routes emitInputStateRef + emitIdent bare-recovery to
  _scrml_request_<id>; EmitLogicOpts.requestIds + _makeExprCtx forward; threaded through
  emit-reactive-wiring emitOpts + if/for/while/do-while opts reconstructions (which had
  dropped mapVarNames too) + the nested else-if _makeExprCtx({}) latent bug (now bodyOpts).
  emit-html exprHasRequestRef marks the binding hasRequestRef (matches BOTH <#id> AND the
  TAB-lowered bare _scrml_input_<id>_ form — KEY: by codegen the expr is already
  _scrml_input_feed_.data, not <#feed>.data). emit-event-wiring forces the _scrml_effect
  path on hasRequestRef + threads requestIds. binding-registry LogicBinding +hasRequestRef.
  VERIFIED: `<div>${<#feed>.data}</>` + `<request id="feed" url="/api/feed">` emits
  `_scrml_render_value(el, _scrml_request_feed.data)` + `_scrml_effect(...)` (reactive).
- NEXT: the if=/lift-block condition form + <match on=<#id>.data>.

- match on=${<#id>.data} DONE: resolveOnExpr (emit-match.ts) Shape-B complex
  fall-through now threads collectRequestIds(fileAST) into emitExpr ctx → on= routes
  to _scrml_request_<id>.data; dispatch already _scrml_effect-wrapped (Proxy auto-tracks).
  VERIFIED: block-form `<match for=Phase on=${<#feed>.data}>` emits
  `_scrml_effect(() => __dispatch(_scrml_request_feed.data))`.
- E-SCOPE-001 exemption (type-system.ts visitAttr): a lowered `_scrml_input_<id>_`
  ref in an unquoted if=/show= attr no longer false-fires E-SCOPE-001 (it resolves at
  codegen to _scrml_request_<id> / the §36 registry, never a user binding).
- SURFACED (separate parse-level bugs, NOT codegen render-bridge — see report):
  (a) `if=<#id>.member` DROPS the `.member` at tokenize time — the attr value parses as
      `{kind:"variable-ref", name:"_scrml_input_feed_"}` with NO `.loading`/`.data`. So
      `if=<#id>.loading` lowers to a bare base read (reads the wrong thing). Tokenizer/
      attr-value bug, independent of the render bridge.
  (b) `${<#id>.data}` NESTED inside a lifted element (`lift <h1>${<#id>.data}</>`) inside
      a markup-if-block mangles `_scrml_input_feed_` → `crml_input_feed_` (clips `_s`).
      Lift-path string-rewrite bug.
  (c) the bare `if (<#id>.loading) { lift }` markup-if condition (emit-lift path) reads
      the §36 registry, not _scrml_request_<id> — emit-lift.js condition lowering does
      not thread requestIds (the string rewriteRequestRefs ordering should cover it, but
      the lift path mangles before reach).

- if=<#id>.member PARSE FIX DONE (was: brief item (a)):
  (1) block-splitter.js scanAttributes — `hashRefAngleDepth` so a `<#id>`'s embedded
      `>` in an UNQUOTED attr value is not read as the opener terminator (the `.member`
      survives into attrRaw). Analogue of §4.13 shorthandAngleDepth.
  (2) tokenizer.ts tokenizeAttributes — the standalone `<#name>` ATTR_IDENT branch now
      consumes the trailing `.member.chain` (was: dropped it; only `.send(` handled).
      ATTR_IDENT becomes `_scrml_input_<id>_<.member.chain>`.
  (3) emit-event-wiring.ts if= mount-toggle controller — a varName `_scrml_input_<id>_`
      whose <id> is a request id routes to `_scrml_request_<id>.<path>` (reactive Proxy);
      non-request ids fall through to the prior reactive-cell form (§36 unchanged).
  VERIFIED: `if=<#feed>.loading|.error|.data` → `_scrml_effect`-wrapped controller reading
  `(_scrml_request_feed.loading|.error|.data)`. Input-state `if=<#cursor>.pressed` now
  PRESERVES `.pressed` (was dropped) — strictly better; §36.6 render-once form unchanged.
  Unit 14906/0, conformance+integration 2632/0 local.
- REMAINING SURFACED (separate, NOT codegen render-bridge):
  (b) `${<#id>.data}` NESTED in a lifted element + the bare markup-`if (<#id>) { lift }`
      condition: emit-lift path mangles `_scrml_input_<id>_` (clips `_s`) AND the lift-if
      condition reads the §36 registry. emit-lift.js does not thread requestIds; the lift
      string-rewrite has a separate `_s`-clip. The `${...}`-wrapped lift form is the §6.7.7
      canonical shape — SURFACE to PA as a follow-on (lift-path, distinct seam).

- const <x> = <#id>.data MODULE-INIT ORDERING FIX DONE (brief item 4):
  emit-reactive-wiring.ts hoists `var _scrml_request_<id> = _scrml_deep_reactive({...})`
  to BEFORE top-level logic (a pre-pass using classifyMarkupNodes().requestNodes +
  extractRequestId). The late Step-5c emit no longer redeclares the var (collapsed to a
  comment) — keeps the SAME deep-reactive proxy so effect subscriptions stay valid; the
  fetch fn + seq/mounted + invocation stay late. VERIFIED: `${ const <snapshot> =
  <#feed>.data }` emits `var _scrml_request_feed = _scrml_deep_reactive(...)` (hoisted)
  THEN `const snapshot = _scrml_request_feed.data` — no `undefined.data` module-init throw.
  Request tests 11/0; interp+match+if= all green + valid JS.
