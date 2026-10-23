---
title: CSS without a build step
published: false
description: Native CSS shipped @scope while we were not looking. scrml compiles to that. No PostCSS, no runtime, no className mangler.
tags: webdev, css, programming, compiler
cover_image:
canonical_url:
---

> **SUPERSEDED. DO NOT PASTE.** This is an archived April–May 2026 draft, moved to `docs/articles/archive/` in S469. Its scrml is an older dialect that the language has since replaced, and its code is not compile-gated, so code copied from here will not compile as today's scrml. For current scrml, start from the [tutorial](../../tutorial.md); [`docs/DIALECT.md`](../../DIALECT.md) explains which docs teach the ruled dialect.

*authored by claude, rubber stamped by Bryan MacLee*

**TL;DR: Native CSS shipped `@scope` while we were not looking. scrml compiles to that. No PostCSS, no runtime, no className mangler.**

I designed scrml to have the *fewest* moving parts that could deliver real reactivity, real state, and real components. Then I looked at what shipping styles costs in modern frameworks, and I almost laughed.

I am not an experienced framework developer. I can hobble through React if I HAVE TO. I have written enough CSS to know what fine-tuning a layout feels like. Most of what I have read about scoped CSS in framework land is people building elaborate machinery to compensate for a feature the browser had not yet shipped. The browser shipped it. The machinery did not retire.

This is the fourth of six features the browser-language overview piece promised to unpack later. CSS, in detail.

## What shipping scoped styles actually costs (BEFORE)

Pick the path you took the last time you scoped a component's styles. One of these:

**Tailwind utility-first.** A PostCSS pipeline. A JIT scanner that walks your source files. A `tailwind.config.js`. A `content` glob you keep wrong until something disappears in production. The class-name strings on every element grow until the markup looks like a base64 blob. The system is good. The plumbing it sits on is a build pipeline you maintain.

**styled-components or emotion (CSS-in-JS).** A runtime that injects style tags as components mount. A Babel plugin to attach component display names. SSR ceremony to extract critical CSS without flashing unstyled content. A re-render every time a styled component's props change. The runtime cost has been argued about for years, and it is genuinely real for high-frequency renders.

**CSS Modules.** A build step that hashes class names. The compiled output reads `.btn_3xK9f` and the source reads `.btn`. DevTools shows you the hash. You learn to read it. Source maps fix this when they work.

**vanilla-extract.** A typed DSL on top of CSS. Still a build step. Still a layer between what you write and what the browser parses.

Each of those paths exists for one reason: in 2019, scoped styles were not a primitive. The browser did not give you a way to say "these rules apply only inside this component, and not inside its children." Frameworks built it themselves. Five different ways. All five required tooling. All five became how things are done.

## What native CSS actually shipped

`@scope` is in the browser now.

```css
@scope ([data-card]) to ([data-card]) {
    .body { padding: 16px; }
    .title { font-size: 1.25rem; }
}
```

The block applies inside any element with `data-card`, and stops at any nested element with `data-card`. That second clause is the *donut*: child components inherit nothing of the parent's styles, no matter how generic the selector inside the block looks. Parent's `.title` does not bleed into child's `.title`. No hash. No mangler. No runtime. The browser does it.

`@scope` reached Baseline in December 2025. Chrome 143+, Firefox 146+, Safari 26.2+. Most application devs do not know about it because the framework path obscured it. The framework path was a workaround for an absent feature. The feature is no longer absent.

## The scrml way (AFTER)

scrml's CSS sigil is `#{}`. Inside a component declaration, it scopes. At program scope, it goes global. There is no third mode.

```scrml
<program>

${
    const Card = <article props={ title: string }>
        #{
            .card { padding: 16px; border: 1px solid #e5e7eb; border-radius: 8px; }
            .title { font-size: 1.25rem; font-weight: 600; }
        }
        <div class="card" data-scrml="card">
            <h2 class="title">${title}</h2>
        </div>
    </>
}

</program>
```

