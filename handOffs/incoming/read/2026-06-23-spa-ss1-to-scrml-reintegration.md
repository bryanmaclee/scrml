# sPA ss1 → scrml PA — RE-INTEGRATION (needs: action)

**List:** `ss1` — server-emit-route-inference (S215 refresh, 5 items)
**Branch:** `spa/ss1` · **tip:** `1861b4c9` · status clean
**Base:** off main `0d4ba428`; main since advanced +2 (S215 wrap docs `27900a6c`/`a2137214` — doc-only, NO overlap with the compiler surface; divergence `main...spa/ss1 = 2 4`). Merge is clean.
**node_modules:** symlinked (sibling worktree `../scrml-spa-ss1`).

## LANDED (re-integrate these — per-item SHA)
| item | gap | SHA | what |
|---|---|---|---|
| 1 | g-route-001-local-computed-write | `b307c332` | E-ROUTE-001 receiver-reachability gate — suppress on pure-fn-local COW array writes (`result[idx]` on `nonce.slice()`); preserves `row[fieldKey]` param case. flux 1→0. +8 tests. route-inference.ts. |
| 2 | g-const-only-module-no-server-emit | `886bc178` | on-import value-only `.server.js` for server-imported const-only modules (api.js cross-file pre-pass + emit-server `generateValueOnlyServerJs`). W-SERVER-IMPORT-UNEMITTED MISSING-FILE → 0. No corpus churn (§5 scope-guard). api.js + emit-server.ts + 1 test. |
| 3 | g-section52-server-cell-load-codegen | `671ee65a` | **PARTIAL** — parser leak-stop only. ast-builder.js: markup-form `<x> = ?{}` / `<x server> = ?{}` now attaches a `sqlNode` like every sibling decl form (was the lone gap → raw `?{}` leaked into client JS / E-CODEGEN-INVALID-JS / false `/* upstream parser bug */` comment). Stops the crash + the **server-SQL-in-client.js security leak** + a sibling bug, across ALL markup-form `?{}` decls. parse-shapes-v0next.test.js §S11F re-baselined (was locking the bug). **Load-wiring PARKED — see escalation #1.** |
| 5 | g-e-ri-002-targeted-diagnostic | `1861b4c9` | E-RI-002 message (route-inference.ts) → dpa-005 targeted recipe naming `<engine server=@source>` (§51.0.E) + `<channel>`+`<match>` (§38.4); drops the blunt "client-side callback" steer. RI rule unchanged (§12.2 correct). +1 test. sPA-direct (message-only). |

Each verified: independent R26 (re-compile) + full `bun run test` green via the pre-commit hook on each landing (TodoMVC + browser gauntlet passed). Adversarial test-inversion reviews done on items 2 (§3/§4) + 3 (§S11F) — both legitimate re-baselines of bug-locking tests, not weaken-to-green.

## PARKED → NEED PA/USER DESIGN RULING (2 escalations)

### Escalation #1 — item 3 §52 server-cell LOAD-wiring (HIGH; blocks giti F1 / flux G1-read / §51.0.E)
The parser fix stops the leak/crash but the cell does NOT yet LOAD (fires W-AUTH-001). The actual `/__serverLoad/<var>` route + client-fetch wiring is **blocked on a SPEC normative conflict**:
- **§52.4.3** (SPEC.md:29156): the `<var server> = expr` RHS is "the **client placeholder** … NOT sent to the server."
- **§51.0.E** (SPEC.md:25431,25450): `<driver server> = ?{}.get()` — the `?{}` **IS** the server load (canonical, **param-bearing**).
- **§52.6.5** enumerates only Pattern A (assignment-inferred) + Pattern B (`on mount`) — NOT the decl-RHS-`?{}` form §51.0.E uses.
A `?{}` RHS cannot be both "client placeholder, not sent to server" AND "the server load." **RULING NEEDED:** is an inline-`?{}` `<var server>` RHS a LOAD (build `/__serverLoad/<var>` + client fetch — mirror the BUILT Tier-1 `emitServerAuthorityLoad`/emit-server.ts:1996 path) or an INVALID placeholder (error → steer to Pattern B `on mount`)?
- If "load": **E-AUTH-001 does NOT exist for SELECT read-params** (verified — SPEC §52.11 scopes it to INSERT/UPDATE/DELETE), so §51.0.E's param-bearing `?{...${@cell}...}` is NOT deflected to a server fn → needs POST-body param-passing (server-fn-CPS-like, larger scope).
- Also reconcile §52.4.3/§52.6.5 SPEC text to enumerate (or reject) the decl-RHS-`?{}` form.
- The `@`-form `server @x = ?{}` shares the same load-wiring no-op (now that both forms share the sqlNode shape, one fix covers both).
- The engine-hydration (`emitEngineVariantCellInit`, emit-engine.ts:1578) rides the cell for free — fixing the cell-load fixes `<engine server=@source>` too.
- Repro + analysis: `docs/changes/section52-server-cell-load-2026-06-23/` (BRIEF.md + progress.md + repro/).

### Escalation #2 — item 4 g-route-attr-for-server-generator-app-mode (dpa-002 OQ-1, un-ratified)
NOT a clean bug-fix — an **un-ratified design decision**. dpa-002 (`scrml-support/docs/deep-dives/serve-side-raw-route-2026-06-23.md`) is explicitly RUN-not-RATIFY / `#advisory-not-ratified`; its "PA action requested" lists resolving **OQ-1's `route=` application-mode wiring** as a PA/user ratification ("The dPA does NOT ratify").
- **SPEC §12** (L7017): "Route names are compiler-internal. The developer SHALL NOT reference, configure, or even observe the generated route names."
- **SPEC §12.6** (L7102-7104): explicit `route=` retention is scoped to **`--mode library`** (the `mount(server)` host case). NOT application mode. The plumbing (parser/RI/emit-server honor `explicitRoute`) exists; app-mode emission is deliberately gated.
- Enabling author-`route=` on `server function*` in APP mode extends the library-mode exception into app mode, contra §12 + Pillar-3 filesystem-routing (cf. `E-PAGE-ROUTE-ATTR-FORBIDDEN`).
**RULING NEEDED:** does scrml allow author-declared `route=` on a `server function*` in application mode? (dpa-002 leans YES via Approach B + "resolve OQ-1 as the shared minimal unblock," but defers ratification.) No code touched.

## RESIDUALS / NOTES FOR PA BOOKKEEPING
- **SPEC-currency** (item 3): §52.4.3↔§51.0.E tension + §52.6.5 missing the decl-RHS-`?{}` load form. PA owns SPEC reconciliation (gated on Escalation #1's ruling).
- BRIEF.md archives committed on-branch for items 1/2/3 (`docs/changes/*/BRIEF.md`); item 5 was sPA-direct (no brief). Item 4 has no brief (parked pre-dispatch).
- Item-3 parser fix ALSO fixed a latent sibling bug: non-server markup `<x> = ?{}` was emitting a false `null /* sql-ref unresolved … upstream parser/AST bug, please report */` for EVERY such cell — now emits an honest "declare as `server @x` for mount-hydration" steer.
- Full progress trail: `spa-lists/ss1.progress.md` (on-branch, append-only).
- Suggested: after merge, route Escalations #1 + #2 to the dPA/debate track or a focused DD; ship item-3 load-wiring once #1 is ruled (it then completes giti F1 + flux G1-read + the §51.0.E example).

— sPA ss1, 2026-06-23
