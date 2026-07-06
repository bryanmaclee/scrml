# BRIEF — 6nz-F4: reactive `${}` inside `<textarea>` leaks the `data-scrml-logic` span as literal text

**Severity:** MED (blocks reactive/multi-line `<textarea>` in native scrml — the reason flogence has no
multi-line editor + 6nz's editor work needs it). Adopter: 6nz (runtime-verified) + flogence.
**Class:** silent-wrong-output (no diagnostic; the textarea renders a literal `<span…>` string).
**Reproduced (R26, PA-side @ `59dc5287`):** `<textarea class="ta" rows="2">${@x}</textarea>` emits
`<textarea class="ta" rows="2"><span data-scrml-logic="_scrml_logic_1"></span></textarea>` — the reactive
placeholder span leaks as the textarea's literal text value. The **same `${@x}` in a `<div>` renders
correctly** (control). Repro: `docs/changes/6nz-f4-textarea-rcdata-interp/repro.scrml`.
**NOT each-specific** — this is a `<textarea>` content-model bug, independent of `<each>`. (The other 4
findings in 6nz's report — F1/F2/F3/F5 — are ALREADY FIXED on `59dc5287`; this is the only live one.)

## Root cause (pinned)

A reactive content interpolation (`${@x}` in an element's text content) lowers to a
`<span data-scrml-logic="…"></span>` placeholder (`emit-html.ts:2520` / `:2629`) that
`emit-reactive-wiring.ts` later fills via `querySelector('[data-scrml-logic=…]')`. That works for a normal
element. But **`<textarea>` has an RCDATA content model** — its content is raw text, so a `<span>` inside it
is NOT an element, it is the textarea's literal string value. The placeholder never becomes a reactive
mount; it renders verbatim. `<textarea>` is already special-cased for `bind:value` (`emit-html.ts:53`:
`["input","textarea","select"]`) but NOT for reactive text-content interpolation.

## The fix

When a reactive content interpolation sits inside an **RCDATA element** (`<textarea>`; also `<title>` —
see scope), do NOT emit the `<span data-scrml-logic>` placeholder into the content. Instead bind the
interpolation to the element's **`.value`** (textarea) reactively — the one-way read-side of the existing
`bind:value` machinery (`_scrml_reactive_subscribe(cell, () => el.value = …)`), and render the INITIAL
value as the textarea's static text content (for SSR / no-JS first paint).

- **v1 scope: `<textarea>`** (the reported + motivating case). Note `<title>` as the RCDATA sibling
  (`document.title` / `.textContent`) — implement if cheap; otherwise leave a follow-up note. `<option>`
  content is also text-ish — check but don't scope-creep.
- Add an **RCDATA flag to the element registry** (`html-elements.js` — a `rcdata:true` on the textarea/title
  rows) OR a local set mirroring the `bind:value` set, so the carve-out is registry-driven not hardcoded.
- Prefer the SHARED reactive-binding machinery (the `bind:value` read-side subscription) — do NOT fork a
  second reactive-text mechanism.

### Edges the dev MUST handle (verify each)
1. **Reactive `${@x}` in textarea content** → `el.value` bound reactively; NO span in the DOM; typing a new
   `@x` updates the textarea value. (the repro)
2. **Static text** (`<textarea>hello</textarea>`) → stays literal content (works today — no regression).
3. **Mixed static + interp** (`<textarea>pre ${@x} post</textarea>`) → concatenated reactively into `.value`,
   initial value in static content.
4. **`bind:value` on a textarea** (already works) → no conflict/double-wire. A textarea with BOTH
   `bind:value=@x` AND a content `${…}` is contradictory — pick the ruling (bind:value wins + a lint, OR an
   error) and flag it; don't silently double-bind.
5. **Inside `<each>`** — a reactive textarea in an each body binds per-item (the each factory path). Confirm
   the carve-out fires in the each render path too (emit-each.ts renders textarea children via the same
   content-interp lowering).
6. **SSR / `<program db>` context** — the initial value renders in the static HTML content (server-rendered),
   reactive update on the client. (6nz's `bind:value`-no-listener not-reproduced report was SSR-context —
   worth a glance whether SSR textarea binding has a parallel gap, but do NOT scope-creep it here.)

## SPEC (Rule 4)
Check §24 (HTML element registry / content models) + §4.x (interpolation in element content) for whether
the RCDATA content-model behavior is specified. If the spec is silent on reactive interp in RCDATA content,
this is a codegen-correctness fix (no amendment) — but SURFACE it if the spec implies the current (broken)
behavior. Likely: pure codegen fix, no SPEC change. If a new lint/error is minted for edge #4, NAME it.

## Gate
- Unit test(s) in `compiler/tests/unit/`: the repro (textarea reactive interp → `.value` bind, no span
  leak) + edges 2/3/5 (static, mixed, in-each). Emitted `.client.js` `node --check` clean; emitted HTML has
  NO `<span data-scrml-logic>` inside the textarea.
- A merge-blocker conformance case (`conformance/`): codes-half (no error) + runtime-half (textarea `.value`
  === the reactive cell's value after an update; domAnchored on the textarea).
- `bun test compiler/tests/{unit,integration,conformance}` zero delta vs env-floor (5 pre-existing fails).
- R26: recompile the repro + control clean; 6nz re-runs their Playwright harness.

## Files (expected)
- `compiler/src/codegen/emit-html.ts` (the content-interp span emission @ ~2520/2629 — the carve-out).
- `compiler/src/codegen/emit-reactive-wiring.ts` (the `.value` reactive bind — reuse bind:value read-side).
- `compiler/src/html-elements.js` (the RCDATA registry flag).
- possibly `compiler/src/codegen/emit-each.ts` (each-body textarea path — edge 5).
- `compiler/tests/unit/` + `conformance/`.

## Dispatch
Base `59dc5287`. iso: worktree (S88/S99). S67 file-delta landing. PA-side adversarial `/code-review high`
before landing (S239). Do NOT land to main.
