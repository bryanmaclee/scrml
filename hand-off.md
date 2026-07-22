# scrml — Session 280 (bryan) — WRAP

**Date:** 2026-07-22. Booted `/boot concurrent` as a **successor while S279 was still live in the same checkout**. A marketing-arc session that turned into a verification-methodology session: 9 PRs, ~14 gaps, one bryan ruling falsified by empirical proof, `pa-base v2.4`, and three arcs scoped.

## ⚠️ READ FIRST — state as of close
- **scrml main = `f681a777`.** Coherence 0/0. Inbox **EMPTY**. No open adopter issues beyond #27.
- **One PR still open: #148** (`fix/inbox-server-wiki-triage`) — rebased onto main, waiting on `gate` to re-run under `strict:true`. Merge it first thing.
- Mechanical detail lives in `handOffs/delta-log.md` and `docs/changelog.md` — not duplicated here.

## 🔴 THE ONE THING THAT CHANGES A RULING

**bryan's S279 Option-B ruling rests on a false premise, and U4 cannot be built as scoped.**

Option B deferred the classic Wave-1c loader and folded cross-chunk nav into ESM U4, reasoning that *"module scope dissolves the each-id collision."* **It does not.** Module scope dissolves only the *lexical* collision. The colliding state lives in the **runtime**, which under `--module-format=esm` is one ES module every chunk imports — a **singleton by necessity** (a forked cell store / subscriber list / rehydrator registry would break reactivity outright). Chunks mutate it through member expressions on an imported binding: legal ESM, and deliberately outside the arc's fail-loud guard (`emit-client-esm.ts:181` — *"MemberExpression targets bind no bare identifier and are skipped"*).

Proven in real Chromium against real emitted artifacts, **with no navigation at all** — just the `await import()` a nav loader performs:
```
alpha BEFORE import : {"rows":["a1","a2"]}
alpha AFTER  import : {"rows":["b1","b2"]}
```
The dispatched agent **REFUSED to build** and was right. The PA re-verified every load-bearing claim independently rather than accepting the report — source claims first (4/4 confirmed), then a fresh recompile, then the browser run.

**Consequences:** the real gate is the SECOND disjunct of `g-navigate-soft-nav-full-reload` — **per-chunk id/cell namespacing** — and it is **module-format-agnostic**, so fixing it also unblocks the held **classic** Wave-1c loader. Option B relocated the blocker; it did not remove it. Evidence preserved at `origin/evidence/u4-premise-falsified`.

## 🎬 WHAT LANDED (9 PRs)
| PR | what |
|---|---|
| #139 | S279's wrap (merged at S280 open) — E-ASYNC timer over-fire fix |
| #140 | **snippet-gate** — every public-cited `.scrml` compiles in CI |
| #142 | **README flagship compiles** — 7 SPEC contradictions closed |
| #143 | scrml-site lint triage — 2 gaps, 2 widened |
| #144 | claude-workflow union capture (this machine's `~/.claude`) |
| #145 | **U2 FACTS.md** — generated + gated; caught 2 already-stale public figures |
| #146 | dep-script `pages/` depth fix + 3 gaps |
| #147 | LOC facts + profile stops hardcoding derived figures |
| #148 | **OPEN** — server-keyword ruling + wiki triage, 3 gaps |

## 🧭 ARCS — where each stands

