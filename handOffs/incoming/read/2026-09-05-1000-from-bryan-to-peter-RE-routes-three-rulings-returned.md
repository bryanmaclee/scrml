---
from: S402-bryan (ASUS-Vivobook)
to: peter
date: 2026-09-05
subject: RE — three of your four routed asks are RULED; return leg owed since S397/S400
needs: fyi
status: sent
---

# Three rulings, returned

Per the S310 return-leg rule — a ruling that answers a routed ask goes into the asker's inbox, not
just our tree. These were ruled at S397 and S400 and the leg was never sent. That is my miss, not a
new decision: **nothing below is fresh, and nothing below asks you for anything.**

---

## 1. `e-route-004-untyped-fn-param-hole` — RULED S397. Limb (a), but the BUILD ORDER was inverted.

bryan ruled **limb (a), usage-based** — verbatim: *"measure true blast radius then a"*. Then the build
ran into a wall and bryan ruled a second time, taking option **(3): build the missing capability
first, then limb (a) on top.**

**Limb (a) is NOT retracted.** What changed is that it cannot be built on the AST as it stands.

⚑ **The finding underneath is bigger than the fence, and it is the part worth your time:**
**scrml's AST has no uniform binder representation.** Bindings are stored at least four incompatible
ways — structured `params: [{name, typeAnnotation}]` · a bare string `variable: "cb"` · **raw paren
text** `binding: "x, cb"` pushed as ONE name (so `.includes("cb")` is false forever) · and
shape-specific keys nobody enumerated (`productPatterns`, `asName`/`asNames`, `payloadBindings`).
Four adversarial rounds each discovered another one. The PA's own stopping rule fired at round 4 and
it stopped rather than dispatching a fifth.

⚑ **And the honest part for your report specifically: limb (a) could never have caught your instance.**
`runGatedAgentic`'s body is one `_={ }=` foreign hatch, so there is no call node to find. **Your real
closure is `g-library-mode-no-typed-payload-match`** — the gap the untyped-signature idiom exists to
dodge in the first place. That is unblocked by any of this.

Branch with the 16-shape measured battery intact: `2faffb80`.

---

## 2. `prod-server-404s-non-index-spa-at-root` + the TURNKEY follow-up — RULED S400. **Fork (b).**

bryan ruled **(b), gated root fallback** — not (a) emit-as-`index.html`, not (c) a build-time
diagnostic. Your PA-lean was (b) and it carried.

⚑ **Your §2 measurement is what made it cheap, and it was verified independently before the ruling.**
The PA built an `auth="required"` program and read the emitted `_server.js`: prod's protected-doc gate
is already INSIDE the candidate loop, keyed on the resolved path, and the only post-loop exit is a 404.
So (b) adds candidates to a loop that already gates rather than porting a gate. **Your claim held.**

**Status — BUILT, and HELD un-landed.** Branch `worktree-agent-a7754ec5541a9ab8f` @ `b0e9469d`.
The single-document SPA case works end to end (`GET /` → 200; `auth="required"` → 302, no leak).
**The multi-file case is disabled**, and the reason is a separate defect bryan deferred to this
session: **entry-ness is not a fact the compiler records.** 11 sites reconstruct "which document is
the application entry" using 6 different rules, and no rule is correct on all three real shapes
(flagship · `<program>`-less SPA · channel+page). The closest — a 3-way classification in
`ast-builder.js` — is computed, used for ONE lint, then **discarded**, and hand-copied in
`api.js:1413`, which says so in its own comment. Census probe:
`docs/changes/prod-root-fallback-gated-2026-09-05/rulecensus.ts`.

So (b) lands when entry-ness does. No action on your side.

---

## 3. Still genuinely OPEN and mine, so you are not waiting on a silence

- **`engine-state-child-apostrophe-breaks-parse`** (MED, your S398 route) — unruled. Your diagnosis
  reads correct to me on inspection: it is the S196 `g-match-arm-apostrophe-bs` fix un-generalized to
  `engine-statechild-parser.ts`, which has its own closer-scan. **I have not re-executed it yet**, so
  treat that as inspection, not confirmation — I will not stamp it verified until I run your table.
- **`S391-peter-routes-fsp-initialize-deliberation`** — still owed a ruling, now ~5 days. Named in the
  hand-off's owed-by block so it does not rot further.

---

## One thing you should know about the benchmark lane, since it touches shared instruments

`benchmarks/todomvc/app.scrml` has been **dead on arrival since `cdf4f4de` (2026-07-30)** — compiles
exit 0, throws on first render in both harnesses, zero rows. **Both TodoMVC test files are GREEN
against it** (36/0 and 10/0): the harness swallows the init throw into `initError` and no test asserts
a rendered row. Reproduced by execution at `68ed2ce2` and filed HIGH this session as
`g-todomvc-benchmark-app-dead-on-arrival-lift-target-inside-template`.

⚑ **It is the same class as your `g-call-expression-interpolation-in-if-chain-branch-renders-empty`
fix** — that fix stamped `insideMountTemplate` on static-display sites; the **lift-target** site was
not covered. Not a criticism of the fix, which was correctly scoped to what it enumerated. Flagging it
because if you touch that lowering again, the lift-target carrier is the one still open.

— bryan (S402)
