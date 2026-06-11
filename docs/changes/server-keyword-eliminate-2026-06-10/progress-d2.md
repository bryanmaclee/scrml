# D2 progress — two new server-escalation triggers (channel-cell-write + reserved-name `handle`)

Change-id: server-keyword-eliminate-2026-06-10 (dispatch D2 of 5)
Worktree: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a6e5d85f656435721

## 2026-06-10 — Startup verification
- pwd == worktree root; git rev-parse --show-toplevel matches; tree clean.
- `git merge origin/main` → Already up to date (HEAD 6e83b3dc).
- `bun install` OK (204 packages). `bun run pretest` OK.
- Baseline `bun run test`: first run 23778 pass / 2 fail (FLAKY — parallel-test/shared-temp-DB
  ordering), clean re-run 23779 pass / 221 skip / 1 todo / 0 fail. Baseline = 23779/0 (flaky 2-fail
  noted; not in scope).

## Phase 0 — SURVEY-CONFIRM (findings + predicate corrections)

### 1. Escalation-reason model (route-inference.ts)
- EscalationReason union @ :89-92: `protected-field-access` | `server-only-resource` | `explicit-annotation`.
  (Doc header @ :27-30 mirrors.)
- Per-function direct triggers computed @ Step 3 (:2406-2445): explicit-annotation (isServer) @ :2410-2416,
  body triggers via `walkBodyForTriggers` @ :2422. `directTriggers = [...explicit, ...body]` @ :2431.
