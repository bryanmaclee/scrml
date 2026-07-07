# DISPATCH BRIEF — Realtime `<channel watches=>` IMPL **PHASE 1** (front-end: recognition + typer + RowChange + `<onchange>` + the 6 codes)  [change-id: realtime-external-db-writes-2026-07-06]

You are implementing **PHASE 1** of the §38.13 realtime-feed-over-external-DB-writes feature — the compiler FRONT-END only: parse `watches=`/`key=`, synthesize `RowChange`, register + validate `<onchange>`, and fire the 6 diagnostics. **You do NOT build the runtime this phase** — NO trigger-DDL, NO Postgres LISTEN bridge, NO client `__change` dispatch codegen (that is Phase 2, a separate follow-on dispatch). Phase 1 makes a `watches=` channel RECOGNIZED, VALIDATED, and fail-closed, with `RowChange` synthesized and every diagnostic firing — fully testable WITHOUT Postgres.

The normative spec is **SPEC.md §38.13** (already landed this session) — read §38.13.1 (`watches=`), §38.13.2 (`RowChange` synthesis), §38.13.3 (`<onchange>`), §38.13.4 (read-only forbidden-set), §38.13.8 (the 6 codes). It is Nominal/spec-ahead; Phase 1 flips the RECOGNITION+DIAGNOSTIC half (Phase 2 flips the runtime half + the banner).

# MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` in full; follow §"Task-Shape Routing" for a compiler-source change (parser + typer + §34). Map currency: HEAD `66a3afb1` as of `2026-07-04`; HEAD has moved (SPEC §38.13 + auth + oracle landed since) — verify map claims against current source. Report the Maps line.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (S99 — this class has leaked)
Before ANY other tool call:
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Else STOP+report (S90). Save as `WORKTREE_ROOT`.
2. `git rev-parse --show-toplevel` == `WORKTREE_ROOT`. 3. `git status --short` clean. 4. `bun install`. 5. First commit message includes verbatim `pwd`.
- **Apply ALL edits via Bash** (perl/python3/heredoc) on worktree-absolute paths incl. the `.claude/worktrees/agent-<id>/` segment — NOT Edit/Write (S126 divergence leaked to MAIN twice). Echo path before each write; `git diff` after.
- **NEVER `cd` into the main repo.** Use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`, worktree-absolute paths only.

# REQUIRED READS (before writing)
1. **SPEC.md §38.13** in full (the spec) + §38.3 (the attribute table — `watches`/`key` rows already added) + §4.15/§24.4 (the `<onchange>` registry rows already added) + §18.0.1 (match-block arms — REUSE) + §51.0.B.1 (payload binding — REUSE) + §61.2 (`<endpoint accepts=>` — the direct precedent for a typed inbound arm-dispatch; mirror its shape).
2. **Fire sites (survey the exact functions — the depth-of-survey discount applies; these are the loci):**
   - `compiler/src/ast-builder.js` — the `<channel>` opener attribute parse (~851 `readChannelMeta`-area, ~1324-1358 the export form). ADD `watches=`/`key=` extraction (static literal identifiers; parallel to `name=`/`topic=` which are literal-only per §38.11 — NO `${}` interpolation).
   - `compiler/src/symbol-table.js` (~8810, `walkChannelPlacement`/`walkValidateChannels` — the B19 channel-validation home, fires `E-CHANNEL-OUTSIDE-PROGRAM` etc.). ADD the `watches=` channel validation: the 6 diagnostics + `<onchange>` arm checks. This is the natural home (SYM pass over channels).
   - `compiler/src/type-system.js` (~18238, the `<schema>` table-declaration surface) — read the WATCHED table's column shape + PK to synthesize `RowChange:enum={Inserted(row:<RowT>),Updated(row:<RowT>),Deleted(key:<PKT>)}` where `<RowT>` = the table's columns as a struct, `<PKT>` = the PK column type (the `id`-convention, or the `key=` override per §38.13.2).
   - `compiler/src/attribute-registry.js` (~135, channel attrs) — register `watches`/`key` (both `supportsInterpolation:false`) + register `<onchange>` per the "adding a new structural element" procedure (PRIMER §12) + the block-splitter classify list (mirror how `<onTransition>` is classified/registered).
   - `compiler/SPEC.md` §34 (~17807, the `E-CHANNEL-*` catalog region) — ADD the 6 rows (Rule 4: §34 rows land WITH this impl).
3. The block-splitter structural-element classification (how `<onTransition>`/`<onTimeout>` openers are recognized) — `<onchange>` follows the same path, valid ONLY inside a `watches=` `<channel>` body.

# THE TASK — Phase 1 (front-end)

1. **Parse `watches=<table>` + `key=<column>`** on `<channel>` (static literal identifiers). A channel with `watches=` is a "feed channel."
2. **Register `<onchange>`** as a scrml-defined structural element valid ONLY inside a `watches=` channel body (`E-STRUCTURAL-ELEMENT-MISPLACED` elsewhere, reusing the existing code). Its body is per-variant arms over `RowChange` — REUSE §18.0.1 match-arm parsing + §51.0.B.1 payload binding (do NOT invent a new arm grammar).
3. **Synthesize `RowChange`** from the watched table's `<schema>` row shape (§38.13.2). PK by the `id`-convention or the `key=` override. If no derivable PK and no `key=` → `W-CHANNEL-WATCHES-NO-PK`.
4. **Validate `<onchange>` arms**: exhaustive over `RowChange`'s 3 variants (reuse the §18 exhaustiveness family — `E-MATCH-NOT-EXHAUSTIVE`-class; NO dedicated code; a `_` wildcard is legal). Payload binding resolves the arm's `row`/`key`.
5. **The 6 diagnostics (§38.13.8) + their §34 rows:**
   - `E-CHANNEL-WATCHES-DRIVER` — `watches=` on a non-`postgres` driver (resolve the channel's program `db=`/`<db>` driver per §44.2; SQLite/MySQL → this error).
   - `E-CHANNEL-WATCHES-UNKNOWN-TABLE` — the `watches=` table is not `<schema>`-declared in the program.
   - `E-CHANNEL-WATCHES-CLIENT-WRITE` — a V5-strict synced-cell decl (`<x> = init`) OR a client→server write path inside a `watches=` channel body (read-only feed, §38.13.4).
   - `E-CHANNEL-WATCHES-BROADCAST` — a `broadcast()`/`disconnect()` call inside a `watches=` channel (a tighter sibling of `E-CHANNEL-004`).
   - `W-CHANNEL-WATCHES-NO-PK` (Warning) — no derivable PK + no `key=`.
   - `W-CHANNEL-WATCHES-NO-CONSUMER` (Warning) — a `watches=` channel with no `<onchange>`.

# EXPLICITLY OUT OF PHASE 1 (do NOT build — Phase 2)
- The trigger-DDL emission (AFTER INSERT/UPDATE/DELETE + `pg_notify`) in `schema-differ.js`.
- The server-side LISTEN bridge (per-instance LISTEN connection + re-SELECT-by-PK + `__change` publish) in `emit-channel.ts`/`emit-server.ts`.
- The client-side `__change` → `<onchange>` dispatch codegen.
If a `watches=` channel reaches codegen in Phase 1, it is fine for it to emit NOTHING functional yet (or a documented Phase-1 stub) — the recognition + diagnostics are the deliverable. Do NOT half-build the runtime.

# TESTS (unit + conformance; NO Postgres needed)
- Each of the 6 diagnostics fires on its trigger + does NOT false-fire on a valid `watches=` channel.
- `RowChange` synthesized correctly from a struct-shaped `<schema>` table (Inserted/Updated carry the full row struct; Deleted carries the PK type); `key=` override honored.
- `<onchange>` exhaustiveness enforced (missing a variant → the exhaustiveness error; `_` wildcard legal); misplacement outside a `watches=` channel → `E-STRUCTURAL-ELEMENT-MISPLACED`.
- A non-postgres driver (`db="sqlite:…"`) with `watches=` → `E-CHANNEL-WATCHES-DRIVER`.
- A valid `watches=` channel over a postgres `<program db="postgres://…">` with a full exhaustive `<onchange>` → CLEAN (no diagnostics).
- Add a conformance case if the codes-half is conformance-testable (`conformance/` — the codes are a natural fit).

# COMMIT DISCIPLINE (S83) + VERIFY
- Commit incrementally (parse → registry → RowChange synth → validation+codes → tests). `git status --short` clean before DONE.
- Run the FULL `bun --cwd "$WORKTREE_ROOT" run test` before DONE (0 failures the contract; note the ~7 env-floor browser fails if they appear — not yours). If you shift any fixture ASTs, re-baseline the within-node allowlist per its docstring.

# REPORT (final message = raw data for the PA)
`WORKTREE_PATH`, `FINAL_SHA`, `FILES_TOUCHED`, full-suite counts, a per-diagnostic PASS line, a sample synthesized `RowChange` for a 3-column table, what you DEFERRED to Phase 2, the Maps line. You CANNOT run `/code-review` in-agent — self-review + name uncertain spots; the PA runs the adversarial `/code-review` before landing (S239).

# WHAT NOT TO DO
- Do NOT build any Phase-2 runtime (trigger DDL / LISTEN bridge / client dispatch).
- Do NOT invent a new arm grammar for `<onchange>` — REUSE §18.0.1 + §51.0.B.1.
- Do NOT allow `${}` interpolation in `watches=`/`key=` (literal identifiers only).
- Do NOT `--no-verify`. Do NOT write outside `$WORKTREE_ROOT`. Do NOT `cd` into main.
