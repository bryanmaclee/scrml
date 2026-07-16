# BRIEF (common preamble) — sPA ss77 conformance authoring: markup/parse contract §4/§10

Archived verbatim at dispatch time. Each group brief (BRIEF-A..D) = this preamble + its items.

## Mission
Author conformance cases pinning the CODES in your group. This is FREEZE-GATE tier-1 work
(S256 audit): scrml-language-1.0 does NOT freeze until the conformance suite pins every claimed
V1 surface. Every code in your group has **ZERO coverage** in the corpus today — verified by the
sPA (no `expected.json` anywhere asserts them; the only E-CTX-001 hits are `notCodes` absence
assertions). You are authoring first coverage, not extending existing coverage.

## Setup (do this FIRST)
- You are in a fresh git worktree off main (`32cb0a89`). Work ONLY inside your worktree, using
  paths relative to your worktree root. **NEVER write to `/home/bryan-maclee/scrmlMaster/scrml`**
  (the main checkout) — a path-discipline hook rejects absolute main-rooted writes, and a leak
  corrupts the PA's tree.
- Your worktree lacks gitignored `node_modules` (a checkout brings only tracked files). Run:
  `ln -s /home/bryan-maclee/scrmlMaster/scrml/node_modules ./node_modules`
  Without it `bun conformance/run.ts` cannot run.
- Baseline is **GREEN at 695/695**. Confirm before you start: `bun conformance/run.ts`

## Read first (targeted — do NOT wholesale-read project docs)
1. `conformance/README.md` — the `expected.json` schema + the "(a) Codes-half matching" section.
2. The mirror pair, for exact codes-half format:
   `conformance/cases/block-grammar/block-047-unclosed-brace-pos/` and
   `conformance/cases/block-grammar/block-047-closed-brace-neg/`
3. The named SPEC subsection per code in `compiler/SPEC.md` — read the **subsection**, not the file.

## What a case IS
`conformance/cases/<category>/<case-id>/{case.scrml, expected.json}`

- `case.scrml` — real, minimal scrml that triggers (pos) or cleanly avoids (neg) the code.
- `expected.json`:
  ```json
  {
    "id": "<case-id>",
    "description": "one line — what fires and why (cite the §)",
    "language-version": "1.0",
    "spec": "§X.Y",
    "rationale": "what §X.Y says should happen",
    "expect": { "codes": ["E-TARGET"], "notCodes": [] }
  }
  ```
- **POS**: `codes: ["E-TARGET"]` — PRESENCE, a superset check, so incidental codes are fine.
- **NEG**: `codes: []`, `notCodes: ["E-TARGET"]` — the real assertion is `notCodes`;
  `codes: []` is trivially true under the superset check.
- `id` MUST equal the directory name.
- Message TEXT, emitted JS, and AST are explicit **IMPL FREEDOM** — never assert them.

## Method (LOAD-BEARING — the OQ4 discipline)
1. **GREP THE CODE LIVE** in the compiler source to find the EXACT trigger guard. The line refs
   in your items are **APPROXIMATE** — main has advanced and several have drifted; several codes
   have **multiple fire sites** the original list did not mention. Read the actual guard and author
   source that provably satisfies it. Never guess the trigger from the code's name.
2. Author the `.scrml`; run it through impl#1 to capture the ACTUAL codes.
3. **SANITY-CHECK against the cited SPEC section.**
4. **If impl#1 DIVERGES from a normative SPEC statement — STOP. Do NOT enshrine impl#1's behavior
   against the spec.** Report it as **ESCALATE** in your final message; park that case and continue
   with the rest. Pure golden-capture is REJECTED — it would make impl#1 the spec. (Precedent: the
   §19.9.1 server-error-wire divergence.)
5. Verify `bun conformance/run.ts` is GREEN and the count rose by **exactly** your case count.

## Reachability check (applies to any code whose fire site is in `compiler/native-parser/`)
The conformance adapter drives **impl#1** (the TS reference compiler). A code that fires ONLY in
`compiler/native-parser/*` may be **unreachable through the default conformance pipeline**. If you
cannot make it fire through the harness, do NOT fabricate a case and do NOT assert a code the
pipeline never emits — report it as **ESCALATE / not-fireable** with the evidence. That finding is
worth more than a fabricated green case.

## scrml syntax notes (get these right or your reproducer silently won't reproduce)
- **V5-strict declaration form**: `<x>=0` at top level; `@x=0` **only** inside `${...}` logic
  blocks. Mixing the forms is the single most common reason a reproducer doesn't reproduce.
- **`null`/`undefined` do not exist in scrml** — both are `not`. But `""`, `0`, `false`, `[]`, `{}`
  are DEFINED values, not absence.

## Commit
Do **NOT** commit to main. Do **NOT** push. Leave your work uncommitted in your worktree — the sPA
collects it via file-delta and lands a single commit on `spa/ss77`.

## Report back
- Per code: case dir paths created; the **exact trigger** you found (`file:line` + the guard
  condition); pos + neg verified.
- The final `bun conformance/run.ts` count (must be green).
- Any **ESCALATE** (impl#1-vs-SPEC divergence, or not-fireable) — the highest-value output.
