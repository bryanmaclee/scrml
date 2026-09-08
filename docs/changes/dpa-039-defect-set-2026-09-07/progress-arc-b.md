# progress — dpa-039 arc B (tenant isolation floor)

Append-only. Timestamps UTC.

## 2026-09-07T~13:05Z — startup verification

- `pwd` = `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a54daa9c8437c79c5`
- `git rev-parse --show-toplevel` == that path. Tree clean at start.
- `HEAD` == `origin/main` == `merge-base` == `8fa6854d749ba66469650a62c0799bf0eaabf396`.
- `bun install` -> 218 packages. `bun run pretest` from the worktree CWD -> exit 0,
  `samples/compilation-tests/dist/` has 34 artifacts (VERIFIED the artifact appeared,
  per the `bun --cwd` no-op trap).
- Brief fetched from `origin/briefs/s405-dpa-039-defect-set`.

## 2026-09-07T~13:10Z — DONE-PROBE MATRIX REPRODUCED AT BASE (exit 0, zero errors)

Harness: `<program db=…>` + `<schema>` (DSL or raw DDL) + optional `<db src= tables=>`
+ a `${}` logic block whose server fn does `?{`SELECT id, name, tenant_id FROM assets`}.all()`.

| app | `<schema>` | `<db>` | server bytes | `_scrml_tenant_tag` | q-line |
|---|---|---|---|---|---|
| A | DSL | no | 6224 | 3 | `_scrml_tenant_tag(await _scrml_sql`…`, "tenant_id", false)` |
| B | raw DDL | no | **2670** | **0** | `await _scrml_sql`…`` — **NO TAG** |
| C | raw DDL | yes | 6224 | 3 | tagged |
| D | DSL | yes | 6224 | 3 | tagged |

`_scrml_tenant_redact` / `_scrml_active_tenant` / `tenantId` are all **0** in B, and B raises
**no diagnostic at all** (`I-TENANT-STRIP` fires in A/C/D and is absent in B). Exit 0.
**The brief's finding is confirmed independently, not relayed.**

## LOCUS VERIFICATION (the brief says loci are hypotheses)

- `harvestRawCreateTables` — `compiler/src/protect-analyzer.ts:454`, called `:557`. **HELD** (both exact).
- `buildTenantContext` — `compiler/src/codegen/tenant-egress.ts:90`. **HELD.**
- `parseSchemaBlock` — `compiler/src/schema-differ.js:31`. **HELD.**
- `emit-server.ts:1769` `extractDesiredSchema(fileAST).tables`. **HELD** (not touched — arc A owns the file).
- `conf-TENANT-FLOOR.test.js` `tenantApp` at `:32`. **HELD.**
- Brief's correction re `schema-only-tenant-principal.test.js` — verified below.

## 2026-09-07T~13:25Z — B1 LANDED (878d69df) + the fail-open it shipped (d5d96b7a)

Fix locus: `extractDesiredSchema` (db-authoritative.ts) harvests raw `CREATE TABLE`
from `<schema>` bodies via the SHARED `harvestRawCreateTables` (now exported from
protect-analyzer.ts); `parseRawCreateTableColumns` (schema-differ.js) reads the column
names; `diffSchema` skips the resulting `rawDdl` tables.

`parseSchemaBlock` was RULED OUT as the locus on evidence: its output feeds
gauntlet-phase1-checks' DSL-specific validators, so raw-DDL tables routed through it
fire E-SCHEMA-004 on every non-§39.4 SQL type and W-SCHEMA-001 on table-level PKs.

⚑ My own B1 fix shipped a fail-open, found by the adversarial sweep and closed in
d5d96b7a: `CREATE_TABLE_RE` handles ONE nesting level, so
`CREATE TABLE assets (name TEXT CHECK (name IN ('a','b')), tenant_id TEXT)` clipped at
the inner `)` and `tenant_id` vanished -> floor inert again. `parseRawCreateTableColumns`
now re-reads the column list from the original `<schema>` body.

