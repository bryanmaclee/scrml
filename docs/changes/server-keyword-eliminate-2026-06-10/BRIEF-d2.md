# D2 BRIEF (archived verbatim per S136) — dispatched S180 2026-06-10, base HEAD 6e83b3dc

agent: scrml-js-codegen-engineer · isolation: worktree · run_in_background: true · agentId a6e5d85f656435721
(dispatched in PARALLEL with D1 — file-disjoint: D1=emit-client/mcp-descriptors/type-system; D2=route-inference+SPEC)

TASK: Add two new §12.2 server-escalation triggers so channel publishers + middleware handle() infer
server placement WITHOUT the deprecated `server` keyword. NO corpus change, NO keyword stripping (D4).

PHASE-0 SURVEY-CONFIRM GATE first (reason model · channel AST shape · middleware handle detection),
agent authorized to correct predicates.

Trigger 7 — channel-cell-write escalation: a standalone `function` DECL within a `<channel>` lexical
  scope whose body WRITES a channel-declared cell OR calls broadcast()/disconnect() → server (new reason
  `channel-broadcast`). OVER-FIRE GUARDS: scope to channel-body function DECLS only (not onclient:/
  onserver: attribute handlers, not fn, not reads, not non-channel fns). §38.6 relax (broadcast available
  to any channel-scope fn; the call is the escalation signal). Fire NARROWER when uncertain.
Trigger 8 — reserved-name handle escalation: the compiler-recognized middleware handle(request,resolve)
  escalates by name (§40.3 already weaves by name; keyword is belt-and-suspenders) → server (new reason
  `middleware-handle`). §39.3.2 amend: "server keyword required" → "inferred by reserved name". Verify
  weaver + E-MW-003/004 don't gate on keyword.

SPEC: §12.2 +Trigger 7+8 + update the Trigger-4 "covers every case" claim to include 7,8; §38.4/§38.6
  cross-ref + relax; §39.3.2 handle amend; §34 no new codes expected (verify W-DEPRECATED-SERVER-MODIFIER
  now fires on keyword-bearing channel/handle). regen-spec-index if ranges shift.

Tests (both triggers + ALL over-fire guards) + R26 (channel-chat / trucking channels / middleware /
go-api-service: keyword-present unchanged; keyword-removed now escalates). Full bun run test green.

Full F4 + S99/S126 + MAPS + commit-discipline + progress-d2.md in dispatched prompt. Maps d70f6bd8/main 6e83b3dc.
