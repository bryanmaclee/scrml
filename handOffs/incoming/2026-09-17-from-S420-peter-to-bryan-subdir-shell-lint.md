---
from: S420-peter (P-Tech1, Windows)
to: bryan
date: 2026-09-17
subject: a subdirectory shell draws a FALSE SPA lint and silently suppresses the correct outlet lint — one routing, plus two corrections to things I told you earlier
needs: ruling
status: unread
---

## The one thing that needs you

**`g-program-shape-inference-anchors-on-the-entry-file-dirname` (MED, filed S420).**

`compiler/src/ast-builder.js:20054` computes `const projectRoot = _pathDirname(filePath)` — "the project
root is the directory of the `<program>` file." When the shell lives in a subdirectory, the `pages/` probe
looks in `<root>/shell/pages`, misses, and infers SPA.

PA-reproduced with a control — two projects identical except where the shell sits, both with a real
`pages/` directory at the project root and an outlet-less shell:

```
A · shell at <root>/app.scrml        -> info [W-OUTLET-ABSENT-SOFT-NAV-DISABLED]   (correct)
B · shell at <root>/shell/app.scrml  -> info [W-PROGRAM-SPA-INFERRED]              (false; outlet lint absent)
```

Two defects, and the second is the quiet one:

1. The emitted lint tells the author *"no `pages/` directory exists at the project root"* — **it does** —
   and advises them to *"create a `pages/` directory at the project root"* to fix it and *"create an empty
   `pages/` directory"* to suppress it. Both are already true. Composition demonstrably ran.
2. `W-PROGRAM-SPA-INFERRED` and `W-OUTLET-ABSENT-SOFT-NAV-DISABLED` are mutually exclusive (§20.8.1 /
   §20.8.7), so inferring SPA **suppresses** the outlet lint. A subdirectory shell with no `<outlet>` is
   told nothing about soft navigation being dead.

**Why it is yours and not mine.** Fixing it changes which diagnostics fire. Both are info-level and no
program's compile status moves, so my read is conformance restoration toward §40.8.1's filesystem-inference
rule rather than a language-surface change — but that is a read, not a ruling, and the hard boundary says
ambiguous fails closed. **I have not touched it.**

⚑ **Worth knowing before you rule:** this is the class #972 closed, surviving one file away. #972 united
three gap entries under "the entry file's directory is not the dist root" and fixed it in `codegen/`; this
is the identical `dirname(entryFilePath)` anchor in `ast-builder.js`, and it misfires on **precisely the
subdirectory-shell layout #972 exists to support.**

## Two corrections to things I have told you

**1. The S419 hand-off's CI claim was inverted, and I repeated it.** It said #972's browser test was not
CI-executed while its integration sibling ran in CI. The truth is the reverse: `scripts/browser-baseline.ts
--check` is a step in the **blocking** `gate` job (`ci.yml:148-149`, *"a regression here now blocks"*), and
`compiler/tests/integration` runs **only** in `tracking`, which is `continue-on-error: true`. Filed as
`g-instrument-suites-cite-themselves-as-gates-while-running-only-in-the-non-blocking-tracking-job` (MED).
**The ask there is promote-or-stop-citing, not "make integration blocking"** — `.github/` is shared infra,
so it is a proposal to you, not something I will land.

**2. The e2e-render-map tier's with-data coverage was never 4 of 438 — it was 0.** The filed entry
overstated it. All four populated seeds were inert; the detector the tier exists for had never had a live
subject. Limb 1 is fixed (#978); the seeds are live on 2 of 4 apps and the other two write nothing because
their fixtures are wrong in three different ways. Corrected in place.

## Untouched and still yours

The four S418 ruling builds · the `>>>` tokenizer reorder · `examples/09-error-handling` · the two soft-nav
RULING gaps · the whole S417 list. I worked only instruments and test surface this session.

— S420-peter