DONE-PROBE after B1: A/C/D BYTE-IDENTICAL to base; B 2670 -> 6224 bytes, tag 0 -> 3,
I-TENANT-STRIP now fires.

## 2026-09-07T~13:45Z — B4 LANDED (4f97a69e), BITE PROVEN

Deleting the B1 raw-DDL pass:
  (fail) … BOTH spellings > raw `<schema>`, NO `<db>` block — 11 pass / 1 fail
The `dsl` sibling and every pre-existing case stay GREEN — the direct demonstration
that the existing cases were 100% `<db>`-driven.
Unit lock bites too: 4 of 20 fail.

⚑ BRIEF'S CORRECTION VERIFIED INDEPENDENTLY: `schema-only-tenant-principal.test.js`
passes 7/0 at base. The dPA's "no coverage at all" is FALSE. It now carries the
raw-DDL twin as well (10/0).

## 2026-09-07T~14:00Z — B3 LANDED (93aa965e), BITE PROVEN

`_scrml_tenant_redact` read `instanceof Response` BEFORE the tenant descriptor, so a
TAGGED value inside a host-opaque carrier crossed the wire uninspected. Descriptor now
read FIRST; tagged+opaque REFUSES (throws), untagged+opaque still passes through (the
shipped §12.5 binary egress path, pinned by two regression guards).
Restoring the pre-fix ordering: 3 fail / 45 pass.

## 2026-09-07T~14:20Z — B2 LANDED (ab02125a), BITE PROVEN

W-SCHEMA-NO-TABLES-DECLARED, Warning. Trigger: non-blank comment-stripped TEXT body AND
zero tables from EITHER form AND zero SECDEF `fn`s AND no non-text child.

Corpus census over ALL 2,555 `.scrml`: 91 carry a parsed `<schema>`; 18 are schemaFor
delegation bodies (the cry-wolf population — all quiet); exactly ONE trips the code,
`compiler/tests/commands/migrate-program-shape-fixtures/schema-anchor.scrml`, whose body
`users: { id: integer, name: text }` declares nothing because of a stray colon. A genuine
defect in scrml's own corpus, found on first run.

Neutralizing the fire site: 3 fail / 18 pass — exactly the 3 FIRES cases; all 7 SILENT
cases stay green.

## LOCUS REPORT (the brief asked which held)

| locus (as briefed) | verdict |
|---|---|
| `harvestRawCreateTables` protect-analyzer.ts:454, called :557 | **HELD**, both exact |
| `buildTenantContext` tenant-egress.ts:90 | **HELD** |
| `parseSchemaBlock` schema-differ.js:31 | **HELD** |
| `emit-server.ts:1769` `extractDesiredSchema(fileAST).tables` | **HELD** — not touched (arc A owns the file) |
| `tenantApp` conf-TENANT-FLOOR.test.js:32 | **HELD** |
| dPA's "no coverage at all" for `<schema>`-only | **WRONG**, as the brief said — verified 7/0 at base |

## 2026-09-07T~15:10Z — VERIFICATION

### Full suite

| | pass | skip | todo | fail | files | wall |
|---|---|---|---|---|---|---|
| BASE (8fa6854d) | 31131 | 214 | 11 | 56 | 1451 | 410s |
| AFTER run 1 | 31175 | 214 | 11 | 55 | 1452 | 480s |
| AFTER run 2 | 31176 | 214 | 11 | 54 | 1452 | 341s |

`comm -13 base-fails after2-fails` is **EMPTY** — zero new failures.

