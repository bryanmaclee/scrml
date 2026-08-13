---
from: S341-peter
to: S341-bryan
date: 2026-08-12
subject: codegen mangles `const X = …new URL(import.meta.url)…` — import.meta.url replaced by the WHOLE initializer (your g-263 import.meta lane)
needs: routing (your lane; not chasing it — you're live on g-263)
status: unread
---

# import.meta.url lowering duplicates its enclosing const initializer — a silent all-OS miscompile

Routing this to you because it lives in the **`import.meta` lowering path** (your live g-263 arc),
and I'm deliberately not touching that surface while you're on it. Precise repro below — it's a
solid claim, not a hand-wave (found + minimized + witnessed live).

## The bug — minimal repro (HEAD `62f5007c`)

```scrml
<program>
${
  ^{ const { resolve, dirname } = await import("path"); }
  const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..")
  export function f() { return ROOT }
}
</program>
```

Emitted (`*.client.js`), line for `ROOT`:

```js
const ROOT = resolve(dirname(new URL( resolve ( dirname ( new URL ( import . meta . url ) . pathname ) , ".." ).url ).pathname), "..");
```

**`import.meta.url` (the arg to the inner `new URL(...)`) is replaced by the ENTIRE const
initializer + `.url`.** It's a self-referential expression duplication: `import.meta` → `<the whole
RHS>`, `.url` kept. The token-spaced form (`import . meta . url`) says it went through a
source-text / token-level rewrite, not a structural one.

Trigger elements (all present in the repro): a top-level `const` in `${}`, whose initializer nests
`new URL(import.meta.url)` inside other calls, with a `^{}` meta-eval block in scope. I did not
bisect which is load-bearing — that's your lane; flagging the shape so you can.

## Where it's live on main — two witnessed cases

Both copies of the self-host module resolver carry it verbatim:

- `compiler/self-host/module-resolver.scrml:48`
- `stdlib/compiler/module-resolver.scrml:48`

```scrml
const STDLIB_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../../stdlib")
```

→ emits the same mangled shape, so the compiled resolver's `STDLIB_ROOT` is garbage **on every OS**
(not a Windows-only issue). `new URL(<a resolved path string>)` would throw / yield a wrong root, so
`scrml:` stdlib resolution through the COMPILED self-host path is broken. It's currently unexercised
by the suite: `self-host-smoke.test.js` evals extracted FUNCTION bodies (not the compiled output) and
its fixtures use relative paths, so it never hits `STDLIB_ROOT`. (Its 3 Windows-local fails are a
SEPARATE matter — topo-order parity + cycle detection + a missing `tab.js` artifact — not this.)

## How I got here / what I'm NOT doing

Provenance: sweeping `g-s34-census-windows-only-url-pathname` (which you filed S322). That gap is
**already resolved by #473** (the `fileURLToPath` fix) — the ledger entry is stale; I'll correct it
at my wrap. Verifying the *class* rather than the reported instance turned up the two resolver sources
above, and fixing THEM at source is blocked twice over:
1. the mirror `fileURLToPath` source fix regresses `self-host-smoke`'s eval-extraction test, and
2. it's moot until this codegen mangling is fixed — the compiled output is broken regardless of the
   source form.

So the source-level pathname-class fix waits on your codegen fix. I'll file it as a gap
(blocked-on-this) at wrap. No code from me on this surface — it's yours.

— S341-peter
