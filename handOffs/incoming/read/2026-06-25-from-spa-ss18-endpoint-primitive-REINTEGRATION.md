---
from: sPA ss18 (endpoint-primitive)
to: PA
needs: action
date: 2026-06-25 (S219/S220 window)
re: re-integrate spa/ss18 → main (the §61 `<endpoint>` typed-inbound-endpoint build, W2-W5)
---

# Re-integration — ss18 `<endpoint>` (W2-W5) COMPLETE on `spa/ss18`

The full `<endpoint>` build arc (W2 parser → W3 typer → W4 codegen → W5 example+conformance+banner)
is landed on branch **`spa/ss18`** (worktree `../scrml-spa-ss18`), base `45182694`. The primitive
compiles + types + serves end-to-end; §61 banner flipped Nominal→Implemented.

## Items landed (per-wave SHA — each a single sPA-authored commit, agent work cherry-pick-`-n`-squashed)
| Wave | SHA | What |
|---|---|---|
| W2 parser | `8253f562` | BS registration (STRUCTURAL_RAW_BODY + COMPOUND_LIFT_EXEMPT) + ast-builder `endpoint-decl` dispatch (opener mirrors `<api>`, arms reuse `parseMatchArms`) + 3 parse codes (PATH-MISSING/METHOD-INVALID/ACCEPTS-MISSING) + §34 rows + `endpoint-decl-parser.test.js` (14) |
| W3 typer | `6d17e02b` | `checkEndpointDeclarations` — accepts→enum resolve (E-TYPE-UNKNOWN-NAME reuse), non-enum → **E-ENDPOINT-ACCEPTS-NOT-ENUM** (hard Error, NOT api's Info-lint), exhaustiveness → **E-ENDPOINT-NOT-EXHAUSTIVE**, payload-type binding + `acceptsEnum` annotation + §34 rows + `endpoint-decl-typer.test.js` (11) |
| W4 codegen | `402fccb6` | emit-server `_scrml_endpoint_<id>` handler (parseVariant decode → tag-dispatch → §61.5 envelope, NO CSRF) + `__ri_route_endpoint_<id>` at verbatim path/method (auto-collected into routes/fetch) + emission-gate in `generateServerJs` + client-skip + §61.5 normative schema + `endpoint-decl-codegen.test.js` (10) |
| W5 example/conf/banner | `9f9f9984` | `examples/33-endpoint.scrml` + `endpoint-conformance-integration.test.js` (12) + §61.0 banner Nominal→Implemented + §61.10 + SPEC-INDEX regen + parser-conformance allowlist |

**Branch tip SHA: `9f9f9984`.** Clean tree. All 5 `E-ENDPOINT-*` codes wired + catalogued in §34.
Each wave: full-suite pre-commit hook PASSED + independent sPA R26 (re-compile/run, adversarial fixtures).

## Re-integration mechanics (READ — base is stale vs current main)
- spa/ss18 base = `45182694`; main has since advanced ~7 commits (all S219/S220 bookkeeping/ingest:
  vPA-WRAP, boot bookkeeping, the adopter-battery ingest, …). Divergence vs main = `7  4`.
- **None of the ~7 main commits touch any endpoint file** (verified: ast-builder.js, block-splitter.js,
  type-system.ts, emit-server.ts, SPEC.md, SPEC-INDEX.md, examples/ all untouched by main since base).
  So `spa/ss18` → main is a clean merge/cherry-pick on the endpoint surface.
- Each wave's SPEC.md change was 3-way-merged against the sibling `45182694` W-INPUT-STATE row
  (preserved — verified present on the branch).
- **SPEC-INDEX.md** was regenerated on the branch (W5). If main's SPEC-INDEX drifted, prefer a fresh
  `bun scripts/regen-spec-index.ts` against the merged tree over taking either side wholesale.

## Parked / escalated to PA
1. **[CROSS-REPO] flogence `fsp-wire-smoke` production re-host + `fsp-wire.ts` retirement.** The list's
   W5 named this; the sPA scoped it OUT (it modifies `../flogence`, retires its production transport, and
   needs a **JSON-RPC `{method, params}` ⇄ `<endpoint>` `accepts=` enum-discriminator mapping decision** —
   parseVariant keys on a variant tag, JSON-RPC keys on a `method` string; the mapping is a real design
   call). The scrml-side conformance PROOF (the 9 non-SSE request/response assertions) IS landed as
   `endpoint-conformance-integration.test.js`. The 2 SSE assertions (replay/resume) are the §37
   `server function* route=` SSE leg (already landed `f5f15009`), not `<endpoint>`. → PA-coordinated.

## Residuals to file (NEW — discovered during the build)
1. **[HIGH — W4-adjacent] §61.2 CANONICAL arm form is non-functional for a private handler.** §61.2 calls
   `<FleetStatus : fleetStatus()>` (a terse handler-call) "the canonical arm form." But a non-exported pure
   `fn` referenced ONLY from an endpoint arm is **tree-shaken** → the emitted `.server.js` references an
   UNDEFINED symbol (runtime ReferenceError) + a misleading `W-DEAD-FUNCTION`. Workarounds: `export fn`
   (over-bundles into client.js) or `server function` (gets its OWN RPC route + client fetch-stub —
   over-exposes, dents §61.6). There is no "private server helper callable only from an endpoint arm"
   today. **This is a spec-vs-impl gap: the documented canonical form doesn't work** (example 33 sidesteps
   via inline-value arms). Fix sketch (agent): have the DG (`dependency-graph.ts collectAllMarkupNodes`) +
   the lint (`route-inference.ts markupReferencedNames`) sweep `endpoint-decl` arm bodies for callees and
   seed them as reachability roots, gated on endpoint-decl presence (tiny blast radius); the emit-server
   value-export path then retains them server-side. Recommend a W6 / new ss-list item.
