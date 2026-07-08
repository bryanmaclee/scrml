# BRIEF — watches= must source its table shape from a §52 authority collection (MED, S245)

CHANGE-ID: `channel-watches-52-authority-source-2026-07-07`
BASELINE: current main. GAP: `g-channel-watches-schema-vs-52-authority-composition` (MED, filed S245 in the realtime GAPS.md).
DISPATCHED-BY: scrml PA (S245). AGENT: scrml-js-codegen-engineer · isolation:worktree · background.
NOTE: commits are HELD (user) — build + report; the PA reviews + lands. Your worktree crash-recovery commits are fine.

## The bug (reproduced)
The realtime DD + SPEC §38.13.5 say a `<channel watches=X>` feed **composes with a §52 `authority="server"`
collection** — the §52 cell owns the collection, the feed carries the deltas. But it doesn't work:
```scrml
<program db="postgres://localhost/app">
  <orders authority="server" table="orders">   <!-- §52 collection — carries the shape INLINE -->
      id: int
      status: string
  </>
  <channel name="orders-feed" watches=orders>   <!-- §38.13 feed -->
      <onchange> … </onchange>
  </channel>
</program>
```
→ `E-CHANNEL-WATCHES-UNKNOWN-TABLE`: "watches table `orders`, but no `<schema>` declares a table named `orders`."

**Root:** the watches table-shape resolver `collectSchemaTables` (`compiler/src/channel-watches.ts`) walks only for
`<schema>` blocks (`stateType === "schema"`). It does NOT read a §52 `authority="server" table="X">` decl — which
**already carries the table shape inline** (its body `id: int` / `status: string` ARE the columns; it compiles
WITHOUT any `<schema>` block, verified). So `watches=orders` can't find the table the §52 collection declares, and
the `E-CHANNEL-WATCHES-UNKNOWN-TABLE` check (symbol-table.ts, ~:9076) fires.

This is an **unimplemented intended composition**, not a design fork — the DD/SPEC explicitly advertise §52+watches.

## The fix — two parts
### Part 1 — the resolver (channel-watches.ts)
Extend `collectSchemaTables(nodes)` (or add a sibling the caller merges) to ALSO collect §52
`authority="server" table="X">` decls as `WatchTable{ name, columns:[{name, scrmlType, primaryKey}] }`:
- Find how §52 authority cells + their inline column shape are already read — `collectServerAuthorityTypes`
  (imported at `emit-reactive-wiring.ts:12`, used ~:709; find its def). REUSE that shape-reading (don't
  re-parse the §52 decl by hand).
- Map the §52 authority decl to a `WatchTable`: `name` = the `table="X"` value; `columns` = the decl's inline
  fields with their scrml types; `primaryKey` = the `id`-field convention (§41.16/§52), same as
  `derivePrimaryKey` already expects.
- **Precedence:** if BOTH a `<schema>` block AND a §52 authority decl declare the same table name, the existing
  first-declaration-wins / `<schema>`-authoritative behavior should hold (pick one, keep it consistent, document
  it). A `watches=X` where X is declared by NEITHER still fires `E-CHANNEL-WATCHES-UNKNOWN-TABLE`.
- Everything downstream (`synthesizeRowChange`, the 6 diagnostics, Phase-2 codegen) already consumes `WatchTable`
  — no changes needed there once the §52 table is in the map.

### Part 2 — the SPEC §38.13 worked example (SPEC.md ~L20239-20257)
The example is currently MALFORMED (independent of this bug):
- `<orders authority="server" table=orders>` uses an UNQUOTED `table=orders` → `E-SCOPE-001` (the §52 `table=` attr
  requires a quoted string; note `watches=orders` bare IS accepted — a separate inconsistency, do NOT change that).
  Fix to `table="orders"`.
- `<orders> @orders` is an unclosed render line → `E-CTX-001/003`. Replace with a valid render of the collection
  (e.g. an `<each>` over `@orders`, or a valid closed form) — make the whole example COMPILE. Verify the corrected
  example compiles clean.

## ACCEPTANCE (all must hold)
- The §52+watches repro above (§52 authority decl, NO `<schema>`) COMPILES clean — no `E-CHANNEL-WATCHES-UNKNOWN-TABLE`
  — and Phase-2 runtime emits (trigger + LISTEN + client dispatch) with `RowChange` synthesized from the §52 decl's
  columns + `id`-PK.
- **Regression:** a `<schema>`-declared watches table STILL works (don't break the existing path).
- `W-CHANNEL-WATCHES-NO-PK` still fires for a §52 decl with no derivable `id`/PK + no `key=`.
- The corrected SPEC §38.13 worked example COMPILES (add it as a sample or a conformance case).
- Regression tests (§52-sourced watches · `<schema>`-sourced still works · both-declare precedence · unknown-table
  still errors) + a conformance case. Full suite `bun run test` → 0 fail (document env-floor).

## SPEC — read before coding (Rule 4)
Read §38.13.2 (RowChange synth from the table shape), §38.13.5 (composition with §52 authority), and §52
(`authority="server" table=` — the collection decl + its inline shape). Confirm the §52-decl-carries-the-shape
reading + the `id`-PK convention.

## SCOPE FENCE
Touch ONLY `compiler/src/channel-watches.ts` (+ a minimal reuse of the §52-authority shape reader — do NOT
restructure it) + `compiler/SPEC.md` §38.13 example + tests/conformance. Do NOT touch `emit-library.ts` (a sibling
thread owns it), the string-blind scanner files, `emit-channel.ts`/`emit-server.ts` (Phase-2, landed), or
`runtime-template.js`. Do NOT edit `docs/known-gaps.md` (PA marks it at landing).

## STARTUP + PATH DISCIPLINE (worktree)
`pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-` (else STOP — S90). `git
rev-parse --show-toplevel`==WORKTREE_ROOT; `git status --short` clean; FF to current main; `bun install`; `bun run
pretest`. Apply ALL edits via Bash on worktree-absolute paths (NOT Edit/Write). Never `cd` into main. First commit
message includes verbatim `pwd`. Commit incrementally; keep progress.md.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` (Task-Shape Routing). Report the Maps line.

## REPORT
`WORKTREE_PATH` · `FINAL_SHA` · `FILES_TOUCHED` · how you read the §52-authority shape (which existing fn) · the
repro-now-compiles evidence + the emitted RowChange sourced from §52 · the `<schema>`-still-works regression ·
the corrected SPEC example (compiles) · the conformance case · the Maps line.
