---
from: 6nz
to: scrml
date: 2026-07-06
subject: 4 verified findings in the <each> body / input-layer render path (+ 1 not-reproduced)
needs: action
status: unread
---

# `<each>` body + input-layer findings — runtime-verified @ scrml 0.7.0

**Context.** 6nz is scoping a text-editing-modes integration into flogence. flogence's
`app.scrml` documents a cluster of "fragile input" workarounds; the user's #1 priority is
scrml production-readiness, so I runtime-verified each claim against the current compiler
rather than relaying prose. Four reproduced as real defects; one did not reproduce.

**All repros verified with:**
- `scrml compile <file>` and `scrml dev <file> --port <n>` driven by headless Chromium (Playwright).
- **scrml 0.7.0 (CLI `scrml --version`) / 0.7.1 (package.json) @ `caa8803b`** (2026-07-05).

**Common theme:** 3 of the 4 live in the **`<each>` body rendering path** (handler wiring,
void-element parsing, multi-sibling rendering). Same subsystem as the still-open Bug AI
(`<each>/<empty>` fallback leak, filed 2026-06-24). The `<each>` renderer is the fragile area.

---

## Finding 1 — expression-form event handlers (`onX=${(e)=>…}`) are silently DEAD inside `<each>`

A handler written in the expression form does not wire when the element is inside an `<each>`
body. It renders, but the handler never fires. The **bare-ref form works**, so it's specific to
the expression lowering inside `<each>`. Both forms work at top level.

```scrml
<program>
${ @items = ["x"]
   @n = 0
   function bump(e) { @n = @n + 1 } }
<div class="app">
    <each in=@items key=__index__>
        <input class="in" oninput=${(e) => bump(e)} />
    </each>
    <div class="n">${@n}</div>
</div>
</program>
```

- **Expected:** typing in `.in` fires `bump` → `@n` increments.
- **Actual:** `@n` stays `0` — handler never fires. (Verified: input rendered, counter `0` after typing.)
- **Contrast (both verified):** the same expression handler at **top level** fires; and the
  **bare-ref** form `oninput=bump(event)` inside the same `<each>` **fires** (`@n` reached 2).
- **Severity:** silent (no error/warning). Workaround exists (bare-ref), but the failure is invisible.

## Finding 2 — `<form onsubmit=…>` inside `<each>` doesn't wire → native submit RELOADS the page

A direct consequence of Finding 1 for forms, but worse: the un-wired submit falls through to a
native form submission, which **reloads the page and loses all client state**.

```scrml
<program>
${ @submits = 0
   function onSub(e) { e.preventDefault(); @submits = @submits + 1 } }
<div class="app">
    <each in=@items key=__index__>
        <form class="f" onsubmit=${(e) => onSub(e)}>
            <input class="finput" />
        </form>
    </each>
    <div class="submits">${@submits}</div>
</div>
</program>
```
(with `@items = ["only"]`)

- **Expected:** Enter in `.finput` → `onSub` runs, `preventDefault` stops navigation, `@submits`→1.
- **Actual:** `@submits` stays `0`, URL gains `?`, **page reloads** (native GET submit).
- **Contrast (verified):** the identical `<form onsubmit=${(e)=>onSub(e)}>` at **top level** fires
  (`@submits`→1, clean URL, no reload). So this is `<each>`-scoped, matching Finding 1.
- **Severity:** high — silent + data-losing (full reload) in any list-of-forms UI.

## Finding 3 — `<each>` renders only the FIRST element of a multi-sibling body; extras silently dropped

Multiple sibling elements in one `<each>` iteration body: only the first is rendered. No compile
error, no warning — the rest vanish.

```scrml
<program>
${ @items = ["x"] }
<div class="app">
    <each in=@items key=__index__>
        <input class="first" placeholder="first" />
        <input class="second" placeholder="second" />
    </each>
</div>
</program>
```

