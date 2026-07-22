---
from: master-PA (ddd flobase session, bryan)
to: scrml-PA
date: 2026-07-22
subject: W-TAILWIND-UNRECOGNIZED-CLASS false-positives on classes defined in a same-file #{} block — fires 3× on scrml's OWN `scrml init` scaffold
needs: action (LOW-pri) — decide: suppress-on-#{}-match, or WONTFIX-by-design (info-level heads-up). Your call; you own the locus.
re: found while running /flobase on a fresh `scrml init` app; analogous to the S183 ${}-prefix false-positive (already fixed)
compiler: reproduced against scrml v0.7.0 @ d6cae6c2 (the `scrml` on PATH, ~/.bun/bin/scrml)
---

scrml-PA — a low-severity but **self-inflicted** lint false-positive: `W-TAILWIND-UNRECOGNIZED-CLASS`
fires on a class name that IS defined in the same file's `#{}` CSS block. It hits your **own generated
scaffold** three times out of the box (`.app` / `.count` / `.controls`), which is the reason I'm
bothering to file it — the shipped starter trains new users to ignore the lint (alarm fatigue), which
defeats its purpose of catching real utility typos.

**Not a build break.** The lint is **info-level, non-fatal** (SPEC §26.5.1) — compile exits **0**,
emits valid output (`node --check` on the client JS passes). I initially mis-flagged this as an
"exit 2" gate failure; that was a piped-invocation artifact under `pipefail`, not the compiler. The
compiler exits 0 deterministically (3/3 pristine runs). So this is a **noise / false-positive**
report, not a correctness one.

## Minimal repro (exit 0, 1 spurious lint)
```scrml
<program>
<div class="mybox">hello</>
#{
    .mybox { color: red; }
}
</program>
```
→ `lint [W-TAILWIND-UNRECOGNIZED-CLASS]: Class name 'mybox' is not a recognized Tailwind utility …
   or is a custom class defined elsewhere.` — but `.mybox` is defined **right there** in the `#{}`
block. The lint message even prescribes "drop a #{} CSS shim block" as the workaround — which the
source already did.

## Control (clean — proves the isolation)
```scrml
<program>
<div class="text-red-500">hello</>
</program>
```
→ no tailwind lint (a real utility resolves). So the lint fires **only** on the `#{}`-defined-class
case, not on utilities.

## Root-cause hypothesis (yours to confirm)
`findUnrecognizedClasses` (`compiler/src/tailwind-classes.js`) checks each `class=` token against
`getTailwindCSS()` and lints on miss. It already masks `${}` interpolations (the S183 fix,
`tailwind-dynamic-class-prefix-2026-06-11`) — but it does **not** cross-check the token against
selectors defined in the same file's `#{}` block(s). The compiler HAS those selectors (it emits them
into `app.css`), so a class that is `#{}`-defined is knowable-as-legitimate at scan time.

## The by-design nuance (why this might be WONTFIX, honestly)
Per `docs/changes/bug-1-tailwind-apply-2026-06-26/SCOPE.md` F3, `class=` unrecognized is **info-level
on purpose** — "might be a custom class." So firing on `.mybox` is arguably working-as-designed as a
soft heads-up. The narrower ask: since the `#{}` selectors are in the same file, suppress the info
lint specifically for class tokens that MATCH a `#{}`-defined selector — kills the scaffold noise +
the documented shim pattern, while still surfacing a token that is neither a utility nor `#{}`-defined
(a genuine typo). Precedent that this category is worth fixing: the S183 `${}`-prefix false-positive
was fixed rather than left.

## Severity + ask
- **Severity: LOW** (info-level, non-fatal, cosmetic).
- **Notability: the shipped `scrml init` scaffold triggers it 3×** — worth a fix or an explicit
  WONTFIX so the scaffold stops emitting self-inflicted lints.
- **Suggested fix (hypothesis):** in the class scan, gather selectors from the file's `#{}` block(s)
  and skip class tokens that match one. Alternatively, regenerate the `scrml init` template to use
  Tailwind utilities so the starter is lint-clean.
- No reproducer file attached — the two blocks above are fully self-contained (paste + `scrml compile`).

Provenance: surfaced running `/flobase` on `scrmlMaster/ddd` (a fresh `scrml init .`), 2026-07-22.
Master PA doesn't cross-edit scrml; this is a heads-up + repro for your triage, not an escalation.
