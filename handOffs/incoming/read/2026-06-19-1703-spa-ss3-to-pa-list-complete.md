---
needs: action
from: sPA ss3 (codegen-expr-attr)
to: PA
date: 2026-06-19 17:03 (S209)
---

# sPA ss3 — list COMPLETE, ready for re-integration

## ACTION: re-integrate `spa/ss3` → main

- **Branch:** `spa/ss3` · **tip SHA:** `a62b0392` · **6 commits ahead** of `origin/main`'s
  pre-run base (a99246e2), **2 behind** current `origin/main` (advanced to `b3bb8fd1` — deputy
  tick 91 + flogence cPA MV). **Those 2 commits are DISJOINT from every ss3 file → the merge is
  conflict-free** (verified: `git diff HEAD...origin/main` over all 9 ss3 source files = empty).
- All 6 commits are sPA-authored (S67 file-delta from agent branches; coherence-gated S147 — tip ==
  item7 landing SHA, no leak). Pre-commit hook (full `bun test`) passed on every landing.

## Items landed (5 fixes + 1 NOT-REPRODUCED + 1 doc checkpoint)

| item | SHA | result |
|------|-----|--------|
| 1 `g-component-001-coverage` | `c4a6ac18` | **NOT-REPRODUCED** — W-COMPONENT-001 (fn-typed-prop nudge) fires correctly; block-splitter already tracks bare `{` (block-splitter.js:1233). Premise stale. Corrected the stale "will not fire" comment in component-expander.ts. No behavior change. |
| 3 `g-bare-literal-attr-value` | `de9d3a12` | bare numeric/dur/bool on spec-typed structural attrs {reconnect,channel-reconnect,interval,running,delay} no longer false-fire E-SCOPE-001 (value-aware exemption in visitAttr; `@`-ref still scope-checks; `<input value=42>` still errors). reconnect made value-aware (S186 improvement). +8 tests. |
| 2 `s169-ordered-unordered-build` | `7eb75dca` | `@ordered` value-native maps now build ordered (was hardcoded `false`; normative §59.8 bug, shipped S169; runtime already honored ordered). `collectOrderedMapVarNames` + ctx flag consumed by emitMapLit (nested map-VALUE literals stay unordered) at decl-init/C5-sidecar/emitAssign. +24 tests. |
| 4 `g-render-not-enum-asis-miss` | `631ea548` | `<render of=@strCell/>` now fences E-RENDER-NOT-ENUM instead of emitting an inert empty-switch no-op (concretizes asIs-erased of= target from the cell's literal init; strict guard keeps call/variant/absence/ambiguous SILENT). +9 tests. |
| 7 `giti-006-async-reactive-module-top-read` | `a62b0392` | spurious module-top `${@var.path}` bare read (threw on async-null reactives) eliminated. ROOT (differed from hypothesis): the S107/S144 pure-read-orphan suppression regex in emit-reactive-wiring.ts missed the dotted-path chain (the `_scrml_(reactive\|derived)_get` alt lacked the trailing member chain the input-state alt already had, S144). +6 tests. |
| — doc checkpoint | `cf30f64c` | parks for 5/6/8 + staged briefs (crash-recovery). |

Each fix R26-verified by the sPA on the branch (reproduce → fix → re-compile). Agent full-suite runs all
green (0 fail + browser 442/0); counts vary by gate scope (17282–24537).

## Items PARKED → PA / dPA design track (escalate)

- **item5 `r28-2b`** — leading-`:` on `:let` stripped by tokenizer START class (tokenizer.ts:451
  `/[A-Za-z_@]/`). Already a triaged/deferred known-gap (known-gaps.md:336; changelog.md:341
  re-confirmed-deferred). Admitting leading `:` ripples across ALL leading-colon attrs + into the
  block-splitter §4.14 `:`-shorthand recognition (**ss4 territory**) → broad blast radius + a
  language-cohesion ruling. `:let` works via the `let` alias today. **No ss3-bounded fix.**
- **item6 `emit-sql-ref-placeholder`** — `emitSqlRef` (emit-expr.ts:1850) is an explicit
  `TODO(Phase 3 Slice 4)`; structured SQL-ref *expression* emission needs the **statement-level SQL
  emission subsystem** (absent — the existing sql-ref code only classifies for server-only
  suppression). Future-phase + design-open; blast-radius exceeds ss3.
- **item8 `dq12-phase-b-bare-compound-is-op`** — **found a REAL silent-wrong bug:** a bare-compound
  is-op in an attribute condition (`<p if=fn() is not>`) silently DROPS the `is not` → emits
  `if((fn()))` (truthiness, semantics inverted); the paren form is correct. `is`/`is not` aren't in
  the cluster-A operator set so `E-ATTR-UNQUOTED-OPERATOR` doesn't fire. (Logic-body bare-compound
  is-op already works — AST-level.) **FIX DIRECTION is a ruling the sPA can't make:** (a) SUPPORT
  bare-compound in the fallback rewrite (the filed dq12-phase-b framing) vs (b) REJECT-with-parens,
  consistent with cluster-A "compound conditions SHALL be parenthesized" (§5.2/§17.1, S188). No
  ratification (no `dq12` provenance; no SPEC §42.2.4 Phase-B). The silent-wrong must be fixed
  EITHER way — the direction is the open question (amendment-direction-must-be-explicit, S129).

