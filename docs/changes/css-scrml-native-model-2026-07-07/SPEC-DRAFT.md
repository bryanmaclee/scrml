# SPEC DRAFT — §65 The scrml-native CSS Model (predictable, cascade-free styling)

**Change-id:** `css-scrml-native-model-2026-07-07`
**Date:** 2026-07-07
**Status:** draft
**for:** SPEC §65 (Nominal) — the scrml-native CSS model (new top-level section; **the number `65` is the next-available top-level § as of this draft — assign at apply, section-relative, do NOT hardcode the number**)
**Classification:** SPEC-TEXT / **Nominal** (spec-ahead-of-implementation). v1.next / post-freeze. The model SURFACE + the `E-STYLE-*` / `W-STYLE-*` / `E-THEME-*` / `E-DEFAULTS-*` diagnostic codes are **NAMED** here; their **§34 catalog rows land WITH the impl wave** per Rule 4 / the §38.13 · §60 · §61 · §64 named-codes-land-with-impl precedent. **NONE at this landing.**
**authority:** `../../../../scrml-support/docs/deep-dives/css-scrml-fication-2026-07-07.md` DD (axes 1–3 LOCKED; §Rulings — 9 ratified decisions 2026-07-07) + bryan rulings 2026-07-07. Rulings are LOCKED; this text is built FROM them, not a re-litigation.

> **This is a DRAFT the PA reviews before it is applied to `SPEC.md`.** It does NOT touch `compiler/SPEC.md`. It is not committed as a SPEC change. Apply at a clean landing per the instructions below.

---

## Apply instructions (at landing — section-relative; SPEC.md line numbers drift, do NOT hardcode)

1. Append **§65** (below, "THE NEW SECTION") as a **new top-level section**, after the current last top-level section (§64 `Standalone Tool Target` as of this draft), before any appendix. Assign the next-available top-level number at apply time and update every self-reference in this draft to the assigned number.
2. Amend **§9.1** (Inline CSS Context) — the scoped `#{}` emission is KEPT; it GAINS flat-specificity `:where()` wrapping + the `E-STYLE-CONFLICT` conflict-checker on top (§A below).
3. Amend **§25** (CSS Variable Syntax) — KEPT as the raw custom-property layer; REFRAMED as the lowering target of §65 `<theme>` tokens (§B below).
4. Amend **§26** (Tailwind) — KEPT as the atomic escape-hatch; GAINS the fixed `@layer` order (utilities-LOW) + the utility-vs-utility `E-STYLE-CONFLICT` exemption + the OQ-2b same-property-utility-collision follow-on note (§C below).
5. Amend **§4.15** + **§24.4** structural-element registries — add `<theme>` and `<defaults>` (§D below).
6. Regenerate `SPEC-INDEX.md` (`bun run scripts/regen-spec-index.ts`) + add the §65 Quick-Lookup topic rows.
7. **§34 rows: NONE at this landing** (Nominal / named-with-impl per Rule 4).

---

# THE NEW SECTION

## 65. The scrml-native CSS Model — predictable, cascade-free styling

> **Nominal (spec-ahead-of-implementation).** This section is normative for the SURFACE (the styling model, the resolution algorithm, the `<theme>`/`<defaults>` structural elements, the `style=`-value application, and the named diagnostics). The compiler wiring — the conflict-checker pass, `:where()`-flat emission on scoped `#{}`, the `@layer` order emission, the reset block, token → `:root` custom-property lowering, the `style`-value type + `style=` value-shape dispatch, and the `E-STYLE-*`/`W-STYLE-*`/`E-THEME-*`/`E-DEFAULTS-*` diagnostics — is the follow-on impl wave that flips this banner. Sequencing: §65.13.

### 65.0 Thesis — predictability as a language guarantee

CSS conflates *essential* complexity (boxes, color, type, spacing, breakpoints, states, motion) with *accidental* complexity: to know one element's final value for one property you must know **every rule in the whole stylesheet that could match it**, then resolve by the cascade (origin → layer → specificity `(id, class, type)` → source order). That resolution is **non-local** — the exact antithesis of scrml's co-location axiom ("look at the thing, know what it does").

scrml already ships ~70% of a cascade-free model by construction (§9.1 scoped `#{}` with a `@scope` donut, no `:deep()`, non-mangled class names; §26.6 `prose` `:where()`-flat; §26 utility-first). §65 closes the remaining gap and turns "predictable" from an emergent property into a **guarantee**: an ambiguous overlap is a **compile error** (`E-STYLE-CONFLICT`, §65.2) — the styling analog of an exhaustive `match` (§18). The compiler refuses to silently pick a winner for you.

This is the [[limit-primitives-not-godify]] move: CSS's cascade is a **god-primitive** doing scoping, layering, theming, overriding, inheritance, and conflict-resolution at once by one implicit weighting. §65 does not tame it — it splits its jobs into bounded, explicit, locally-reasoned primitives (flat specificity · DOM-inheritance · token-flow · element-defaults · a fixed reset · style-as-value), each of which you can look at and know what it does. **Specificity is deleted** (§65.2); its disambiguation job is handed to the author, at compile time.

### 65.1 The single resolution algorithm (no specificity step)

There is exactly **one** resolution algorithm, and it has no "search the whole stylesheet, weight by specificity" step. For a property `P` on an element `E`, the final value is the first of:

```
final value of P on E =
  1. E's applied style=  (per-instance: a quoted-literal `style="…"`, an applied style-VALUE,
                          or an ordered `style=[a,b]` list → last-in-list wins)          [§65.4, §65.5]
  2. else E's component-scope `#{}` selector rule that sets P                             [§9.1]
        └─ two UNCONDITIONAL scope rules that both set P and both provably match E →
           E-STYLE-CONFLICT (same-level ambiguity; §65.2.1)
        └─ CONDITIONAL rules (:hover / :focus / [attr] / @media / @container) override
           while their condition holds — deterministic LAYERS, not conflicts (§65.2.2)
  3. else a `<defaults>` element-default for E's tag that sets P                          [§65.3.3]
  4. else, if P is natively-inherited: the value inherited from E's nearest ancestor      [§65.3.1]
  5. else the built-in reset's value for P                                               [§65.3.4]
  6. else the browser initial value
```

Every step is a **finite, local** lookup — the applied `style=` you can see on the element, the co-located `#{}` you can see in the component, a finite ancestor chain, one fixed reset. Tailwind utilities (§26) slot in as a fixed `@layer` (§65.8) **below** the component-scope author rules (utilities-LOW, §65.8). That deletion of the global specificity search **is** the design.

