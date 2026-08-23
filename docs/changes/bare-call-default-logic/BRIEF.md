# BRIEF — bare call at a default-logic body-top (S368, operator-ruled `c`)

DONE-PROBE: bash -c 'd=$(mktemp -d); printf "<program>\nloadData()\n<p>ok</>\n</program>\n" > "$d/t.scrml"; bun compiler/bin/scrml.js compile "$d/t.scrml" --output-dir "$d/o" >/dev/null 2>&1; [ $? -ne 0 ]'

## The ruling — this is NOT an open design question

**Operator ruled `c` (S368).** Diagnose the **CALL SHAPE specifically** at a
`<program>` / `<page>` / `<channel>` default-logic body-top. Explicitly rejected alongside it:
- **(a) lift every text run** — contradicts the S122 ruling AND breaks prose (prose renders at that
  position today and is a working shape).
- **(b) diagnose every non-declaration run** — over-reaches into prose.

Banked verbatim: `scrml-support/user-voice-scrml.md` S368.

## Why this is conformance restoration, not a new policy

A bare **write** at the identical position is *already* a hard error:

```
error [E-WRITE-NOT-IN-LOGIC-CONTEXT]: bare `@n = ...` write at default-logic body-top.
Default-logic mode (SPEC §40.8) auto-lifts DECLARATIONS only — NOT writes.
Writes are logic; wrap in `${...}`.
```

Its §34 row cites **the S122 user-voice Option-2 ratification** and states the rule as *auto-lifts
DECLARATIONS only … writes ARE logic; logic goes in `${...}`.* **A call is logic by the identical
reasoning.** §40.8 specifies the lift set and is silent on the complement; everything in the
complement falls through to "emit as text", which is right for prose and wrong for logic.

## ⚑ THE DISCRIMINATOR — reason in scrml's grammar ONLY

**"Valid JS" has NO standing in this decision, in either direction** (operator-ruled S368, verbatim:
*"There is lots of valid js that dose not work in scrml … 'valid js' is not a consideration one way
or another"*). scrml is **not** a JS superset — `try/catch`, `async`/`await`, `===`,
`null`/`undefined` are all valid JS and none is scrml.

So do **not** implement this by asking whether a run parses as JS, and do not justify any choice
that way in code comments, SPEC text, or your report. The rule is:

- `ident(...)` / `obj.method(...)` — **a scrml call form → logic → diagnose it.**
- a bare word, a sentence, prose — **not any scrml logic form → text → leave it alone.**

There is no ambiguous middle to engineer around. If you find yourself reaching for a JS parser to
classify a run, stop and report — that means the scrml-grammar answer is unclear and it is a ruling,
not an implementation choice.

## Measured behaviour on main (PA-verified — reproduce before changing anything)

```scrml
<program>
Welcome to the dashboard.      <!-- exit 0, renders as text.  WORKING SHAPE — must stay working -->
Loading                        <!-- exit 0, renders as text.  WORKING SHAPE — must stay working -->
loadData()                     <!-- exit 0, renders as text.  THE DEFECT -->
@n = 2                         <!-- exit 1, E-WRITE-NOT-IN-LOGIC-CONTEXT. Already ruled. -->
<p>hi</>
</program>
```

## Scope

1. **The diagnostic.** A new code, sibling to `E-WRITE-NOT-IN-LOGIC-CONTEXT`, firing on a call-shaped
   run at the IMMEDIATE default-logic body-top of `<program>` / `<page>` / `<channel>`. Match that
   code's discrimination exactly: **immediate body-top only** — a call inside a `function` body, or
   inside an explicit user-written `${...}` at body-top, is NOT this. Its message must name the fix
   (`${ loadData() }`) the way the write diagnostic names its own.
2. **§34 catalog row + SPEC §40.8 amendment.** §40.8 currently specifies the lift set and is silent
   on the complement; state the complement rule normatively. Carry a `provenance:` field —
   `ruling:user-voice-scrml.md S368` plus the verbatim line.
3. **Migration.** This is **newly-rejecting**. Reuse the existing per-file exemption mechanism if the
   measured migration is non-zero.

## Verification — do not mark DONE without these

- **Reproduce all four shapes above first.** The two working shapes (prose, bare word) are
  regression targets, not incidental — a fix that rejects either is wrong.
- **MEASURED migration, count AND file list**, over `samples/ examples/ conformance/cases/ stdlib/
  benchmarks/ docs/`. **Assumed-zero is not measured-zero.** ⚑ A PA scan attempted this and
  over-counted badly because finding "body-top" by regex is unreliable — **derive the population
  from the compiler/AST, not by text scanning**, and say which you used. If the count is non-zero,
  report it and stop before migrating; a non-zero migration is a separate ruling.
- **Direction-of-change: newly-rejecting.** Run `bun scripts/corpus-emit-differential.ts` — any file
  that newly fails is a migration item; any artifact whose content changes is unexpected here and
  must be explained. ⚑ That tool keys scope ids on a project-root marker (`scrml.toml`/`.git`); give
  both sides a marker or you will read ~1000 false diffs.
- **Bite proof both directions**, exit codes measured DIRECTLY (never through a pipe): the call form
  reds, prose and the bare word stay green, and reverting your change restores the silent emission.
- **A merge-blocker test** pinning: the call form diagnosed · prose still renders · a bare word still
  renders · a call inside `${...}` still compiles · a call inside a `function` body still compiles.
- Full suite `bun run test`; conformance `bun conformance/run.ts`. Establish your own baseline at your
  merge-base rather than assuming which failures are pre-existing.

## Out of scope

- The **four other silent-code-as-text members outside §40.8** — notably
  `on mount { loadDashboard() }` shipping as page text in a `<db>` state-block body
  (`samples/htmx-debate-dashboard.scrml:143`), where `isDefaultLogicBody` is deliberately false and
  the mount hook never runs. **Separate locus, separate ruling — do not touch.**
- The `//`-comment flush defect (fixed on its own branch, review owed).

## Process

Commit after each unit; append to `docs/changes/bare-call-default-logic/progress.md`. Never
`--no-verify`; never override `core.hooksPath`. **First commit must be a real docs-only one** — an
empty WIP commit defeats the hook's docs-only skip and runs the full suite for nothing.

⚑ `compiler/tests/integration/self-host-smoke.test.js` resolves `projectRoot` to the **MAIN**
checkout by design, so a `Self-host: block-splitter parity` red may belong to a concurrent agent
editing main, not to you. Check the path in the stack before attributing it.

Report: files touched · final SHA · whether the PA loci held/refined/were wrong · the MEASURED
migration (count + files + how you derived the population) · differential result · bite proof with
exit codes · maps load-bearing or not · any DEFERRED item WITH ITS REASON.
