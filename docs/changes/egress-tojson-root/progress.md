# progress — egress-tojson-root

Append-only. Timestamps are local (America/Denver).

## 2026-08-18 — startup

- Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a3748d68a1d807f9c`
- `git fetch origin egress-fix-r1` + `git checkout -B egress-tojson-root FETCH_HEAD` -> HEAD
  `a112c92f` (confirmed, matches brief).
- `bun install` (217 packages) and `bun run pretest` (13 samples compiled) both clean.
- Read `docs/changes/egress-tojson-root/BRIEF.md` in full; read `.claude/maps/primary.map.md`
  header + Task-Shape Routing.
- Read `compiler/src/codegen/protect-egress.ts` (531 lines) in full.
- NEXT: reproduce the PA's four A/B shapes on this tree BEFORE touching source (baseline),
  then Unit 1 (delete the toJSON install), then scope Unit 2.

## 2026-08-18 — baseline A/B reproduced (PA's table, re-run on this tree)

Compiled every shape with BOTH compilers: `origin/main` `d604df09` exported to a scratch tree via
`git archive` (read-only on git; no `cd` into the main checkout at any point), and this worktree at
`a112c92f`.

| case | shape | MAIN exit | BRANCH `a112c92f` exit | E-PROTECT-004 |
|---|---|---|---|---|
| A | `handle()` + inline SQL + `new globalThis.Response(JSON.stringify(u))` | 0 | **1** | fires on branch only |
| B | A + `{...u}` spread | 0 | **1** | fires on branch only |
| C | SQL in a CALLED helper + spread | 0 | 0 | **silent on both** |
| D | SQL in a CALLED helper, NO spread | 0 | 0 | **silent on both** |

PA's finding CONFIRMED, and D is the control that settles it: the gate goes silent across one call
hop **with or without the spread**. The CALL BOUNDARY is the defeater, not `{...u}`. The S349 round's
"object spread drops the toJSON hook" was the wrong cause for Blocker 1.

### Executed the emitted helper (extracted from a REAL artifact, not read)

`exec-helper.mjs` slices the `_SCRML_PROTECT` .. end-of-`_scrml_protect_redact` block out of a
compiled `*.server.js` by brace-matching and evaluates it. Both sides:

| probe | MAIN `d604df09` | BRANCH `a112c92f` |
|---|---|---|
| `JSON.stringify(u)` | `{"id":1,"name":"ada","passwordHash":"SECRET"}` | `{"id":1,"name":"ada"}` |
| `JSON.stringify({...u})` | full row | **full row — LEAKS** |
| `JSON.stringify(Object.assign({},u))` | full row | **full row — LEAKS** |
| descriptor survives spread | true | true |
| `toJSON` survives spread | false | **false** |
| `_scrml_protect_redact(u)` | `{"id":1,"name":"ada"}` | `{"id":1,"name":"ada"}` |
| `_scrml_protect_redact({...u})` | `{"id":1,"name":"ada"}` | `{"id":1,"name":"ada"}` |

**Blocker 2 CONFIRMED by execution**: the branch's server-INTERNAL `JSON.stringify(row)` silently
drops columns. **Blocker 1's mechanism CONFIRMED**: `toJSON` does not survive a shallow copy while
the Symbol descriptor does — so the compiler-owned sink is spread-robust and only the hook is not.

## 2026-08-18 — Unit 1 + Unit 2 landed (one commit: coupled code + tests)

### Unit 1 — the `toJSON` install is deleted

`compiler/src/codegen/protect-egress.ts`: `_scrml_protect_mark` removed entirely, callers set the
Symbol descriptor directly (main's exact shape restored). Comment blocks rewritten in three places:
the module docblock item 4, the emitted helper's own header, and the gate's SOUNDNESS BOUND note.

**PA LOCUS WAS INCOMPLETE — three more sites carried the same false claim:**

1. `compiler/src/codegen/emit-server.ts:~4394` — a comment asserting "a tagged row carries a
   non-enumerable `toJSON` that returns the redacted projection". Rewritten.
2. `compiler/tests/integration/g-sql-row-protect-leak.test.js:~198` — the assertion dpa-030 D2c
   changed from the full row to `{ id: 1 }`. Restored to full fidelity, with the reason recorded.
3. same file, `describe("§14.8.9 D2c — a tagged row redacts itself at JSON.stringify")` — an entire
   11-test block asserting the hook's behaviour. Replaced with a block asserting the post-S350
   semantics (tag is inert metadata; the compiler-owned sink is the redaction mechanism; the sink
   redacts THROUGH a shallow copy, which is the property the hook lacked).

Emitted-helper differential: the FIXED tree emits a 37-line helper, identical to main's, with
`toJSON` absent and `INTERNAL JSON.stringify(row) full-fidelity? = true`. Verified by EXECUTING the
extracted block from a real `*.server.js`, not by reading it.

### Unit 2 — E-PROTECT-004 now reaches across the same-file call graph

**AFFORDABLE — no new pass infrastructure.** `emit-server.ts` already had the whole file's function
list in scope (`fnNodes`, api.js `analysis.fnNodes` or `collectFunctions(fileAST)`), and the call
edge is a plain `{kind:"call", callee:{kind:"ident", name}}` — confirmed by dumping a REAL AST from
`C-crosscall-spread.scrml`, not assumed.

Design: for each function F the EFFECTIVE BODY is F plus every same-file function F transitively
calls; the existing single-body predicates run over that set unchanged. One rule covers both
directions. Reported at the INNERMOST firing root, so one leak path yields one diagnostic.

New in `protect-egress.ts`: `collectCalledNames`, `callClosure`, `detectProtectedRawEgressAcrossFile`
(+ `ProtectedRawEgressFinding`). `findProtectedQuery` / `findRawEgress` factored out of
`detectProtectedRawEgress`, which stays exported as the intraprocedural entry.

Deliberate choices, both recorded in-source:
- aliases are collected PER BODY, never merged across the closure (a merged map would make an
  unrelated local `R` in one function resolve to another function's `globalThis.Response` alias);
- `reveal("col")` IS honoured across the closure, matching the within-body rule — otherwise an
  explicit reveal becomes unsilenceable the moment the author factors the query into a helper.

### A/B after the fix (8 cases, both compilers)

| case | MAIN | FIXED |
|---|---|---|
| A inline + `globalThis.Response` | 0 silent | **1 FIRES** |
| B inline + spread | 0 silent | **1 FIRES** |
| C SQL in callee + spread | 0 silent | **1 FIRES** |
| D SQL in callee, no spread | 0 silent | **1 FIRES** |
| E raw egress in CALLEE (reverse direction) | 0 silent | **1 FIRES** |
| F `reveal` in the callee | 0 silent | 0 silent (correctly suppressed) |
| G protect + no raw egress | 0 silent | 0 silent |
| H raw `403` egress, no protected query | 0 silent | 0 silent |

The intraprocedural message is byte-identical to before (case A); the cross-call message names the
other function (`calls \`fetchUser\`, which selects …`, `… via \`wrap\``).

### Verification at this commit

- `bun test compiler/tests/integration/g-sql-row-protect-leak.test.js` — **70 pass / 0 fail**.
- `bun conformance/run.ts` — **883/883**.

**MIGRATION SET REFINEMENT (PA premise, corrected):** the brief named
`conformance/cases/protect/raw-egress-e004` and `.../reveal-suppresses-e004` as the measured
migration set. Both are INTRAPROCEDURAL shapes, so Unit 2 does not change what either asserts and
**zero expected.json edits were required**. The set was identified correctly; the migration cost is
nil.

- NEXT: `bun scripts/corpus-emit-differential.ts` base-vs-head (the standing pre-land gate for
  `compiler/src/codegen/` per primary.map.md), then the full `bun run test`.
