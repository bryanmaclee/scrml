# from sPA ss75 → PA — **NO-OP RE-FIRE**: list was already complete; closed + bookkeeping only

**List:** `spa-lists/ss75-conformance-control-flow-linear-17-35.md` (control-flow §17 + linear §35)
**Branch:** `spa/ss75` · **tip `423b2c44`** (1 commit, docs-only) · base `58c8161d`
**Worktree:** `../scrml-spa-ss75` · main untouched, nothing pushed
**Session:** S275 · **date:** 2026-07-20

## Headline

`/spa ss75` was fired against a list whose `[status=pending]` markers were **never updated at
re-integration**. All 14 items read as open; **none were**. 12 are LANDED, 2 are PARKED under a
standing user ruling. **I authored no conformance cases** — for the 2 open items, authoring would have
produced FALSE-GREEN data.

This is the S248 no-op pattern again (plan from landed artifacts + the oracle, never from list markers).
The durable fix is in the commit: the list now carries a **LIST CLOSED** banner so it cannot re-fire.

## Verification chain (independent, this session, on `58c8161d`)

| Check | Result |
|---|---|
| `bun conformance/run.ts` | **745/745 pass** |
| `git log -- conformance/cases/{control-flow,linear}` | `55bbdbed` (#75, +24) · `32cb0a89` (#76) · `6d360d23` (#77) · `8134fb55` (#78) |
| Read `expect.codes[]` across all 27 control-flow + 13 linear `expected.json` | every item 1-12 code has a pos assertion **and** a neg twin (not a grep-hit — read) |
| Bidirectional sweep: live fire-sites in `compiler/src` vs asserted `codes[]` in `conformance/cases/` | 15 of 17 live §17/§35 codes asserted; **only `E-TILDE-001/002` live-but-unasserted** |
| 11-shape empirical probe of `~` through the impl#1 adapter | **zero** E-TILDE codes on every shape |

Coverage is in fact **broader than the list**: follow-on waves pinned `E-CTRL-010`, `E-LIN-004`,
`E-LIN-005` — codes the original 14-item enumeration missed.

## The one finding worth your attention

**The parser arc for `~` is still open, and the post-escalation fix rounds did not close it.**

E-TILDE-001/002 remain structurally unreachable on current main. The type-system dispatches them off
AST kinds `tilde-init` / `tilde-ref` (`type-system.ts:17801`, `:17807`) and `lift-stmt` (`:17813`);
**nothing in `compiler/src` produces any of the three** — the builder emits only `lift-expr`, and the
`usesTilde` flag the walker reads (`:17814`, `:18527`) is never set.

I re-derived this independently before finding the prior escalation, then reconciled:

- **bryan S261 ruling-2** (delta-log `[547]`): E-TILDE-001/002 → *"fix-message-now,
  scope-wiring-separately."*
- The message half **landed** (#78, `8134fb55`).
- **#76 and #78 both landed AFTER that ruling and neither wired the codes** — #78 touched only message
  text. So the wiring arc (hand-off-261 item 8: how `~` is represented in the AST — it is gated behind a
  value-lift window, outside which `~` parses as bitwise NOT) is **still open**, and these two are the
  only unasserted live diagnostics left in the entire §17/§35 surface.

**No ruling requested** — ruling-2 already governs. This is a currency datapoint: if the freeze bar
wants §17/§35 diagnostic-exhaustive, the `~` parser arc is the single remaining blocker, and it is a
compiler-source arc, not conformance work.

## Trap flagged (kept visible in the list file)

`compiler/tests/unit/type-system.test.js:1766+` **hand-builds `{kind:"tilde-ref"}` AST literals**, so
both codes appear green over a dead path — the R26 trap. Any future grep-based "is E-TILDE covered?"
sweep will hit unit-test matches and may wrongly mark it done. `tilde-carry-forward.test.js:193` already
pins the gap verbatim, and `emit-expr.ts` carries a `null /* ~ orphaned */` codegen fallback *because*
E-TILDE-001 never fires. The list file now has an explicit **do-not-author** block with this rationale.

## What landed on the branch (`423b2c44`, docs-only — hook skipped the suite)

- `spa-lists/ss75-conformance-control-flow-linear-17-35.md` — LIST CLOSED banner; per-item status with
  landed SHAs + concrete case-ids; corrected stale impl line-refs and several **wrong trigger
  descriptions** in the original list (e.g. `E-CTRL-011` is `for (… in …)` rejection, not a placement
  error; `E-LIN-001` is *never* consumed, not a generic "consumption error"); items 13-14 do-not-author
  rationale + the governing ruling.
- `spa-lists/ss75.progress.md` — new; the evidence chain above.

**No `conformance/cases/` changes. No compiler-source changes.**

## Re-integration

Trivial — 2 doc files, pure-additive to `spa-lists/`, no conflict surface with any other sPA. File-delta
or cherry-pick `423b2c44`. Nothing to re-verify beyond what is tabled above (745/745 was measured on the
unmodified base; my commit touches no code or corpus).

## End state

Items 1-12 `landed` · items 13-14 `parked` (standing ruling-2, blocker re-verified) · list **CLOSED**.
Standing down.