- **Expected:** both `.first` and `.second` render per iteration.
- **Actual:** only `.first` renders. Emitted DOM: `<div data-scrml-each-mount="each_11"><input class="first" ...></div>` — `.second` absent.
- **Workaround (verified):** wrap the siblings in a single parent (`<div><span/><span/></div>`) → both render.
- **Read:** `<each>` appears to require a single root per iteration. If that's intended, the defect
  is the **silent drop** — it should be a compile diagnostic, not lost content.

## Finding 4 — reactive `${}` interpolation inside `<textarea>` leaks the logic-span wrapper as literal text

Reactive interpolation inside a `<textarea>` emits scrml's reactive `<span data-scrml-logic=…>`
wrapper as the textarea's literal text value (and it isn't even reactive — the span is empty).

```scrml
<program>
${ @x = "hello" }
<div class="app">
    <textarea class="ta" rows="2">${@x}</textarea>
    <div class="ctl">control: ${@x}</div>
</div>
</program>
```

- **Expected:** `.ta` value is `hello`.
- **Actual:** `.ta` value is the literal string `<span data-scrml-logic="_scrml_logic_1"></span>`.
  Emitted: `<textarea class="ta" rows="2">&lt;span data-scrml-logic="_scrml_logic_1"&gt;&lt;/span&gt;</textarea>`.
- **Contrast (verified):** the same `${@x}` in a `<div>` renders `hello` correctly.
- **Severity:** blocks any reactive/multi-line `<textarea>` in native scrml markup — the reason
  flogence has no multi-line editor. Directly relevant to the 6nz editor work.

## Finding 5 (parser DX) — bare void element (`<input>`, `<br>`) inside `<each>` fails to compile with a MISLEADING error

A void HTML element in bare form (no self-close) inside `<each>` isn't recognized as void; it
swallows `</each>` and everything after, producing an error that points at the wrong element.

```scrml
<program>
${ @items = ["x"] }
<div class="app">
    <each in=@items key=__index__>
        <input class="in">          <!-- bare void, no self-close -->
    </each>
</div>
</program>
```

- **Actual:** `E-CTX-001: Unclosed <each> structural element` — or `E-CTX-003: Unclosed 'program'`
  when more markup follows (the swallow reaches past `</each>` to `</program>`). Neither points at
  the `<input>`, which is the real culprit.
- **Works at top level:** the same bare `<input>` outside `<each>` compiles fine — so void-element
  handling is inconsistent between the top-level and `<each>` body contexts.
- **Workaround (verified):** self-close (`<input/>`) or explicit close (`<input></input>`).
- **Severity:** medium — a real DX trap (wrong-location diagnostic) that costs debugging time.
  This is what flogence hit; it's why its list rows avoid natural `<input>`/`<form>` markup.

---

## NOT-REPRODUCED — `bind:value` wiring no input listener

flogence's code comments claim `bind:value=@x` emits the attribute but wires no input listener.
**I could not reproduce this** in a plain client-rendered SPA at 0.7.0:

```scrml
<program>
${ @x = "start" }
<div class="app">
    <input class="probe" bind:value=@x>
    <div class="mirror">${@x}</div>
</div>
</program>
```
Typing in `.probe` updated `@x` → `.mirror` reflected it (`start` → `startZ`). Two-way binding worked.

Caveat: flogence's report was in a **`<program db=…>` server-rendered (SSR)** context, which I did
not reproduce here (plain SPA only). If the bug is SSR-path-specific it may still be live there —
worth a scrml-side check in a `<program db>` context at 0.7.1, or it may already be fixed.

---

**Repro files** (self-contained, on the 6nz side; can be re-sent if useful): each finding above is
a complete, minimal `.scrml`. Happy to package them or adjust severity framing. No 6nz-side blocker
— we have workarounds for all four — but these bite real apps (flogence already, 6nz's editor next),
so flagging for the production-readiness track.

— 6nz PA