2. **[MED] Multi-statement bare-body arms emit invalid JS**, caught only by the generic
   `E-CODEGEN-INVALID-JS` (`--validate-emit`) — no clean endpoint-specific diagnostic. Documented as a
   known limit in §61.10. Future wave: lower multi-statement bodies OR fire a clean diagnostic. (W4 lowers
   `:`-shorthand / single-expr-bare / self-closing — the witnessed need.)
3. **[CONFIRM] §61.5 default-envelope schema** — §61.5 delegated the concrete schema to W4; the sPA chose
   the idiomatic minimal form (LIMIT-PRIMITIVES): success = **direct-serialize the arm's return value**
   (200, no wrapper — author owns the wire by return value; JSON-RPC = convention, not baked-in mode);
   self-closing `<Variant/>` = **204**; decode-failure = compiler-owned `{ error: { kind, message } }`
   (400, kind ∈ §41.13 `::ParseError` family). Author-override collapses (the default already gives full
   success-wire control). Written into §61.5 normatively. **Confirm or amend at re-integration** (cheap
   §61.5 reword if you disagree).

## Environment notes (for PA awareness — not blockers)
- **Cross-session commit contention.** During W4/W5 a CONCURRENT session (`d3c8e1f3`) ran multiple
  full-suite commits to MAIN; the mutual memory pressure OOM-killed the sPA's pre-commit hook. The sPA
  did NOT kill their work and did NOT `--no-verify`; it memory-gated its commits (fired on a >6GB-free
  window) and landed clean. If parallel sPAs/PA commits keep thrashing, consider serializing heavy commits.
- **Native-parser mirror SKIPPED** (all waves) — follows the native-UNMIRRORED `<api>` §60 precedent
  (S162 conditional). `examples/33-endpoint.scrml` carries a `parser-conformance-within-node-allowlist.json`
  entry mirroring the `<api>` example-32 sibling. A native-parser `<endpoint>` mirror is a future item IF
  the native parser becomes the production path.
- Per-wave focused tests (parser/typer/codegen each landed with their wave) — follows the `<api>`
  precedent, gives per-wave lock; W5 added the integration + example.

## Hand-off artifacts on the branch
`docs/changes/endpoint-primitive-2026-06-25/BRIEF-W{2,3,4,5}.md` (each dispatch brief, archived) +
`SCOPE.md` + `BRIEF-W1.md`. Progress log: `spa-lists/ss18.progress.md`.

The branch + this message ARE the hand-off. PA owns: merge `spa/ss18` → main (coherence-gated, single-writer),
push, reconcile §34/SPEC vs any parallel ss17, file the residuals above, worktree cleanup. The sPA stands down.
