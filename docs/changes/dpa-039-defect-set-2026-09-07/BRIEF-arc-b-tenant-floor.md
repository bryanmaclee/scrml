# BRIEF — dpa-039 defect set, ARC B: the tenant isolation floor

**Authorized:** bryan, S405 2026-09-07 — call **2** (the bounded six-item set). Verbatim:
*"all your recs look good"*, then *"fire the defect set"*. **Change-id:** `dpa-039-defect-set-2026-09-07` (arc B).

## THE FINDING, IN ONE SENTENCE — and it is bigger than "an off-grammar body is dropped"

> **Two adjacent security floors disagree on what counts as a schema declaration.** The §14.8.9
> PROTECT floor was deliberately TAUGHT the raw-DDL `<schema>` form. The §14.8.10 TENANT floor was
> not. So a raw-DDL + no-`<db>` app gets a silently inert tenant floor.

`harvestRawCreateTables` (`compiler/src/protect-analyzer.ts:454`, called `:557` — PA-verified by
symbol) exists for exactly this, and says so in its own comment:

> *"we harvest those statements too … so a raw-DDL `<schema>` feeds the shadow DB exactly like a `?{}`
> CREATE TABLE — otherwise the raw form reaches NEITHER `parseSchemaBlock` NOR the `?{}` walker and
> E-PA-002 false-fires even though the author DID supply DDL."*

**PA-verified: `tenant-egress.ts` and `db-authoritative.ts` contain ZERO references to it.**
**So the fix is to teach the tenant leg the same harvester — NOT to reject the input.**

## YOUR FILES — and ONLY these

`compiler/src/codegen/tenant-egress.ts` · `compiler/src/schema-differ.js` ·
`compiler/src/codegen/db-authoritative.ts` · the tenant conformance/integration tests.

⛔ **`compiler/src/codegen/emit-server.ts` and `compiler/src/codegen/protect-egress.ts` belong to a
SIBLING AGENT running right now (arc A).** Do not touch them. `emit-server.ts:1769` already passes
`extractDesiredSchema(fileAST).tables` correctly — **the S288 fix is LIVE and is not your problem.**
If your work requires an `emit-server.ts` change, **STOP and report.**

## DONE-PROBE — the 4-app matrix, reproduced end-to-end at `8f1cea31`

Every app has a `tenant_id` column and the same `SELECT id, name, tenant_id FROM assets`:

| app | `<schema>` form | `<db>`? | tenant floor | must be after |
|---|---|---|---|---|
| A | DSL | no | **ACTIVE** | ACTIVE (unchanged) |
| B | **raw DDL** | **no** | **⛑ INERT** | **ACTIVE** |
| C | raw DDL | yes | ACTIVE | ACTIVE (unchanged) |
| D | DSL | yes | ACTIVE | ACTIVE (unchanged) |

```
A_server.js:  let x = _scrml_tenant_tag(await _scrml_sql`SELECT …`, "tenant_id", false);
B_server.js:  let x = await _scrml_sql`SELECT …`;            // no tag, no redact
```
In B, `_scrml_tenant_redact` / `_scrml_active_tenant` / `tenantId` occur **0 times**, at exit 0.
**Only B is broken. A, C and D must not move.**

## THE ITEMS — each with a binary done-condition

### B1. Teach the tenant leg the raw-DDL form
Reuse `harvestRawCreateTables`; do not write a second harvester. Root cause: **both** legs of
`buildTenantContext` (`tenant-egress.ts:90`) come up empty — the `schemaByTable` leg is built from
per-`<db>` `protectAnalysis.views`, and the `<schema>` leg dies in `parseSchemaBlock`
(`schema-differ.js:31`), which recognizes ONLY the `tableName { col: type }` DSL.
- **DONE:** app **B** emits `_scrml_tenant_tag`; A/C/D byte-identical.

