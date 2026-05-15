---
title: scrml — where the compiler is going from v0.3
date: 2026-05-14
status: draft
revision: 2
audience: scrml.dev / adopter-facing roadmap context
authored_by: Bryan Maclee (PA-drafted; voice-fidelity reviewed)
---

# scrml — where the compiler is going from v0.3

scrml v0.3.0 just shipped. This document is a forward-looking sketch — what the compiler is investing in next, and why. **No timelines.** scrml is a one-person language; estimates are inherently soft. What's stable is the *direction*. The order is what matters.

If you've looked at the v0.3.0 benchmark numbers and they look weaker than the v0.2 numbers did, this document is the context. The short version: v0.3.0 traded single-page-app runtime for a multi-page-multi-role capability that single-page apps don't pay attention to. Most production apps aren't single-page. The trade is in the right direction. The next investments compound on it.

---

## Where v0.3.0 stands

The v0.3.0 critical-path investment was **whole-stack closure analysis**. At compile time, the compiler now computes exactly which code is reachable from each entry point and from each role. Two adopter-facing consequences:

- **`<auth role="Admin">`** is a first-class compile-time visibility constraint. The compiler analyzes the auth graph statically and emits separate bundles per role. Anonymous visitors literally can't see admin code — it's not in their bundle.
- **Per-route per-role content-addressed chunks** ship in three prefetch tiers (idle / hover / on-demand). Filenames embed a deterministic content hash so adopter caches stay valid across builds when source bytes don't change.

That investment had a runtime cost. The compiler's runtime now includes a chunk loader, role-detection bootstrap, content-addressed routing, and mount-hydration coalescing. **A single-page app pays for all of this without using any of it.** That's the bench regression the v0.3.0 measurements caught: scrml's TodoMVC bundle grew from 14.8 KB gzipped to 39.9 KB; runtime perf on a 10-operation TodoMVC suite regressed from winning 6/10 to winning 0/10.

A multi-page multi-role app sees the inverse trade. The new per-route per-role chunk bench shipped in v0.3.0 measures the win directly: anonymous-visitor initial chunks land at sub-1-KB gzipped; per-role overhead peaks at 13% for admin within `/admin`; the total reduction versus a hypothetical single-bundle is 96%.

That's the v0.3.0 deal. It is the right deal for production apps. It is the wrong deal for one-page demos. The next-version-and-a-half of work is partly about making the one-page case carry less of that weight.

---

## v0.3.x — what the patches do

The next several patch releases close gaps surfaced by the v0.3.0 cut. These are not new features. They are the compiler bugs and performance narrowings the v0.3.0 measurements + example-corpus migration revealed.

In order of likely landing:

### 1. Server-only body-emission tightening

A bug surfaced during v0.3.0 verification: under specific conditions, the codegen could emit a server-scoped function body into the client bundle. The `E-CG-006` fail-safe caught it, so adopters running the reference multi-file demo got a hard compile error rather than a silent SQL leak. The underlying bug — a missing handler in the route-inference walker — is now fixed; the diagnostic stays in place as a permanent fail-safe.

### 2. Edge-case parser fixes for the program-as-container shape

v0.3 moved the canonical file shape to "everything inside `<program>`, default mode = logic." The migration of the example corpus to this shape surfaced five distinct parser bugs where specific constructs — JavaScript template-literal interpolation inside a function body, HTML comments inside a component definition, bare `export type` at file-top in a non-entry module — forced a `${ ... }` wrapper as a workaround. Workarounds are documented; the fixes are filed and queued. After they land, the workarounds come out of the examples and the canonical shape carries through end-to-end.

### 3. Closure-analysis runtime tree-shake for single-page apps

This is the big perf-narrowing patch. When an app has zero `<auth>` blocks and zero `<page>` siblings (the single-page case), the new runtime additions — chunk loader, content-addressed routing, role-detection bootstrap, prefetch helpers — are dead weight. The compiler should detect this case statically and emit zero of those helpers. The TodoMVC numbers should recover most of the regression once this lands. Multi-page-multi-role apps continue to get the full surface, unchanged.

### 4. Auth-redirect resolution + login-page scaffolding

