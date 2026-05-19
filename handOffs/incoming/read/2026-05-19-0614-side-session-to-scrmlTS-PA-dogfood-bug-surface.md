---
from: scrmlTS-PA-side-session (2026-05-19, post-S104-CLOSE, unofficial)
to: scrmlTS-PA-next-official-session (S105)
date: 2026-05-19
subject: dogfood bug surface — 4 compiler/stdlib holes hit while expanding scrml.dev
needs: action
status: unread
---

# scrml.dev dogfood — bug surface from this side session

**Context.** Side session on the second machine while the official S105
session runs elsewhere. Scope was strictly website + Playwright per
user directive. While creating 50 stub pages to close the 277
broken-link gap on scrml.dev and dark-theming the site, four real
compiler/stdlib holes surfaced. Filing them here so next-official-PA
can triage.

User's standing framing per S105-open conversation: *"surface bugs and
holes, that is one of the purposes to building this in scrml."*

**No fixes attempted.** I worked around each hole locally to keep
moving on the website task. The workarounds are documented per bug so
they can be peeled back if/when the underlying fix lands.

## Summary table

| # | Severity | Class | One-line |
|---|---|---|---|
| 1 | HIGH    | BUG       | Tailwind layer silently no-ops arbitrary-value utility classes (`grid-cols-[auto_1fr_auto]` etc.) |
| 2 | MED-HI  | BUG       | Multi-line `<a>` opener + entity-encoded element-name text inside body produces phantom E-SYNTAX-050 + cascade |
| 3 | MED     | BUG       | `[BS] E-...` dev-server error messages omit file path while sibling `[W-LINT-...]` messages include it |
| 4 | LOW-MED | ERGONOMIC | Bare `?{` in markup copy (docs about scrml) opens an SQL context with no `--text-mode` escape hatch |
| 5 | HIGH    | BUG       | `${VERSION}` interpolation of a `const` emits an empty reactive-placeholder span; client JS gets a naked `VERSION;` no-op statement instead of a DOM update |
| 6 | MED     | DOC-DRIFT | Multiple shipped reference pages link to retired error code `E-CHANNEL-INSIDE-PROGRAM` instead of the current canonical `E-CHANNEL-OUTSIDE-PROGRAM` (v0.3 Wave 1 direction reversal, 2026-05-12) |

---

## Bug 1 — Tailwind arbitrary-value classes silently no-op (HIGH)

**Severity rationale.** Every modern Tailwind app reaches for arbitrary
values (`grid-cols-[200px_1fr]`, `w-[420px]`, `text-[clamp(1rem,2vw,1.5rem)]`,
`bg-[#1a1a1a]`). They emit no rule and no warning. Visible layout
breakage with no diagnostic to chase.

**Repro (this session).** Wrote `app.scrml` header as:

```scrml
<header class="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
    <div class="max-w-5xl mx-auto px-6 py-3 grid grid-cols-[auto_1fr_auto] items-center gap-8">
        <a href="/" class="...">scrml.dev</a>
        <nav class="flex items-center justify-center gap-6 ...">...</nav>
        <div class="flex items-center gap-3 justify-end">...</div>
    </div>
</header>
```

Expected: 3-column grid (logo / nav / actions).
Observed: items stacked vertically into three rows. Inspected
`dist/app.css`:

```css
/* present */
.grid          { display: grid }
.grid-cols-1   { grid-template-columns: repeat(1, minmax(0, 1fr)) }

/* ABSENT — never emitted */
.grid-cols-\[auto_1fr_auto\]  { grid-template-columns: auto 1fr auto }
```

Result: `display: grid` is set, but `grid-template-columns` is left at
the default `none`, which lays out as a single auto column. Children
stack.

Same shape applies to any `<utility>-[<arbitrary>]` pattern. Tailwind's
JIT layer is supposed to scan source and emit arbitrary-value rules
on demand; scrml's Tailwind layer is only emitting the *named*
utilities it encounters.

**Workaround (live in `app.scrml`).** Switched the header to plain
flex (`flex items-center gap-8`) with `flex-1` on the nav for the
center-expansion. Also discovered that `flex-1` and `justify-center`
were *also* missing from the scanned set initially (no other source
file used them), so I added a CSS-shim block in the global `#{}`:

```scrml
#{
    .flex-1         { flex: 1 1 0%; }
    .justify-center { justify-content: center; }
    .justify-end    { justify-content: flex-end; }
}
```

