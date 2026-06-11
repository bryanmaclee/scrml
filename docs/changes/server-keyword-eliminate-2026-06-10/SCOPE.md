# Server-keyword full elimination — SCOPE & DECOMPOSITION

**Arc:** `g-server-keyword-drift` — user-ratified S180 TOP arc.
**Goal (user-ruled S180):** ELIMINATE `server function` from the corpus entirely. Only `server fn` (canonical pure-server form) and the DEFERRED SSE `server function*` survive. The `server` modifier becomes a deprecated no-op alias that nothing structurally depends on.
**Date opened:** 2026-06-10. **Base HEAD at open:** `6e83b3dc`.

## User rulings (S180, AskUserQuestion)
1. **SSE `server function*` → DEFER to its own DD.** Migration 4 + corpus migration leave ALL `server function*` untouched. File an SSE-keyword DD candidate.
2. **Load-bearing trigger-less sites → ELIMINATE FULLY (add real bodies).** Security/stub sites get real server bodies so they escalate; `server` drops.
3. **`handle()` + channel publishers (trigger-less structural survivors) → ELIMINATE BOTH FULLY.** Build a channel-cell-write escalation rule AND amend §39.3.2 so `handle()` infers server by its reserved name. `server function` disappears completely.

## Why this is not a `sed` (the investigation findings, wf_e84a6dce-19d)
- The `server` keyword is **load-bearing in 3 codegen/type paths** (all key on `node.isServer`, NOT inferred boundary): `emit-client.ts:729` wire-chunk gate (SOLE gate; confirmed not redundant with the routeMap CSRF path), `mcp-descriptors.ts:841` MCP RPC discovery, `type-system.ts:14497` §10.4 lift-as-return permission. Dropping the keyword from an *escalating* fn would regress these. (Same class as the S179 I-FN-PROMOTABLE bug.)
- `.scrml` corpus: **172 `server function` decl sites / 71 files** (examples+samples; stdlib has only comments). 151 escalate (safe), 19 trigger-less (load-bearing), 2 `server fn` (preserve), 0 SSE.
- `handle()` middleware: §39.3.2 verbatim *"`handle` is always `server`-escalated. The `server` keyword before `function` is required and is not implied."* — spec-mandated; needs an AMENDMENT to eliminate.
- Channel publishers: trigger-less (`@chanCell = [...]` reactive-array writes lowering to broadcast); need a new "writes a channel-synced cell → server" inference rule. (Caution: a channel body holds BOTH server ops and `onclient:` handlers — the rule must key on source-level WRITES to a channel-declared cell, not "in a channel body".)
- Escalation reason kinds today (route-inference.ts:28-30, closed set): `protected-field-access | server-only-resource | explicit-annotation`. No generator/channel/handle reason.

## Decomposition (5 dispatches)

### D1 — Keyword → inferred-boundary refactor (compiler-source, NO spec change) [FOUNDATIONAL / lowest risk]
Make the `server` keyword non-load-bearing in codegen. Refactor the 3 keyed-on-keyword sites to key on inferred boundary (routeMap `boundary === "server"`):
- `emit-client.ts:729` — wire-chunk gate → activate when any file fn is inferred-server (mirror the routeMap pattern at :1578), not `node.isServer`.
- `mcp-descriptors.ts:841` — MCP discovery → inferred boundary.
- `type-system.ts:14497` — §10.4 lift-as-return permission → allow lift-as-return for inferred-server fns (not keyword).
- PROOF TEST: a fn with an escalating body but NO `server` keyword gets identical wire-chunk + MCP + lift-permission as the keyword form. R26 verify (emit-client is codegen → S138 doctrine applies).

### D2 — New escalation rules + SPEC amendments (compiler-source + SPEC) [highest risk — inference-semantics change]
**Sanctioned by §12.2 itself: "Additional escalation triggers MAY be added in future versions." And the §12.2 Trigger-4 claim "Triggers 1,2,3,5,6 cover every case the keyword previously communicated" is presently INCOMPLETE — channel + handle are the two gaps. Triggers 7+8 make that claim true.**