> **Reconciliation note (for the applying editor).** The DD §2 resolution box (DD lines 100–111) lists step 1 = "E's LOCAL rules" and step 2 = "an APPLIED style-value" — that ordering PRE-DATES DD §Rulings row 5, which **REVISED** it so the applied `style=` WINS over the target's own scope selector rule (inline-beats-class intuition; `style=` IS the per-instance override). The algorithm above is written in the **ruled** order (applied `style=` first). See §65.5.

### 65.2 Axis 1 — flat specificity + `E-STYLE-CONFLICT`

No specificity weighting. **All scrml-emitted selectors are specificity-flat.** scrml already emits `:where()`-flat rules for §26.6 `prose` (holding descendant rules at `(0,1,0)`); §65 reuses that same mechanism for every author selector inside a scope (§65.2.5). The cascade's specificity tiebreaker is deleted; its job is handed to the author at compile time.

#### 65.2.1 Unconditional overlap = a compile error

An **UNCONDITIONAL** same-property overlap on a **provably-shared element**, between two rules **at the same precedence level** (§65.5), is `E-STYLE-CONFLICT`. Two rules that both set `color` on an element that provably matches both, with no distinguishing condition and no author-declared order, are ambiguous → the author disambiguates. This is styling's analog of an exhaustive `match`: the compiler will not silently pick.

The canonical shape is **two component-scope `#{}` selector rules** that both provably match one element in the scope's markup (a broad `button {}` fighting a specific `.btn {}` on a `<button class="btn">` — today's silent bug). The other shape is two **ambient** applied style-values (NOT an explicit ordered `style=[a,b]` list) that both set `P` on one element.

> **Reconciliation note (for the applying editor).** The DD §3.5 `E-STYLE-CONFLICT` row lists "a rule + an applied style-value" among the firing cases. Under §Rulings row 5 (§65.5) a scope-rule-vs-applied-`style=` pair is now **precedence-ordered** (the applied `style=` wins) — so it is NOT a conflict. `E-STYLE-CONFLICT` fires only on same-LEVEL overlaps (two scope selector rules; two ambient non-list style-values). The DD §3.5 wording predates row 5; this section supersedes it.

#### 65.2.2 Conditional rules = deterministic layers, not conflicts

A state (`:hover`, `:focus`), attribute (`[busy]`, `[invalid]`), or media/container (`@media`, `@container`) rule wins **while its condition holds** — that is well-defined, local, and predictable. It is a deterministic **LAYER over** the base, not a conflict. This is the 95% case (base + hover + responsive) and it never fires an error. The error therefore fires exactly where a human would have been surprised (an unconditional both-match) and nowhere else — the carve-out that keeps the guarantee affordable.

#### 65.2.3 Same-axis recursion + cross-axis overlap (`E-STYLE-CONDITION-OVERLAP`)

The conditional carve-out is **recursive**:

- Two **CONDITIONAL** rules **on the same axis** that can both be active for one element and set the same property (two overlapping `@media` ranges; `:hover` set twice with different values on one property) are themselves a conflict → the same `E-STYLE-CONFLICT` family (a same-axis ambiguity).
- Two **DIFFERENT-axis** conditional rules that **provably co-occur** (a `@media` viewport condition and a `@container` condition that can both hold at once) and set the same property → `E-STYLE-CONDITION-OVERLAP` (§Rulings row 4 — chosen over a fixed axis-order fallback; the guarantee wins). The author writes the **combined** condition (nest them, or `@media (...) and @container (...)`).

#### 65.2.4 Decidability — co-location-resolved core + fail-closed residue

The checker decides, for two same-property rules R1/R2: is there an element both can match (**provably-shared**), and are they otherwise **provably disjoint**? Global CSS conflict-detection is undecidable in the open world, but scrml's CSS is **co-located** with its markup in the same donut scope — the checker resolves selectors against a **KNOWN, bounded element set (the scope's actual markup)**, not an abstract selector intersection. This is the same co-location that powers dead-CSS elimination (§26.2), reused.

**Decidable — hard `E-STYLE-CONFLICT` on a proven overlap:**

- `tag × tag` (same tag → shared; different tag → provably disjoint — an element has exactly one tag name);
- `class × class`, `tag × class`, `id × *` — resolved against the static markup element-set (shared iff some element in the scope carries the intersection);
- attribute-presence and mutually-exclusive attribute values on one attribute (`[type="submit"]` vs `[type="button"]` → provably disjoint);
- combinators (`.card .title`, `.a > .b`) over **static** markup (the tree is known → matches are enumerable).

**Fail-closed — soft `W-STYLE-CONFLICT-POSSIBLE` (non-blocking; names both loci; asks for disambiguation):**

- combinator / `:not()` / `:has()` / sibling (`~`, `+`) selectors over **dynamic** markup (`<each>`, conditional subtrees) where the element set is not fully static;
- `@media × @container` cross-axis both-active pairs the checker cannot prove co-occur (contrast the provable case → `E-STYLE-CONDITION-OVERLAP`, §65.2.3);
- program-level global `#{}` (no donut → unbounded element set → not enumerable; the global escape hatch inherently gets the weaker guarantee — §65.9, OQ-8).

**The fail-closed rule:** a pair the checker can **neither** prove-disjoint **nor** prove-shared SHALL be surfaced (err toward flagging the risk), but as the **soft** `W-STYLE-CONFLICT-POSSIBLE`, not the hard block. A legitimately-disjoint-but-unprovable pair is *warned*, not *rejected*. Hard `E-STYLE-CONFLICT` is reserved for **proven** ambiguity. This split is what keeps the guarantee real without a false-positive wall adopters would disable — and its boundary is the one make-or-break risk (§65.11 MVP gate).

#### 65.2.5 `:where()`-flat emission (the flat-specificity mechanism)

Flat specificity is *emitted* by wrapping author selectors in `:where()` so every rule resolves to `(0,0,0)` and only the `@layer` order (§65.8) + source order remain as tiebreaks — the mechanism scrml **already** ships for §26.6 `prose`. Normative obligations carried over from that proven surface:

- The compiler SHALL emit `:where()`, **never** `:is()`, for flat wrapping (`:is()` spikes to its most-specific argument — `:is(#id, .c)` → `1-0-0`), and SHALL NOT fold an id-bearing selector into an `:is()` list.
- Pseudo-element rules (`::before`/`::after`) are emitted **unwrapped** — `:where(::before)` matches nothing, and a bare pseudo-element already carries `(0,0,0)`, so no specificity is added.
- The compiler SHALL **validate author selectors and fail loud** — it MUST NOT rely on `:where()`/`:is()`'s forgiving-list behavior (they silently drop an unparseable selector). scrml already parses author selectors for the conflict-checker; an unparseable selector is a compile error, never a silent drop.