## NEW residuals surfaced during the run (R5 — file to known-gaps)

1. **Derived-engine crash** — `<engine for=@phase ...>` → `autoDeriveEngineVarName is not defined`.
   Reproduces on **clean main**, NOT introduced by ss3 (item3 + item7 agents both hit it). Likely MED.
2. **server-fn typed-object-literal return** — `return { name: string, ... }` inside a `server function`
   body trips **E-SCOPE-001 on the field name**. Separate type-scope quirk (item7 agent + my own async
   reproducer both hit it). Out of ss3 scope; not investigated.
3. **misnamed test** — `compiler/tests/unit/render-expr-primitive.test.js:65-76` is named
   "...string cell is an inert no-op" but its body asserts on an ENUM cell (assertions correct, name
   stale post-item4). Harmless; rename when convenient.
4. **upstream of item4** — the untyped reactive `state-decl` arm in type-system.ts (~:8590) does NOT
   infer a primitive `resolvedType` from a literal init the way the `let`/`const` arm does (the reason
   cells stay `asIs`). item4 sidesteps at the render fence rather than changing the bind type (broader
   fallout risk). Worth a future look.

## Operational hazard — SHARED-WORKTREE collision (for PA awareness + cleanup)

- items 2 + 3 agents were BOTH routed (by the harness) into the **pre-existing stale worktree
  `agent-a6eb2c2fd9ba6086b`** (present at my session start, a prior s169/ss1 leftover) and committed
  on the same branch concurrently (index.lock contention, ~39s waits, interleaved commits). **Fully
  recovered** via selective file-delta — I landed ONLY each item's own files (base-checked: the
  relevant files were byte-identical between the agents' bases and spa/ss3's base). Both agents'
  self-reports + my landings cross-confirm no cross-contamination.
- Mitigation that worked for items 4 + 7: each agent ran `git checkout -B <fresh> spa/ss3 --force` at
  startup → clean spa/ss3 base regardless of worktree reuse. item4 reused agent-a6eb2c2fd9ba6086b but
  reset cleanly; item7 created its own `agent-ss3-item7`. Recommend FUTURE sPA list-builds/dispatches
  serialize same-file dispatches and/or the harness avoid reusing stale agent worktrees.
- **WORKTREE CLEANUP IS PA-OWNED (per spa-scrml.md §Lifecycle).** At re-integration please remove the
  stale agent worktrees + sПА worktree:
  - `agent-a6eb2c2fd9ba6086b` (now on branch `ss3-item4-render-fresh` @`ece13d5c`)
  - `agent-ss3-item7` (branch `ss3-item7-asyncread-fresh` @`4a1b43fe`)
  - `../scrml-spa-ss3` (my list worktree, branch `spa/ss3`) once `spa/ss3` is merged.
  All their content is fully landed on `spa/ss3`; the branches are gc-safe to delete after merge.

## Durable record

Per-item dispositions + SHAs + R26 evidence are in `spa-lists/ss3.progress.md` and the item statuses
in `spa-lists/ss3-codegen-expr-attr.md` (both on `spa/ss3`). Per-dispatch BRIEFs archived under
`docs/changes/ss3-*/BRIEF.md`. **No wrap performed** (sPA owns no durable main-state) — the branch +
progress.md + this message ARE the handoff.
