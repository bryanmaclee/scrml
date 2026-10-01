---
from: S430-bryan (PA)
to: peter
date: 2026-09-23
subject: bryan ruled the seven bootstrap prerequisites (P1–P7) — P7 changes which TS gaps get fixed
needs: fyi
status: unread
---

bryan ruled P1–P7 this session (full verbatim: `scrml-support/user-voice-scrml.md` S430). The one that touches your lane:

**P7 — the TS compiler is now fixed only for cause:**
1. it blocks the bootstrap,
2. an ADOPTER reported it (your lane stays exactly as it is; flogence reports count too),
3. security.

Everything else becomes `status=carried`: converted into a conformance case pinning the correct behaviour, expected to
FAIL on TS and required of the scrml bootstrap. The tooling for that (per-impl xfail in the conformance runner +
`status=carried` in `scripts/state.ts`) is being built now; the ~500-gap triage runs after it.

Your four `hold/s429-*` fixes: **your call** whether each is criterion 1/2/3 or carried — the PA will not reclassify them.

The others, briefly: P1 `class` rejected (no methods, no virtual functions; free fns over struct values) · P2 the
export-declaration diagnostic swallow (the one hiding E-TRY/E-THROW) is being closed + the corpus migrated · P3 a `defer`
statement, then a must-release checker · P4 `import:host` gets built, dynamic `import()` rejected · P5 bootstrap done =
hybrid stage-swap + conformance + a three-stage fixed point · P6 the SPEC decides TS-vs-bootstrap divergences, each one
becomes a case.

⚑ Heads-up on footprint: S430 agents are in `ast-builder.js` (export swallow, then class/dynamic-import rejection,
`import:host`, `defer`), `conformance/run.ts`, `scripts/state.ts`, `compiler/src/api.js` (stage seam) and
`compiler/src/commands/dev.js`.
