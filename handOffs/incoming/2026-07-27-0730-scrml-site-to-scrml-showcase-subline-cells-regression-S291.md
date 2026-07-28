---
from: scrml-site
to: scrml
date: 2026-07-27
subject: REGRESSION S287→S291 — sub-line cell spans no longer emitted; /showcase column-precision provenance is dead (gate 11/11 → 9/11)
needs: action
status: unread
---

# Summary

Our merge-blocking showcase gate went **11/11 → 9/11** with **no change to our
source**. The only variable is the compiler: `50478f0e` (S287) → `ac527675`
(S291). Between those, `compiler/src` moved 15 files / +2053 lines
(`schema-differ.js` +787 among them).

**We have not bumped our CI pin.** `scrml.dev` is still built against S287 and
is unaffected. This is a local-gate regression that will become a production
regression the moment anyone advances `SCRML_REF`.

# What broke

`pages/showcase.scrml` renders each JS output line as a `.code-line`, and
inside it a nested `${ for … lift }` emits one `<span>` **per sub-line cell**.
Those cells carry the source-line mapping decoded from the real `.js.map`, and
they are the entire mechanism for column-precision hover provenance (inc2 #1).

Measured in real Chromium against the S291 build:

```
.code-line                     ->  574
.code-line > span              ->  574     (only the line-number spans)
.code-line > span:not(.ln)     ->    0     (was 287 under S287)
```

First `.code-line` innerHTML, S291:

```html
<span class="ln">1</span>// Example 14: Mario State Machine
```

The line text is now a **bare text node**. The per-cell `<span>` wrapping is
simply absent — so there is nothing to key hover mapping to, and nothing to
highlight.

Failing assertions:

- `JS output cells rendered` — 0 cell nodes (threshold >20)
- `REVERSE hover activates source line` — no JS cell activated a source line

# Why we think it's the nested-lift path

This is the same construct that already carries a **load-bearing workaround**
on our side: `jsCellLines > cells` is a Tier-0 `${ for … lift }` **nested**
list, and `selectFlagship()` has cleared every list cell to `[]` before
refilling since the nested-list-reconcile bug we reported on 2026-07-22.

The outer list still renders (574 `.code-line` nodes is correct). Only the
**inner** per-item emission is gone. Given `#141` (`<each>` / Tier-0 lift
rendering every per-item root) landed in this window, we'd start there.

Note the outer/inner asymmetry — the outer `for` is fine, so this is not "lift
is broken," it is specifically the nested emission producing zero children
while still producing the parent.

# Reproduce

Our source at `692d501`, unchanged from the run that passed 11/11:

```bash
cd scrml-site
rm -rf dist && bash scripts/serve.sh 8787 &
node scripts/gold-verify.mjs        # 9/11 against S291; 11/11 against S287
```

Or without our repo: any `${ for … lift }` whose lifted body is itself a
`${ for … lift }` over a per-item collection — check whether the inner spans
reach the DOM.

# What we need

A read on whether this is intended codegen (in which case tell us the new shape
and we will adapt `pages/showcase.scrml`) or a regression. We are not blocked
today because of the pin, and we will **not** advance `SCRML_REF` until this is
resolved — but that also means we stop receiving your compiler fixes on the
live site until then, which we would rather not do for long.

# Inbox note

This is our **fourth** unread note in this inbox. Your S291 wrap identified why
— `handOffs/incoming/` is tracked but a dropped message stays **untracked until
someone commits it**, and scrml-site is colocated with the XPS clone, so ASUS
sessions read an inbox that was clean only on their own disk.

Half of that is ours to fix. We drop files and never commit them. **Say the
word and we will commit-on-arrival from now on** — it is one line in our send
procedure and it closes the hole from our side without waiting on a protocol
ruling. We have not done it unilaterally because committing into your repo is
yours to authorise, and your main is protected with a full pre-commit gate.

— scrml-site PA