⚑ Run 1 showed ONE entry in `comm -13`:
`§64 tool target — R26 > Bun.serve tool: invoke-only harness stays alive`.
It did NOT reproduce in run 2, passes 32/0 in isolation, and I did not merely assert
it was unrelated — I EXECUTED its exact fixture: no `<schema>`, no `?{}`, zero
`_scrml_tenant*` symbols in the emitted 396-byte module, and
`W-SCHEMA-NO-TABLES-DECLARED` absent. None of the three change sites can run for it.
It spawns a subprocess, binds a port and fetches within a 10 s deadline; run 1 was
17% slower wall-clock under sibling-agent load. Load-flake.

`comm -23` shows 2 base failures GONE (TodoMVC "dist not compiled"). Not a code
effect — `scripts/corpus-compile-floor.ts` builds `benchmarks/<dir>/`, which
populated the gitignored dist those two assert on.

### R26 empirical recompile
- `scripts/corpus-compile-floor.ts` — **PASS**, 37 showcase programs (32 single +
  5 multi-file), 1 tracked baselined failure (`examples/09-error-handling.scrml`,
  pre-existing, `g-fail-variant-shorthand-rejected-by-ts-context`).
- `bun run pretest` — 13 samples, exit 0.
- The 4 raw-DDL + no-`<db>` corpus files the brief named all compile clean; all four
  carry ZERO `tenant_id`, so the floor correctly stays off for them (`grep -c` = 0).

### Zero-overhead check (non-tenant apps carry nothing)
| shape | bytes | tenant_tag | tenant_redact | tenant_opaque | tenantId |
|---|---|---|---|---|---|
| no `<schema>` | 2662 | 0 | 0 | 0 | 0 |
| DSL `<schema>`, no tenant_id | 2666 | 0 | 0 | 0 | 0 |
| raw-DDL `<schema>`, no tenant_id | 2666 | 0 | 0 | 0 | 0 |

### types-gate — RED AT BASE, and none of the 12 are mine
`bun run types:check` reports **12 NEW** diagnostics. I reverted all five of my
source files to `8fa6854d` and re-ran: **the SAME 12, byte-identical.** Pre-existing
`origin/main` breakage (`compiler/tests/TYPES-BASELINE.json` is stale); surfaced, not
inherited.

### Byte-identity, stated precisely
After **B1 alone** A/C/D are byte-identical to base. After **B3** they are NOT, and
that is B3 working as briefed: the shipped `SERVER_TENANT_HELPER` changes for every
tenant app. The A/C/D delta from base is EXACTLY the B3 helper block
(`_scrml_tenant_opaque` + `_scrml_tenant_refuse_opaque` + the reordered descriptor
read) and nothing else — diffed line by line. B is the only app whose BEHAVIOUR moves.

## 2026-09-07T~15:40Z — B3 EXTENDED (05a6cda5): the tag must STICK

Adversarial sweep run against arc B's OWN B3 fix. `_scrml_tenant_opaque` enumerates
FIVE carrier kinds; the question that matters is what a TAGGED value of a kind NOT in
that set does. Thirteen exercised (Map, Set, Date, Promise, RegExp, Error, URL,
Headers, FormData, WeakMap, class instance, null-proto object, FROZEN row). Twelve
fail CLOSED. The thirteenth LEAKED:

  Object.freeze({tenant_id:"B",secret:"s"}) -> tag -> redact(ambient "A")
    => {"tenant_id":"B","secret":"s"}

Mechanism: the descriptor write is a plain property write, which is a SILENT no-op on
a frozen / sealed / non-extensible object. Every write is now VERIFIED and refuses.
Honest reachability: NOT reachable from correct emission (the tag wraps the raw driver
result; no author code runs between the await and the tag). Defence in depth.
Bite: deleting the one verification line -> 4 fail / 50 pass.

## 2026-09-07T~16:00Z — B5 (2bbb976a): CROSS-ARC, a LIVE tenant escape

Handed across from arc A. REPRODUCED HERE BEFORE FIXING — "byte-identical code" is not
a reproduction, and the consequence differs (tenant isolation escape vs protected-column
leak).

