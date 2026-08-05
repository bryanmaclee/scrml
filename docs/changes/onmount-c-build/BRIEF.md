# BRIEF — on-mount (c) build: route the mount body through real statement codegen

**Dispatched by:** S315-peter · 2026-08-02 · **Lane:** Peter (compute / adopter-codegen)
**Ruling:** bryan S313 — *"take C, and amend 3726"* (SPEC §6.7.1a amendment already LANDED, PR #359 `180fbe7d`).
**Baseline:** `main` @ `bc51b610` (#384). Work in an ISOLATED WORKTREE.
**Direction-of-change:** **newly-accepting** → language-surface review from bryan before merge (distinct from S239).

DONE-PROBE: test -d conformance/cases/lifecycle/onmount-markup-as-value-rt

> ## ⏸ STATUS (S322-peter, 2026-08-05) — BUILT, PRESERVED, DEFERRED (not landed)
> S315 **built the deliverable** on branch `feat/onmount-c-build` (@ `ba72eaa0`, now **pushed to
> origin** — 2 commits: the statement-codegen reroute + the S313-review follow-up; touches
> `ast-builder.js` + `emit-logic.ts`, registers the within-node STRIP_KEY, ships **10 conformance
> cases both halves**). The target bug is **confirmed LIVE on main `f5d970a7`** — `@x = <span>hi</>`
> in a mount body still emits `< span > hi < / >` → `E-CODEGEN-INVALID-LOGIC`. So the fix is real and
> not obsolete.
> **Why deferred, not advanced to a PR (S322 fork, Peter chose B2):**
> 1. It is **`newly-accepting`** → bryan's language-surface review gates the merge (Peter's hard
>    boundary); it cannot self-land, and bryan is not in-session.
> 2. It routes the mount body through the **auto-await path U1 is actively reworking and that must not
>    land yet** — advancing now means rebasing (37 commits, textually low-conflict) onto machinery that
>    is about to change again. The headline cases (markup-as-value, `match`, multi-statement) are
>    orthogonal to auto-await; a server-call-in-mount-body sub-case rides the in-flux path.
> **PICK-UP when U1's auto-await rework settles:** rebase `feat/onmount-c-build` onto main → full gate +
> conformance + within-node parity → S239 adversarial pass → open a PR **routed to bryan** for the
> language-surface review. The DONE-PROBE above flips this thread DONE when the conformance cases land.

---

## The mechanism (PA source-read, confirmed on baseline)

`on mount { body }` desugars per §6.7.1a; its body is lowered via `mountBodyExprNode`
(`compiler/src/ast-builder.js:357`):

- It parses the body as **one expression**. Clean single expression → `emitExpr` fast-path.
- Multi-statement, OR an **escape-hatch** node (a construct the native parser skips) → falls to the
  **string rewriter** (`compiler/src/codegen/rewrite.ts`), which lowers plain JS + `@` but **cannot
  lower the scrml extensions that need real lowering** → `E-CODEGEN-INVALID-LOGIC` (fail-CLOSED).

A `function` body already lowers these correctly through the **real statement codegen**
(`scheduleStatements` → `injectServerCallAwaitsViaAst` — the GH #264 pivot). **(c) = make the mount
body take that same path** (desugar to a statement list → real statement codegen), dissolving the
escape-hatch/string-path dependency generically.

## ⚑ GATING TASK 1 — establish the TRUE failing set on `bc51b610`, then STOP-AND-REPORT

Do NOT build until the failing set is confirmed. The PA's quick repro **diverged** from bryan's
`a4a4d55f` "four constructs" measurement — on current HEAD it appears to **over-count**:

| construct in `on mount {}` | PA quick-repro on bc51b610 | scope call |
|---|---|---|
| markup-as-expr (`@x = <span>hi</>`) | ❌ `E-CODEGEN-INVALID-LOGIC` | **IN SCOPE** — genuine codegen-completeness bug |
| `!{}` error arms | pipe-arm `\| _ e ->` **compiled**; variant-arm `::X :>` reportedly failed | **RECHECK both forms** — in-scope only if a faithful form genuinely fails to lower |
| `?{}` SQL | **compiled + W-CG-001** ("server-only… will not execute") | ⚠️ **LIKELY OUT OF SCOPE** — see below |
| `lift` | **compiled + W-CG-001** | ⚠️ **LIKELY OUT OF SCOPE** — see below |
| `@variable` (control) | ✅ compiles | must NOT regress |
| `match` (control) | ✅ compiles | must NOT regress (the S295 ledger's "match breaks" claim is wrong) |

**The hard-boundary trap:** `?{}` and `lift` are **server-only** constructs. In a *client* `on mount`
the W-CG-001 suppression may be **correct behavior**, not the codegen bug. **Whether `?{}`/`lift`
should be legal directly in a client mount body is a LANGUAGE-DESIGN question → bryan's lane.** Do NOT
make them newly-compile — that would be a newly-accepting *language* change dressed as a bug fix.

**STOP-AND-REPORT** the confirmed set before building. For any construct whose failure resolves to a
language-legality question, flag it OUT OF SCOPE (bryan-lane) rather than fixing it.

## BUILD (task 2 — only the confirmed codegen-completeness failures)

Route the mount body through the real statement codegen (the #264 / function-body path). Requirements:

- **Byte-identical emit** for currently-passing cases: single-expression bodies, `@variable`, `match`,
  and existing multi-statement plain-JS bodies (`samples/rust-dev-debate-dashboard.scrml:160` is a
  live 3-call multi-statement mount body that MUST keep lowering).
- Scope the acceptance tests to the **genuine failing set**, not one construct (the pa-base §5
  correct-at-site-but-incomplete trap — a fix that closes markup-as-expr and leaves a real `!{}`
  failure passes its own new tests because the untouched path had no coverage either).

## MERGE-BLOCKERS / acceptance

- **Pin in conformance BOTH halves** (codes + runtime) for each in-scope construct — §62.2
  corpus-is-contract; this is a freeze surface, an unpinned fix is not in the language.
- **No regression:** the two controls + existing multi-statement bodies + the nested-markup case.
  **Do NOT touch or half-fix** `g-onmount-in-markup-position-silently-emits-source-text` (bryan's
  separate concern, a different file).
- **Full pre-commit gate green:** `bun test compiler/tests/{unit,integration,conformance}` (0 failures
  = contract). Also run the root-level `compiler/tests/*.test.js` scope (the S302 lesson — native-parity
  suites live there and the pre-commit hook checks them).
- **@generated regen at PR time:** `bun scripts/facts.ts --write` AND `bun scripts/state.ts --write`;
  if SPEC.md touched, `bun scripts/regen-spec-index.ts` too. (Windows note for the human: these regen
  scripts are LF-only — strip CR first. The agent's worktree is clean POSIX; flag if regen is needed.)

## GUARDRAILS

- **STOP-IF-BIGGER:** if (c) requires moving lifecycle bodies out of module-init, or restructuring the
  desugar beyond the mount-body codegen path, **STOP and report** — do not expand scope.
- **Collision:** S314-bryan has a LIVE route-region-teardown agent touching
  `emit-reactive-wiring.ts` / `emit-event-wiring.ts` / nav teardown. Isolated worktree avoids the
  git-level clash; **avoid editing the same functions** and flag any overlap for merge-time.
- **No language decisions** (Peter's hard boundary): the fix restores the sugar-equivalence
  (§6.7.1a:3716 — `on mount` is sugar for the §17.3 bare-expression-at-mount pattern). Anything that
  changes what the language ACCEPTS / REJECTS / MEANS beyond that → flag for bryan, do not land.

## DELIVERABLE

A feature branch with: the fix, conformance pins (both halves), tests green, plus a REPORT covering —
(1) the confirmed failing set on bc51b610, (2) what was built, (3) direction-of-change class,
(4) any bryan-lane / language items surfaced OUT of scope, (5) gate status. The PA (Peter) runs the
mandatory **S239 adversarial pass** before landing; bryan's language-surface review gates the merge.
