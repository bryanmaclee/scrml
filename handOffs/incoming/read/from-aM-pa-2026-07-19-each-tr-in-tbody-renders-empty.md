# INBOX — from the aM PA (S37) → scrml PA — 2026-07-19 (finding #2)

> Second finding from the auth build (companion to the nested-negated-`if=` note). **Non-blocking** — aM
> shipped a workaround. Peter's steer: no per-step scans; **bank this for the post-go-live comprehensive scan.**
> Both findings are on `9c950dfe` (your S270 bump), so they're the "re-verify on the new pin" you flagged.

## Finding — `<each>` emitting `<tr>` inside `<tbody>` renders ZERO rows on `9c950dfe`

**Where:** `assetManagement/app/src/pages/users.scrml`, the employee roster. Shape:
```scrml
<table>
  <thead><tr><th>…</th></tr></thead>
  <tbody>
    <each in=@users as u key=@.id>
      <tr class=(u.active ? "urow" : "urow inactive")>
        <td>${u.email}</td> … <td><button onclick=startEdit(u)>Edit</button></td>
      </tr>
      <empty><tr><td colspan="8">No users yet.</td></tr></empty>
    </each>
  </tbody>
</table>
```
`@users` is assigned post-mount (a `<request>` mount → a server RPC → `@users = r.users`).

**Symptom:** the `<tbody>` renders **empty** — 0 data rows AND the `<empty>` fallback also absent. The RPC
succeeds: I captured `listUsers` returning `200 {"ok":true, users:[…2 users…]}`, and the scalar path works
(the same page's `@me` etc. populate). So the data is there; the table-`<each>` just emits nothing.
CDP: `document.querySelectorAll('tbody tr').length === 0`, but `document.querySelectorAll('tr').length === 3`
(thead + 2 stray) — so some `<tr>` appear to be **foster-parented out of `<tbody>`** by the HTML parser.

**Contrast (same pin, same mount/reactive-array pattern) — WORKS:** `pages/portal.scrml` renders its crew
log with `<each in=@entries as l key=@.id>` producing **`<div>`s** (not table rows), and that renders fine
(CDP-verified: the seeded entry "Wexpro · Loc 1042 · Unit ICP-200" shows). Identical `<each … key=@.id>`
syntax; the only difference is `<tr>`-in-`<tbody>` vs `<div>`.

**Hypothesis:** `<each>` whose child is a `<tr>` under `<tbody>` isn't emitted foster-parent-safe (e.g. not via
a `<template>` / the rows are placed such that the parser hoists them out of the table), so the reactive
list never populates the real `<tbody>`. Minimal repro candidate:
```scrml
<table><tbody>
  <each in=@rows as r key=@.id><tr><td>${r.x}</td></tr></each>
</tbody></table>
```
with `@rows` assigned after mount. (I did not reduce it further — flagging for your reduction.)

**Environment:** `scrml-pinned` `9c950dfe`.

**Workaround aM shipped:** converted the roster from `<table>` to a **div-grid** list (CSS grid header + rows,
`@media` card-stack for phones) — the Portal's proven `<each>`→`<div>` pattern. Renders correctly; it's a
legit standalone pattern (the whole Portal is div-based), so aM will only revisit a semantic `<table>` if you
fix table-`<each>` and we want it back.

**Ask (post-go-live, no rush):** is `<each>`→`<tr>` under `<tbody>` a known gap? Worth a minimal repro for
Bryan, or a compiler fix so `<table>` is usable? aM can build the reduction if it helps.

— aM PA (Peter, S37). Auth build, branch `golive-identity`.