#### 65.2.6 The `--explain-style` DX complement (not the resolution rule)

`--explain-style` (CLI) / an LSP hover "resolved style" view prints the §65.1 resolution chain for an element (which rule/value/default/inherited/reset supplied each property, and why). This is the **debugging** aid; the **guarantee** is the `E-STYLE-CONFLICT` error, not this view. Predictability comes from the error, not from a tool that helps you trace a cascade you should not have.

### 65.3 Axis 2 — the bounded cascade (kill the selector cascade; keep two structural channels)

The *selector* cascade is deleted. **Two** structural channels remain — each bounded, each locally reasoned:

#### 65.3.1 DOM-inheritance (the natively-inherited property set)

The natively-inherited properties (`color`, `font-*`, `line-height`, `letter-spacing`, …) still flow down the **render tree**. This is bounded (only inherited props), structural (follows the DOM, not a global selector space), and predictable (you look **up** a finite, visible ancestor chain — not across a global rule space). `@scope`/the donut bounds *selector matching*, **not** inheritance: a parent's `color` DOES inherit into a child component's elements (the intended channel), while the parent's `.title {}` does NOT match the child's `.title` (the donut stops matching). Two orthogonal channels — stated explicitly: **"`@scope` bounds matching, not inheritance."**

#### 65.3.2 Token-flow — `<theme>` named values → CSS custom properties

A **`<theme>`** structural element (§65.9, §D) declares named VALUES referenced **explicitly at use sites**:

```scrml
<theme>
    brand   = #2563eb;
    danger  = #dc2626;
    line    = #e2e8f0;
    space-4 = 1rem;
</theme>
```

`color: brand` at a use site resolves `brand` from the in-scope `<theme>`. Token references are **opt-in → no action at a distance**: *defining* a token changes nothing; only an *explicit reference* applies it. `<theme>` tokens **lower to CSS custom properties** (`:root { --brand: #2563eb; }`; a `color: brand` reference → `color: var(--brand)`) — reusing the §25 custom-property machinery (§B). This **UNIFIES token-flow with custom-property inheritance** as one mechanism: the token is available (inherits) as a *value*, and is *applied* only where referenced.

A `color: brand` whose token is declared in no in-scope `<theme>` SHALL emit `E-THEME-TOKEN-UNKNOWN`.

> **Token-flow does NOT clash with custom-property inheritance** (DD §3.6 / §6 hole 6). Custom-property inheritance carries **value-availability**, not **style-application** — a token being *in scope* is not a style being *applied*; nothing is styled until a property *explicitly references* it. So token-flow's "no action at a distance" (about *styling*) is untouched by custom-property inheritance (about *value availability*). This is distinct from §65.3.1 DOM-inheritance of `color`/`font`, which *does* apply styling down the tree — the separate, blessed, bounded channel.

#### 65.3.3 `<defaults>` — app-wide element defaults, locally overridable

A **`<defaults>`** structural element (§65.9, §D — NOT `<base>`: that is a standard HTML element, §65.9) declares app-wide **bare-element** defaults, locally overridable by any component-scope rule:

```scrml
<defaults>
    a     { color: brand; }        // app-wide default for every <a>, overridable
    label { font-weight: 600; }    // bare-element only
</defaults>
```

`<defaults>` is for **bare-element** defaults only (`a {}`, `body {}`, `label {}`). A non-bare-element selector inside `<defaults>` (`.class`, `#id`, a combinator/complex selector) SHALL emit `E-DEFAULTS-MISUSE` — everything class/id/structural belongs to a component. A `<defaults>` rule *universally* overridden (every element of that tag carries a local rule for the property) is a dead default → `W-STYLE-DEFAULTS-DEAD` (info). `<defaults>` sits below the component-scope rule and below applied `style=` in the precedence chain (§65.5).

#### 65.3.4 The built-in reset (opt-out-able, its own bottom layer)

A **built-in sane reset** ships (`box-sizing: border-box`, zeroed default margins, sensible element defaults) so no reset-boilerplate is needed. It lives in the bottom **`reset`** `@layer` (§65.8) — *below* everything author — so a reset rule and an author rule for one property are **layered** (deterministic), never a same-layer overlap; `E-STYLE-CONFLICT` fires only *within* a layer. The reset is **opt-out-able**. It is the **one** sanctioned universal global block — justified because a reset is genuinely app-wide (every app wants it), reconciling with the §26.7 "no per-utility global preflight block" minimalism axiom (scrml avoids a *per-utility* global var block, but a small, fixed, universal reset is sanctioned).

> **OPEN (PA to close with bryan).** OQ-9 ruled "a built-in reset ships, opt-out-able, in its own layer," but did NOT fix (a) *which* reset (the exact frozen, documented ruleset) nor (b) the *opt-out syntax*. Both are under-specified — see §65.12.

### 65.4 Axis 3 — style-as-value (mirrors Pillar 1 markup-as-value)

A `#{}` bound to a name is a first-class **style VALUE** — the styling analog of the §1.4 markup-as-value pillar.

#### 65.4.1 `#{}` in expression vs statement position (mirrors markup exactly)

A `#{}` in **statement position** (bare in a component body / at program level) is a **stylesheet block** — the existing §9.1 behavior, unchanged (scoped inside a component; global at program level). A `#{}` in **expression position** (RHS of `=`, inside a `style=` attribute, inside a `[…]` list) is a **style value**:

```scrml
const chrome = #{ padding: space-4; border: 1px solid line; }   // a named style VALUE
```

This is the identical grammar lever that distinguishes `const x = <div/>` (a markup value) from a bare `<div/>` (rendered markup) — "expression position vs statement position." The existing §9.1 **flat-declaration `#{}`** (the dominant corpus pattern) is thereby **re-explained, not changed**: an inline flat `#{}` on an element is an **anonymous** style-value applied once; `const chrome = #{…}` is the same thing *named* for reuse. **Zero migration** — a conceptual unification (§65.14 migration).

#### 65.4.2 Applying a style-value — `style=` value-shape overloading

`style=` is overloaded by value-shape — reusing scrml's existing quoted-literal-vs-binding discrimination (`class="btn"` literal vs `value=name` binding). No new attribute name:

