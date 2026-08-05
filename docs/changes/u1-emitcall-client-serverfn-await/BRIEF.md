# U1 — the missing `emitCall` client-server-fn await branch (dpa-020 RATIFIED)

**Dispatched S319-bryan 2026-08-05.** Authority: `dpa-020` RATIFIED S319 (bryan: *"ratify all three"*,
then *"build U1"*). Artifact: `scrml-support/docs/deep-dives/autoawait-choke-point-vs-heterogeneous-2026-08-04.md`.

## The symptom (evidence — this part is verified)

§13.2 is POSITION-INVARIANT and normative: *"The compiler SHALL insert `await` at **every call site**
where a server-generated fetch call is made"* and *"SHALL wrap **any function containing at least one
server call** in an `async` function."* Ten open `*-await*` gaps are instances of the compiler not
meeting it. Discovery is not slowing (~3 new per PR); every member is SILENT (exit 0, no diagnostic, a
`.field` read off a Promise yields `undefined`).

## Root cause (dPA-established, emit sites read + probes compiled)

`emit-expr.ts` `emitCall` has FOUR sibling auto-await branches and **no `mode === "client"` branch that
reads `ctx.serverFnNames`**. The field EXISTS (`:460`) and is threaded, but no consumer reads it in
client mode. Reason: the client's server-fn call is renamed to `_scrml_fetch_X_N` by a **whole-buffer
regex post-pass** (`emit-client.ts`) that runs AFTER every emitter, so at emit time the compiler cannot
see it is emitting a server call. The `await` is therefore retrofitted by post-hoc injectors — **that is
the machine that manufactures one gap per position.**

**★ The false comment that encodes the bug** — `emit-expr.ts:3094-3096` claims *"A server-fn call from
the client goes through the emit-functions fetch stub (already awaited), never here — the two sets are
disjoint by construction."* The "already awaited" is precisely what the injectors retrofit. Treat this
comment as WRONG and fix it as part of the change.

## PA-LOCATED-VERIFY (hypotheses — confirm, refine, or report wrong)

- **The new branch belongs beside the existing three**, `emit-expr.ts` ~`:3099-3113` (the client
  `clientAsyncFnNames` branch), mirroring its exact shape including the shadow guard
  (`!ctx.declaredNames?.has(name)`) and the `peerAwaitable === false` → bare + `syncPeerCalls.push`
  fail-closed record.
- **★ The host-coloring precondition appears ALREADY MET** — `emit-functions.ts:1192-1205` builds
  `_serverFnNames` from server-boundary routes and passes it to `computeAsyncFnNames`
  (`emit-library-shared.ts:148`), whose `callsServerFn(callees)` seeds a client fn that structurally
  calls a server fn as `async` (comment: *"Cleanup 9 (S239) — the CLIENT server-direct seed derives from
  THIS single structural callee walk"*). **VERIFY THIS FIRST.** If it holds, dpa-020's dominant risk is
  largely pre-mitigated. If it does NOT hold for some shape, that shape is the precondition and must be
  fixed before the branch lands.

## HARD CONSTRAINTS (ratified — violating any of these fails the dispatch)

1. **Do NOT touch `combinatorIsAsyncName` (`emit-expr.ts:~1622-1628`).** It is the shared predicate
   feeding both the async-combinator lowering and the fail-closed drain; widening it is a **§8
   newly-rejecting change under freeze**. If U1 seems to need it, STOP and report.
2. **Do NOT build another string injector.** The fix is an emitter branch.
3. **Dominant risk — a stranded `await` is a WHOLE-BUNDLE SyntaxError.** `peerAwaitable` DEFAULTS to
   awaitable and is set at only two sites (`emit-expr.ts:3441-3442`, both `emitLambda`). Any position
   where the branch fires inside a non-async host is a global, catastrophic failure.
4. **GATE (mandatory, per position): `node --check` on EVERY emitted bundle** across `examples/` and
   `samples/compilation-tests/`. A green test suite is NOT sufficient evidence here.

## Definition of done

- The branch lands; the false `:3094-3096` comment is corrected.
- **Corpus emit differential** vs pre-change baseline: report EVERY file whose emit changes and why.
  Byte-identical on the no-tail case is expected and good.
- **`node --check` clean on every emitted bundle** (report the count).
- Full gated suite green; conformance green.
- **R26 empirical:** compile real adopter/corpus `.scrml` post-fix and EXECUTE, don't grep — the
  standing lesson is "emitted ≠ runs" (S265/S268/U3/#357 all passed `node --check` while broken).
- Report which of the 10 open `*-await*` gaps this closes, **verified by reproduction**, not by
  reasoning. Do NOT flip a gap to resolved without a reproduction on the post-fix baseline.
- If the change turns out larger than U1's scope, **STOP and report** rather than widening.

## Crash recovery

Commit after each meaningful unit (WIP commits expected); keep an append-only timestamped
`progress.md` in this directory. The branch + progress.md are the recovery anchor.
