# BRIEF — dpa-039 defect set, ARC A: the protect / `Response` egress surface

**Authorized:** bryan, S405 2026-09-07 — calls **2** (the bounded six-item set) and **3b** (the
three-item pairing). Verbatim: *"all your recs look good"*, then *"fire the defect set"*.
**Change-id:** `dpa-039-defect-set-2026-09-07` (arc A).

## THE GOVERNING IDEA — read this before any code

> **A source-text predicate cannot carry a confidentiality guarantee.** Five poles reached that
> independently, by three different routes. The repair is NOT a better analysis of the escape hatch.

And the sequencing rule bryan ratified with it, which is why this brief is shaped as bounded items:

> The prior fix was an **unbounded completeness fix on an unsound mechanism** — "handle one more
> spelling of `Response`" — and such a fix **has no done-condition**, so it lost every scheduling
> contest for ~40 sessions. **Each item below has a binary done-condition. Do not widen any of them.**

## YOUR FILES — and ONLY these

`compiler/src/codegen/emit-server.ts` · `compiler/src/codegen/protect-egress.ts` (+ their tests).

⛔ **`compiler/src/codegen/tenant-egress.ts`, `compiler/src/schema-differ.js` and
`compiler/src/codegen/db-authoritative.ts` belong to a SIBLING AGENT running right now (arc B).**
Do not touch them. If your work requires a change there, **STOP and report** — do not reach across.

## THE ITEMS — each with its done-condition

### A1. Guard the UNPROTECTED arms (defect-set item 2)
The baseline-CSRF arm and `<endpoint>` have no `instanceof Response` passthrough. **PA-REPRODUCED BY
EXECUTION at `8f1cea31`:** a server fn returning `new Response("forbidden", {status:403, headers:{"Content-Type":"text/plain"}})`
comes back **`200 / application/json / "{}"`** (`JSON.stringify` of a `Response` is `"{}"`), exit 0,
**no diagnostic**. The identical body under `<program auth="required">` returns **403 / text/plain**.

- Selector: `useBaselineCsrf` (`emit-server.ts:3804` — PA-verified by symbol).
- The one existing guard on a server-fn result path: `:4509`. **The other four `instanceof Response`
  hits in that file are the `handle()` middleware path — do NOT touch those.**
- **DONE:** the 403 reproducer returns 403 / text/plain from the default arm and from `<endpoint>`.
- **Zero confidentiality delta** — nothing was being protected on these arms anyway.

### A2. On the `protect=` arm, the passthrough becomes a HARD DIAGNOSTIC (call 3b item 2)
An author-constructed `Response` returned from a `protect=` scope becomes a **compile error**. The
compiler cannot see inside it and the redactor is fail-open on it; **fail-closed beats fail-open, and
a compile error is the cheapest place to be fail-closed.**

⚑ **This deliberately creates a hole, and the hole is intended** — it is the argument for a future
typed, mediatable return. Do not soften it into a warning. Do not add an escape hatch.

- Mint a new `E-` code with a §34 row, a `provenance:` line, and **≥1 conformance `-neg` case proven
  to fire**. A code with no `-neg` case has never been proven to bite — that is exactly how
  `E-TILDE-001/002` sat dead while two SPEC sections contradicted each other unnoticed.
- **DONE:** the reproducer under `protect=` fails to compile with the new code; the same shape
  without `protect=` still compiles.

### A3. Delete the source-text regex (call 3b item 3 + defect-set item 5)
The `E-PROTECT-004` gate as built is a per-`fn` **source-text co-occurrence regex** over four
spellings. It is *"a lint that reads as a guarantee,"* which the panel called the worst category —
and **ordinary function extraction defeats it** (query in a helper + `new Response` in the caller
compiles clean while the same code in one body fires).

⚑ **The member-chain-walk repair is PERMANENTLY DEAD** — do not attempt it. That is the unbounded
fix with no done-condition. Either promote the check to an AST walk on the shipped
`egress-field-scan.ts` template, or delete the regex and let A2's diagnostic carry the protected path.
**State which you chose and why.**
- **DONE:** no spelling of `Response` compiles clean with a tagged value on a `protect=` path.

### A4. Narrow `reveal` suppression from EXISTENCE-keyed to COLUMN-keyed (item 4)
Today **any** `.reveal(` in a body disarms **every** protected column in that body. RELAYED, not
PA-reproduced — **verify it first and report what you find.**
- **DONE:** `.reveal("email")` no longer disarms `passwordHash`.

### A5. Flip the protect-side fail-open (item 3, protect half)
The runtime redactor begins by returning any `Response` untouched. **Refuse what the monitor cannot
inspect.** The tenant-side twin is arc B's — leave it.
- **DONE:** a tagged value inside an opaque `Response` produces a refusal, not a 200.

## LOCI ARE HYPOTHESES — line numbers on this project rot and have burned us three times today
Locate by symbol (`grep -n 'function <name>'`). ⚑ Note the dPA's own path for `protect-egress.ts` was
**wrong** (it omitted `codegen/`), which is why every path above was re-verified before this brief was
written. Report whether each locus held, was refined, or was wrong.

## ADVERSARIAL SCOPE — enumerate the population, do not list members
A recent dispatch on this repo probed four tokens exhaustively and shipped a HIGH because the helper
recognized a **fifth**. **State the population you enumerated over and how you know it is complete.**
At minimum: the `handle()` middleware path must be unaffected (SPEC §40.3.5's blessed
`new Response("Forbidden", {status:403})` example lives there and IS guarded); `<endpoint>`'s JSON
envelope; a `protect=` scope with no `Response` at all; and a `Response` returned from a plain
non-protected server fn.

## VERIFY
`bun install` → `bun run pretest` **from the worktree CWD** (⚑ `bun --cwd <path> run` silently no-ops
and exits 0 — verify the artifact appeared) → `bun run test`. ⚑ **The suite is NOT 0-fail at base
right now** — ~63 pre-existing failures (a browser-fixture red + order-dependent flakes in
`commands/`). **Capture the base failure set BEFORE you change anything and prove your
`comm -13 before after` is EMPTY.** Then the R26 empirical recompile of real adopter `.scrml`.

## DISCIPLINE
Worktree-absolute paths only; never `cd` into the main checkout. **NEVER `git stash`** (shared across
worktrees). **NEVER a bare `pkill -f`** (matches suites in other checkouts). Commit after every unit;
keep an append-only `progress.md`. I will run an independent S239 adversarial pass on your diff before
landing — report honestly; a limb you name costs far less than one I find.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md`, then follow its Task-Shape Routing. Its watermark is behind HEAD but
every landing since is docs-only. It has been load-bearing on this surface before — a recent dispatch
got an exact call-site enumeration from it that the PA's brief had undercounted.