The `<program auth="required">` shape needs a corresponding `/login` page. Adopters who declare auth without one currently get an `I-AUTH-REDIRECT-UNRESOLVED` info-level diagnostic. The `scrml generate auth` CLI subcommand scaffolds a default login page. The diagnostic and the scaffold link will be tightened so adopters get a one-line fix.

### 5. Performance characterization

The v0.3.0 bench refresh measured TodoMVC + per-route per-role + SQL batching + bundle + build time. It did **not** measure the closure-analysis pipeline's own cost — how long the analysis takes on large codebases, peak memory, how the cost scales with code volume. That measurement is queued. The expectation is that closure-analysis cost is dominated by per-file work rather than cross-file work, but the measurement is the way to find out.

### 6. Smaller items

- A documentation note clarifying that `reset` is a reserved keyword (per §6.8) — adopters reflexively naming a function `reset()` hit an error during the corpus migration.
- Versioning convention formalization across `package.json` and the compiler identity emitted into the chunks manifest.
- Test-authoring note: when asserting on `W-*` / `I-*` diagnostics, use a cross-stream helper that reads both `result.errors` and `result.warnings` — info-level diagnostics partition into `result.warnings`, not `result.errors`.

---

## v0.4 — body-split

The next minor release anchors on a feature we're calling **body-split**: an ergonomic and correctness improvement for the server-function surface.

Today, when a `function` body touches a server-only resource (a `?{}` SQL block, server I/O, etc.), the compiler escalates the whole function to a server route via body-content inference. Multiple statements in one function become one server round-trip. That's fine for most cases. It is less fine for a couple of specific shapes:

- **Failable batches.** A handler that calls three failable functions in sequence and routes each error variant to a different recovery path currently makes either three round-trips (when the failable functions are independently server-escalated) or one round-trip whose failure semantics are awkward to express at the call site.
- **Idempotent retries.** A handler that's safe to replay should be safely replayable when the network connection blips mid-call. The retry-key shape that makes this work — Stripe-style `Idempotency-Key` semantics — has nothing to do with the developer-authored scrml; it should be the compiler's job to apply it.

The v0.4 body-split work adds two extensions to the existing escalation:

- **Function bodies split at server-escalation boundaries; `!{}` handler context propagated through.** The compiler analyzes each call site, splits the function body where it crosses the server boundary, and threads the `!{}` recovery handlers through to the right error arm. The shape that today requires three handlers becomes the shape adopters wrote — one `!{}` block at the call site.
- **Static monotonicity classifier + idempotency-key storage.** Per-batch, the compiler classifies whether the operations are monotone (safe to re-apply regardless of order). Monotone batches need no retry-key — replay is a no-op. Non-monotone batches get a Stripe-style `Idempotency-Key` automatically, backed by an adopter-configured storage backend declared in the project config.

This is backwards-compatible. Apps that don't use the new patterns compile as they do today. Apps that do use them get correctness + ergonomics improvements automatically.

The full body-split surface — multi-batch, conditional-tier, loop-aware splitting — is bigger than the first v0.4 cut. It sequences after v0.4 lands and after adopter friction shows where the next ergonomic gap actually is. Cross-function body-split (analysis across function calls) is bigger still and sits on the v0.5+ horizon; the v0.4 cut does not foreclose it.

---

## v0.5+ — the horizon

Two arcs sit past v0.4, both already explored in earlier design work, neither yet committed to a specific version target:

### Profile-guided optimization

Whole-stack closure analysis (the v0.3 investment) lets the compiler know, at compile time, which code is reachable. The natural next step is letting **runtime telemetry** shape codegen. Hot paths get inlined. Cold paths get tree-shaken harder. Per-app codegen tightens around the actual usage shape, not the theoretical reachable set.

The mechanism is an open design question — LLVM-style profile-guided optimization, Erlang-VM-style hot-swap, or a novel scrml-native shape — but the direction is established. The compiler's analysis surface keeps widening; this is the version that brings runtime feedback into the loop.

### A compiler that's alive in the developer's environment

Earlier design work explored what it would look like if the compiler weren't a batch tool that re-parses every keystroke, but a long-running state machine that maintains incremental invariants and can be queried — "what would change if I made this edit?" "what's reachable from this entry point right now?" "what would break if I renamed this variable?"

The full shape (recoverability, structured editing, hot-swap, persistent compiler state) is a substantial set of design decisions. The exploration mapped the space; the implementation path is still open.

