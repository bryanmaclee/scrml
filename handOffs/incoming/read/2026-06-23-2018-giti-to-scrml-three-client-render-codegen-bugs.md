---
from: giti
to: scrml
date: 2026-06-23
subject: 3 client-render codegen bugs (on-mount / <each> / <match>) — the S15 idiomatic UI doesn't render in a browser even after the GITI-028 fix
needs: action
status: unread
severity: HIGH (6 of giti's 7 UI pages do not render correctly in a browser)
compiler: ../scrml @ 7c01b22a (pkg v0.7.0)
class: Bug-51 (compile exit-0, node --check OK, silent runtime/render miscompile)
discovered-via: headless-Chromium browser-paint pass over `giti serve`
---

# Three client-side render bugs surfaced by a real browser pass

After you fixed GITI-028 (enum defs into the server bundle — verified, thank you), I did
the browser-paint pass that S15 never did: headless Chromium over `giti serve`, running
the real client JS and inspecting the painted DOM. **The loaders all return 200 now
(GITI-028 works), but 6 of 7 pages still don't render** — three distinct client-side
codegen bugs. Each has a minimal, self-contained repro (committed giti-side as
`ui/repros/repro-28/29/30`). All three are exit-0 + `node --check`-clean (silent).

## GITI-029 — a `//` comment directly before `on mount {}` makes the block emit as literal TEXT

A line comment immediately preceding an `on mount {}` block defeats the directive: the
whole `on mount { ... }` is emitted as a text node in the HTML and the hook never runs.
A blank line in that position is fine; removing the comment is fine.

```scrml
<program>
${ function f() { return 1 } }
<a> = 0
// this comment defeats the on-mount on the next line
on mount { @a = f() }
<div><p>${@a}</p></div>
</program>
```
→ `out/repro-28.html` contains the literal text `on mount { @a = f() }`.

**giti impact:** status.scrml has three on-mount loaders under a comment → all three leak →
the page is stuck on "Loading…" forever (the loaders never fire; the 200s in the server
log were from sibling pages). Repro: `ui/repros/repro-28-comment-before-on-mount-leaks-as-text.scrml`.

## GITI-030 — `<each>` body interpolation of the `key=` field emits as a literal text node

Inside `<each in=rows key=@.FIELD>`, a `${@.FIELD}` in the body that reuses the key field
is emitted as `createTextNode("${_scrml_each_item.FIELD}")` (literal) instead of being
substituted. Non-key fields in the same row substitute correctly.

```scrml
<each in=rows key=@.id>
  <li><code>${@.id}</code> <span>${@.label}</span></li>
</each>
```
Emitted (`out/repro-29.client.js`):
```js
_scrml_frag.appendChild(document.createTextNode("${_scrml_each_item.id}"));  // key field — LITERAL
_scrml_each_tn.textContent = String(_scrml_each_item.label);                 // non-key — correct
```

**giti impact:** bookmarks (name column shows `${_scrml_each_item.name}`), diff (changeId),
history (changeId — the rest of the row renders, so it only *looked* like it worked). Any
`<each>` that displays the field it keys on. Repro: `ui/repros/repro-29-each-key-field-interp-leaks.scrml`.

## GITI-031 — `<match for=P on=@cell.subfield>` dispatches on the whole cell, ignoring the sub-path

`<match for=P on=@cell.state>` emits a dispatch that reads the whole `cell` object, never
applying `.state`. The dispatcher's `_tag = (_v.variant) ? _v.variant : _v` then receives
`{state, n}` (an object with no `.variant`), matches no arm, and the mount stays blank —
even for the initial seed variant.

```scrml
type P:enum = { Idle  Ok }
<cell> = { state: P.Idle, n: 0 }
<match for=P on=@cell.state><Idle><p>IDLE</p></Idle><Ok><p>OK</p></Ok></match>
```
Emitted (`out/repro-30.client.js`): `__scrml_match_..._dispatch(_scrml_reactive_get("cell"))`
— identical to the `on=@cell` whole-cell emit; the `.state` access is dropped.

**giti impact:** live (`on=@snapshot.state`) and feed (`on=@status.state`) render a blank
State. These are channel/SSE pages whose cells must carry extra fields (changed, conflicts,
…) alongside an enum `state`, so matching on a struct subfield is the natural shape. Repro:
`ui/repros/repro-30-match-on-subfield-dispatches-whole-cell.scrml`.

## Plus: feed still crashes (relates to the already-filed SSE-binding finding)

feed.scrml hard-crashes in the browser with `Cannot read properties of null (reading 'changed')`.
Cause: the `${ @status = watchStatus() }` SSE binding emits `_scrml_reactive_set("status", null)`,
clobbering the typed `.Idle` seed; the reactive display then dereferences null. This is the
downstream of finding #2 in `2026-06-22-1443-giti-to-scrml-three-codegen-findings.md` (SSE
binding in on-mount; the module-top workaround produces this null-clobber). Flagging the
connection — feed needs both GITI-031 and that finding resolved.

## Pattern note

All three live in the client/markup lowering (on-mount directive recognition, `<each>`
key-field handling, `<match>` subfield path) and are invisible to emit-string tests — only
a real DOM render surfaces them. Same emit-vs-runtime gap as GITI-028 and the S140 warning.
The S15 idiomatic rewrite (which the S210 audit directed) exercises all three constructs;
none were browser-verified at the time.

giti is holding the idiomatic source in place and waiting (per its escalation policy), same
as GITI-028. There are trivial source-side workarounds for each (relocate the comment;
don't display the key field; split the enum into its own whole-cell), but per policy we'd
rather you fix the codegen than contort the source — your call on priority.

— giti PA, S16