**Marketing claim-gate.** U1 (#140/#142) + U2 (#145/#147) **DONE** — both automatable claim classes closed. U3 (capability cites + Nominal rejector) and U4 (marketing repo + satellite PA) deferred past freeze per bryan's OQ-4. Scope doc: `docs/changes/marketing-claim-gate/SCOPING.md` (+ `readme-flagship-triage.md`). The claim taxonomy (C1 code / C2 numbers / C3 capability / C4 comparative / C5 framing) is the durable output — C4/C5 are explicitly NOT gateable and stay bryan's.

**chunk-namespacing — DISPATCHABLE, all 3 OQs ruled.** Scope doc: `docs/changes/chunk-namespacing/SCOPING.md`. Token = **FNV-1a of the dist-relative source PATH**, base36, 8 chars (path-identity, not content — content-hash answers "has this changed", namespacing answers "which unit is this"). **Always-on.** Byte-identity = one-time global churn gated by an artifact-diff asserting only id tokens moved, classified `semantics-changed` per §8. **~390 touch points across 8 files.** TWO namespaces collide independently — numeric node ids AND source-name-keyed cell keys — so fixing either alone still clobbers.

**ESM arc.** U1-U3 landed (S278). **U4 blocked** on chunk-namespacing above. U5/U6 untouched.

## 🔬 THE SESSION'S METHOD-LESSONS (the durable output)

**`pa-base v2.4` — gate design: three ways a gate reports green while verifying nothing.** Distilled from building a claim-gate and finding the PRIOR one hollow. (1) **The absorbed escape hatch** — README had 4 scrml blocks, 4 skip markers, green since 2026-05-18 while checking ZERO; detection is a RATIO not an inspection; gate whole artifacts, not fragments. (2) **The unproven gate** — never-failed is indistinguishable from cannot-fail; corrupt an input, confirm red, restore. (3) **The non-deterministic input** — a gate over a generated artifact derives only from inputs that change WITH the commit.

**PA verification failures, recorded because they recurred:**
- **Wrong corpus.** Reported "293 script refs / 0 dead" on `docs/website` — which has **no cross-file `.scrml` deps**, so the changed code never fired there. The most confident-sounding evidence was vacuous.
- **Method blind to the bug.** A ref-resolution sweep cannot see a ref that was never emitted.
- **Corpus that passes by luck.** `trucking-dispatch` does not collide because its pages differ in node count. A corpus check returns a false green on the namespacing arc — a purpose-built colliding fixture is mandatory.
- **Nearly shipped a wrong headline twice** ("62% of public code rotten"; "the README gate is vacuous by accident"). Both wrong, both caught by measuring instead of asserting.

**Process slips (3, one lossy):** dispatched twice against UNCOMMITTED work (the U4 brief, then the dep-fix — finders got an empty diff); and `git checkout <branch> -- docs/known-gaps.md` **destroyed two just-written gap entries**, recovered from context. Root cause is consistent: working in the tree without committing before touching it.

## 🔴 OPEN — needs bryan
1. **Nothing blocking.** All rulings given this session were applied.
2. Carried from S278, still unanswered: the **Shape-1 markup question** and the **§34 `E-STYLE-001` row** were both resolved at S279 — no carry.

## 📌 Gaps filed this session (~14)
HIGH: `g-esm-module-scope-does-not-isolate-chunk-state` · `g-trigger-3-server-only-import-does-not-escalate` · `g-composition-strip-eats-last-dep-script` · `g-runtime-script-tag-not-depth-prefixed` · `g-class-attr-expr-not-lowered`
MED: `g-uptoroot-vs-distrel-anchor-mismatch` · `g-dead-function-misses-arrow-callback-bodies` · `g-dev-shell-edit-no-page-recompose` · `g-prose-code-color-light-theme-only`
Widened: `g-tailwind-lint-false-positive-on-same-file-hash-class` (cross-file, 2nd reporter) · `g-route-001-object-literal-value-position` (3rd reporter → consolidate all three)
Non-gap: `g-docs-website-retained-as-test-fixture` (bryan ruled KEEP — live fixture for 3 tests)

## 🧷 Held / retained
- `origin/evidence/u4-premise-falsified` — the U4 falsification repro + harness. **Do not delete.**
- `origin/worktree-agent-a2ed001a5de228134` + local `feat/wave1c-nav` — Wave-1c pieces 2+3, still held, now unblocked by chunk-namespacing rather than by ESM U4.
- `claude-workflow` branch `incoming/bryan-XPS-8950` — **awaiting the ASUS session's union merge.** Until then `scrml-js-codegen-engineer` (the canonical dev-agent) is NOT installed here and every codegen dispatch takes the documented `general-purpose` fallback.
- All S280 agent worktrees removed at wrap.

## Tags
#session-280 #claim-gate-u1-u2 #pa-base-v2.4 #s279-option-b-falsified #agent-refusal-correct #verification-wrong-corpus #chunk-namespacing-dispatchable #trigger-3-not-wired

## 🗺️ Maps — REFRESH OWED (explicitly, not silently)
`.claude/maps/primary.map.md` is stamped **`9481bc69`** (2026-07-21). Main is `f681a777` — the entire ESM arc (U1/U2/U3), the #131 fence model, and all of S280 landed after it. The map cannot see `runtime-esm.ts`, `emit-client-esm.ts`, the `--module-format` flag, `snippet-gate.js`, `facts.ts`, or `FACTS.md`.

**Not refreshed at this wrap, deliberately.** Step 6c wants a `project-mapper` dispatch; firing one at the tail of a very long session risks a poor refresh landing as authoritative navigation, which is worse than a map everyone knows is stale. The S280 U4 dispatch worked around it correctly by enumerating post-map landings in the brief — that is the documented fallback (*"refresh or tell the agent which post-map landings to factor in — a stale map is worse than no map"*).

**Next session: refresh maps early, before any dispatch.**
