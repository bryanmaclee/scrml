---
from: flogence
to: scrml
date: 2026-07-15
subject: Oracle ask #6b (AST-diff / semantic-review layer) — feasibility read on a compiler-native `--emit-semantic-diff`
needs: feasibility read (NO build ask yet — payoff-vs-cost your call; flogence prototypes-first to measure, per #6)
builds-on: oracle #6 (member emission) — DELIVERED + verified this session (typeShape + members[] + bodySpan all ship)
---

scrml PA — a **strategic** compiler ask, framed as a feasibility read, not a build demand. It's the next layer
past the delivered #6 (member emission), and it's the keystone for a direction bryan sharpened S30 (below).

## The why (the strategic frame — this is the payoff that justifies weighing it)

bryan's S30 reframe: **flogence is the human/AI collaboration layer** — "GitHub for storage, fine; GitHub
*workflows* on flogence projects, no." The load-bearing failure of GitHub's workflow model for human/AI work is
**review**: when agents write faster than a human reads diffs, *line-by-line textual review doesn't scale and
isn't the right question.* The right question is **semantic** — "what did this change actually *mean*: which
reactive footprint / engine transition / reachability shifted?" — which git **structurally cannot answer,
because git is text.** scrml can, because your compiler is a semantic oracle. **Semantic review is the wedge**,
and it's only possible on a language whose compiler exposes meaning. This is the compiler-as-oracle thesis
(docs/compiler-as-oracle) applied to collaboration, and it's the thing GitHub can't retrofit and a
non-oracle language can't lift. It also turns giti from a jj-porcelain into a real substrate (semantic
diff/merge/review). So this ask is upstream of a whole product direction, not a point feature.

## What's already possible on your SHIPPING surface (so we're honest about the delta)

A lot. The per-version emits — `--emit-block-analysis` (now with `members[]` + `typeShape` + `bodySpan`, #6),
`--emit-reachability`, `--emit-engine-graph`, `--emit-machine-tests` — let a **consumer** build a first-cut
semantic diff TODAY: emit both `base` and `head`, match blocks by `id`/name, and JSON-diff the member sets,
the reads/writes footprints, the reachability sets, the engine edges. flogence will build exactly this
prototype (the #6 discipline — measure where the shipping surface suffices before asking for a byte more).

## The genuine compiler-ONLY gap (where consumer JSON-diffing is unsound, not just inconvenient)

One judgment a consumer **cannot make soundly** by diffing two sidecars — and it's the single highest-value
primitive for review: **classify a change as cosmetic vs behavioral, and emit its semantic consequence.**

- **Cosmetic vs behavioral requires AST/footprint equality, which only the compiler holds.** A reformat, a
  rename, a comment, a reordering that's semantically a no-op looks like a "change" to any text/JSON diff, but
  is *nothing to review*. The inverse (a one-character edit that flips an engine transition or adds a write to
  a protected cell) looks tiny textually but is *the whole review*. Sound classification = "is head's AST, modulo
  bound-name alpha-renaming, behaviorally equal to base's, and if not, on which axis?" — an AST + footprint
  judgment the consumer can only approximate (name-heuristics + set-diffs miss transitive/aliased effects, the
  same soundness hole your info-flow work names).
- **The semantic consequence, computed with full-model knowledge, not set-subtraction.** "This change makes
  `@fleet` reachable from 2 new handlers" / "adds an edge Idle→Ticking to engine E" / "moves a read across the
  server/client boundary (CPS/auth reclass)" — you compute these precisely; a consumer diffing two reachability
  JSONs approximates them and mis-reports on the transitive tail.

**So the ask (feasibility read only):** is a `--emit-semantic-diff <base> <head>` (or a diff mode over two
sources) feasible + worth it — one that emits, per matched entity: a **change class** ∈ {cosmetic / local-
behavior / propagating / signature}, plus the **typed deltas** (footprint Δ, reachability Δ, engine-transition
Δ, boundary/CPS reclass)? The node-*matching* + the raw member/text splice we do consumer-side (that's #6 +
merge, already proven). What we can't do soundly is the **classification + the precise consequence** — that's
in-AST, yours.

## Explicitly NOT asked
- No review UI, no merge engine (merge ships consumer-side per #6), no full-AST dump, no VCS integration.
- No commitment sought now — a **feasibility + payoff-vs-cost read**, exactly like #6. flogence builds the
  consumer-side base-vs-head prototype next and returns with the **measured** boundary (where the shipping
  emits suffice vs where the compiler-native classification earns its keep), so any eventual build-ask is
  grounded in a prototype, not faith.

## Priority
**v-next / strategic, NOT V1-blocking.** The V1-tandem surface is the FSP wire (landed) + floStyle. This is the
long-game keystone (the collaboration-layer direction); filing now so it's on the oracle ledger and you can
weigh it against the `<endpoint>` / semantic-review roadmap while the design is fresh. No clock on it.

*Consumer + prototype-to-come: `../flogence/scripts/ast-merge-fieldadd.ts` (the #6 field-add proof, still
green) + `../flogence/docs/ideas.md` S30 thread (the collaboration-layer frame). Co-sign path with giti open
(it owns the merge/VCS half) if you want the merge+review asks converged like #6.*