- isServer derived from `directTriggers.length > 0` (+ Step-5b capture-taint / Step-5c caller-context).
- DECISION: add TWO NEW reason kinds (per brief's preference) — `channel-broadcast` and `middleware-handle`.
  Cleaner for diagnostics (W-DEPRECATED-SERVER-MODIFIER) + I-FN-PROMOTABLE skip than folding into
  server-only-resource.

### 2. Channel AST shape (CONFIRMED, infra already present)
- Channel = markup node `tag === "channel"`. Body fns reachable via `n.children` + nested `logic.body`.
- `collectChannelFunctionMap(nodes)` (emit-channel.ts:408) → Map<fnName, channelName> for STANDALONE
  `function-decl`s lexically inside a `<channel>` body (NOT onclient:/onserver: attribute handlers — those
  are channel ATTRIBUTES, not function-decl children). EXACT predicate Trigger 7 needs for "standalone fn
  in channel scope."
- `collectChannelCellMap(nodes)` (emit-channel.ts:456) → Map<channelName, Set<cellName>> via
  `extractSharedVars` (:357) = V5-strict `<x>=init` state-decls (structuralForm/isShared) inside the channel.
  EXACT predicate for "channel-DECLARED cell."
- Both ALREADY built per-file in RI Step 2d (:2369-2377: perFileChannelFnMap / perFileChannelCellMap).
- Write detection: `extractReactiveAssignmentCellName(node)` (:1335) extracts the LHS @cell name from a
  state-decl OR bare-expr `@x = ...` (structured assign exprNode w/ op "=" preferred; regex fallback).
  Reuse for "write to a channel cell." REA...
- broadcast/disconnect: a call expr `broadcast(...)` / `disconnect()` in the fn body. Detect by scanning
  the body's expr strings/exprNodes for those call names.
- §38.4:18510 confirms client-ORIGINATED writes also legal (server-side router for client writes); channel
  bodies hold onclient:/onserver: ATTRIBUTE handlers → over-fire guard: scope Trigger 7 to standalone
  function-decls only (which collectChannelFunctionMap already does — it only walks function-decl kinds).

### 3. Middleware handle detection (CONFIRMED + predicate CORRECTION required)
- `isHandleEscapeHatch` flag set @ ast-builder.js:9582: `isServer && !isGenerator && name === 'handle'`.
  CURRENTLY GATES ON isServer → the keyword dependency to break.
- Weaver keys on the FLAG: emit-functions.ts:930 (skip client body), emit-server.ts:438 (find handle node).
- E-MW-005/006 key on the FLAG (ast-builder.js:14280/14305) — NOT on the keyword directly. E-MW-003/004
  are spec-documented but not separately enforced in source (they ride the flag/weave).
- CORRECTION (over-fire guard, LOAD-BEARING): removing the `isServer` gate with NAME-ONLY recognition
  OVER-FIRES on real corpus:
    * samples/compilation-tests/.../phase2-partial-match-all-covered-042.scrml:5 → `function handle()` (0 params)
    * samples/compilation-tests/.../phase4-event-logic-wrapper-028.scrml:3 → `function handle(e, tag)` (2 params, wrong names)
  Both are NON-middleware. To recognize `handle` WITHOUT the keyword and NOT over-fire, the predicate must
  add the §39.3.2 SIGNATURE shape: exactly 2 params named `request` + `resolve`. Both counter-examples are
  excluded by name. This is the right answer (Rule 3) — tighten recognition, don't loosen it.

### Plan
- Trigger 8: change ast-builder.js:9582 `isHandleEscapeHatch` to name+signature (drop isServer gate),
  add `middleware-handle` reason in RI Step 3 when fnNode.isHandleEscapeHatch.
- Trigger 7: in RI Step 3, after channel maps built, if fnNode is channel-owned AND body writes a channel
  cell OR calls broadcast/disconnect → add `channel-broadcast` reason.
- SPEC: §12.2 +T7/+T8 + Trigger-4 note; §38.6 relax "server-annotated"→"any fn in channel scope";
  §39.3.2 handle amendment; verify W-DEPRECATED-SERVER-MODIFIER fire condition.

## 2026-06-10 — Implementation COMPLETE

### Trigger 8 (handle) — DONE
- ast-builder.js:9588 `isHandleEscapeHatch` now name+signature-based (drop isServer gate):
  `!isGenerator && name==='handle' && params.length===2 && params[0].name==='request' && params[1].name==='resolve'`.
  Over-fire-excludes corpus `function handle()` / `function handle(e,tag)`.
- RI Step 3: `middleware-handle` reason added when isHandleEscapeHatch. Route map surfaces
  deduped reasons. D4 (dead-warn) still skipped for handle; D5 (W-DEPRECATED) now RUNS →
  keyword-bearing handle fires W-DEPRECATED-SERVER-MODIFIER (§39.3.2 amendment).
- Tests: middleware-handle.test.js (keyword-less handle IS escape hatch + 2 over-fire guards +
  end-to-end weave MW-HANDLE-001b); handle-middleware-ri.test.js (RI-HANDLE-006 boundary:middleware +
  middleware-handle reason + no false W-DEPRECATED; RI-HANDLE-002/004 updated for D2).

### Trigger 7 (channel) — DONE
- `channel-broadcast` reason; `detectChannelBroadcastReason()` (route-inference.ts) scans a
  channel-owned fn body for (a) write to a channel-declared cell, (b) broadcast()/disconnect() call.
  Gated on perFileChannelFnMap (Step 2d) so attr-handlers / fn / non-channel fns excluded.
  Reads do NOT escalate; no nested-fn descent.
- Tests: channel-broadcast-escalation-trigger7.test.js (6) — §1 cell-write escalates, §2 broadcast
  escalates, §3 read-only does NOT, §4 non-channel unaffected, §5 keyword-parity, §6 onclient unaffected.

### SPEC amendments — DONE
- §12.2 +Trigger 7 +Trigger 8 + Trigger-4 note ('1,2,3,5,6,7,8 cover every case').
- §38.4 cross-ref Trigger 7; §38.6 relax 'server-annotated'→'any function in channel scope'
  (E-CHANNEL-004 UNCHANGED).
- §39.3.2 handle: inferred by reserved name+signature, keyword no longer required, fires W-DEPRECATED.
- §34 W-DEPRECATED-SERVER-MODIFIER row: +T7/T8 reasons. NO new codes.
- SPEC-INDEX regenerated (53 rows, 0 missing) + D2 header note.

### Tests + R26 — GREEN
- Full suite: 23790 pass / 0 fail (baseline 23779; +11 new/updated tests).
- trucking-dispatch baseline: +W-DEPRECATED-SERVER-MODIFIER:19 (4 channel publishers ×
  CHX-inline at cross-file consumers; corpus UNCHANGED).
- R26 (7 adopters: 20-middleware, 15-channel-chat, 08-chat, r13/r14 go-api-service +
  react-auth-dashboard): FATAL errors IDENTICAL base↔fix (no emission regression). ONLY delta =
  expected W-DEPRECATED increase on keyword-bearing handle/channel publishers
  (handle / postMessage / etc.). 08-chat (no keyword publishers) unaffected → no over-fire.

### Predicate corrections made
- Trigger 8 recognition: changed from NAME-ONLY (brief's "same predicate the weaver uses") to
  NAME+SIGNATURE (request,resolve), because name-only over-fires on 2 real corpus `function handle`
  declarations. Tightening, not loosening (Rule 3).