§23.2 opener = `_` + ZERO OR MORE `=` + `{`. The scan tested `_\{` — level 0 only, i.e.
exactly the spelling W-FOREIGN-001 steers authors AWAY from. Levels 1/2/3 compiled at
exit 0 with ZERO errors; EXECUTED, ambient tenant "A" received
`{"id":2,"name":"THEIRS","tenant_id":"B"}` because the foreign block flattens the tagged
rows to a STRING past the redact's `typeof !== "object"` exit.

Fixed with the in-tree pattern at ast-builder.js:18392 (copied, not re-derived).

Opener-detector enumeration — 5 sites, all classified, none unexplained:
  tenant-egress.ts:389 FIXED · protect-egress.ts:294 arc A's · ast-builder.js:18392
  CORRECT · type-system.ts:473 levels 0+1 only, PARTIAL, SURFACED ·
  lint-w-interp-in-raw-content.js:51 level-0-only for EVERY sigil, SURFACED.

Negative check with reconciled totals over all 2,555 corpus `.scrml`: the widening adds
14 matches in 14 files; 14 GENUINE §23.2, 0 not-genuine, **0 UNEXPLAINED**,
`genuine + notGenuine === delta` asserted. No false-positive surface.
Bite: reverting to `_\{` -> exactly 6 red (levels 1/2/3 at unit AND conformance grain).

## MY OWN ADVERSARIAL PASS (the two classes arc A hit)

**(a) False positive on compiler-generated code.** Enumerated every construction site of
a `kind:"state", stateType:"schema"` node: there is none in the compiler — every such
node comes from the block splitter parsing AUTHOR source. `emit-schema-for.ts` emits a
TEXT FRAGMENT in codegen, not a synthetic node, and runs after GCP1. So
W-SCHEMA-NO-TABLES-DECLARED structurally cannot fire on generated code. Separately,
`detectTenantRawEgress` scans `_src.slice(span)` off `fileAST._sourceText` — author
source, not emitted JS — verified at the call site (emit-server.ts:1902).

**(b) A silently dead limb — a negative case passing because the fixture never parsed.**
Checked against MY OWN B2 negatives. All eight build a real `<schema>` node at ZERO
errors, and carry the child kinds the exclusion logic keys on:
| case | node? | child kinds | errors |
|---|---|---|---|
| dsl table | yes | `["text"]` | [] |
| raw table | yes | `["text"]` | [] |
| comment `--` | yes | `["text"]` | [] |
| comment `//` | yes | `["text","comment","text"]` | [] |
| comment `/* */` | yes | `["text"]` | [] |
| empty | yes | `["text"]` | [] |
| **schemaFor** | yes | **`["text","logic","text"]`** | [] |
| secdef fn only | yes | `["text"]` | [] |
The schemaFor row is the load-bearing one: it really does carry the `logic` child that
the `hasNonTextChild` exclusion tests, so that limb is live, not vacuous.

## OUT OF SCOPE — reported, not taken