- **Trigger 7 — channel-cell-write escalation.** A standalone `function` declaration **within a `<channel>` lexical scope** whose body (source-level) **writes a channel-synced cell** (a `<x>=init` declared in the channel body) OR **calls the channel `broadcast()`/`disconnect()` built-ins** escalates to server. New escalation reason kind (e.g. `channel-broadcast` or fold into `server-only-resource`). §12.2 +Trigger 7; §38.4/§38.6 cross-ref.
  - **Over-fire guards (load-bearing):** §38.4:18510 allows BOTH server- and client-originated writes to a channel cell, and channel bodies hold `onclient:`/`onserver:` ATTRIBUTE handlers too. Scope the trigger to standalone `function` DECLARATIONS in the channel `${}` body — NOT attribute handlers, NOT reads, NOT functions outside channel scope. `broadcast()`/`disconnect()` are already channel-scope-only (E-CHANNEL-004), so a broadcast call is an unambiguous server signal. Verify the exact AST shape (channel-decl → `${}` body → function-decl → write-to-channel-cell-or-broadcast).
- **Trigger 8 — reserved-name `handle` escalation.** §40.3: `handle` is ALREADY a RESERVED function name the compiler weaves into the pipeline BY NAME (the `server` keyword at §39.3.2 is belt-and-suspenders). So: the function the compiler recognizes as the middleware `handle(request, resolve)` escape-hatch escalates server by that recognition. §12.2 +Trigger 8; **§39.3.2 amended**: "The `server` keyword before `function` is required and is not implied" → "`handle` is inferred server by its reserved name; the deprecated `server` keyword is no longer required." Verify the middleware weaver keys on the name (it does per §40.3) so dropping the keyword keeps the weaving + escalation. Check E-MW-* codes don't gate on the keyword.
- §34: likely no new error codes (these are escalation ADDITIONS). W-DEPRECATED-SERVER-MODIFIER now fires on handle()+channel once they escalate via 7/8 (it gates on isExplicitServer && other-reason-present — now there's an other reason).
- Tests + R26. After D2, channel publishers + handle() escalate WITHOUT the keyword. **Highest-risk dispatch — careful spec-author + over-fire tests.**

### D3 — Escalation-aware Migration 4 (compiler-source: migrate.js) [the tool]
**Refined design (S180, post-D1/D2): drive Migration 4 off the `W-DEPRECATED-SERVER-MODIFIER` diagnostic.** That lint (route-inference Step 5d) fires iff a function is keyword-`server`-annotated AND has at least one NON-explicit-annotation escalation reason (T1/T2/T3/T5/T7/T8) — i.e. exactly when the keyword is REDUNDANT. It NEVER fires on `server fn` (a pure fn has no other trigger → only explicit-annotation → no fire), so driving off it AUTO-PRESERVES `server fn` by construction. It also never fires on keyword-only-no-trigger sites (the client-flip danger) → those are left untouched. This is provably safety-aware without re-implementing inference in the text tool.
- Migration 4 = a `--fix`-tier migration (the tier already compiles via `sanityCheckParse`): compile the file, collect `W-DEPRECATED-SERVER-MODIFIER` diagnostics + their spans, strip the leading `server ` at EACH fire-site's `server function NAME(` (span-based rewrite). EXCLUDE `function*` (SSE — deferred ruling) even if the lint fires (SQL-bearing SSE would fire). EXCLUDE `fn` (the lint won't fire there anyway — belt-and-suspenders). Verify the W-DEPRECATED diagnostic carries a usable span (the `server` keyword / decl location).
- Counts threaded through `runMigrate` (`totalServerFn` accumulator + summary line). Update BOTH docstring blocks (migrate.js:8-22, 2090-2160) — note the existing Migration-3 label collision (lens 1). Tests mirror `scrml-migrate.test.js` §13 + `migrate-program-shape.test.js` §7 composition; include: a `server function` w/ SQL body → stripped; a `server fn` → untouched; a `server function*` → untouched; a keyword-only-no-trigger `server function` → untouched (left, the danger case); a channel publisher (no keyword needed post-D2, but if keyword present) → stripped via T7-driven W-DEPRECATED; a `handle()` → stripped via T8.
- **Why not lens-1's pure-text regex:** a text regex can't tell an escalating `server function` from a keyword-only one, so it would client-flip the danger sites. The W-DEPRECATED-driven approach is the gap's mandated "safety-aware."

