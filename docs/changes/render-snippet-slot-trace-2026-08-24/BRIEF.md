# BRIEF — TRACE ONLY: why does `${render name(...)}` render nothing?

change-id: render-snippet-slot-trace-2026-08-24
dispatched: S372-bryan, 2026-08-24, base origin/main @ b0abcbc6
gap: g-render-snippet-slot-renders-empty (HIGH)
DONE-PROBE: test -f docs/changes/render-snippet-slot-trace-2026-08-24/TRACE.md

## ⚑ THIS IS A TRACE DISPATCH. DO NOT FIX ANYTHING.

You write **no compiler source**. Your deliverable is a written trace that names the file and
line where the behaviour is DECIDED, with the execution path that reaches it. The fix is a
separate dispatch, deliberately — the gap entry says **NO LOCUS TRACED**, and this repo's
recorded failure mode is a confident wrong locus producing a fix that is correct at that site and
incomplete everywhere else, passing its own new tests and the whole suite.

Bound your work. If you cannot reach a decision site, **say so and name where you looked** — a
recorded search is a first-class, sufficient answer here and is worth more than a guess.

## The symptom — PA-VERIFIED BY EXECUTION on `b0abcbc6`

`examples/12-snippets-slots.scrml` — the flagship snippets/slots example — compiles **exit 0,
zero relevant diagnostics**, and every card renders empty:

```
card__header: "<span data-scrml-logic=\"_scrml_logic_1\"></span>"     <- EMPTY
card__body:   "<span data-scrml-logic=\"_scrml_logic_2\"></span>"     <- EMPTY
```

and after mounting the shipped artifact, four of the six sites are `""` outright. **Unslotted
children DO render**, so the defect is the NAMED snippet / `render` surface specifically, not
component expansion as a whole.

Reproduced at S371 in **both** call-site forms, each matching SPEC's own worked example:

| shape | result |
|---|---|
| parametric — `control={ (n) => <strong>${n}</strong> }` + `${render control(label)}` (§16.6 verbatim) | render site EMPTY; the sibling `${label}` prop renders |
| zero-arg via `body={ <em>…</em> }` | render site EMPTY |
| zero-arg via canonical `slot="body"` | render site EMPTY **and** the slotted `<em>` is DUPLICATED into sibling text positions |

## Why SPEC says this must work

§16.8.1 (`SPEC.md:11117`), normative: *"CE SHALL emit a transient `render-expansion` node for
every valid invocation, carrying `propName`, `argExpr`, and `span`. TS consumes it; codegen sees
only `inlinedChildren`."* §16.8.1 also SHALLs the rejection codes (`E-COMPONENT-023` /
`E-TYPE-071` / `E-TYPE-072`) — **none of which fire here**, so the invocation is VALID by the
spec's own classification and simply produces nothing.

## The question to answer, in order

1. **Is the `render-expansion` node emitted at all?** Instrument CE and look. If not, the break
   is upstream of TS and the trace stops there.
2. **If it IS emitted, does TS consume it, and what does it produce?** Does `inlinedChildren`
   get populated? With what?
3. **What does codegen see?** If `inlinedChildren` is empty or absent at the emit site, name the
   pass that dropped it.
4. **The `slot=` duplication row is a clue worth chasing** — S371's unverified hypothesis was
   that slotted content is being inlined as ordinary children INSTEAD of being routed to the
   render site, which would be ONE root for all three rows. Confirm or refute it; do not assume it.

## Suggested entry points — SEARCHED, NOT TRACED. Treat as hypotheses.

- `compiler/src/component-expander.ts` — CE, where §16.8.1 says the `render-expansion` node is born
- `compiler/src/codegen/emit-html.ts` — the render/interp emit surface
- `compiler/src/codegen/emit-client.ts` — where `data-scrml-logic` placeholders get wired
- grep for `render-expansion`, `inlinedChildren`, `snippet`, `propName` across `compiler/src/`

The `data-scrml-logic="_scrml_logic_N"` placeholder IS emitted, so *something* registered a logic
binding for the render site — following that placeholder id from emission to wiring is likely the
fastest path to the decision site.

## Method requirements

⚑ **Mount the SHIPPED runtime CHUNK, never `runtime-template.js`.** The template defines
everything the pruned `scrml-runtime.<hash>.js` omits and masks a whole defect class (S371 method
correction). Read `result.runtimeFilename`. `compiler/tests/browser/browser-theme-switch.test.js`
is the correct pattern; `compiler/tests/helpers/chunk-scope.js` reaches chunk-local accessors.

⚑ **Blast radius is measured, not corpus-zero:** 15 corpus files use `${ render <name>(` and 17
declare a `snippet` prop, including `examples/12-snippets-slots.scrml`, `samples/card.scrml`, and
three `conformance/cases/components/*`. The surface is exercised and broken in place.

⚑ **Why it survived:** the files COMPILE and the conformance cases assert CODES; nothing loads
the artifact and looks at the DOM.

## Deliverable

Write `docs/changes/render-snippet-slot-trace-2026-08-24/TRACE.md` containing:

1. **The decision site** — file:line where the content is dropped, with the execution path that
   reaches it — **or** an explicit *"searched X, Y, Z — no decision site found"* naming every
   file and symbol you inspected.
2. **Which of the three rows share a root**, on evidence (instrumented or executed), not on
   plausibility.
3. **A recommended fix direction** with its direction-of-change classification (pa-base §8) and
   whether it extends an existing mechanism or would add a parallel one.
4. **The blast radius the fix would touch** — which of the 15 + 17 corpus files change behaviour.
5. Anything in the brief above that turned out to be WRONG. Say it plainly; four dispatches
   corrected the PA at S368 and two of those were on measurements the PA had made itself.

## Write-set — HARD BOUNDARY

**You MAY write ONLY:**
- `docs/changes/render-snippet-slot-trace-2026-08-24/TRACE.md`
- `docs/changes/render-snippet-slot-trace-2026-08-24/progress.md`
- throwaway probe scripts **inside your own worktree**, committed with your work

**You MUST NOT write any file under `compiler/`.** Not one line. If you are tempted, that is the
signal that the trace succeeded and the next dispatch should start.

## Crash-recovery (non-negotiable)

Commit after every meaningful unit — WIP commits expected. Append timestamped lines to
`progress.md` as you go: a read-only investigation that dies without commits loses 100% of its
work, and that is a recorded failure mode here.
