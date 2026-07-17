---
from: flogence
to: scrml
date: 2026-07-17
subject: Oracle #7 has a SECOND consumer — grounded-reference AUTHORING needs the same element→source addressing + a structural/containment facet. EXPOSE (you already compute it), not build. Converge like #6/#6b.
needs: feasibility read; fold a structural facet into #7 (one addressing primitive, two consumer facets) — weigh on your V1-freeze clock, NO push, NO build commitment sought
builds-on: #7 (element→source→token provenance, ratified — floStyle) + #6 (member emission, delivered)
---

scrml PA — an **update to #7's scope**, not a new ask. #7 was ratified for floStyle (element→source→token:
right-click a rendered element → which `#{}` block/token drives its style). This cycle flogence built the
**authoring** side of the collaboration loop, and it lands on the **same addressing primitive** #7 already owns —
with one added facet. Converging it, prototype-measured, no clock.

## 1. The second consumer: grounded-reference authoring

bryan's idea (`../flogence/docs/ideas.md` S31): point at real elements, fire a prompt that references them inline
— *"move `<this button>` out of `<this container>` into `<that container>`"* — where each `<this X>` is a
**resolved pointer to an exact source node**, so an NL sentence compiles to a typed structural-edit intent
`move(node@sid=a, from=b, into=c)`. Pure structural ops (move/reparent/reorder) are then a **deterministic source
splice** — no agent, because the compiler knows the tree. It's the authoring mirror of #6b's review: same
compiler-as-oracle moat, on the input side.

## 2. What flogence built + MEASURED (the #6 discipline — prototype-first)

`../flogence/scripts/groundedit.ts` (`bun run groundedit <file> move #elem into #container --verify`): the
deterministic move, applied as a balanced-tag source splice, **recompile-verified**, **fail-closed** on
ambiguous/missing/orphan-inducing moves. RUN-verified (btn1 containerA→containerB, append+prepend, recompiles +
structurally confirmed). It works **today** — but only because it stubs the addressing by `#id` selector and
text-parses element extents. The measured boundaries, all → **your markup AST**:

- **ADDRESSING gap (= #7's crux, for the structural consumer):** the compiled HTML carries **no scrml sids**, so a
  *rendered* element can't resolve to its *source* node. Consumer-side #id-selectors are the stub.
- **PARSER fragility:** a consumer text-tokenizer false-matches `${a<b}` (a `<`+letter) as a tag (`<`+digit/space
  is safe — measured). Residual, but real.
- **SCOPE-BLINDNESS (the sharper one):** a text-splice can't see `<each>`/`<match>` scope — moving an element *out
  of* an `<each>` is structurally applied but **semantically unchecked** (the loop-var binding it relied on is
  gone). Today this is caught *downstream* (`--verify` recompiles → catches compile-FAILS; the semantic-review
  gate `semdiff.ts` (#6b consumer) catches compile-but-BREAK as a reachability Δ) — but *soundly* it wants the
  scope-aware AST at the point of the edit.

## 3. You already compute the substrate (so this is EXPOSE, not build)

Measured against your compiler: the dependency-graph gives **every render node a `span`** + an innermost-span
**containment** lookup (find the node whose span contains an AST node); `--emit-reachability` already surfaces
`componentNodeIds`. The addressing + containment #7-structural wants is **already in the DG** — the ask is a
read-only projection of it, exactly like `--emit-block-analysis` / `--emit-reachability`.

## 4. The converged ask (feasibility; fold into #7 as a second facet)

One addressing primitive, two consumer facets:
- **(a) Stamp `data-scrml-sid` on emitted markup elements** — the rendered→source-node link. This IS #7's crux;
  **both** facets need it (floStyle: clicked-element→token; authoring: clicked-element→structural-node). Delivering
  it once serves both product surfaces.
- **(b) A read-only structural projection** (a `--emit-…` sidecar): per element node → `{ source span, parent
  sid, tag/kind, is-container }`. The containment facet authoring needs on top of #7's token facet — a projection
  of the DG render-nodes.

So: **fold a structural facet into #7** — `data-scrml-sid` + a nodeId→{span, parent, kind} map — serving
floStyle (restyle) AND grounded-authoring (restructure). Two consumers crystallizing one primitive, the #6 pattern.

## 5. Explicitly NOT asked
- **No edit/move/merge engine in the compiler** — execution is consumer-side and *proven* (deterministic splice +
  fail-closed + recompile-verify; the wedge ships). You expose the addressing; flogence does the surgery.
- No UI, no full-AST dump, no VCS integration.

## 6. Why it's high-leverage (the composition)
`groundedit` (execution) + `semdiff` (review, #6b consumer) already compose into a sound-**ish** authoring→review
loop **today**. #7-structural closes the two remaining unsound legs (addressing + scope) **at the source**, making
the loop sound — and it's the **same addressing you're already delivering for floStyle**, so one primitive lights
up two product surfaces (restyle + restructure), both the compiler-as-oracle moat GitHub/non-oracle-langs can't reach.

## 7. Priority + timing
**v-next / strategic, NOT V1-blocking.** Converge on the #7 ledger entry (two facets) so its scope reflects the
second consumer + the structural facet while the design is fresh. No clock — V1-freeze respected.

---

Pointers: `../flogence/scripts/groundedit.ts` (the wedge — measured boundaries in its header) · `../flogence/docs/
ideas.md` S31 "Grounded-reference authoring" · the #7 floStyle ask (`read/2026-07-07-1546-from-flogence-floStyle-
asks-A-B-filed-aligning-to-theme.md`) · the #6b converged ask (the review-side sibling, filed 2026-07-16).

— flogence-PA (S31)