### Self-host

scrml will eventually be written in scrml. Not as a mechanical port of the current TypeScript implementation — that would lose the language's advantages. As a from-scratch rewrite using scrml's natural idioms: optional `not`, failable functions, refinement types, reactive deps, engine state machines. The TypeScript implementation is the scaffold; self-host is the proof.

Self-host is sequenced after v1.0 stable. It is the destination, not the path.

---

## Surfaces that will likely change visibility in adopter docs

A few language features sit in a particular spot — they have spec real-estate and compiler implementation but a narrowing or atypical adopter surface. Honest about each:

**Compile-time meta blocks (`^{}`).** Three current use shapes: (1) compile-time markup generation via `emit()` from data arrays, (2) compile-time reflection via `reflect(TypeName)` for type inspection, (3) self-host compiler internals (extensive use in `stdlib/compiler/*.scrml`). The L22 type-as-argument family (`parseVariant` shipped at v0.next; `serialize`, `formFor`, `schemaFor`, `tableFor` planned) is structurally undercutting shape #2 — adopters who want "compile-time type introspection" will reach for `formFor(StructType)` rather than `^{ reflect(StructType) ... }`. Shape #1 (markup-from-data unrolling) and shape #3 (self-host internals) remain. `^{}` won't deprecate; the primitive is what the L22 family rides on internally. But its visibility in adopter docs will likely narrow over v0.4 → v0.5 as family primitives ship as the recommended surface. The flagship marketing pitch shifts to "define struct → get form" via `formFor`, not "you can write compile-time code" via raw `^{}`.

**The last-unbound-expression carry-forward (`~`).** Substantive spec real-estate and compiler implementation (linearity-tracked, with discrete diagnostics — `E-TILDE-001`, `E-TILDE-002`, `E-MU-001`) but currently zero adopter-facing corpus usage. The primitive captures the result of an unbound expression or lift — `fetchUser(id)` initializes `~`, `process(~)` consumes it. Designed for pipeline shapes where naming each intermediate value would be noise. The closest existing-language analogue is Perl's `$_`, but `~` has full linearity + scope rules rather than being a global magic.

**Naming intermediates is a real cost.** The design intent here is load-bearing: the time cost of choosing a good name for a value you're going to use exactly once in the next line is a tax the language shouldn't impose. The cleanliness of `fetchUser(id); validate(~); save(~)` over `let u = fetchUser(id); let v = validate(u); save(v)` is the point — same shape of motivation that makes ternary expressions feel clean.

**Adoption path: v0.4 body-split is the natural discovery moment.** The v0.4 anchor introduces failable batches + `!{}` handler propagation across CPS-split function bodies — exactly the pipeline shape where `~` shines. Post-v0.4 the canonical failable-pipeline example reads:

```scrml
fetchUser(id) !{ | ::NotFound -> { return } }
validateUser(~) !{ | ::Invalid -> { return } }
saveToDB(~)    !{ | ::DBError -> { return } }
```

The empty corpus is a documentation surface, not an adoption signal. v0.4's example refresh + recipes are the natural place to make `~` visible — adopters learn the pipeline shape and the `~` primitive together.

---

## The shape, not the schedule

Three patterns repeat across the work above:

**Investments compound.** Closure analysis made it possible to know which code is reachable; that knowledge is what makes the v0.3.x tree-shake work, what makes the v0.4 body-split classifier sharper, what makes runtime-feedback codegen meaningful later. None of these investments stand alone.

**Benchmarks are a measurement, not the goal.** v0.3.0's TodoMVC numbers regressed. The right response is not to re-tune the runtime to make TodoMVC win; it's to make sure TodoMVC isn't paying for things TodoMVC doesn't use (the v0.3.x tree-shake), and to make sure the per-role chunk story is measurable for the apps that use it (the new per-route per-role bench).

**The language is post-training-cutoff for every LLM.** Adopters using LLMs to write scrml will see the LLM reach for React or Vue or Svelte patterns. The language reference, the canonical examples, and an LLM anti-pattern catalog are the corrective. Each version's corpus migration is part of keeping the canonical examples honest, so that LLMs reading them learn the right shape.

That's the shape. The schedule is the schedule.