### B2. Diagnose an inert floor (defect-set item 1)
A `<schema>` body that yields **zero parsed tables** must fire rather than silently disabling
tenancy. Mint a `W-` or `E-` with a §34 row, a `provenance:` line, and **≥1 conformance case proven
to fire** — a code with no proven bite has never been shown to work.
⚑ **Judgement call, and I want your reasoning, not a coin flip:** after B1 the raw-DDL case parses,
so what remains that legitimately yields zero tables? If the honest answer is "an empty `<schema>`,
which may be intentional", say so and propose the right severity. **Do not ship a cry-wolf gate.**
- **DONE:** a zero-table `<schema>` is loud, and no legitimate corpus file trips it.

### B3. Flip the tenant-side fail-open (item 3, tenant half)
The runtime tenant redactor returns early on values it cannot inspect. **Refuse what the monitor
cannot inspect.** The protect-side twin is arc A's — leave it.
- **DONE:** a tagged value the redactor cannot inspect produces a refusal, not a pass-through.

### B4. Add the missing conformance axis (item 6) — ⚑ THIS IS WHY IT DIDN'T STAY FIXED
`conf-TENANT-FLOOR.test.js`'s single app builder (`tenantApp`, `:32`) pairs a raw-DDL `<schema>`
**with** a `<db src= tables=>`, so the gate drives the floor **100% from the `<db>` registry** and
never exercises the `<schema>` leg. **The uncovered cell is B, and no case builds it.**
⚑ **CORRECTION to the dPA, PA-verified — do not inherit its claim:** it said the `<schema>`-only path
has *"no coverage at all"*. **FALSE.** `compiler/tests/integration/schema-only-tenant-principal.test.js`
is the S288 regression lock for that shape and passes **7/0**. What is missing is the raw-DDL spelling.
- **DONE:** a `<schema>`-only, `<db>`-less case exists in **BOTH** spellings; deleting your B1 fix
  turns it red. **Prove that bite.**

## Blast radius, measured — read it as blast radius, not as demand evidence
95 `.scrml` carry a `<schema>`; ~30 use raw DDL; **4 use raw DDL with no `<db>` at all** —
`samples/gauntlet-r14/htmx-forms.scrml`, `samples/compilation-tests/{server-005-mixed,server-008-form-handler,gauntlet-r10-react-wizard}.scrml`.
**None declares `tenant_id`, so none is presently exploitable** — but the corpus teaches the shape.

## LOCI ARE HYPOTHESES — line numbers rot here and have burned us three times today
Locate by symbol. ⚑ The dPA's own path for `protect-egress.ts` was **wrong** (omitted `codegen/`) and
its `emit-server.ts:1766` was **1769**. Report whether each locus held, was refined, or was wrong.

## ADVERSARIAL SCOPE — enumerate the population, do not list members
A recent dispatch here probed four tokens exhaustively and shipped a HIGH because the helper
recognized a **fifth**. **State the population you enumerated over and how you know it is complete.**
At minimum: `<schema>` in both spellings × `<db>` present/absent × `tenant_id` present/absent; a
`schemaFor()`-expanded `<schema>` (≈12 corpus files); an empty `<schema>`; and multiple `<schema>`
blocks in one program.

## VERIFY
`bun install` → `bun run pretest` **from the worktree CWD** (⚑ `bun --cwd <path> run` silently no-ops
and exits 0 — verify the artifact appeared) → `bun run test`. ⚑ **The suite is NOT 0-fail at base**
— ~63 pre-existing failures. **Capture the base failure set BEFORE changing anything and prove
`comm -13 before after` is EMPTY.** Then the R26 empirical recompile of real adopter `.scrml`.

## DISCIPLINE
Worktree-absolute paths only; never `cd` into the main checkout. **NEVER `git stash`** (shared across
worktrees). **NEVER a bare `pkill -f`**. Commit after every unit; keep an append-only `progress.md`.
I will run an independent S239 adversarial pass before landing.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md`, then its Task-Shape Routing. Watermark is behind HEAD; every landing
since is docs-only.
