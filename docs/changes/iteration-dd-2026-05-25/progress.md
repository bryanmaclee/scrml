# Iteration Design Surface DD — Progress Log

## 2026-05-25 Phase 1: Scope Lock

- Read SPEC-INDEX.md for navigation
- Read SPEC.md §17.4 (current iteration), §17.4a (else block), §17.4b (key)
- Read SPEC.md §10 (lift keyword)
- Read SPEC.md §1.4 (markup-as-value pillar), §1.5 (Tier ladder), §1.6 (V5-strict)
- Read SPEC.md §4.14 (`:`-shorthand body form), §4.15 (scrml-defined structural elements)
- Read SPEC.md §18.0 (match block-form, the established Tier 1 pattern)

## Scope-lock conclusion

**Central question:** What does scrml's structural-markup-first iteration surface look like? Should we ship a `<each>` structural element, and if so, what are its semantics?

**In scope:**
- `<each>` structural-element design: attributes, body grammar, semantics
- Item-binding surface (`as`, `@`-bare, bare-attribute)
- `:`-shorthand template-body extension
- Multi-child body grammar
- Empty-state handling (else=, <empty>, composition with match)
- key= attribute for keyed reconciliation
- Composition with engines, match, components, V5-strict
- Migration from current `for...of` + `lift` form
- Relationship to existing `<match>` Tier 1 form

**Out of scope:**
- Performance benchmarking of compiler-emitted iteration code
- Tier 0 (current) deprecation — current `for...of` + lift remains as fallback
- JS-style match (§18.1+) — iteration is structural-element-domain, not match-domain
- Lazy/streamed iteration / virtualized lists
- Server-paginated iteration (separate concern from local-iteration surface)
- Reactivity guarantees on iter-bound name (covered by existing §6.5 reactive array rules)

**Already known:**
- Current §17.4 syntax: `${ for (let x of @items) { lift <li>...</> } else { lift <li>empty</> } }`
- Current §17.4b `key`: `for (let x of @items key x.id) { ... }`
- Current §17.4a `else`: empty-state block on for/lift
- §4.14: `:`-shorthand body form is universal (engine state-children + match arms)
- §4.15: scrml-defined structural elements registry — adding `<each>` requires registry update
- §17.0: Tier ladder for case analysis (if= → match → engine); same shape applies to iteration?
- §1.4: markup-as-value pillar — bodies ARE values
- §18.0.1: `<match for=Type>` block-form is the canonical "structural element wraps logic" pattern in scrml; the `<each>` analog must mirror this idiom
- §10.4: `lift` is anonymous-${}-only; named functions return markup. This constrains how an `<each>` body composes with `lift`.

**Need to find out:**
- Actual count of iteration sites in `samples/` + `examples/` corpus
- What shapes are actually used (single `<li>` vs multi-child vs nested logic)
- Prior art: Svelte, Vue, Solid, React, Marko, Astro, Imba, Lit, Angular, Vento
- 3-5 viable `<each>` designs with tradeoff analysis
- Cohesion analysis with V5-strict, engines, match, components

## Phase 2 next steps

1. Corpus survey of `samples/` + `examples/` iteration sites — count + classify
2. Prior art research (WebSearch + framework docs)
3. Read PA-SCRML-PRIMER.md for Tier ladder + pillars
4. Read llm-kickstarter-v2-2026-05-04.md for current canonical recipes
5. Read examples/03-contact-book.scrml (hero) + 15-channel-chat.scrml