These shims could now be removed — adding the classes to nav source
triggered Tailwind to emit them on the next compile (verified
`dist/app.css` now contains both `.flex-1` and `.justify-center` in
the Tailwind-generated section). Kept as belt-and-suspenders. Worth
keeping until the arbitrary-value bug is understood — the same scan
mechanism that handles `flex-1` is *supposed* to handle
`grid-cols-[auto_1fr_auto]`.

**Where to look.** Find the Tailwind/CSS extraction pass in
`compiler/src/codegen/` or `compiler/src/passes/` (probably under a
`css` or `tailwind` filename). Check whether arbitrary-value class
syntax (`[...]` segment in a class name) is in the recognised
production. If recognised but skipped, that's a passive bug; if not
recognised at all, the class-scanner regex needs extending to
`/-\[[^\]]+\]/` and the emitter needs to parse the bracket payload
back into a CSS value.

**Suggested classification.** BUG. Not "doc gap" — adopters will hit
this on day one of any non-trivial layout. Either emit the rule, or
fire a lint when an unsupported class is detected so the silence
breaks. Silent no-op is the worst failure mode.

**Severity ladder for the fix:**
- Floor (cheap): lint the class names; warn on unrecognised arbitrary
  values. Adopters at least know what's not working.
- Full fix: support the standard Tailwind arbitrary-value syntax
  (`<utility>-[<value-with-no-spaces-or-with-underscores>]`).

---

## Bug 2 — Phantom E-SYNTAX-050 + cascade on multi-line `<a>` with entity-encoded element-name body (MED-HI)

**Severity rationale.** The diagnostic is *wrong* — it reports "Bare '/'
is no longer a valid closer" on a line containing no `/`, with a
cascade of "Unclosed page/article/header/p" errors. The user/adopter
has nothing to chase. I only resolved it by trial-and-error
restructuring.

**Repro (initial state of `pages/reference/keywords/lift.scrml`).**

```scrml
<page>

    <article class="prose prose-slate max-w-3xl">

        <header class="not-prose mb-8 pb-6 border-b border-slate-200">
            <div class="text-xs font-mono text-slate-500 mb-2">
                Reference &rsaquo; Keywords
            </div>
            <h1 class="text-4xl font-bold tracking-tight text-slate-900 font-mono">
                lift
            </h1>
            <p class="text-lg text-slate-600 mt-2">
                Promotes a child template into its parent
                <code class="font-mono text-base">&lt;program&gt;</code>'s
                shell slot &mdash; the load-bearing primitive behind
                multi-page composition.
            </p>
        </header>

        <div class="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-slate-800">
            <p class="font-semibold text-slate-900 mb-2">
                Reference page queued for the Day-30 build-out.
            </p>
            <p class="leading-relaxed">
                Until then the authoritative source is SPEC.md.
                <code class="font-mono text-sm">lift</code> is what
                makes
                <a href="/reference/elements/page"
                   class="text-blue-700 hover:text-blue-900 underline font-mono">
                    &lt;page&gt;
                </a>
                content compose into the parent
                <a href="/reference/elements/program"
                   class="text-blue-700 hover:text-blue-900 underline font-mono">
                    &lt;program&gt;
                </a>
                shell &mdash; the markup-as-value pillar realised at
                the routing level.
            </p>
        </div>

        <p class="mt-10 text-sm">
            <a href="/reference" class="text-blue-700 hover:text-blue-900 underline">
                &larr; Reference
            </a>
        </p>

    </article>

</>
```

**Compile output (from `bun run compiler/src/cli.js dev docs/website/`):**

```
[BS] E-SYNTAX-050: E-SYNTAX-050: Bare '/' is no longer a valid closer.
     Use '</>' to close '<p>', or use the explicit form '</p>'.
     (line 37, ...)
[BS] E-CTX-003: Unclosed 'p' — (line 14, col 13)
[BS] E-CTX-003: Unclosed 'header' — (line 7, col 9)
[BS] E-CTX-003: Unclosed 'article' — (line 5, col 5)
[BS] E-CTX-003: Unclosed 'page' — (line 3, col 1)
```

Line 37 of that file is `                    &lt;program&gt;` — text
content. No `/` character anywhere on that line.

**Working analog (same pattern, different file — compiles fine).**
`pages/reference/index.scrml` line 47-50:

```scrml
<a href="/reference/elements/program" class="font-mono text-blue-700 hover:text-blue-900 underline">
    &lt;program&gt;
</a>
```