| Form | Meaning |
|---|---|
| `style="padding: 16px"` / `style="background:${color}"` | a **quoted string literal** → raw inline CSS pass-through (the heavy corpus pattern, incl. `${}` interpolation — MUST stay working, back-compat) |
| `style=chrome` | a **bare identifier** → a style-VALUE binding (`chrome` : a `#{}`-value of type `style`) |
| `style=[a, b]` | a **list** → ordered composition, last-in-list wins (§65.4.4) |
| `style=@expr` | a **reactive** binding → the applied style-value re-evaluates on `@expr` change |

`style=<expr>` where `<expr>` is neither a quoted string literal nor a `style`-typed value/list SHALL emit `E-STYLE-VALUE-NOT-STYLE`. Dynamic raw CSS is **only** the quoted-literal form — you cannot apply an arbitrary runtime string as a style-value (that would reopen the injection surface).

#### 65.4.3 FLAT-single-element scope; `E-STYLE-VALUE-DESCENDANT`

A style-value is **FLAT-single-element** (§Rulings row 1): it styles **its own element** plus that element's **own** conditional variants (`:hover`, `:focus`, `[attr]`, `@media`, `@container`) and its **own** generated pseudo-elements (`::before`/`::after` — part of the element, not descendants):

```scrml
const field = #{
    display: block; width: 100%; padding: space-4; border: 1px solid line;
    &:focus    { border-color: brand; }    // this element's own state — a layer
    &[busy]    { opacity: 0.6; }            // this element's own attr — a layer
    &::before  { content: ""; }             // this element's own pseudo-element
    @media (min-width: 700px) { padding: space-6; }
}
```

A **descendant** selector inside a `#{}`-value (`.title { … }`, `& > div { … }` — a selector that reaches into a child the element does not own) SHALL emit `E-STYLE-VALUE-DESCENDANT`, with the message routing the author to **make a component** (owned subtree) or **use a content-treatment** (un-owned subtree — OQ-6). This is the same cut vanilla-extract's `style()` draws (self-target only; descendants throw → `globalStyle()`), arrived at independently and validated in production. A descendant-bearing style-value would be a *half-component* — a strictly weaker, blurrier component that cannot add structure but can reach into it: a god-ification of the treatment primitive ([[limit-primitives-not-godify]]). The sharper cut is *more* powerful because it is unambiguous — at any `<x style=v>` you know `v` touches only `<x>`, never its children.

#### 65.4.4 Composition — the explicit ordered list `style=[a, b]`

Composition is an **explicit ordered list** `style=[a, b]` → **last-in-list wins**. This is *deliberate ordering* (like function-argument order), **not** a cascade, and it is distinct from §65.2.1's "unordered ambient overlap is an error": order resolves a conflict **only when the author explicitly wrote the order**. An *ambient* overlap (two rules that merely happen to match) is `E-STYLE-CONFLICT`; an *explicit* `style=[a,b]` order is sanctioned intent.

#### 65.4.5 Conditional + reactive application (existing machinery)

Conditional application reuses the **`class:`-family** (§5.5.2) sibling: **`style:name=@cond`** applies the style-value `name` while `@cond` holds. Reactive application is the `style=@expr` form of §65.4.2 (re-evaluates on change). No new mechanism (§Rulings row 7 — "both, via existing machinery").

```scrml
<input type="email" style=field style:invalid=@hasError />
```

#### 65.4.6 Division of labor — component vs style-value

