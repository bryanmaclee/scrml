---
status: current
last-reviewed: 2026-08-16
gap: g-emitted-js-never-minified-prize-unmeasured
class: compiler-spec (emitted-JS shape = implementation freedom, S278 ESM precedent) — NOT language-spec
---

# Emit minification — scope the measurement, not the fix

**Origin:** bryan, S347 — *"`_scrml_reactive_get` could be something like `_srg` and reduce the size not insignificantly. But maybe that is over simplification."* The instinct is right and the mechanism is not the one proposed; the general form (a mangle pass) is worth more and is unshipped.

## The question this arc answers

**What does a MANGLE-ONLY pass buy on the artifacts scrml actually ships, and does the pipeline survive it?**

Not "should we minify" — that is unanswerable until the prize is a real number.

## Why the number is not already known

`bun build --minify` **conflates three things**: mangling, whitespace/comment stripping, and **re-bundling with tree-shaking**. Given an emitted file as an entry point it drops every export that file does not itself reference — which is why it reported a 95% reduction on an SPA runtime (17,406 → 817 B gzip). That figure measures re-bundling, not minification, and it is discarded.

**Everything currently known, and its trust level, is in the gap entry.** The two trustworthy numbers: renaming all 233 `_scrml_*` identifiers saves **10.8% raw but only 2.7% gzip** (LZ77 absorbs ~93% of it), and on a per-app client chunk that is **443 B gzip (8.3%)**.

## Why it is worth the measurement

[[g-spa-runtime-gzip-budget-knife-edge]] (HIGH, open) puts a live fork to bryan — hold a 16 KB gzip budget with a **127 B margin** and require zero-core-residue from every future feature forever, or raise it. **A real mangle-only win may dissolve that fork instead of answering it.**

⚠ **The budget test PASSES today (19/19, verified S347).** This arc does not claim a regression and must not be scoped as a rescue.

## Method

1. **Isolate mangle-only.** Do NOT use a bundler entry-point build. Run a rename/mangle pass over the emitted artifacts *in place* — or run the bundler with tree-shaking and bundling explicitly disabled — and prove the isolation by showing the export surface is unchanged before/after.
2. **Measure the shipped population, not a sample.** The SPA runtime assembly the budget test builds, plus per-route client chunks across the real corpus. Report `N of M` files and gzip deltas; state the compression level used (`gzip -9` here) and whether brotli is the real transport.
3. **Establish what CANNOT be mangled, first.** `_scrml_*` names that are cross-chunk-referenced, exported from the runtime, or reached by string lookup are off-limits. §47 (Output Name Encoding) is a **normative contract** over these names — read it in full before proposing any rename, and treat a §47 change as a spec amendment with a `provenance:` field, not an optimization.
4. **⚑ EXECUTE THE RESULT.** "Emitted ≠ runs" has bitten this project three times (S265 theme-switch DOA, S268 component-root value-attr, ESM U3), each caught only by running the bundle in a real browser rather than grepping it. A minified artifact that compiles is not evidence. **Run the flagship and a `<engine>`-bearing app in Chromium and assert behaviour, not presence.**
5. **Direction-of-change.** Mangling changes no source program's accept/reject status, so it is `inert` on the language axis — but it changes debuggability and any tooling that keys on emitted names (the dock/`--emit-block-analysis` surface, source maps if any, §47's hash scheme). Enumerate those consumers before landing.

## Explicitly out of scope

- Any change to `_scrml_*` naming **in the compiler's own source** — the proposal is an emit-time pass, not a rename of the codebase.
- Tree-shaking improvements. Real, larger, and a **separate** arc — do not let it ride in on this one, because it is precisely what contaminated the first measurement.
- Raising or lowering the 16 KB budget. That is bryan's open fork on the knife-edge gap; this arc only changes the evidence he rules on.

## Done-gate

A number for mangle-only gzip savings on the shipped population with its isolation proven, a named list of unmanglable identifiers with the reason, an executed-in-browser pass on at least two real apps, and a one-paragraph recommendation that explicitly includes "not worth it" as an available answer.

DONE-PROBE: `grep -q "mangle-only measured" docs/changes/emit-minification-prize/SCOPING.md`