The compiler emits this CSS:

```css
@scope ([data-scrml="card"]) to ([data-scrml]) {
    .card { padding: 16px; border: 1px solid #e5e7eb; border-radius: 8px; }
    .title { font-size: 1.25rem; font-weight: 600; }
}
```

That is the entire pipeline. The selectors in the source are the selectors in the output. DevTools shows you `.title`, not `.title_h7Bz4`. Source maps are optional. The donut limit (`to ([data-scrml])`) is implicit: nested constructors get their own scope and the outer rules stop at the boundary.

There is one more sub-mode. A `#{}` block with no selectors, just bare `property: value;` pairs, compiles to an inline `style=""` attribute on the containing element. It does not appear in the `.css` file at all.

```scrml
${
    <title> = "Hello"

    lift <div data-scrml="card">
        #{ padding: 16px; }
        <h2>${@title}</h2>
    </div>
}
```

becomes a `<div style="padding: 16px;">` directly. The most common case (one or two declarations on one element) gets the lightest possible compilation.

That is it. No PostCSS. No runtime. No hash mangler. No `tailwind.config.js` `content` glob. No styled-components Babel plugin. No SSR critical-extraction. The compiler reads the `#{}` block, decides whether it is selector-based or flat-declaration, and emits the corresponding output. Co-location of behavior was a founding philosophy of scrml. The styles for a component live inside the component. They compile next to the markup that wears them.

## What this kills

- The PostCSS config. There is no `postcss.config.js` in a scrml project. There is a `scrml build`.
- The Tailwind CLI step. The compiler runs the utility-class scan as part of its normal pass.
- The styled-components runtime. There are no style tags injected on mount. CSS is emitted at compile time and served as a `.css` file the browser loads once.
- The Babel plugin tier for CSS-in-JS. There is no Babel.
- Hash-mangled class names. The class you wrote is the class the browser sees.
- The "where is my SSR critical CSS extraction layer" decision. There isn't one to configure.
- The decision of which CSS-in-JS library to use. The decision is *no CSS-in-JS library*; the language has CSS as a context.

That's the tier of tooling that compresses out when the browser already has scoping.

## What is still real

Tailwind's *system* is genuinely useful. The utility-first vocabulary, the design-token discipline, the spacing scale, the way the class names compose: that is real ergonomics. The point of this article is not "no Tailwind." It is "no Tailwind *pipeline*."

scrml has a built-in Tailwind engine. It scans the source for used utility classes and emits only the CSS rules for what the source actually uses. No `tailwind.config.js`. No `content` array. No PostCSS. The engine is in the compiler.

```scrml
${
    const Badge = <span props={ label: string }
                         data-scrml="badge"
                         class="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800">
        ${label}
    </>
}
```

That works out of the box. Mixed with `#{}` for things utilities don't reach, in the same component.

Two honest disclosures.

1. The current built-in engine covers the core utility set. Custom theme configuration, `group-*`/`peer-*` parent/sibling-state variants, and `before:`/`after:` pseudo-element variants are tracked in `SPEC-ISSUE-012` and not yet shipped. If your design language requires those today, you would still need them.

> **Correction, May 2026:** arbitrary values (`p-[1.5rem]`), responsive prefixes (`md:`, `lg:`), and variant prefixes (`hover:`, `focus:`) have since shipped (SPEC §26.3, §26.4). The original list above understated current engine coverage.
2. Tailwind utility classes live *outside* `@scope`. They remain globally scoped, by design. A `.bg-emerald-100` rule in a child constructor uses the same emerald as the parent. That is what Tailwind users expect; it is the right call.

The `#{}` block is for the cases utilities don't cover. The utilities are for the design-token cases, where consistency across the app is the value.

## The deeper point

A reactive system that wires its dependencies at compile time does no work at runtime to figure out what to update. A query that batches itself at compile time does not need a DataLoader. A boundary that is enforced at compile time does not need a validator on the wire. CSS that compiles to native `@scope` does not need a runtime mangler.