**A component is a new element; a style-value is a treatment on an existing element.** A component *adds a node* (and may own + style that node's descendants via its own scoped `#{}`); a style-value *does not add a node* and touches only the element it is applied to (§65.4.3). This is the mixin/utility role a component structurally cannot fill, and the division that keeps "is this a treatment or a component?" from ever being ambiguous.

### 65.5 Precedence — a single fixed order, no specificity

One fixed chain, reasoned top-to-bottom, **no `(id,class,type)` arithmetic anywhere** (§Rulings row 5):

```
applied style=  >  component-scope `#{}` selector rule  >  <defaults> / DOM-inherited  >  built-in reset  >  browser initial
```

- **Applied `style=` is the per-instance override** and WINS over the target's own scope selector rule (inline-beats-class intuition — `style=` IS the per-instance override). This **REVISES** the DD axis-2 provisional "local rule > applied style-value"; §Rulings row 5 is authoritative.
- An explicit `style=[a, b]` list resolves internally by author order (last-in-list wins, §65.4.4) before competing as the single "applied `style=`" level.
- Tailwind `utilities` (§26) sit **below** the component-scope author rules (utilities-LOW) but above `<defaults>` — see the `@layer` order in §65.8. A co-located scope rule beats a global utility (axiom-consistent).
- Across levels the chain **orders** (never a conflict); *within* a level an unconditional same-property overlap is `E-STYLE-CONFLICT` (§65.2.1).

### 65.6 Reactive theming — the named-variant reactive selector (`@mode`)

`<theme>` tokens are **reactive**. Theming is a **named-variant reactive selector** (§Rulings row 3): a reactive selector cell (conventionally `@mode`) holds the active variant; switching it (`@mode = .Dark`) re-binds the active custom-property set with **one `:root` custom-property write**, natively propagated to every explicit use site, **zero re-render**. Because every use site *explicitly references* the token (`color: ink`), the whole page flips together — with **no** `[data-theme] .foo` global override selectors, no specificity war, no `!important`. The theme is a **value channel**, not a cascade.

A `<theme>` MAY also re-bind token values by a **media condition** (a deterministic layer):

```scrml
<theme>
    ink   = #0f172a;
    paper = #ffffff;
    @media (prefers-color-scheme: dark) {   // token VALUES re-bind by a media condition
        ink   = #e2e8f0;
        paper = #0f172a;
    }
</theme>
```

> **OPEN (PA to close with bryan).** §Rulings row 3 names the manual switch (`@mode = .Dark`) and the DD §4.3 shows the `@media` re-bind form, but the **`<theme>` variant-block declaration syntax** for a *named* variant set (how `<theme>` declares the `.Light` / `.Dark` token bundles that `@mode` selects, vs the `@media` auto form) is under-specified. Whether `@mode` is a reserved cell name or an ordinary reactive enum cell the adopter names, and how the variant blocks bind, is for the PA to close (§65.12).

### 65.7 `!important` — no internal use; one interop-only escape

Internal precedence is **guaranteed** (§65.5) → internal `!important` is a bug. `!important` in a scrml-author `#{}` / style-value SHALL emit `E-STYLE-IMPORTANT-INTERNAL` (§Rulings row 6 — "forbidden internally"). Exactly **one** interop-only escape exists: a narrow, lint-gated `!` form **only** for out-ranking an un-isolable third-party/foreign `!important` (a vendored/CDN stylesheet whose `!important` still inverts `@layer` precedence — a foreign important-in-a-lower-layer beats a scrml normal-in-a-higher-layer per CSS `@layer` semantics). Normal (non-important) foreign CSS is handled purely by the `thirdparty` layer being *below* author (§65.8) — no escape needed there.

> **OPEN (PA to close with bryan).** The exact **surface spelling** of the interop-only escape (§Rulings row 6 "one interop-only escape, lint-gated") is not fixed. See §65.12.

### 65.8 Tailwind (§26) relationship — the atomic escape hatch, one fixed `@layer` order

Tailwind stays as the **atomic escape hatch** — not replaced (its utility thesis won on its own merits; §26 is a large shipped surface). The coexistence contract is a **fixed `@layer` order**, emitted once, deleting the specificity race *within* each layer (§Rulings row 2 · §C):

```css
@layer reset, thirdparty, base, tokens, utilities, author;   /* later = higher; specificity deleted within each */
```

- **Utilities-LOW** (§Rulings row 2): the `utilities` layer sits **below** the `author` layer (scrml-native scoped `#{}` rules + style-values), so a **co-located scrml rule beats a global utility** — axiom-consistent with §65.5 local-authority. This **diverges** from the universal ecosystem convention (Panda / Tailwind v4 / vanilla-extract sprinkles all put utilities highest); the muscle-memory cost (`class="p-8"` silently loses to a component rule) is an **accepted** divergence, flagged. So `<button class="p-4" style=chrome>` (both padding) → `chrome` wins, `p-4` inert.
- **`<defaults>` → `base` layer**; `<theme>` tokens → `tokens` layer (custom-property definitions); third-party CSS → `thirdparty` layer; the reset → the bottom `reset` layer (§65.3.4).
- **Utility-vs-utility (`p-4 p-6`)** stays governed by Tailwind's own last-wins *inside* the `utilities` layer, **EXEMPT from `E-STYLE-CONFLICT`** at MVP. Because the whole order is fixed and each layer is `:where()`-flat, there is no specificity race and no `!important` anywhere — a single fixed precedence chain, not a reintroduced cascade.
- **OQ-2b follow-on (bounded, off by default):** scrml has the full `class=` list statically, so `p-4 p-6` is *exactly* an "unconditional same-property overlap on a provably-shared element" — §65.2 *could* turn Tailwind's #1 footgun into a compile error. This is a bounded follow-on, **off by default at first**, and it MUST **exempt the §26.7 composing families** (ring-2 + shadow-lg intentionally both touch `box-shadow`; the checker must know the composing-family set, which scrml already models). See §65.12 (deferred detail: OQ-3 token unification).

### 65.9 Structural-element keywords — the collision principle (`<theme>` kept; `<defaults>` not `<base>`)

`<theme>` and `<defaults>` are scrml-defined structural elements (siblings of `<program>`, `<page>`, `<engine>`, `<channel>` — "all scrml is scrml, one grammar"; §D registers them).

**Keyword-collision principle (bryan-ratified).** A corpus *state-cell name* colliding with a proposed keyword is **migration backlog, NOT a blocker** (Rule 2 — corpus is an artifact of past limits, not evidence of intent). ONLY a genuine scrml-language construct OR a **standard HTML element** blocks a keyword. Therefore:

- **`<theme>` is KEPT.** It is *only* a live corpus state-cell name today (`<theme> = "dark"`, `<theme>: Theme = .Light` — verified: multiple corpus files) — those were poor-man's proto-themes; the handful migrate (§65.14). No HTML element / language construct named `theme` blocks it.
- **`<base>` is NOT usable** — it is a **standard HTML element** (`<base href>`) *and* a corpus cell name. Element-defaults are spelled **`<defaults>`** instead.

### 65.10 Error / diagnostic codes (NAMED; §34 rows land WITH the impl per Rule 4)

| Code | Severity | Fires when |
|---|---|---|
| **`E-STYLE-CONFLICT`** | Error | An UNCONDITIONAL same-property overlap on a **provably-shared** element between two rules at the **same precedence level** — two component `#{}` scope selector rules, or two ambient (non-list) style-values — that the checker *proves* both match (§65.2.1). The flagship. Same-axis conditional overlaps (§65.2.3) also fall here. |
| **`E-STYLE-CONDITION-OVERLAP`** | Error | Two **DIFFERENT-axis** conditional rules that **provably co-occur** (`@media`×`@container` both-active) and set the same property (§65.2.3). Author writes the combined condition. |
| **`W-STYLE-CONFLICT-POSSIBLE`** | Warning (info) | The fail-closed soft diagnostic — selectors **not provably disjoint** over dynamic markup or the unbounded global `#{}` scope. Names both loci; asks for disambiguation; **non-blocking** (§65.2.4). |
| **`E-STYLE-VALUE-DESCENDANT`** | Error | A `#{}`-**value** (style-value) contains a **descendant** selector (§65.4.3). Message routes to *make a component* / *use a content-treatment*. |
| **`E-STYLE-VALUE-NOT-STYLE`** | Error | `style=<expr>` where `<expr>` is neither a quoted string literal nor a `style`-typed value/list (§65.4.2). |
| **`E-THEME-TOKEN-UNKNOWN`** | Error | A token reference (`color: brand`) resolves to no in-scope `<theme>` (§65.3.2). |
| **`E-DEFAULTS-MISUSE`** | Error | A `<defaults>` block contains a non-bare-element selector (`.class`, `#id`, combinator/complex) — `<defaults>` is bare app-wide element defaults only (§65.3.3). |
| **`W-STYLE-DEFAULTS-DEAD`** | Warning (info) | A `<defaults>` rule is *universally* overridden (every element of that tag has a local rule for the property) — a dead default (§65.3.3). |
| **`E-STYLE-IMPORTANT-INTERNAL`** | Error | `!important` inside a scrml-author `#{}` / style-value — internal precedence is guaranteed, so internal `!important` is a bug (§65.7). The one interop-only escape is exempt. |
| **`E-STYLE-KEYFRAMES-COLLISION`** | Error (or auto-namespace — **OQ-5, DEFERRED**) | Two component scopes define the same globally-named `@keyframes`/`@font-face`/counter that would leak. `@scope` bounds selector matching, not at-rule names. Disposition (auto-namespace `Card__spin` vs error-on-leak) is OQ-5 (§65.12). |

**`<onchange>`-style reuse (no dedicated codes):** `<theme>`/`<defaults>` **misplacement** reuses `E-STRUCTURAL-ELEMENT-MISPLACED` (§4.15/§24.4). A component/user-type named `theme`/`defaults` reuses `E-NAME-COLLIDES-RESERVED` (§4.15/§24.4).

**Not a code — the DX complement:** `--explain-style` (CLI) / the LSP "resolved style" hover (§65.2.6).

### 65.11 The MVP gate — dry-run the checker before the hard error ships

Wave 1 SHALL **build + dry-run the `E-STYLE-CONFLICT` checker on the existing `#{}` corpus surface** (83 files / 187 blocks — verified 2026-07-07) and **tune the decidable / fail-closed boundary (§65.2.4) BEFORE the hard error ships.** The predictability *guarantee* is the whole thesis, and its teeth depend entirely on that boundary: too eager → it blocks legitimate code and adopters disable the lint (the guarantee dies as a convention); too lax → fail-open silent last-wins (the guarantee was never real). Only a corpus-wide dry-run (hard-error rate, `W-STYLE-CONFLICT-POSSIBLE` rate, false-positive audit) can calibrate the boundary. This is the single make-or-break risk, and the reason Wave 1 is scoped to *run the checker on the existing `#{}` and tune it* before any new syntax lands.

### 65.12 Deferred / open questions (marked OPEN — NOT designed here)

Deferred Tier-3 per the DD §Rulings (PA leans recorded inline in the DD; do NOT design them in this draft):

- **OQ-3 — token unification with the Tailwind scale.** Should `<theme>` tokens and Tailwind's design-token scale (`blue-500`, `space-4`) be *one* space (a `<theme>` token extends/overrides the Tailwind scale; `bg-[brand]` resolves a theme token)? PA lean: yes, a Wave-3 integration. **OPEN.**
- **OQ-5 — `@keyframes` / `@font-face` / counter namespacing.** Globally-named at-rules inside a component collide globally (last-wins), un-scopable by `@scope`. Auto-namespace (component-owned, `Card__spin`; PA lean) or `E-STYLE-KEYFRAMES-COLLISION` on leak? **OPEN** (the one place scrml might have to name-mangle — animation names have no `@scope` remedy).
- **OQ-6 — a content-treatment primitive for un-owned subtrees.** A blessed `prose`-shaped primitive as the explicit home for un-owned-subtree (slotted/projected/markdown) descendant styling, or is §26.6 `prose` + "make a component" enough? The `E-STYLE-VALUE-DESCENDANT` message routes here. **OPEN.**
- **OQ-7 — `@apply` (§26.8) vs style-value, long-term.** Both compose reusable treatments (`@apply` composes *utilities*; a style-value composes *declarations + tokens*). Keep both, or does a style-value + an "apply-utilities-into-a-style-value" form subsume `@apply`? **OPEN.**
- **OQ-8 — global program-level `#{}` disposition.** No donut → unbounded element set → only the soft `W-STYLE-CONFLICT-POSSIBLE` (§65.2.4). Accept the weaker guarantee for the global escape hatch, or discourage/deprecate raw global *selector* `#{}` in favor of `<defaults>` + `<theme>`? **OPEN.**

**Additionally under-specified for SPEC prose (surfaced by this draft — PA to close with bryan; see the returned summary):** the reset ruleset + opt-out syntax (§65.3.4); the `<theme>` named-variant declaration syntax + whether `@mode` is reserved (§65.6); the `!important` interop-escape surface spelling (§65.7); the `E-DEFAULTS-MISUSE`/`W-STYLE-DEFAULTS-DEAD`/`E-STYLE-IMPORTANT-INTERNAL` code spellings (DD used the pre-rename `-BASE-` forms and named no internal-important code); and `<theme>`/`<defaults>` placement scope (program-scope assumed; page-scope override not addressed).

### 65.13 Worked adopter example (a themed app)

A themed form: `<theme>` tokens + `<defaults>` element-defaults + a component with a scoped `#{}` + a `style=`-applied treatment + a `style:name=@cond` conditional + dark-mode via `@mode`.

```scrml
<program>

  <theme>                                     // §65.3.2 — named values; lower to :root custom properties
      brand   = #2563eb;
      danger  = #dc2626;
      line    = #e2e8f0;
      ink     = #0f172a;
      paper   = #ffffff;
      space-4 = 1rem;
      space-6 = 1.5rem;
      .Dark {                                 // §65.6 — the named variant `@mode` selects (variant-block
          ink   = #e2e8f0;                    //          syntax is OPEN — see §65.6 note)
          paper = #0f172a;
      }
  </theme>

  <defaults>                                  // §65.3.3 — bare-element app-wide defaults, overridable
      body  { color: ink; background: paper; }
      a     { color: brand; }
      label { font-weight: 600; }             // a `.class` here → E-DEFAULTS-MISUSE
  </defaults>

  <mode>: Theme = .Light                      // the reactive selector cell (§65.6); switch flips :root once

  const field = #{                            // §65.4 — a FLAT-single-element style VALUE
      display: block; width: 100%;
      padding: space-4; border: 1px solid line; border-radius: 6px;
      &:focus  { border-color: brand; }       // this input's OWN state — a deterministic layer (§65.2.2)
      &[busy]  { opacity: 0.6; }
  }

  const SignupForm = <form props={ onsubmit: fn }>
      #{                                       // §9.1 component-scope stylesheet — @scope donut, :where()-flat
          .row  { margin-bottom: space-6; }
          .hint { color: line; font-size: 0.85rem; }
      }
      <div class="row">
          <label>Email</label>
          <input type="email" style=field style:invalid=@emailBad />   // §65.4.5 conditional application
      </div>
      <div class="row">
          <label>Password</label>
          <input type="password" style=field />
          <span class="hint">8+ characters</span>
      </div>
      <button class="px-4 py-2 rounded-md" style=[field, primaryButton]>Sign up</button>
      //                    ↑ Tailwind utilities (utilities layer, §65.8 — BELOW author)
      //                                          ↑ §65.4.4 ordered style-values; primaryButton wins ties
      <button onclick=(@mode = @mode == .Dark ? .Light : .Dark)>Toggle theme</button>   // §65.6 — one :root write
  </form>

</program>
```

You can look at `<input type="email" style=field …>` and **know** it is styled by `field` (self only), the two `<defaults>` bare-element rules, DOM-inherited `color`/`font` (§65.3.1), and the reset — a finite, visible list. Nothing three files away reaches in. Toggling `@mode` re-binds `ink`/`paper` at `:root` once; every explicit `color: ink` / `background: paper` flips together, zero re-render (§65.6).

### 65.14 Migration + back-compat — additive layer, near-zero forced migration

Corpus reality (verified 2026-07-07): **83 of 4946 `.scrml` files use `#{}` (187 blocks)** — CSS is a *sparse* surface; the dominant pattern is flat-declaration inline `#{}`.

| Today | Under §65 | Migration cost |
|---|---|---|
| §9.1 scoped component `#{}` (`@scope`, donut, no mangling) | **KEPT unchanged** in emission (§A). The conflict-checker (§65.2) is *added on top* — new diagnostics only. | ~0 emission. Some components may trip `E-STYLE-CONFLICT` on genuine unconditional overlaps — those are *today-bugs*; surfacing them is the point. (Wave-1 corpus dry-run quantifies — §65.11.) |
| §9.1 flat-declaration `#{}` → inline `style=""` | **REFRAMED** as anonymous style-values (§65.4.1). Emission unchanged. | 0 (conceptual only). |
| §25 CSS vars (`name = value` / `prop: name fb`) | **KEPT** as the raw custom-property layer (§B). `<theme>` tokens are the new blessed named-value channel and lower to §25 custom properties. | 0; `<theme>` is opt-in additive. |
| §26 Tailwind + variants + `prose` (§26.6) + §26.7 composing + §26.8 `@apply` | **KEPT** as the `utilities` bottom layer (§65.8). `@apply` still composes utilities into an author-layer class. | 0. |
| Program-level global `#{}` selector CSS | **KEPT** (escape hatch) but *discouraged* in favor of `<defaults>` + `<theme>`; gets only the soft `W-STYLE-CONFLICT-POSSIBLE` (unbounded scope — §65.2.4). | 0 forced; nudge only (OQ-8). |
| Corpus `<theme>` / `<base>` **state-cell** names (verified live — the §65.9 collision) | `<theme>` is RECLAIMED as the structural element (§65.9); the handful of corpus cells migrate to a different cell name. `<base>` cells are unaffected (`<base>` is NOT reclaimed — element-defaults are `<defaults>`). | Small, bounded — a rename of the handful of `<theme>` cells (Rule 2 migration backlog). |

**`<theme>` / `<defaults>` / `style=<value>` / `style=[…]` / `style:name=` are all NEW opt-in surfaces** — adopt incrementally, file by file. **Net: additive, near-zero forced migration** — the only forced changes are the genuine `E-STYLE-CONFLICT` conflicts (today-bugs) and the `<theme>`-cell renames. A v1.next additive layer, not a breaking rewrite — which is why it is post-freeze-appropriate (§65.13 sequencing / §8 of the DD).

### 65.15 Implementation status (Nominal) — the waves

SPEC-TEXT only at this landing. Sequencing (ship the guarantee on what exists first; add new syntax last):

- **Wave 1 — harden what already ships.** The axis-1 conflict-checker on the existing component `#{}` surface (`E-STYLE-CONFLICT` for the decidable core, §65.2.4) + `:where()`-flat emission (already proven for `prose`) + the built-in reset layer + `<theme>`/tokens (blessed named-value channel over §25) + `--explain-style`. **Gated on the §65.11 corpus dry-run.**
- **Wave 2 — style-as-value.** `const chrome = #{}` + `style=<value>` + `style=[a,b]` + `style:name=` + the `<defaults>` layer + the §65.5 precedence order formalized + the `E-STYLE-VALUE-*` codes.
- **Wave 3 — integration + edges.** Tailwind `@layer` integration (§65.8) + token unification (OQ-3) + `@keyframes` namespacing (OQ-5) + `@layer thirdparty` interop + the `!important` interop escape (§65.7) + optional same-property utility-collision detection (OQ-2b).
- **Full.** Conditional-axis conflict recursion (`@media`×`@container` → `E-STYLE-CONDITION-OVERLAP`), the fail-closed `W-STYLE-CONFLICT-POSSIBLE` over dynamic markup, the LSP resolved-style hover.

The §34 catalog rows for every `E-STYLE-*`/`W-STYLE-*`/`E-THEME-*`/`E-DEFAULTS-*` code land **with the wave that implements each** (Rule 4). The build-cost profile is favorable — mostly *add a checker + light emission deltas on existing infra*, not a CSS-pipeline rebuild; the single large item (and single largest risk) is the conflict-checker's decidability core (§65.11).

### 65.16 Cross-references

§9.1 (scoped `#{}` — KEPT, gains §65.2 + §65.2.5; §A) · §25 (CSS variables — the `<theme>` lowering target; §B) · §26 / §26.6 (`prose` `:where()`-flat — the proven flat-specificity precedent) / §26.7 (composing families — the utility-collision exemption) / §26.8 (`@apply` — OQ-7); the Tailwind `@layer` (§C) · §4.15 / §24.4 (`<theme>`/`<defaults>` structural-element registry; §D) · §5.5.2 (`class:name=expr` — the `style:name=` sibling) · §1.4 (markup-as-value pillar — the style-as-value analog) · §18 (exhaustive `match` — the guarantee analog). Authority: DD `css-scrml-fication-2026-07-07.md` (axes 1–3 LOCKED; §Rulings 2026-07-07) + bryan rulings 2026-07-07.

---

# CROSS-AMENDMENTS

## §A — Amendment to §9.1 (scoped `#{}` gains flat-specificity + the conflict-checker)

The three §9.1 `#{}` placements and their emission are **UNCHANGED** (scoped `@scope` donut with non-mangled class names inside a component; flat-declaration → inline `style=""`; program-level → global). Add, after the §9.1 DQ-7 normative block, a forward-reference paragraph (Nominal):

> **§65 (Nominal).** Under the scrml-native CSS model (§65), a component-scope `#{}` selector rule is emitted **`:where()`-flat** (specificity `(0,0,0)`; §65.2.5 — the same mechanism §26.6 `prose` already ships) and is subject to the **`E-STYLE-CONFLICT` conflict-checker** (§65.2): two unconditional same-property scope rules that provably match one element in the scope's markup are a compile error. Conditional rules (`:hover`/`[attr]`/`@media`/`@container`) are deterministic layers, not conflicts. The emission is otherwise unchanged; the checker is *added on top* (new diagnostics only). Program-level global `#{}` (no donut) gets only the soft `W-STYLE-CONFLICT-POSSIBLE` (§65.2.4, OQ-8). A flat-declaration `#{}` is re-explained as an **anonymous style-value** (§65.4.1) — emission unchanged.

## §B — Amendment to §25 (CSS variables — KEPT; reframed as the `<theme>` token lowering)

§25 is **KEPT unchanged** as the raw custom-property layer (`name = value` → `--name: value`; `prop: name fallback` → `var(--name, fallback)`; the `--`/`var()` compiler-generated). Add a §25.7 (Nominal):

> **§25.7 — `<theme>` tokens lower to §25 custom properties (Nominal, §65.3.2).** A §65 `<theme>` block of named values is the **blessed** named-value channel; it **lowers to §25 CSS custom properties** — a `<theme>` binding `brand = #2563eb` emits `:root { --brand: #2563eb; }` and a use-site reference `color: brand` emits `color: var(--brand)`, reusing exactly the §25.2/§25.3 machinery. This **unifies** token-flow with custom-property inheritance (one mechanism): the token *inherits* as a value (§25.5's normal custom-property cascade) but *applies* only where explicitly referenced (§65.3.2 — no action at a distance). §25.5's "custom-property scoping follows normal CSS cascade rules" remains the raw substrate; `<theme>` is the checked, named surface over it. A token reference resolving to no in-scope `<theme>` is `E-THEME-TOKEN-UNKNOWN`.

## §C — Amendment to §26 (Tailwind gains the fixed `@layer` order; utilities-LOW)

§26 (Tailwind, incl. §26.6 `prose`, §26.7 composing families, §26.8 `@apply`) is **KEPT** as the atomic escape hatch. Add a §26.9 (Nominal):

> **§26.9 — The fixed `@layer` order under the scrml-native CSS model (Nominal, §65.8).** scrml emits a single fixed `@layer` order once — `@layer reset, thirdparty, base, tokens, utilities, author;` (later = higher; specificity deleted within each). Tailwind utilities live in the **`utilities`** layer, **BELOW** the `author` layer (scrml-native scoped `#{}` rules + style-values) — **utilities-LOW** (§Rulings row 2): a co-located scrml rule beats a global utility. This is axiom-consistent with §65.5 local-authority and **diverges** from the ecosystem convention (utilities-highest); the muscle-memory cost is accepted and flagged. Utility-vs-utility collisions (`p-4 p-6`) keep Tailwind's own last-wins *inside* the `utilities` layer and are **EXEMPT from `E-STYLE-CONFLICT`** at MVP. A bounded follow-on (OQ-2b, off by default) MAY extend `E-STYLE-CONFLICT` to same-property utility collisions in one `class=`, **exempting the §26.7 composing families** (ring/shadow/gradient/transform/filter — which intentionally co-write one property via `--tw-*` vars). Token unification with the Tailwind scale (OQ-3) is deferred. The §26.2 "only what's used" minimalism + §26.7 "no global preflight" axioms are preserved (the one sanctioned universal block is the §65.3.4 reset).

## §D — Amendment to §4.15 + §24.4 structural-element registries (add `<theme>`, `<defaults>`)

Add `<theme>` and `<defaults>` to the §4.15 (block-grammar) and §24.4 (not-HTML) structural-element registries — **Nominal/spec-ahead**: the registry rows are added; block-splitter classification + `attribute-registry.js` wiring land with the §65 impl (PRIMER §12 "Adding a new scrml-special structural element").

**§4.15 registered-elements table — add rows:**

| Element | Owning section | Attribute slots (parse-time) | Body form |
|---|---|---|---|
| `<theme>` (§65, **Nominal**) | §65.3.2 / §65.6 | (none — token bindings + optional `@media` / named-variant blocks in the body) | bare-body of `name = value;` token bindings + optional `@media (...)` / `.Variant { … }` re-bind blocks (variant-block syntax OPEN — §65.6) |
| `<defaults>` (§65, **Nominal**) | §65.3.3 | (none) | bare-body of **bare-element** rules only (`a { … }`, `body { … }`); a `.class`/`#id`/combinator selector → `E-DEFAULTS-MISUSE` |

**§4.15 / §24.4 normative additions (Nominal):**

- `<theme>` and `<defaults>` are scrml-defined structural elements (NOT HTML) valid at **program scope** (children of `<program>`, siblings of `<page>` — page-scope override is OPEN, §65.12). Use outside a valid locus is `E-STRUCTURAL-ELEMENT-MISPLACED`.
- The names `theme` / `defaults` (any case) SHALL NOT be valid component/user-type names — `E-NAME-COLLIDES-RESERVED` (the §4.15/§24.4 reserved-identifier rule). **`<theme>` reclaims the identifier from the corpus state-cell usage** per the §65.9 keyword-collision principle (the handful of live `<theme>` cells migrate — §65.14); `<base>` is deliberately **NOT** reclaimed (a standard HTML element — element-defaults are `<defaults>`).
- The compiler SHALL NOT apply HTML attribute validation to `<theme>`/`<defaults>`; their body-forms are defined in §65.3.

**§24.4 registered-elements table — add rows:**

| Element | Owning section | Notes |
|---|---|---|
| `<theme>` (§65, **Nominal**) | §65.3.2 / §65.6 | Named-token block; lowers to §25 `:root` custom properties; reactive theming via `@mode` named-variant selector; child of `<program>`; reclaims the identifier from corpus cells (§65.9) |
| `<defaults>` (§65, **Nominal**) | §65.3.3 | App-wide bare-element defaults, locally overridable; the `base` `@layer`; child of `<program>`; NOT `<base>` (an HTML element) |

---

## Frontmatter recap + returned-to-PA checklist

- **status:** draft · **for:** SPEC §65 (Nominal) · **authority:** css-scrml-fication-2026-07-07 DD + bryan rulings 2026-07-07.
- **Named codes** (§65.10; §34 rows land WITH the impl per Rule 4): `E-STYLE-CONFLICT`, `E-STYLE-CONDITION-OVERLAP`, `W-STYLE-CONFLICT-POSSIBLE`, `E-STYLE-VALUE-DESCENDANT`, `E-STYLE-VALUE-NOT-STYLE`, `E-THEME-TOKEN-UNKNOWN`, `E-DEFAULTS-MISUSE`, `W-STYLE-DEFAULTS-DEAD`, `E-STYLE-IMPORTANT-INTERNAL`, `E-STYLE-KEYFRAMES-COLLISION` (OQ-5, deferred). Reused: `E-STRUCTURAL-ELEMENT-MISPLACED`, `E-NAME-COLLIDES-RESERVED`.
- **Reconciliations the applying editor must honor** (DD text that predates the rulings): (1) the DD §2 resolution box (steps 1–2 order) is stale vs Ruling 5 — the applied `style=` wins (§65.1/§65.5); (2) the DD §3.5 `E-STYLE-CONFLICT` "a rule + an applied style-value" case is superseded by Ruling 5 (that pair is precedence-ordered, not a conflict — §65.2.1).