### D4 — Corpus elimination (.scrml + docs) [the visible payoff]
- Add real server bodies to the trigger-less security/stub `.scrml` sites so they escalate (per ruling 2).
- Convert genuinely-pure server-pin sites → `server fn`.
- Run `migrate --fix` Migration 4 over examples/samples → strips `server` everywhere now-redundant (incl. handle + channel post-D2). PER-FILE compile-verify.
- Doc migration: SPEC worked-examples (~54 clean + pure-pin→`server fn`) + kickstarter (~11) + PRIMER (~3); LEAVE deprecation-teaching passages, SSE, `server fn`. handle() worked examples → `function handle(...)`; channel publishers → `function`.

### D5 — Verify + close
- Full R26 compile-verify all migrated `.scrml`; full `bun test`; 0 regressions.
- File SSE-keyword DD candidate (scrml-support deep-dive shell).
- Update gap `g-server-keyword-drift` → resolved (or partial-with-residual if staged across sessions).
- PRIMER §6 + kickstarter §3.3: add channel-cell-write + handle-name as escalation triggers (the doc-teach already reframed to inferred-server S179).
- wrap.

## Sequencing constraints
- D1 MUST land before D4 (keyword must be non-load-bearing before stripping).
- D2 MUST land before D4 (channel + handle must escalate without the keyword before their sites are stripped).
- D3 (Migration 4) needs D2's escalation rules to be complete (so it strips channel/handle correctly).
- D1 and D2 are independent compiler changes (can run parallel worktrees; both land before D3/D4).

## Carve-outs / preserved
- `server fn` — PRESERVE (canonical pure-server; the only non-deprecated `server`-bearing form).
- `server function*` SSE — DEFER (ruling 1); untouched this arc; own DD.
- Deprecation-TEACHING passages in SPEC/PRIMER/kickstarter — LEAVE (they intentionally show the deprecated form).

## Status log
- 2026-06-10 S180: arc opened, rulings captured, decomposition authored.
- 2026-06-10 S180: **D1 LANDED + PUSHED `0dd50a7d`** (keyword→inferred-boundary refactor; 3 sites; OR-fallback design; +7 proof tests; R26 byte-identical; full suite 23786/0). Site 3 needed no residual — routeMap cleanly available at TS (RI runs first).
- 2026-06-10 S180: **D2 LANDED + PUSHED `bf4e51c4`** (T7 channel-cell-write + T8 reserved-name-handle escalation + §12.2/§38/§39.3.2/§34 spec; agent TIGHTENED handle to name+signature [Rule 3, name-only over-fired on 2 corpus decls]; +11 tests incl. over-fire guards; R26 FATAL-identical + only intended W-DEPRECATED delta). Base-drift caught: D2 branched pre-D1, `main..branch` showed D1's 4 files as "M" — verified 0-diff vs D2-base (pure base-drift), file-delta'd ONLY the 9 D2 files, D1 intact. PA-independent R26: channel-chat + middleware byte-IDENTICAL pre/post-D2 (emission-preserving) + W-DEPRECATED now fires on keyword-bearing publisher/handle (intended).
- 2026-06-10 S180: D3 (escalation-aware Migration 4, W-DEPRECATED-driven) dispatched @ base `bf4e51c4` — IN FLIGHT. D3 is file-disjoint from D1/D2 (touches migrate.js + its tests). Next: D4 corpus.