**What worked as a workaround.** Collapsing the `<a>` opener onto a
single line + adding `font-mono` directly to the `<a>` (matching the
working analog exactly):

```scrml
<a href="/reference/elements/page"
   class="font-mono text-blue-700 hover:text-blue-900 underline">
    &lt;page&gt;
</a>
```

vs. the failing form had `class="text-blue-700 ... font-mono"` (same
classes, different order). I'm not sure which axis fixed it (line
collapse vs. class reorder); didn't bisect.

**Hypothesis.** Some interaction between:
- Multi-line `<a>` tag opener (attributes wrap to second line)
- Entity-encoded element-name text body (`&lt;program&gt;` decodes to
  `<program>` — and `<program>` is the scrml root container with
  parser-special handling)
- Adjacent `<code>` siblings earlier in the same `<p>`

Worth a minimal-bisecting reducer to find which dimension actually
trips it. The fact that the error reports a line that contains no `/`
suggests the position tracker is off by N lines or N tokens by the
time the issue is detected.

**Where to look.** Tokenizer + parser around element-attribute-value
parsing across newlines; entity-decode pass + its interaction with
the markup recognizer (does `&lt;program&gt;` get decoded BEFORE the
parser sees it? if so, that's the structural bug); position tracking
in cascading-error generation.

**Suggested classification.** BUG. Two sub-classes here:
1. Compile failure on valid-shaped source (most pages with this
   pattern compile; this one didn't).
2. Diagnostic localisation lies — line 37 has no `/`.

Even if (1) turns out to be intentional/expected, (2) is independently
a diagnostic bug.

---

## Bug 3 — `[BS]` compiler-diagnostic stream omits file paths (MED)

**Severity rationale.** Inconsistency within the same compiler's
diagnostic surface. Lint-class diagnostics give full file paths;
parse-class diagnostics drop them. Forces detective work to find
which of 80+ files failed.

**Repro.** Same dev-server run as Bug 2. Two diagnostic shapes
present:

```
[W-LINT-013] /home/bryan-maclee/scrmlMaster/scrmlTS/docs/website/pages/reference/errors/E-SYNTHESIZED-WRITE.scrml:93:2 Line 93: Found '@click="handler" ...' — scrml uses 'onclick=handler() ...'

[BS] E-SYNTAX-050: E-SYNTAX-050: Bare '/' is no longer a valid closer. Use '</>' to close '<p>'... (line 37, ...)
```

The `W-LINT-*` row tells you exactly which file. The `[BS] E-*` row
tells you a line number but not which file.

**How I resolved "which file":**

```bash
find docs/website/pages -name "*.scrml" | while read src; do
  rel="${src#docs/website/pages/}"
  html="docs/website/dist/${rel%.scrml}.html"
  if [ ! -f "$html" ]; then echo "MISSING: $src"; fi
done
```

i.e., bisect by which source files DIDN'T produce a `dist/*.html`. Not
something an adopter should have to invent.

**Where to look.** The `[BS]` (`BuildSomething`? `BuildSession`?)
formatter path. Probably under `compiler/src/cli.js dev` or
`compiler/src/passes/build-driver.ts` or similar. Compare to the
`W-LINT-*` formatter — that one is correctly attaching paths.
Whatever differs in how diagnostics are constructed between the two
streams is the gap.

**Suggested classification.** BUG (internal-consistency). Trivial to
fix; high quality-of-life.

---

## Bug 4 — Bare `?{` in markup copy opens an SQL context with no docs-mode escape hatch (LOW-MED)

**Severity rationale.** Real ergonomic hole specifically for
*documentation about scrml*. Any prose that talks about the SQL
context (`?{ ... }`) by name will trip the tokenizer if not entity-
encoded. The tokenizer can't distinguish "I am *describing* `?{`"
from "I am *opening* `?{`".

**Repro (`pages/reference/errors/E-SQL-008.scrml` initial state — now
fixed):**

```scrml
<page>

    <article class="prose prose-slate max-w-3xl">

        <header class="not-prose mb-8 pb-6 border-b border-slate-200">
            <div class="text-xs font-mono text-slate-500 mb-2">
                Reference &rsaquo; Errors
            </div>
            <h1 class="text-4xl font-bold tracking-tight text-rose-700 font-mono">
                E-SQL-008
            </h1>
            <p class="text-lg text-slate-600 mt-2">
                Bracket-matched ?{ scanner caught an unmatched brace.
            </p>
            ...
```

That literal `?{` in the `<p>` body opens an SQL context that runs
off the end of the file looking for `}`. Compile output:

```
[BS] E-CTX-003: Unclosed 'sql' — opened but never closed before end of file. (line 15, col 33)
[BS] E-CTX-003: Unclosed 'p' — (line 14, col 13)
[BS] E-CTX-003: Unclosed 'header' — (line 7, col 9)
[BS] E-CTX-003: Unclosed 'article' — (line 5, col 5)
[BS] E-CTX-003: Unclosed 'page' — (line 3, col 1)
[BS] E-SYNTAX-050: Bare '/' is no longer a valid closer. ...
```

(Note: same cascade-without-filepath problem as Bug 3 made this take
~10min to localise.)

**Fix applied.** Replaced `?{` with `<code>?&#123;</code>` — works
because `<code>` body appears to be treated as raw text (entity-
encoded `&#123;` doesn't get decoded back to `{` at scan time, so the
SQL opener isn't recognised).

**Why this is a real hole.**

- Adopters writing scrml-about-scrml content (which is *every* docs
  site, every blog post, every README example) WILL write `?{` in
  prose. The tokenizer eats it.
- The error class is structural: every scrml context-opener (`?{`,
  `${`, `#{`, `^{`, `_{`) has this exposure. The docs already use
  `<code>$&#123;...&#125;</code>` and `<code>#&#123;...&#125;</code>`
  defensively — i.e. the workaround is already part of standing
  practice, undocumented.

**Update — bare `/` separator in markup copy is the same family.**
While writing `pages/getting-started.scrml`, I used `"" / 0 / []` as
inline text separating three code samples. The bare `/` characters
got parsed as element closers, producing:

```
[BS] E-SYNTAX-050: Bare '/' is no longer a valid closer. Use '</>' to close '<li>', or use the explicit form '</li>'. (line 3…)
```

Switched to `&middot;` (visible as `·`) and the file compiles. Worth
adding `/` to the list of context-meaningful characters that
adopters cannot use literally in markup text. The structural fix
(markup-text-mode tokenizer awareness — option 3 above) would
naturally cover this case too.

**Possible designs.**

1. **Status quo + docs hardening.** Document the entity-encoding
   requirement explicitly in the kickstarter + idiomatic-examples.
   Cheapest. Adopters still hit it.

2. **Docs-mode lint.** Warn when a context-opener token appears
   outside `<pre>`/`<code>` and outside an actual context. "Did you
   mean `?&#123;`?" Cheap, high-signal.

3. **Markup-text-mode tokenizer awareness.** When parsing markup
   element body content (not attribute values, not context bodies),
   recognise context openers only inside explicit context shapes.
   This is a bigger lift but eliminates the class structurally.

**Suggested classification.** ERGONOMIC HOLE. Not a BUG strictly —
the tokenizer is doing what it says. But the language-as-its-own-docs
use case is structurally going to keep hitting this until something
gives. Worth a deep-dive on whether (2) or (3) is the right shape.

---

---

## Bug 5 — `${ident}` interpolation of a `const` emits an empty placeholder + no-op JS binding (HIGH)

**Severity rationale.** This is the markup-as-value pillar misfiring on
its single most common shape: interpolating a top-level constant into
markup. The DOM placeholder is rendered as empty (visible as a small
empty span / hole in the layout), and the client JS gets a naked
`IDENT;` expression statement that does nothing. Adopter wiring a
version pill, footer year, or any other "compile-time literal" via
the obvious `${X}` shape will see an empty UI with no diagnostic.

**Repro.** `docs/website/app.scrml`:

```scrml
<program>

    const SITE_NAME = "scrml.dev"
    const SITE_TAGLINE = "Official documentation for the scrml language"
    const VERSION = "v0.3.0"

    <header class="site-chrome sticky top-0 z-10">
        <div class="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between gap-6">
            <a href="/" class="font-mono font-bold text-lg text-slate-100">scrml.dev</a>
            <nav class="flex items-center gap-5 text-sm text-slate-400">...</nav>
            <span class="version-pill">${VERSION}</span>
        </div>
    </header>
    ...
```

**Generated `dist/app.html`:**

```html
<span class="version-pill"><span data-scrml-logic="_scrml_logic_2"></span></span>
```

**Generated `dist/app.client.js`:**

```js
const SITE_NAME = "scrml.dev";
const SITE_TAGLINE = "Official documentation for the scrml language";
const VERSION = "v0.3.0";
VERSION;
VERSION;

document.addEventListener('DOMContentLoaded', function() {
  // --- Reactive display wiring ---
});
```

- The HTML has a `data-scrml-logic="_scrml_logic_2"` placeholder span (empty inner content).
- The JS has `VERSION;` — a naked expression statement. It evaluates the constant and throws away the value. There is NO `document.querySelector('[data-scrml-logic="_scrml_logic_2"]').textContent = VERSION;` or equivalent.
- The `// --- Reactive display wiring ---` comment block is empty.

**Visible result.** The version pill renders as an empty styled span. With my `.version-pill` having visible border + padding + bg, it becomes a small empty rounded chip on the far right of the header — the "small empty thing" the user spotted that broke their visual alignment. With the *original* light-theme bare-text styling (no border), the empty pill was invisible — the bug was always there but masked.

**Why both `${VERSION}` instances produce ONE `data-scrml-logic="_scrml_logic_2"`.** Two interpolations in the source (header pill + footer MIT-license line) but only one logic-index? The dist `app.html` may actually be emitting `_scrml_logic_2` for one and another id for the other; I didn't grep them both. Worth noting but not load-bearing — the structural bug is the empty placeholder + no-op JS, regardless of how many copies.

**Hypothesis.** The compiler's interpolation-codegen treats `${IDENT}` uniformly as a reactive binding, emitting a placeholder span + a JS-side binding stub. But for `const`-bound identifiers (compile-time-constant values), the binding stub should either:
- (a) Inline the value into the markup at compile time and emit no placeholder + no JS, OR
- (b) Emit the binding code that writes the constant value into the placeholder once at startup.

Currently it does neither — emits the placeholder, emits a no-op `IDENT;` statement, no DOM update happens. The third bullet "Reactive display wiring" comment in the JS is the slot where the actual update code should go but is empty.

**Workaround applied.** Replaced `${VERSION}` with the literal string
`v0.3.0` in `app.scrml` (header version pill + footer MIT-license
line). The const declaration is unused now but harmless. (Sidebar:
the const still appears in client JS — `const VERSION = "v0.3.0";` is
emitted even with no markup references, plus one naked `VERSION;`
remains. Cosmetic noise but worth noting; the compiler isn't tree-
shaking unused const declarations either.)

**Where to look.** The markup-interpolation codegen (probably under
`compiler/src/codegen/emit-markup.ts` or similar) and the
reactive-display-wiring emitter. Trace what `${IDENT}` produces for
the JS side when IDENT resolves to a `const` declaration vs a
reactive `<x>` binding.

**Suggested classification.** BUG — load-bearing on Pillar L4
markup-as-value semantics. Affects:
- Any adopter using `${IDENT}` to inject a constant into markup
  (versions, dates, project names, env config).
- The trust users place in scrml's reactivity story — if `${X}`
  silently no-ops for the simplest case, what else doesn't work?

**Test plan to verify a fix.** A scrml file declaring
`const FOO = "bar"` at `<program>` scope and using `${FOO}` inside
markup must produce HTML with "bar" baked in (or have JS that writes
"bar" into the placeholder on DOMContentLoaded). Currently produces
neither.

---

---

## Bug 6 — Shipped reference pages link to retired `E-CHANNEL-INSIDE-PROGRAM` (MED)

**Severity rationale.** The retired error code can never fire on current
compiler output — so adopter who clicks the link from `<channel>` or
`<program>` reference pages lands on a 404 (now: lands on a stub).
The actual current error is `E-CHANNEL-OUTSIDE-PROGRAM`. The
direction was REVERSED in v0.3 Wave 1 (2026-05-12) per S87 Insight 30
when channels were moved from file-top to INSIDE `<program>`. The
reference pages weren't updated to follow.

**Found while drafting** `pages/reference/errors/E-CHANNEL-INSIDE-PROGRAM.scrml`.
I started flesh-out, hit the SPEC catalog row (`§34` line 14841)
which said "Retired 2026-05-12 (v0.3 Wave 1 direction reversal)" with
a pointer to `E-CHANNEL-OUTSIDE-PROGRAM` (line 14842), and stopped.

**Sites that referenced the retired code (now fixed in-place):**

- `pages/reference/elements/channel.scrml` — comment header (line 8) + Related-errors anchor (line 174)
- `pages/reference/elements/program.scrml` — Channel-scope paragraph (lines 152-153) + Errors section anchor (line 186) + a third inline mention (line 295)

All 4 link sites switched to `E-CHANNEL-OUTSIDE-PROGRAM`. The old
stub at `/reference/errors/E-CHANNEL-INSIDE-PROGRAM` was repurposed
as a "retired — see new code" pointer page so old bookmarks /
search-engine results still resolve. New full reference page at
`/reference/errors/E-CHANNEL-OUTSIDE-PROGRAM`.

**Where else to look (NOT yet swept):**

This is one instance of a likely-wider pattern. Other places to grep
across docs/website for retired-or-renamed error codes:

- `E-DERIVED-ENGINE-INITIAL-UNDEFINED` (renamed S90 → `E-DERIVED-ENGINE-INITIAL-ABSENT` per OQ-6, M-7C-D-12 Track 4)
- `E-REACTIVE-005` (renamed S66 → `E-DERIVED-CIRCULAR-DEP` per §6.6.10)
- `E-CHANNEL-002` (retired 2026-05-04 / D3 M19 → `E-CHANNEL-SHARED-MODIFIER`)
- `W-NULL-IN-SCRML-SOURCE` (renamed S89 → `W-ABSENCE-IN-SCRML-SOURCE` per undefined-eradication dispatch)
- Anything from the pre-v0.3 era still referenced verbatim in a shipped reference page.

Recommended PA action: a sweep pass across `docs/website/pages/` for
references to error codes that no longer exist in the current SPEC
§34 catalog. The right shape is a small audit dispatch — read the
current §34 row list, grep the website for references, surface
mismatches.

**Classification.** DOC-DRIFT, not a compiler bug. The compiler is
fine; the public-facing docs lag.

---

## Provenance / file pointers

Live files where workarounds are in place (all under
`docs/website/`):

- `app.scrml` — has the `.flex-1` / `.justify-center` / `.justify-end`
  CSS shim block (Bug 1 workaround). Header restructured from
  `grid-cols-[auto_1fr_auto]` to flex+flex-1. Also carries the
  dark-theme overrides which work via `!important` class overrides
  (not strictly a bug, but worth noting that `dark:` variants weren't
  available so the override approach was the path of least resistance).
- `pages/reference/keywords/lift.scrml` — Bug 2 workaround: collapsed
  multi-line `<a>` opener; `<code>` wrap around the entity-encoded
  element name.
- `pages/reference/errors/E-SQL-008.scrml` — Bug 4 workaround:
  `<code>?&#123;</code>` instead of bare `?{`.
- `app.scrml` — Bug 5 workaround: two `${VERSION}` interpolations
  replaced with the literal `v0.3.0`. Const declaration left in place
  (harmless, currently unused).

## What I did NOT do

- Did not modify any compiler source.
- Did not modify any spec.
- Did not rotate hand-off (this is unofficial).
- Did not commit. All website edits are uncommitted in working tree on
  this machine. **Coordinate with official machine before pulling
  these into main** — the user explicitly said this session is just
  the website + Playwright, so the official session may have
  diverging website state we'd clobber.

## Suggested triage order

1. **Bug 5 (`${const}` empty placeholder).** Load-bearing on
   markup-as-value pillar. Common idiom returns no-op silently. Should
   land first — also unblocks reuse of constants across the docs
   site (currently every literal has to be inlined).
2. **Bug 3 (path in `[BS]` diagnostics).** Trivial fix, immediate
   quality-of-life win, makes the other bugs cheaper to debug.
3. **Bug 6 (retired error-code references in docs).** Sweep pass
   across `docs/website/pages/` for references to renamed/retired
   codes; replace with current canonical codes per SPEC §34.
   In-place fix; cheap; eliminates a class of broken-link surprises.
4. **Bug 1 (Tailwind arbitrary-value).** High adopter-impact. Floor
   solution (lint on unrecognised) is cheap; full solution is a real
   feature.
5. **Bug 2 (phantom E-SYNTAX-050).** Build a minimal bisecting
   reducer first to find which dimension matters; then fix.
6. **Bug 4 (`?{` in copy).** Deep-dive on the design space — this
   touches the markup tokenizer + every context-opener token. Not
   urgent but worth getting right before adopters write more docs.

---

#dogfood #side-session-2026-05-19 #bug-surface
#tailwind-arbitrary-values #diagnostic-path-omission
#phantom-syntax-error #context-opener-in-copy
#const-interpolation-no-op
