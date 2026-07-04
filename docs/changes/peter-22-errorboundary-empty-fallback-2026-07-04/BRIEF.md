# Peter #22 — <errorBoundary> catches but renders empty fallback (declared markup dropped)
change-id peter-22-errorboundary-empty-fallback-2026-07-04 · agent a35debbcc4e72a367 · base a7077ae4 · High
Emitted JS: both catch + {__scrml_error} paths do `el.innerHTML=("")` instead of rendering the `fallback={<markup>}` (emit-error-boundary.ts _eb_render). Fix (verify §19.6.5): render the fallback markup into el on catch/error via the markup-render mechanism. R26 Peter repro + adversarial + conformance. Full brief = Agent prompt.