**The A5 twin** (arc A's guard branching on `_protectActive` alone) lives in
`codegen/emit-server.ts`, which the brief forbids me outright ("If your work requires an
emit-server.ts change, STOP and report"). Not taken. Coordinator offered to carry it as
a separate item — please do.

## 2026-09-07T~16:30Z — FINAL VERIFICATION

| | pass | skip | todo | fail | files | wall |
|---|---|---|---|---|---|---|
| BASE (8fa6854d) | 31131 | 214 | 11 | **56** | 1451 | 410s |
| FINAL | 31199 | 214 | 11 | **54** | 1452 | 298s |

`comm -13 base-fails final-fails` -> **EMPTY**. Zero new failures.
`comm -23` -> the 2 TodoMVC "dist not compiled" entries, which
`scripts/corpus-compile-floor.ts` fixed by building `benchmarks/<dir>/`. Not a code
effect.

R26 recompile re-run at the final SHA: corpus-compile-floor **PASS**, 37 showcase
programs, 1 tracked baselined failure (pre-existing).

Done-probe at the final SHA — all four ACTIVE, identical emission (10319 bytes,
tag=3, redact=4, active=2, tenantId=3), zero errors. Only app B's BEHAVIOUR moved
from base; A/C/D differ from base by exactly the B3/B5 helper text, diffed line by line.

types-gate: 12 NEW — PROVEN pre-existing by reverting all five source files to
8fa6854d and re-running (the SAME 12). `compiler/tests/TYPES-BASELINE.json` is stale
on origin/main. Surfaced, not inherited.

## 2026-09-07T~17:30Z — ROUND 2 (55669b90): the S239 findings

Finding 1 (`protect-egress.ts` still level-0) is the coordinator's orchestration
boundary, not a defect here. **`protect-egress.ts` UNTOUCHED.** Verified: my delta
does not name that file.

### HIGH 2 — case-sensitive table matching, BROADER than reported

Reproduced at exit 0, no diagnostic:

| declared | queried | before | after |
|---|---|---|---|
| `assets` | `assets` | ACTIVE | ACTIVE |
| `Assets` | `assets` | **INERT** | ACTIVE |
| `assets` | `ASSETS` | **INERT** | ACTIVE |
| `ASSETS` | `Assets` | **INERT** | ACTIVE |
| `Assets` (DSL) | `assets` | **INERT** | ACTIVE |

⚑ The review scoped this to raw-DDL names carrying author casing. It is the WHOLE
declaration side — the DSL leg (S288, predating this arc) has it identically.

Fixed in the CONTAINER (`TenantTableSet extends Set`), not per lookup: `has()` has
FIVE call sites and TWO are in `emit-server.ts`, which this arc may not touch.
Bite: reverting to a plain `Set` -> 5 red.

### MEDIUM 3 — the silent "up to date", and my comment was WRONG

My comment claimed the change "moves neither direction". It moves one. Reproduced
on THREE shipped corpus files (htmx-forms, server-008-form-handler, server-005-mixed):
early-return false, plan **0 statements**, **zero warnings**, table absent.
`W-SCHEMA-PLAN-WITHHELD` minted (§34 + §39.12 rows). Bite: neutralizing the
collector -> warnings `[]` on all three.

### MEDIUM 4 — qualified names

`public.assets` / `"public"."assets"` matched nothing; §14.8.11 is Postgres-ONLY so
that is the tier's likeliest spelling. Recognizing it is not enough — `resolveDb`
REPLAYS statements into in-memory SQLite, which has no such namespace, so the
harvester NORMALIZES the qualifier away. All three qualified spellings now ACTIVE.

### MEDIUM 5 — my test ran the one mode the bundle never runs in

Verify-after-write rests on a frozen write being a SILENT no-op — true only in
SLOPPY mode. `app.server.js` is an ES module, always STRICT, where it THROWS.
`_scrml_tenant_mark` now try/catches and routes BOTH shapes to the same refusal;
the test file gains `loadHelperModule()` (a real `.mjs` import) and the header no
longer over-claims. Both limbs pinned, each under the mode that reaches it.

### LOW 6 — CORRECTION TO THE REVIEW, measured

"That test disambiguates all nine" — it disambiguates **EIGHT**. Per-name
measurement: `constraint`/`primary`/`foreign`/`unique`/`check`/`exclude`/`index`/`key`
all recover as columns; `like` does not, because `like TEXT` and the in-parens
`LIKE other_table` copy clause are the same shape. Closed by the GRAMMAR instead:
`LIKE` is RESERVED, so a column named `like` must be quoted — `"like"`, `` `like` ``
and `[like]` all parse, and the unquoted copy clause is still skipped.

### LOW 7 — the recognizer moved to `schema-differ.js`

protect-analyzer's line-631 invariant, mirrored: consumers must not pull
`bun:sqlite`/`node:fs` to ask what counts as a table declaration. Still ONE recognizer.

### Also
`schema-anchor.scrml` typo fixed; its 54 consuming tests green.

### VERIFY (round 2)
Full suite 31213 pass / 54 fail — `comm -13` vs base **EMPTY**.
R26 with `matched + unmatched == total`: ⚑ **my first pass FAILED its own
assertion** — a shallow readdir enumerated 36 against the floor's 37, missing a
program whose sources live in a SUBdirectory. The truncated-probe shape, in my own
instrument, caught only by comparing totals. Recursive: **37 enumerated, 36 CLEAN,
1 tracked baselined, 0 unexpected, 0 UNCLASSIFIED, agrees with the floor.**

## 2026-09-07T~19:00Z — ROUND 3 (2f7dbe05, 0e0c28c2): the seam DELETED

### The interaction, reproduced then removed

Round 1's `sourceText` unclip-recovery and round 2's qualifier normalization
cancelled: stored statement `assets`, body `public.assets`, `indexOf` -> -1,
recovery silently never fired.

⚑ NOT a third patch. Every defect this recognizer has had traces to ONE thing —
the regex matching the column BODY with a one-level-nesting group. That group is
GONE: `CREATE_TABLE_HEAD_RE` matches the head, a balanced scanner finds the close.
Nothing clips, so nothing needs recovering, so the `sourceText` parameter is
DELETED and `extractDesiredSchema` consumes `harvestRawCreateTableDecls` directly
instead of round-tripping through a stored string. **One side of the seam removed,
not both patched.**

CROSSED MATRIX (3 qualifiers x 5 first-columns):

| | before | after |
|---|---|---|
| cells INERT | **6 / 15** | **0 / 15** |
| stored statement replays into SQLite | **5 / 15** | **15 / 15** |

⚑ ATTRIBUTION, by running origin/main's exact regex side by side: the UNQUALIFIED
clip -> `E-PA-003` is **PRE-EXISTING on main**; only the QUALIFIED row was mine.
This closes both.

### HIGH — a DROP against a declared table

`desiredMap` filtering made step 3 read declared raw tables as UNdeclared:
`allowDestructive=false` -> W-SCHEMA-PLAN-WITHHELD **and**
W-SCHEMA-DESTRUCTIVE-DROP (contradictory); `=true` -> `DROP TABLE IF EXISTS
"assets";`. `desiredMap` now covers ALL desired tables. Its ONLY consumer is the
drop check (grep-verified), so no DDL path moves. Bite: 3 red.

### MEDIUM — `key VARCHAR(50)`

`KEY idx (col)` and `key VARCHAR(50)` are the same token shape. Discriminator is
the paren CONTENT: numeric = a type argument, identifiers = an index column list.

### ⚑ AND ONE I FOUND IN MY OWN NEW MATRIX

The KEY bite turned only **1** case red — all fifteen `leaderParen` cells stayed
GREEN, because they asserted `cols[last] === "tenant_id"` and dropping `key` does
not move `tenant_id`. **The matrix built to stop fixes landing in uncrossed cells
had an uncrossed cell of its own.** Every cell now asserts the FULL column list;
the same bite now turns **4** red.

### VERIFY (round 3)
Full suite 31250 pass / 54 fail — `comm -13` vs base **EMPTY**.
R26 reconciled: 37 enumerated / 36 CLEAN / 1 baselined / 0 unexpected / 0 UNCLASSIFIED.
Done-probe 4/4 ACTIVE; case-fold probe 9/9 ACTIVE.

⚑ Two `db-authoritative-p2-pg` failures in ONE run, NOT reproduced: 8/0 isolated,
absent next run, structurally impossible from this change. Live-PG socket timeout
under load.

## STOPPING-RULE ASSESSMENT

**No third interaction found.** Classified honestly:
- normalize x unclip-recovery — INTERACTION (coordinator's).
- rawDdl-filter x step-3 drop — INTERACTION (coordinator's).
- `E-PA-003` on qualified DDL — SAME ROOT as the first (clipping), not separate.
- `key VARCHAR(50)` — a plain bug in one fix, no second fix involved.
- the matrix's own weak assertion — a test gap, not a code interaction.

Both interactions shared ONE seam: a statement STRING passed from producer
(harvester) to consumer (column reader) with a transformation applied in between.
Round 3 removes that seam — the declaration path no longer passes a statement
string at all. That is a structural reduction rather than a patch, which is the
honest reason to think the clustering is addressed and not merely quieted.

**Where I still agree with the re-scope instinct:** rounds 2 AND 3 both landed
findings in `diffSchema`. The migrate consumer is a genuinely different concern
from the tenant floor, wired together only because `extractDesiredSchema` serves
both. If the arc is split, that is the seam to split on — NOT schema-parsing vs
tenant-floor, which now share one uncrossable recognizer.

## 2026-09-07T~20:30Z — THE SPLIT (5e2ae1e8). bryan ruled it; arc B ships the tenant half.

Cut at `extractDesiredSchema`'s TWO CONSUMERS — the seam I named at the end of
round 3, and the one bryan ruled on.

**Migrate consumer declines raw tables at its OWN boundary** — one
`if (t.rawDdl) continue;` in `commands/db-migrate.js`'s collection site.
**REMOVED entirely:** the `rawDdl` filtering in `diffSchema`,
`W-SCHEMA-PLAN-WITHHELD` (code + both SPEC rows), the `desiredMap` /
create-alter / grant-loop changes.

⚑ **PROVEN LINE-IDENTICAL:** `diffSchema` and everything after it in
schema-differ.js is 902 code lines on both sides with **0 differences** (comments
excluded). The file's only remaining delta vs main is the recognizer, which
belongs to the tenant half.

### DONE-CONDITION — partitioned and reconciled

Migrate behaviour captured on a pristine `8fa6854d` worktree and on this branch,
every corpus app carrying a `<schema>`, diffed against EMPTY and LIVE `actual` x
both `--allow-destructive` settings:

| | |
|---|---|
| apps compared | 96 |
| of which carry raw `<schema>` DDL | **31** — the population the split is about |
| identical migrate behaviour | 95 |
| **differing — RAW-DDL apps** | **0** — the condition |
| differing — other apps | 1 |
| RECONCILES (same + diffs == total) | true |

The one difference is `schema-anchor.scrml`, and it is a **SOURCE edit, not a
split leak**: its stray-colon typo was corrected on instruction. The probe
classifies each app from MAIN's copy and reports `sourceChanged` per difference,
so the attribution is measured rather than claimed.

⚑ I also RE-corrected that fixture: my first pass wrote the DSL body on ONE line
and `parseColumns` is newline-delimited, so `name` was being swallowed.

⚑ **A self-inflicted near-miss worth recording.** The surgical revert of
`diffSchema` deleted the `actualMap` declaration along with my comment block, and
I only ran the narrow tenant test file afterwards — which passed, because it no
longer imports `diffSchema`. The parity probe caught it (`ReferenceError:
actualMap is not defined`). A green narrow suite after a destructive edit is not
evidence; the broad suite and the behavioural probe are.

**All four migrate findings evaporated by construction** — none survived the
split, so the coupling was not deeper than we thought.

Findings 5 and 6 (`key GEOMETRY(Point, 4326)` / `key ENUM('a','b')`, three-part
`db.schema.table`) are in the RECOGNIZER and travel with the tenant half. Left
alone per instruction.

### VERIFY (split)
Full suite 31247 pass / 54 fail — `comm -13` vs base **EMPTY**.
R26 reconciled: 37 / 36 CLEAN / 1 baselined / 0 unexpected / 0 UNCLASSIFIED.
Tenant half intact: crossed matrix **15/15 ACTIVE**, case-fold **9/9 ACTIVE**,
done-probe **4/4 ACTIVE**.
