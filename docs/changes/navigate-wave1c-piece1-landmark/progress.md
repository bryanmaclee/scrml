# navigate-wave1c PR-1 — marker-driven composition + the ONE-LANDMARK invariant

Append-only progress log. Dispatch S276.

---

## 2026-07-20 — startup + baseline

Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a320ce9f1464c6c72`
Base: `020485b2` (clean). `bun install` + `bun run pretest` OK.

Maps read: `primary.map.md` -> routing sends outlet/Client-Router work to `domain.map.md`
(+ `structure.map.md` for codegen layout). Load-bearing finding from `domain.map.md`:
`<outlet>` is **NOT a dedicated AST node** — it is plain `kind: "markup"` with `tag: "outlet"`,
rewritten to a container element in `emit-html.ts`. That is why both the landmark decision and the
composition slot decision are *textual/emit-time*, not AST-typed.

### Empirical baseline at `020485b2` (probe: compile + inspect emitted `<body>`)

| case | errors | `<main>` count | marker element |
|---|---|---|---|
| `<program><h1/><outlet/></program>` | none | 0 | `<div data-scrml-outlet tabindex="-1">` |
| `<program><main><outlet/></main></program>` | none | 1 | `<div data-scrml-outlet tabindex="-1">` |
| `<program><main>x</main><outlet/></program>` | none | 1 | `<div data-scrml-outlet tabindex="-1">` |
| D2 `<program><nav/><outlet/><page><main/></page></program>` | none | 1 | `<div data-scrml-outlet tabindex="-1">` |
| D3 multi-file shell+outlet, route has own `<main>` | none | route page: 1 `<main>`, **no marker, NO shell chrome** | — |
| D3b multi-file shell+outlet, plain route | none | 0 | **no marker, NO shell chrome** |
| back-compat bare `<main>` shell + route | none | 1 | n/a (composed, chrome + route both present) |

**KEY BASELINE FACT (drives the whole design):** an `<outlet>`-only shell does **NOT compose at all**
today — route pages emit standalone with zero shell chrome. That is the §20.8-vs-§40.8 coherence gap
this PR closes.

**KEY BASELINE FACT 2 (not in the brief; found empirically):** in a **single-file** `<program>` with
`<page>` children, the page bodies emit **INLINE** into the same document, in source position — they
are NOT composed into the outlet. So the D2 shape puts the route's `<main>` and the outlet marker in
ONE document. If the outlet unconditionally became `<main>`, D2 would emit TWO `<main>`s. This makes
ruling case 3 a *single-file* concern too, not only the multi-file composition concern the brief
describes. Handled in `emit-html.ts` (see below), not only in `index.ts`.

### Design derived from the ruling (one landmark; the MARKER decides the slot)

- `emit-html.ts` — `<outlet>` emits `<main data-scrml-outlet tabindex="-1">` **iff the emitted
  document carries no author `<main>` anywhere**; otherwise `<div data-scrml-outlet tabindex="-1">`.
  This one predicate covers ruling case 1 (bare outlet -> `<main>`), case 2 (outlet wrapped in an
  author `<main>` -> `<div>`), and the single-file form of case 3 (`<page>`-scoped `<main>` -> `<div>`).
  The marker + `tabindex` ride the element in BOTH forms — the marker, not the tag, is the slot.
- `index.ts` — multi-file composition: slot = first element carrying the `data-scrml-outlet`
  **attribute name** (proper open-tag/attribute scan, not a `\b` regex), else first bare `<main>`
  (back-compat). Per composed page, if the ROUTE body carries its own `<main>`, the marker slot is
  DEMOTED `<main>` -> `<div>` in that page's composed output (ruling case 3, multi-file form).
- `symbol-table.ts` — `E-OUTLET-AND-MAIN` narrowed to the BARE/SIBLING case only: an author `<main>`
  in shell scope that neither encloses nor is enclosed by the outlet, and is not inside a `<page>`.
