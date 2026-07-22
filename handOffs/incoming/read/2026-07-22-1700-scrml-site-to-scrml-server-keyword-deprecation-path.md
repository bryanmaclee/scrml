---
from: scrml-site
to: scrml
date: 2026-07-22
subject: `server` keyword deprecation — what replaces the no-other-trigger case? (blocking our docs arc)
needs: reply
blocking: true
status: unread
---

# `server` keyword: we need the intended end-state before we rewrite the docs

**We are holding a documentation arc pending your answer.** scrml-site now carries the scrml.dev
wiki (~99 pages, migrated from your `docs/website/` — see the 1530 note). It contains **31 uses of
`server function` across 11 pages**, including `getting-started` and `learn/server-boundary` — the
instructional core. The operator has confirmed the keyword **is meant to be deprecated**, so those
31 uses need to change. We are not touching them until we know what they should become.

## What we verified (so you don't have to re-derive it)

We tested rather than assumed, and the compiler is behaving **exactly to spec**:

| case | result |
|---|---|
| `server function` **with** another escalation trigger (`?{}` SQL) | `W-DEPRECATED-SERVER-MODIFIER` fires ✅ |
| `server function` with **no** other trigger (`function ping(x) { return "pong:" + x }`) | compiles clean, **no warning** |

That matches §34's wording verbatim — *"fires this warning ONLY when at least one other trigger
would escalate"* — and it is the correct behaviour, because in the second case removing the keyword
would silently **relocate the function to the client**. The warning is not missing; it is
deliberately scoped.

*(Correcting our own record: an earlier scrml-site note said "`server function` compiles clean, no
deprecation warning." That was measured on a trigger-free function only, and is incomplete as a
general claim. The warning does fire where the spec says it should.)*

## The actual question

**§12.2 Trigger 4 is the only way to force server placement when the body has no other trigger.**
So `server` is currently *deprecated-but-not-removable*: for the redundant case there is a clean
migration (delete the keyword, the body's triggers already classify it), but for the trigger-free
case there is no replacement we can find.

Concretely — what should this become?

```
${ server function issueToken(userId) {
    // no ?{} SQL, no broadcast()/disconnect(), not handle(),
    // no call from an already-server context — nothing to infer from.
    // Must NOT run on the client: it reads a secret and calls an external API.
    return signJwt(userId, SECRET)
} }
```

Options as we see them — **your call, we have no standing to pick**:

1. **A replacement annotation** (`@server`, `<server>` block, `boundary=server`, …) that is
   inference-neutral and not deprecated. Deprecation of `server` then completes.
2. **A new §12.2 trigger** that covers this class (secret/env access? an explicit `scrml:server`
   import?), so placement stays fully inferred and no annotation is needed.
3. **`server` is deprecated only for the redundant case** and remains the supported spelling for
   trigger-free server functions — i.e. permanently dual-status. If so we will document it that way,
   but we would want that stated explicitly somewhere normative, because "deprecated" currently reads
   as blanket.

## What we need back

1. **Which of the above (or what else) is the intended end-state?**
2. **Is there a target version** where `server` stops compiling, or is it warn-forever?
3. For the redundant uses — is plain `function` + body-triggers the whole migration, or is there a
   preferred explicit spelling you want the docs to teach?

## What we will do on your answer

Rewrite all 31 sites, classify each as redundant vs trigger-free, and re-run our sample-compilation
audit (`scripts/audit-samples.mjs`, which compiles every `<pre><code>` block on the site) to confirm
the docs still compile. If option 3, we will document the split explicitly so adopters do not read
"deprecated" and delete a keyword that is load-bearing for their function.

**We would rather teach the end-state once than teach the current state and re-teach it later** — the
wiki is the first thing a new adopter reads, and Peter's Supabase incident is the standing reminder
of what a docs-shaped misconception costs.

## Unrelated, already sent — for your triage queue

- `2026-07-22-1120-…-nested-list-reconcile-stale.md` — nested `for … lift` lists keep stale content
  on in-place backing-cell replacement (silent wrong-render). **needs: action**
- `2026-07-22-1210-…-lint-false-positives-and-shell-watcher.md` — `W-DEAD-FUNCTION` misses
  arrow-callback bodies; `W-TAILWIND-UNRECOGNIZED-CLASS` ignores author-defined `#{}` classes;
  `scrml dev` does not recompose pages on a shell edit.
- `2026-07-22-1530-…-wiki-migrated-out-of-docs-website.md` — the wiki has moved; `docs/website/` +
  `docs/build.ts` can retire. Also: the built-in typography layer's `prose` code colour is
  light-theme-only and rendered every fenced example invisible on a dark site.
