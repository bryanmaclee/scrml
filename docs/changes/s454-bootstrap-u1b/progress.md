# s454 bootstrap U1b — progress (append-only)

start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a4f8638bf1914ccea
base: 859f60f79 (contains #1295 b13fd9064, #1298 96751008d)

## Baseline (base 859f60f79)
- `bun test ./compiler/self-host-v2/` — 1917 pass / 1 todo / 0 fail (56 files).
- `bun scripts/bootstrap-conformance.ts` — 1312 attempted: PASS 121 · CODES-ONLY 0 · FAIL 48 · NOT-TWINNED 514 ·
  UNSUPPORTED 629 · CRASH 0 (per-case JSON kept in .tmp/counter-before.json for the before/after diff).

## Map
- `.claude/maps/primary.map.md` (stamp 7ce905ac2) — LOAD-BEARING for one fact: "the bootstrap's write / placement /
  binder rules read ONE effect summary per callable … add a new transitive fact as a summary DIMENSION, not a new
  walker". U1b's transitive questions (async colour, Trigger-5 inheritance, client caller of a helper) are summary
  queries; the per-site position plan is not transitive. The routing rows say nothing else about self-host-v2.

## Governing text read in full
SPEC §19.9.10 (as amended by #1298), §19.9.5, §19.4.3, §19.5.3, §13.7, §57.8; design Items 1-5; user-voice §S454.

## [U]/[I] markers checked against source (before building on them)
- [U] design §2.2 "a body-top statement … when a body-top block exists in the bootstrap" — FALSIFIED as a position:
  the bootstrap AST has no body-top statement (AItemK = Import/Type/Fn/Decl/Markup/Program; no statement item). The
  position does not exist, so nothing is lowered or refused for it.
- [U] OQ1 "is `return` legal in an event-handler body" — settled by SPEC (#1298 quotes §5.2.3); in the bootstrap a
  braced handler is a block parsed by the statement grammar (handlerBlock → lowerBlock), so `return` parses there.
- [I] design §1.0 "fetch has none [deadline] by default" — superseded by S454 F3 (the runtime SHALL apply a deadline).
- [R-checked] C1 claims: `suspend` runs `k` untracked, NOT batched, and re-throws a rejection on a live task — TRUE
  (runtime.js `suspend`). `on` runs the handler as one batch — TRUE. Codec (#1295) `decodeError` exists, unused — TRUE.
- [R-checked] "the summary has `places`/`waits`" — TRUE; placement has NO Trigger 5 at all (direct + ambient→client by
  client reach only) — U1a's own note "U1b refusal over-reach … §12.2 T5" confirms. Trigger 5 is built here.
- [I] design 3.2 "Malformed.reason … the codec never echoes a whole foreign value" — codec `show()` bounds strings to
  40 chars and never prints an object/array body; keys through keyText (bounded). Verified by reading runtime.js show/keyText.

## SPEC-vs-design conflicts (SPEC wins)
- Design §1.0 "No timeout variant … fetch has none by default; if a deadline is ruled later, `TimedOut` is added".
  SPEC §19.9.10 (S454): "The client runtime SHALL apply a deadline to every client call of a server function. A call
  that has not produced a response when its deadline passes SHALL fail with `Unreachable` — there is no separate
  timeout variant". → built: a deadline, exceeding it is `Unreachable`.
- Design §1.6 F5 (a): "at a site that turns out server→server a `.Transport` arm is dead (reported like E-ERROR-013's
  dead handler)". SPEC: "When the callee is not declared `!`, the whole handler is attached to a call that cannot fail
  and is **E-ERROR-013**. When the callee is declared `!`, only the `.Transport` arm is dead; it SHALL be reported as
  dead handling in the manner of E-ERROR-013 (the message names the callee and says the call is server→server)."
  → built per SPEC: whole handler E-ERROR-013 for a non-`!` callee; the `.Transport` arm reported (code E-ERROR-013,
  message names the callee + server→server) for a `!` callee.
- Design §2.2 "a function NAMED as a value → E-ASYNC-FN-ESCAPES-AS-VALUE when the function waits". The bootstrap
  refuses EVERY function value already (E-BOOTSTRAP-UNSUPPORTED, "function values arrive with a later slice"); a `!`
  one is E-ERROR-002. Kept (fail closed, a superset); not a SPEC conflict.

## Plan (what is built where)
- analyze phaseA: built-in `ServerCallError`; per own-server-triggered callee its remote failure enum (`E + Transport`
  minted per declared enum, `E` itself when it declares `Transport(t: ServerCallError)`, one shared `Transport` for
  non-`!` callees); FnInfo.serverOwn (§12.2 T1/T4, syntactic — the design's phaseA own-trigger fact).
- binder: a call of a serverOwn callee is judged by its SITE: an own-triggered server caller = server→server
  (unchanged local rules); a handler / effect = remote; a function body with no own trigger = PENDING, decided in
  rulesPass from the whole-program placement (F5 a). E-ERROR-016 at a remote site.
- summary: Trigger-5 inheritance (greatest fixpoint over the reference graph; a client position or a construction /
  formula reference disqualifies); `waits` edges of an inherited function cut (its calls are in place).
- a post-summary SUSPENSION PLAN (per site, not transitive): which call sites suspend (remote handled forms, calls
  of waiting client functions), position verdicts (refusals named), and the binder-minted Syms lower needs (outcome,
  join, ANF temps).
- lower: Expr.ServerCall / Failable.FSettled / Stmt.Suspend+Attempt / Join+Jump (CPS pass), Fn.waits.
- check: C-S3 (+ T5 re-derived from Core), C-S7, C-S8, C-E1/C-E2 extended, C12 widened.
- print + runtime: rt.call (deadline, Item-3.2 classification, never rejects), suspend in batch + one reporter,
  handler tasks, waiting functions return a Promise; the client artifact of a program with server functions.

## S1 — DONE (ServerCallError, the client-call failure enums, E-ERROR-016)
- analyze `builtinTypeDecls` + `builtinTyped`: the built-in `ServerCallError` = `Unreachable` · `Refused(status: int)`
  · `ServerFault(status: int)` · `Malformed(reason: string)` (§19.9.10 S454). A user `type ServerCallError` is
  E-BOOTSTRAP-REDECLARE (the `SqlError` precedent; "the developer SHALL NOT redefine it"). `renders` NOT modelled —
  the bootstrap AST has no `renders` on a variant (same as SqlError), and no bootstrap surface displays one (no
  `<errorBoundary>` / `<formFor>`). OWED with the boundary unit; flagged in the report.
- FnInfo += `serverOwn` (§12.2 T1/T4, syntactic, phase A — the design §2.5 own-trigger fact) and `rerr` (the remote
  failure enum). `remoteEnums` (phase A, after the functions): per declared enum ONE minted `E + Transport` (E's
  variants first, same indices, fresh Syms; then `Transport(t: ServerCallError)`), `E` itself when it declares exactly
  `Transport(t: ServerCallError)` ("that variant IS the wrapper"), ONE shared `Transport` enum for every non-`!`
  callee; `not` (and E-ERROR-016 at the client site) for a `Transport` of another payload or none. Minted enums live
  in the built-in file, so Core ships one only when it names it.
- E-ERROR-016 (`transportConflict`), at the client call site; message names f, its enum and `(t: ServerCallError)`.
  The bootstrap's code; `severity.scrml` regenerated (`bun scripts/gen-bootstrap-severity.ts`) — "E-ERROR-016 — no §34
  row" (fail-closed Error). In S1 it rides the existing U1b refusal loops; S2 moves it to the binder's site judgement.
- Tests: NEW `slice-m4/server-call.test.js` (11). `bun test ./compiler/self-host-v2/` 1928 pass / 0 fail.
- DOGFOOD FINDING (impl#1, file a gap): a narrowed local `const known: Sym | not` read after `if (known is some)`
  compiled to `_scrml_known_907` — the mangled name of the top-level `fn known(ty)` in the same module. impl#1
  resolves a local that shares a module function's name to the FUNCTION in that position (a silent mis-bind). Worked
  around by renaming the local (`prior`). Proposed id: `g-impl1-narrowed-local-shadowed-by-module-fn`.