The runtime does less because the compiler did more. The browser shipped a feature. A language designed today should compile to it. A language designed in 2019 had to ship the workaround as a library. That is not a critique of styled-components or Tailwind: those are excellent solutions to the problem available at the time. It is an observation about the tooling tier that compresses out when the language sits on top of the browser the browser actually is, not the browser it was when the framework was conceived.

I am sure I am wrong about plenty. But every time I look at what a fresh-shape primitive subsumes, the same thing happens. A whole tier of tooling stops being a thing you have to assemble. A little short of perfect is still pretty awesome.

## Further reading

- [Why programming for the browser needs a different kind of language](https://dev.to/bryan_maclee/why-programming-for-the-browser-needs-a-different-kind-of-language-6m2). The high-altitude six-feature overview that this piece zooms in on.
- [Introducing scrml: a single-file, full-stack reactive web language](https://dev.to/bryan_maclee/introducing-scrml-a-single-file-full-stack-reactive-web-language-9dp). Mentions the built-in Tailwind engine in context. Starting-point if you haven't seen scrml before.
- [What npm package do you actually need in scrml?](https://dev.to/bryan_maclee/what-npm-package-do-you-actually-need-in-scrml-2247). The package-list-collapses argument worked through one tier at a time. The CSS-in-JS / scoping line item is in there.
- [The server boundary disappears](https://dev.to/bryan_maclee/the-server-boundary-disappears-hap). The same compiler-owns-it pattern, applied to the wire.
- [Retraction — scrml's Living Compiler](./living-compiler-retraction-devto-2026-05-21.md). The "scrml's Living Compiler" article has been retracted; scrml chose a sealed, deterministic build-story model instead.
- [What scrml's LSP can do that no other LSP can, and why giti follows from the same principle](https://dev.to/bryan_maclee/what-scrmls-lsp-can-do-that-no-other-lsp-can-and-why-giti-follows-from-the-same-principle-4899). What vertical integration unlocks for tooling and version control.
- **scrml on GitHub:** [github.com/bryanmaclee/scrmlTS](https://github.com/bryanmaclee/scrmlTS). The working compiler, examples, spec, benchmarks.

<!--

## Internal verification trail (private — agent-only, not for publish)

This block is an HTML comment so it does not render on dev.to.

- Bio: `/home/bryan/scrmlMaster/scrml-support/voice/user-bio.md` (v1, signed off 2026-04-27; project memory marks BAKED 2026-04-28).
- Private draft + verification log: `/home/bryan/scrmlMaster/scrml-support/voice/articles/css-without-build-step-draft-2026-04-29.md`.
- Companion published: `why-programming-for-the-browser-needs-a-different-kind-of-language-devto-2026-04-27.md` (the six-feature overview this piece zooms in on; CSS section §4 was the one-paragraph gesture this article executes in full).
- Companion published: `npm-myth-devto-2026-04-28.md` (CSS-in-JS / scoping listed in the "replaced by language" tier of the package-list collapse).
- Companion published: `server-boundary-disappears-devto-2026-04-28.md` (same compile-to-primitive pattern, applied to the server boundary instead of styles).
- Companion published: `lsp-and-giti-advantages-devto-2026-04-28.md` (verification-log structural pattern reused).
- Agent: `/home/bryan/.claude/agents/scrml-voice-author.md` (article mode, gate cleared per project memory bio-baked 2026-04-28).
- SPEC: `/home/bryan/scrmlMaster/scrmlTS/compiler/SPEC.md` (§9.1 lines 4901-4925, §25.6 lines 11579-11622, §26 lines 11626-11643 cited).
- Design provenance: `/home/bryan/scrmlMaster/scrml-support/design-insights.md:454-494` (DQ-7 ratification, Approach B, "Baseline since Dec 2025 (Chrome 143+, Firefox 146+, Safari 26.2+)" attribution at line 466).

**Spec validation summary:**

- ✅ §9.1 inline CSS context — current. `#{}` valid in markup, state, and program scope. DQ-6 + DQ-7 normative statements both verified at SPEC.md:4909-4925.
- ✅ §25.6 native `@scope` compile target — current. Compilation rules (selector-based → `@scope ([data-scrml="Name"]) to ([data-scrml]) { ... }`, flat-declaration → inline `style=""`, program-level → unwrapped global, donut implicit, Tailwind exempt) all match spec lines 11583-11599.
- ✅ DQ-7 ratification provenance — design-insights.md:454-494 (2026-04-10, Approach B chosen over A=hash-mangle and C=hybrid). PA-attributed; user-voice does NOT contain a verbatim DQ-7 ratification quote. Article does not claim user-quoted ratification; it cites the spec normative outcomes only.
- ✅ `#{}` syntax current — both in §9.1 grammar and §25.6 examples. Sigil unchanged.
- ✅ Built-in Tailwind utility engine — confirmed: SPEC.md §26 (lines 11626-11643) "scrml compiler IS the build step", "embedded in the compiler", "ONLY the CSS rules for classes that are actually used". Cross-references intro-article line 63 ("built-in Tailwind engine"). User-voice corroboration: voice-archive:2666-2669 (S11 README clarification — user asked, agent confirmed embedded engine).
- ⚠️ Tailwind engine narrowness — §26.3 "Open Items" tracks three explicit gaps under SPEC-ISSUE-012: arbitrary values (`p-[1.5rem]`), responsive/variant prefixes (`md:`, `hover:`), custom theme. Article includes both the positive claim AND the two honest disclosures. Reader is not misled.
- ✅ `@scope` browser baseline status — design-insights.md:466 (2026-04-10 PA-recorded): "Baseline since Dec 2025 (Chrome 143+, Firefox 146+, Safari 26.2+)." Today (2026-04-29) is ~5 months past Baseline. Article uses the precise spec-of-record claim "reached Baseline in December 2025" + names the three browser-version floors. Soft-claim handled.

**Forbidden territory check (bio §6):** all clear.

- React-hobble disclosure preserved verbatim from bio §2b.
- Framework-fatigue narrative avoided. Article frames frameworks-built-scoping-themselves as historical/structural ("in 2019, scoped styles were not a primitive"), not autobiographical.
- Tailwind treatment is constructive: "the system is good. The plumbing it sits on is a build pipeline you maintain." Then the built-in engine paragraph keeps the *system*. No wholesale rejection.
- Motivations: "obsessed with performance" (bio §3f), "do it right, the first time" implicit cadence, "thrilled to be wrong" + "a little short of perfect is still pretty awesome" closing pattern (bio §3k).
- Prior-art credit: `@scope` to the browser standards process; styled-components/emotion/Tailwind/CSS Modules/vanilla-extract all named as the prior frameworks-shipped-it-as-a-library work. scrml's contribution scoped to "compile to the native primitive."

**Voice-constraint compliance:**

1. NO reception-fabrication. Article makes no claim about adoption, community response, or imagined developer reaction.
2. Active first-person. Opener: "I designed", "I almost laughed", "I have written enough CSS". No detached narrator.
3. NO Rails "opinionated." Word does not appear.
4. Em-dash / en-dash purge complete. Body uses periods, commas, colons, parentheses, semicolons. Hyphens in compound modifiers (`single-file`, `compile-time`, `state-type`, etc.) are real hyphens, not dashes.
5. Typo / contraction protocol: article-body contractions standard (`don't`, `doesn't`, `isn't`); citations preserve user verbatim including any typos.
6. Authorship line + TL;DR + Further reading + this internal verification trail block all present.

**Same-batch siblings (per dispatch brief):** `components-are-states-devto-2026-04-29.md`, `orm-trap-devto-2026-04-29.md`, `mutability-contracts-devto-2026-04-29.md`, `realtime-and-workers-as-syntax-devto-2026-04-29.md` — none exist yet at draft time. Not linked from public Further reading (would 404). Cross-link planned after publish.

-->
