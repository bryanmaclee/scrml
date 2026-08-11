# build.map.md
# project: scrml
# updated: 2026-08-11T14:53:28-06:00  commit: 4f034e13
# generated-at: 4f034e13 (informational — not the currency anchor)
# **PARTIALLY RE-WALKED over `8863d457` -> `4f034e13`.** Ancestry CHECKED (invariant 48).
# **The watermark is `origin/main`'s tip** — the prior stamp `616688ea` was a branch tip that bounded
# nothing (MAP-STAMP RULE, primary.map.md).
#
# **`.github/`, `package.json`, `bunfig.toml`, `Dockerfile` and every git hook are ZERO-DIFF this
# window, for a SECOND consecutive window** — verified `git diff --name-only 8863d457..4f034e13 --
# .github/ package.json` is EMPTY. Every CI step, trigger, packaging, CLI and hook claim below is
# UNCHANGED and re-verified, not re-derived.
#
# **WHAT MOVED IS `scripts/`, AND THIS TIME IT GAINED THREE WHOLE FILES (688 lines) — none of which
# is a gate.** Last window `scripts/` moved by three probe-INTEGRITY fixes; this window it moved by
# three NEW PROBES. The standing fact holds and is now load-bearing twice: `scripts/` is explicitly
# inside the review floor's **code-bearing** population, because a probe defect is exactly the class
# the floor exists to catch. **A script that measures the repo is not exempt from being measured.**
#
#   · **`scripts/boot.ts` (NEW, 422L, #492 → #493 → #498)** — the executable boot read-set gate +
#     PICKUP-led digest. **Written because a memory NAVIGATES and does not GATE.** S335 short-booted,
#     skipping both user-voice ledgers and the per-user profile, and led orientation with a fresh
#     option-menu instead of the agreed pickup. See its own section below.
#   · **`scripts/dpa-debt.ts` (NEW, 121L, #507)** — the deliberation-queue probe. **Written because
#     `handOffs/dpa-queue.md` was the one file the dPA drains and NO boot probe read it**; `dpa-024`
#     sat `BANKED — UNRUN` for six sessions as a result. See its own section below.
#   · **`scripts/source-text-regex-census.ts` (NEW, 145L, #513)** — the probe for the S338 post-AST
#     source-text rule. See its own section below.
#
# **NONE OF THE THREE IS A CI GATE, AND EACH SAYS SO IN ITS OWN HEADER — that is a repeated design
# decision, not an omission.** The stated reason is `pa-base` §8's cry-wolf shape: a red-over-backlog
# gate gets bypassed and then deleted, so a probe that reports beats a gate that is ignored. Two of
# the three go further and name the DEFAULT as detection: `boot.ts`'s bare run never fails a boot on a
# network hiccup, and `--check` exits 1 on exactly TWO classes (a MISSING read-set file, an ABSENT
# PICKUP block) — **a repo merely BEHIND origin is a warning, because that is timing, not a defect.**
#
# The gate topology below is unchanged: `gate` stays at 12 steps, `advisory-review` stays DISABLED,
# `cloud-maps` Stage 2 stays DELETED (**no scheduled map refresh — a map stamp is exactly as old as
# the last wrap, and this window proved the second half of that sentence: it can also be off-main and
# bound nothing**), and the wide-corpus emit-differential (#428) remains the standing BY-HAND pre-land
# gate for codegen.

## Development Commands (root package.json scripts)
compile — `bun run compiler/src/cli.js compile`
pretest — `bash scripts/compile-test-samples.sh` (populates samples/compilation-tests/*/dist gitignored fixtures; runs before `test`)
test — `bun test compiler/tests/`
test:coverage — `bun test compiler/tests/ --coverage`
watch — `bun --watch compiler/src/cli.js compile`
bench — compiles samples/compilation-tests/ with `--timing`
security — compiles samples then `node --check`s every emitted .client.js
lsp — `bun run lsp/server.js --stdio`
docs:build — `bun run docs/build.ts`
e2e / e2e:ui / e2e:docs — Playwright suites (playwright.config.ts / playwright.docs.config.ts)
e2e:install — `playwright install chromium firefox webkit`

## Packaging — scrml is PUBLISHABLE as of this window (`171f5f23`)

`"private": true` removed · `"workspaces": ["compiler"]` removed · **`compiler/package.json`
DELETED** (acorn + astring hoisted into the root `dependencies`) · a `files` ALLOWLIST added. There
is now exactly ONE manifest. Published surface: `compiler/bin/`, `compiler/src/`,
`compiler/native-parser/`, `compiler/runtime/`, `stdlib/`, `README.md`, `LICENSE` — an allowlist, so
**anything new is excluded by default**. `stdlib/` is REQUIRED at runtime
(`module-resolver.js`'s `STDLIB_ROOT` resolves `../../stdlib`), not documentation. Deliberately
excluded: `compiler/tests` (20M), `self-host*`, `samples/`, `examples/` (12M),
`SPEC.md`/`PIPELINE.md` (docs live on scrml.dev) — widening a published surface is easy, narrowing
it is not. `bin: { scrml: "compiler/bin/scrml.js" }` is unchanged. Any doc or brief describing a
`compiler/` workspace at v0.2.0 is stale.

## scrml CLI subcommands (compiler/src/cli.js -> commands/*.js)
compile, dev, build, serve, migrate, **db-migrate (NEW S287)**, promote, generate, init, introspect, semdiff — **11 verbs** (was 10; `db-migrate` is the only addition this window). `migrate` and `db-migrate` are DELIBERATELY DISTINCT commands, not a rename: `migrate` is the pre-existing scrml-SOURCE syntax codemod tool; `db-migrate` (below) applies a project's `<schema>` to a REAL database. `compile`, `dev` and `build` carry `--module-format=<classic|esm>` (prior window, unchanged).

### `scrml compile` flags
--parser (live|scrml-native), --mode, --output/--output-dir, --watch, --embed-runtime, --self-host, --convert-legacy-css, --prod/--production (§20.6.5 log() strip), --validate-emit/--no-validate-emit, --no-gather, --debug-perf, --verbose, --chunk-size-budget, --emit-batch-plan, --emit-block-analysis, --emit-engine-graph, --emit-reachability, --emit-token-set, --emit-per-route, --emit-machine-tests, --module-format=<classic|esm>, --help.
`compileScrml()` (compiler/src/api.js) carries an internal `contentHashAssets` option (default `false`) — NOT a CLI flag; `scrml compile`'s output stays byte-identical (un-hashed `.client.js`/`.css` names). See "Content-addressed build assets" below.

### `scrml dev` flags
--port, --idle-timeout <n> (configurable Bun.serve idleTimeout, default 120s), --embed-runtime, --convert-legacy-css, --validate-emit/--no-validate-emit, --no-gather, --verbose, --module-format=<classic|esm>, --help.
`scrml dev` attaches cache headers to every static response (see below) — always on, no flag gates it. **Does NOT auto-apply DB-authoritative security DDL** (see `scrml db-migrate` below — auto-apply-on-boot is deliberately eliminated for Postgres).

### `scrml build` flags
--target, --minify, --output, --idle-timeout, --embed-runtime, --copy-config, --validate-emit/--no-validate-emit, --verbose, --module-format=<classic|esm>, --help.
`scrml build` calls `compileScrml({ ..., contentHashAssets: true })` unconditionally and threads the returned `hashedAssets` set into the generated `_server.js`.

### `scrml db-migrate <project-dir|entry.scrml> --db <url> [options]` flags (NEW S287, §14.8.11.1 — the migration-apply seam)

Applies a project's `<schema>` (including the §14.8.11/.2 DB-authoritative RLS/role/SECDEF DDL) to a
REAL database — the APPLY inverse of `scrml introspect`'s EMIT (introspect: live DB -> `<schema>`
source; db-migrate: desired `<schema>` -> reconciling DDL on the live DB).

--db <url>            REQUIRED. The MIGRATOR/owner connection string (`postgres://…` or a SQLite
                       path/`sqlite:` URL) — a DIFFERENT, MORE-PRIVILEGED principal than the app
                       runtime's own `db=` (a DDL-capable role: `CREATE ROLE`, `ALTER TABLE … FORCE
                       ROW LEVEL SECURITY`, `CREATE POLICY`, `GRANT`). This separation IS the
                       security property — the compiler will not make the app process able to apply
                       or alter its own security DDL.
--dry-run              Print the reconcile plan; apply NOTHING (no lock, no ledger write, no txn).
--allow-destructive    Permit a bare `DROP TABLE` for a table present in the DB but absent from
                       `<schema>` (default: refused — see `W-SCHEMA-DESTRUCTIVE-DROP`, error.map.md).
--help, -h

**Postgres apply flow** (the acceptance-gated, db-authoritative-capable path), all inside ONE
transaction under the migrator connection: `pg_advisory_xact_lock(<fixed key>)` (serializes
concurrent migrators; auto-releases at commit/rollback — a dead migrator process leaks no lock) ->
ensure the thin `_scrml_migrations` ledger (`id`, `applied_at`, `object_kind`, `object_name`,
`ddl_hash` — apply-atomicity + object-authorship, NOT a versioned migration-file history) -> read
actual state (`readActualSchemaPg` + a narrow `pg_policies`/`pg_roles` scrml-managed-object presence
read) -> `diffSchema(desired, actual, {driver:"postgres", allowDestructive})` (appends the idempotent
DB-authoritative DDL for each `db-authoritative` table + any SECDEF `fn`) -> apply each statement,
recording `{object_kind, object_name, ddl_hash}` per statement -> commit. A statement failure rolls
the WHOLE run back.

**SQLite apply flow** (Fork 5 — general, no privilege model): read actual via `readActualSchema`,
diff, apply the whole plan in one `BEGIN`/`COMMIT` transaction. Makes a plain `<schema>` finally
do-something-at-deploy for every adopter, not only db-authoritative ones.

**Pre-flights (fail closed BEFORE touching the DB):** `E-DBAUTH-SQLITE` (a db-authoritative table or
SECDEF `fn` against a non-Postgres `--db`), `E-DBAUTH-NO-TENANT-COLUMN` (a db-authoritative table
with no `tenant_id` column — the M1 policy is keyed on it). Echoes the recognized db-authoritative
table set and surfaces `W-DBAUTH-MARKER-NEARMISS` for a mistyped marker (silent-downgrade guard).
See error.map.md for all four codes, domain.map.md for the tier's concept, migrations.map.md for the
full apply model.

### `scrml semdiff <base> <head>` flags (the #6b P0 semantic-diff primitive, landed S264)
Classify a change between two .scrml versions by AXIS + soundness TIER — never a boolean "safe".
--emit-classification  Emit the per-matched-entity classification (default).
--json                 Structured JSON output (the consumer review-row / merge input).
--help, -h.
Both versions are compiled in-process (full pipeline, write:false); the synthesized top-level `verdict` field is the single value a consumer keys on. Exit codes: **0** = cosmetic (no-op on every modeled axis) · **1** = behavioral (a change on some axis; gate/review stays consumer-side) · **2** = a version failed to compile (fail-closed — the compiler is the first reviewer). Consumers: giti MERGE, flogence REVIEW. Classifier math lives in `compiler/src/semdiff.ts` (pure, unit-tested); the command is the I/O shell.

## `--module-format=classic|esm` (ESM-chunks arc U1-U3)

Selects the CLIENT module format. Accepted on `compile`, `dev` and `build`, in both the
`--module-format=esm` and `--module-format esm` shapes; any other value is a hard exit with
`Unknown --module-format value: "<x>". Valid values: classic, esm`. Parsed in each command's arg
loop (compile.js, dev.js, build.js) and threaded to `compileScrml({ moduleFormat })` -> `runCG`
(codegen/index.ts).

- **`classic` is the DEFAULT and the only conformance-tested path.** The client runtime is a
  non-module `<script src>` sharing one global scope with every page chunk; cross-file linkage goes
  through the global `_scrml_modules` registry. Every esm transform is gated, so classic output is
  byte-identical to pre-arc output.
- **`esm`** emits the runtime as an ES module with a derived `export {…}` surface, each client chunk
  as an ES module that namespace-imports its deps and the runtime subset it uses, `type="module"` on
  the emitted `<script>` tags, and (on the build path) content-hashed in-chunk import URLs. Still
  EXPERIMENTAL: the module-capable browser-test harness and the default-flip are not built.
- **`esm` + `--embed-runtime` = no effect** — the embedded runtime stays a classic script.
- Selecting esm prints an operational stderr notice keyed **`W-MODULE-FORMAT-ESM-INCOMPLETE`**
  (`compiler/src/commands/module-format-notice.js`). Deliberately NOT a §34 catalog code and never
  enters the diagnostic stream or the compile result; classic prints nothing.

## Public-claim gates (S280)

Three scripts, two of them CI-required. They exist because a public claim that was true when
written rots silently.

- **`scripts/snippet-gate.js`** — GATE. Discovers every `.scrml` under a declared corpus and
  compiles each through `compiler/bin/scrml.js compile` into a temp dir; exit 1 on any failure.
  **Wired into CI `gate` and the release-tag `pre-push` hook.** **CORPUS WIDENED S292:**
  `SNIPPET_CORPUS = ["docs/tutorial-snippets", "docs/readme-snippets", "docs/website"]`. The
  scrml.dev pages are the most-read public surface shipped and sat OUTSIDE the gate until now — the
  same hollow-gate shape the gate was built to close at S280, one directory over. The ROOT is
  declared (98 files at time of addition) rather than individual pages, so a NEW page is gated by
  EXISTING rather than by someone remembering to list it. A declared-but-absent row is tolerated.
  **Known limit, stated in the source:** this gates that a page COMPILES; it cannot gate whether the
  page's PROSE is true — the seven false claims corrected at S292 were all prose on a page that
  compiled fine. Prose currency needs an empirical re-verify, not this gate. `docs/FACTS.md`'s
  "public code samples under the compile gate" figure (12) counts the tutorial/readme snippet
  corpus, not the widened `docs/website` root.
- **`scripts/facts.ts`** — generator + checker for `docs/FACTS.md`. `bun scripts/facts.ts` prints,
  `--write` regenerates the `@generated:*` anchored sections in place (idempotent), `--check`
  regenerates in memory and exits 1 on any stale section. **`--check` is wired into CI `gate`.**
  Derives: compiler version, live compiler LOC + file count, test files, SPEC lines, conformance
  cases, stdlib modules, **CLI verbs (now 11, `db-migrate` included)**, LSP capabilities, editor
  integrations, deploy targets, gated snippets. **A public doc SHALL cite FACTS.md rather than
  hardcode any of these figures.**
- **`scripts/regen-spec-index.ts`** — generator + **NEW `--check`er (S290)** for
  `compiler/SPEC-INDEX.md`. Regenerates the Sections-table line ranges/sizes AND the
  `@generated:spec-index-totals` block in place from SPEC.md headings, preserving hand-written
  summaries. **`--check` is wired into CI `gate` (a 6th step) and the local pre-push currency gate.**
  Only the TOTALS are gated — the per-section line ranges drift by design between amendments, and a
  gate that cries wolf gets bypassed then deleted. The totals line (`Total lines: N | Total
  sections: M + appendices`) was hand-maintained while the script regenerated the rows around it, so
  it had rotted to `33,436 lines / 61 sections` against a 36,575-line, §65-deep SPEC. The line count
  drops a trailing empty split element so it matches BOTH `wc -l` and `scripts/facts.ts`'s
  `specLines()` — two generated figures for one quantity disagreeing by one makes a reader distrust
  both.
- **`scripts/claim-gate.js`** — the fenced-block (C1) half: extracts ```scrml fences from a declared
  PUBLIC_SURFACE, compiles + ghost-pattern-lints each, `// gate: skip` opt-OUT. **Not wired into CI**
  (measure-mode only).
- **`scripts/browser-baseline.ts` — NEW (S313, #361). GATE, in BOTH `gate` and `tracking`.** Three
  modes mirroring `facts.ts`/`state.ts` exactly: bare = PRINT the tier's current failure set,
  `--write` = record the baseline (idempotent), `--check` = diff and exit 1 on ANY difference.
  **It asserts the failure NAME SET — not the exit code, and not the count.** The premise it removes:
  the browser tier always exits 1 against a documented ~48-failure baseline, so an exit-code gate
  could not express "the same failures as before", every blocking gate excluded the tier, and a
  genuinely new browser failure was therefore INVISIBLE — `pa-base` §8's "a gate that has never
  failed is indistinguishable from a gate that CANNOT fail", in its purest form. The key is
  `<suite> > <test name>` and nothing else; **timings, pass/fail COUNTS, file paths and ordering are
  deliberately stripped** as non-deterministic or uninformative. **BIDIRECTIONAL by design:** a name
  JOINING is a regression; a name LEAVING means the baseline is STALE (prune it in the commit that
  fixes the test) — a baseline nobody prunes re-acquires the blind spot it was built to remove.
  **Scar worth keeping:** the `(fail)` regex is deliberately NOT line-anchored, because a failing
  test whose assertion dumps a happy-dom object emits the marker MID-LINE and the anchored first cut
  silently under-counted by exactly one — which would have been the precise hollow gate the script
  exists to prevent. Baseline artifact: `compiler/tests/browser/FAILURE-BASELINE.json` (48 names + 2
  env-exclusions, `recordedAt` 2026-08-02). **Scope is the browser tier only** — lsp / commands /
  self-host have no name-set assertion (`g-lsp-commands-selfhost-tiers-have-no-failure-name-set-assertion`,
  LOW). **Deliberately NOT in pre-push:** local environments vary far more than CI, and it was
  exactly a local environment difference that made the first recorded baseline wrong.
- **`scripts/s34-census.ts` — NEW (S310). GATE (`--check-new`), and the §34 oracle otherwise. ⚑ ITS WINDOWS-ONLY `ENOENT` IS FIXED AT #473 (S332-peter) — `fileURLToPath(import.meta.url)`, not `new URL(import.meta.url).pathname`. The four-window-old "this tool is broken" note is RETIRED; it runs on every platform now. Re-executed at `616688ea`: `807 rows (§34 19113..19991, derived) · 1887 source files · 880 conformance cases`.**
  `bun scripts/s34-census.ts [--full] [--json]` classifies every catalogued diagnostic into
  STRUCK / PINNED / IMPL-SITES / DECLARED-AHEAD / RUNTIME-SURFACED / FALSE-CLAIM;
  `--check-new --base <ref>` enforces **SPEC §34.0** against a DIFF, never the legacy corpus.
  **No hardcoded line numbers — §34's range is derived from the headings every run**, explicitly
  because a baked line number in a maintained artifact rots silently and nothing fails (the 3,140-line
  stale SPEC-INDEX and the ~9x-wrong LOC figure are the two precedents, and are why `docs/FACTS.md`
  exists). See error.map.md for the buckets and the traps it defeats.

## `scripts/boot.ts` — the executable boot read-set gate (NEW #492/#493/#498) — NOT a CI gate

**Why it exists, in one sentence: a memory NAVIGATES and does not GATE, so it "leaves room for
misdirection."** S335 short-booted — skipped BOTH user-voice ledgers and the per-user profile — and
led orientation with a fresh option-menu instead of the agreed left-off pickup. The remedy is an
executable check the boot always runs, not a stronger reminder.

**Four things it does, and the third is the design decision worth copying:**

1. **FETCHES both repos READ-ONLY** and reports behind/ahead/dirty. Fetch yes; pull, commit and push
   never — so it is safe to run at any time.
2. **VERIFIES every Profile-A read-set source EXISTS and is CURRENT.** Both user-voice ledgers and
   the per-user profile are in the set **BY CONSTRUCTION** (that is the S335 miss encoded).
3. **DELEGATES the mandatory probes to their authoritative scripts** — `review-debt.ts`, `threads.ts`,
   and `gh` for issues/PRs/runs — **never a reimplementation, so a probe cannot drift from its source
   of truth.** This is the same rule `dpa-debt.ts` states from the other direction, and it is the
   generalisable one: **a second implementation of a probe is a second thing that can be wrong.**
4. **EXTRACTS and PRINTS the `## ⏭ NEXT-SESSION PICKUP` block from `hand-off.md` FIRST** — orientation
   leads with the handshake, not a menu.

**Modes.** `bun scripts/boot.ts` = digest (default) · `--json` = machine-readable · `--check` = the
strict gate · `--no-probes` = skip the `gh`/sub-script calls (fast, offline; still fetches).

**DETECTION, NOT CONTROL, BY DEFAULT — and the failure classes are enumerated, not implied.**
`--check` exits 1 **iff** a read-set file is MISSING or the PICKUP block is ABSENT. **A repo merely
BEHIND origin is a WARNING, not a failure** — that is timing, not a defect, and the `/boot` skill
still owns pull.

**DERIVE-DON'T-DECLARE, GUARDED — with an honest residual it states about itself.** The read-set
manifest MIRRORS the `.pa-base/profile` Profile-A block. Because a hand manifest can drift from the
contract, **each item carries a `needle` proving its mandate, and `driftCheck` asserts that needle is
still present in the mandating artifact** — so the manifest cannot silently outlive a read the
contract renamed or dropped. **The REVERSE direction is NOT auto-detected** (the contract adding a
read the manifest lacks), and the script says why rather than hiding it: the profile prose also NAMES
reads it tells you to SKIP, so a token scan would be cry-wolf (§8). The manifest is reviewed against
the profile at each amendment.

**WINDOWS-FIRST, and it names the precedent.** `ROOT` via `fileURLToPath`, **never**
`new URL().pathname` — that is the S262/#473 Windows break this map set tracked for four windows.
Sub-processes via `spawnSync` with explicit arg arrays, no shell.

**SCOPE — additive.** It does NOT touch bryan's boot contract (`.pa-base/profile` · `/boot` ·
`pa-base.md`); it is wired into peter's `/boot` only, and the shared-contract amendment was ROUTED.

## `scripts/dpa-debt.ts` — the deliberation-queue probe (NEW #507) — NEVER a gate, never in CI

**The rule it discharges is `pa-base` §10's most-repeated failure: an obligation recorded in one
artifact while every probe reads another.** `handOffs/dpa-queue.md` is the ONE file the dPA drains,
and until this landed **no boot probe read it** — the boot gate probed review-debt, the thread board,
gh issues/PRs and CI, every inbound channel except the deliberation queue. **Measured cost:**
`dpa-024` sat `BANKED — UNRUN` from S331 to S337 (six sessions), filed under "OWED BY BRYAN" when it
was the question only the DD could answer, so it sat in a list where it could never move; bryan
surfaced it himself. Separately, `dpa-022`/`dpa-023` read `BANKED — UNRUN` for a full day AFTER they
had run. **The rule: a channel the probe does not read does not exist to the PA.**

**BIDIRECTIONAL, deliberately, and this is the part to copy.** The queue states in its own words that
the PA-maintained status TABLE supersedes the per-item `status:` lines, so the probe reads the table.
**It ALSO parses the per-item lines and reports any DISAGREEMENT** — because the dpa-022/023 miss was
a STALE TABLE, and **a probe that trusts its authoritative surface unconditionally cannot see that
surface go wrong.**

⚠ **ITS CLASSIFIER IS ANCHORED ON THE LEADING TOKEN, AND THE COMMENT EXPLAINING WHY NAMES THE THIRD
INSTANCE OF A REPEATING BUG.** A `contains` test reports dpa-022/023 as UNRUN, because those cells
NARRATE the string (*"this row read \"BANKED — UNRUN\" until S325 corrected it"*) — **a false
positive on the very rows whose staleness motivated the probe.** Same unanchored-match class as the
boot gate's PICKUP `indexOf` bug (#492) and the S337 ledger-section regex. It also reads ratification
from **column 3, not column 2**, because the dPA never flips a row to `ratified` (RUN-not-RATIFY) —
reading col 2 alone reports dpa-019/020/021 as owed when they were ratified at S319.

## `scripts/source-text-regex-census.ts` — the post-AST source-text rule's probe (NEW #513) — deliberately NOT a CI gate

**THE RULE (bryan, S338):** *a regex applied to SOURCE TEXT in a POST-AST stage requires a one-line
justification, or the structural route.* **Binds NEW-OR-TOUCHED code only.** Detection is a RATIO,
not an inspection.

**Why the rule exists: five adversarial reviews across two unrelated branches in ONE session found
the same substitution every time** — a text-level shortcut standing in for a structural one, where
the parsed tree was already in hand. Five instances, five authors, no coordination: a `wired`
classification table validated by COUNTING TEXT OCCURRENCES (circularly — the delta it measured
included the declaration that existed only because the table had already said "wired");
`bareAttrValueIsWired` restating codegen's `name.startsWith("on")` as `/^on[a-z]/`, which then
drifted on `on=` / `on-tap=` / `on_tap=`; an `import.meta` fence regexing source text TWO LINES
BEFORE the `parseExprToNode` call that would have answered it structurally; `bareBindingReferenceOf`
anchored on trimmed RHS source text, so `(@v)` defeated a guard `@v` tripped; a lifecycle variant
branch matching `.Published` inside a STRING LITERAL. **None was caught by a 22,385-test suite or a
7,375-artifact differential — and that is a property of the class, not a gap in the gates: a regex
over source text is indistinguishable from a correct check until someone writes a string literal.**

**WHAT IS AND IS NOT A DEFECT — the partition IS the instrument.** A regex over source text in the
tokenizer, block-splitter, ast-builder, expression-parser or native-parser is **CORRECT** — turning
text into structure is their job. The defect class is a stage that **already holds the parsed tree**
asking the text instead. `PRE_AST_MARKERS` encodes the exempt set. **The raw count of regexes (11,196
literals at the time of writing) is worthless and the script says so — never quote it.**

⚠ **IT REPORTS A FLOOR, NOT A COUNT, AND YOU MUST SAY SO WHEREVER YOU QUOTE IT.** It keys on argument
identifier NAMES, so it cannot see `postRe.test(t)` — **which is exactly where the confirmed
pre-existing defect at `type-system.ts:26048` lives.** The opaque-argument population (`t`, `s`, `v`,
`x`, …) is reported SEPARATELY and is unclassifiable by this instrument. **The script records this
about itself in its own header:** its author built a name-pattern-matching probe to detect the
practice of pattern-matching instead of resolving structure, and it inherited the same blind spot.
**The honest upgrade path is named too** — a structural successor would walk the TypeScript AST and
resolve each regex argument to its declared type and origin rather than guessing from its name.

## PR review-floor tracker — `scripts/review-debt.ts` (NEW, S316) — NOT a CI gate

Built after the review floor (pa.md's mandatory-review contract) was measured at a **0% execution
rate** the day after ratification: boot reads `gh pr list` (**open** PRs only), while the review floor
binds **merged** PRs, and nothing computed the difference — eight PRs merged unreviewed and the debt
was invisible to the session that incurred it and every session after (a second instance of the S262
"a contract can name an obligation with no probe that reads it" class). `scripts/review-debt.ts`
drains merged-but-unreviewed PRs against `docs/pr-reviews.md`, and is wired into **PA boot step 0.6**
— it is bookkeeping for the PA operating loop, **not a CI step**, and does not appear in `ci.yml`.
First drain (S316) found a real incomplete fix (#391). Standing measurement, per S319: the review
floor's execution rate over a 3-session window is itself the thing being tracked.

**REWRITTEN AT #481 (S331), and the rewrite is a lesson in what a health metric actually measures.**

**TWO carve-out rates now print, and ONLY THE SECOND IS A HEALTH SIGNAL.** The all-PR rate cannot
distinguish a docs-heavy stretch from a floor being evaded: a wrap / continuity / gap-filing PR has
**no code path to review BY CONSTRUCTION**, so its carve-out is the CORRECT classification, not an
escape. Measured S328: all-PR **57%** while every code-bearing PR in scope had received a full pass;
code-bearing was **1/28 = 4%**, and the single exception was `scripts/review-debt.ts` itself.
Re-measured S331: all-PR 50%, code-bearing **0/4**. So the all-PR figure prints as a **volume
statistic with no alarm**, and the alarm rides the code-bearing rate where the target is ~0%.

**The code-bearing population is a directory WHITELIST, not a doc-extension blacklist:**
`/^(compiler|stdlib|scripts)\/|^conformance\/cases\//`. The direction is deliberate — **a new docs
directory should default to "not code"; a new source directory must be added here consciously.**
`docs/` is excluded even though it holds `docs/changes/**` briefs (a brief has no runtime surface);
**`scripts/` is INCLUDED because a probe defect is exactly the class this floor exists to catch.**
A PR whose file list `gh` did not return is reported as a THIRD bucket — **not folded into either
rate.** An absent file list is not evidence of docs-only.

**The threshold is a COUNT (>= 2), not a percentage, and the reason is measured.** The target is ~0%,
and a percentage floor scales tolerance with population — at 36 in scope a 20% trigger silently
permits SEVEN carved code-bearing PRs. **Proven by bite test at S331: five injected carve-outs
reached 17% and did NOT fire.** Two is the trigger because exactly one standing exception is
expected and legitimate (`#397`, the script itself, which has no code path a review could probe);
two is a pattern. **The carved list prints unconditionally regardless of the threshold**, so nothing
hides below it.

**The truncation guard, and why the naive version was DELETED rather than tuned.** `gh pr list
--limit N` returns at most N rows, so a full list may have been cut and a cut enumeration reads
exactly like a complete one (the §8 truncated-probe class). But **the completeness test is NOT "was
the list full"** — a full list is only a problem if the cut could have removed an IN-SCOPE PR. Once
the scan has seen a single PR numbered BELOW the floor epoch, the in-scope population is provably
complete no matter how many rows came back. Written the naive way (`merged.length >= limit`) the
guard fired at `--limit 300` while the in-scope count had been stable since `--limit 100` — **a
guard red for reasons no change caused, which is the cry-wolf shape §8 says gets bypassed and then
deleted.** Caught by proving the bite.

**Detection alone was judged insufficient — it AUTO-WIDENS.** `limit` defaults to **150** (from 40)
and quadruples up to a `WIDEN_CEILING` of 1000 until the scan provably clears the epoch, printing
`(scan auto-widened X -> Y …)` when it does. **Root fix, not a louder warning.** And the widening
happens BEFORE anything is counted: computing `bound` first and widening after would leave every
figure derived from the pre-widen list while the widen message claimed otherwise — *the exact defect
this guard exists to prevent, one level up*.


## Wide-corpus emit-differential + dual-goggle syntax gate — `scripts/corpus-emit-differential.ts` + `scripts/corpus-check-goggles.js` (NEW #428) — **NOT a CI gate; the STANDING PRE-LAND GATE for codegen**

**Task-shape routing: any change under `compiler/src/codegen/` runs this, base-vs-head, before it
lands.** It is not in `ci.yml`, not in `bun test`, not in a git hook. It is run by hand. (There was no
routing row for this task shape until this pass, and the absence cost a dispatch.)

```
# capture one side (repeat for base and head, from two checkouts)
bun scripts/corpus-emit-differential.ts capture \
    --compiler-root /abs/path/to/a/scrml/checkout \
    --label base-<sha> --work /scratch/base --manifest /scratch/base.manifest.json
    [--roots examples,samples,conformance,stdlib,benchmarks]   # default; RECURSIVE
    [--concurrency 10] [--expect-total 1878] [--reuse-artifacts] [--no-syntax-check]

# compare
bun scripts/corpus-emit-differential.ts diff \
    --base /scratch/base.manifest.json --head /scratch/head.manifest.json
    [--json /scratch/diff.json] [--allow-same-revision] [--allow-reuse-manifest]
```

**Population at this HEAD: 1878 `.scrml` sources / 7254 emitted artifacts.** The 453 deliberate
exclusions are PRINTED with per-directory counts, so what is not measured is a visible decision rather
than an invisible default (`docs/` illustrative snippets · `compiler/native-parser/` deliberately
malformed fixtures · `handOffs/` session artifacts). `stdlib/` and `benchmarks/` were ADDED to the
default roots after an adversarial review noted the original three covered 1818 of 2368 sources and
excluded both shipped scrml and the most app-shaped programs in the tree.

**Exit codes are three-valued and the third one is the whole design:**
| verb | 0 | 1 | 2 |
|---|---|---|---|
| `capture` | manifest written, every self-check agreed | a self-check FAILED (enumeration disagreement, `--expect-total` mismatch, slug collision, unreadable artifact) | — |
| `diff` | no differences at all | differences found | **NOT A VALID COMPARISON** — different roots, enumeration disagreement, same revision both sides, differing check contexts, a `--reuse-artifacts` manifest, or a VACUOUS run (zero artifacts compared / zero checkable artifacts checked) |

**A capture NEVER exits non-zero merely because sources failed to compile — compile failure is DATA**
(`HARD REQ 5`). Every defense in the tool is marked `HARD REQ n` at its own site so a future editor can
see exactly what they would be removing.

### The load-bearing fact: `node --check` is the WRONG instrument, and so is bun

**`node --check` on a bare `.js` ACCEPTS a top-level stranded `await`** — Node resolves it by
module-syntax auto-detection and happily parses it as a module, where TLA is legal:

```
$ printf 'const x = 1;\nawait fetch("/y");\n' > tla.js
$ node --check tla.js ; echo $?            # -> 0   (PASSES)
```

**But the compiler emits `<script src="…client.js">` with NO `type="module"`.** Client bundles and the
shared runtime load as **CLASSIC SCRIPTS**, where the same bytes are a fatal SyntaxError and the whole
bundle is dead on arrival. **A gate built on `node --check` certifies bundles that cannot load** — and
that is precisely the auto-await work's own dominant failure mode. `node --check` is not used here and
**must not be reintroduced**.

**And the obvious in-process fix would have been a THIRD hollow gate:** measured,
`bun -e 'new (require("node:vm").Script)("await f();")'` does **not** throw, while the same line under
`node` throws `SyntaxError`. **Bun's `vm.Script` does not reject a top-level `await`.** The parent is a
Bun script; `corpus-check-goggles.js` is deliberately a separate **NODE** subprocess
(`node --experimental-vm-modules corpus-check-goggles.js <jobs.json> <results.json>`), batched — one
process, many files — so the correctness does not cost a spawn per artifact.

Two further reasons the goggles are explicit rather than ambient: `node --check`'s verdict is a function
of (content, extension, **nearest `package.json` `"type"` field**) — an input that lives OUTSIDE the
artifact, so dropping a `package.json` above the output tree swings the same bytes between pass and
fail; `vm.Script` / `vm.SourceTextModule` take source text and nothing else. And the EFFECTIVE goggle
per artifact is derived from the emitted HTML's own `<script>` tag, not guessed.

**It earned its cost on its first real run:**
`g-stdlib-module-resolver-emits-import-meta-into-a-classic-script-bundle` (MED, open) — a cleanly
compiling stdlib source emitting `Cannot use 'import.meta' outside a module`, invisible to every prior
gate on TWO counts at once (wrong goggle AND `stdlib/` outside the corpus roots).

### Why it is a repo tool and not another per-arc script

The same defect had shipped **three times**, each time in a throwaway harness, each time leaving a gate
that reported green while measuring a fraction of its population: `docs/changes/chunk-namespacing/
artifact-diff.mjs` compared **8 of 115** files (a re-anchored `relative()` plus a `catch { continue }`
that swallowed the throw); `scripts/u1-corpus-emit.sh` globbed TOP-LEVEL-ONLY in two directories,
measured **329 of 1818**, and reported "708/708 byte-identical"; that same script's `node --check` half
inherited the truncated population and reported base 2 / head 2 while an independent wide measurement of
the same two revisions got base 44 / head 46. **`pa-base v2.13 §8` names this THE TRUNCATED PROBE: a
truncated enumeration reads exactly like a complete one.** `scripts/u1-corpus-emit.sh` was deliberately
EXCLUDED from the #429 landing — it is the gate this tool retired.

## Content-addressed build assets + cache headers (S265, adopter #82, PR #96)

**Naming (build path only).** `scrml build` → `compileScrml({ contentHashAssets: true })`. The
FNV-1a 32-bit hash (8-char base36) of each artifact's FINAL on-disk bytes is spliced in before the
extension: `<base>.client.js` → `<base>.client.<hash>.js`, `<base>.css` → `<base>.<hash>.css`.
`scrml compile` / `scrml dev` keep un-hashed names.

**Cache-header contract (both serve paths).**
- Content-addressed asset → `Cache-Control: public, max-age=31536000, immutable` (decided by EXACT
  SET MEMBERSHIP against `compileScrml()`'s returned `hashedAssets`, never a filename-shape guess).
- HTML entry document → `Cache-Control: no-cache` (always revalidate).
- Every other static asset → `Cache-Control: no-cache` + a WEAK validator (ETag/Last-Modified).

Implementation: `compiler/src/api.js` (`contentHashAssets` option), `compiler/src/commands/build.js`
(`generateServerEntry`), `compiler/src/commands/dev.js` (`devCacheHeaders`).

## CI/CD Pipeline  [.github/workflows/ci.yml] — ONE NEW TRIGGER THIS WINDOW, ZERO step changes
Three jobs, "gate-layering" model (types → pre-commit fast subset → CI-here → PA judgment):

**gate** — BLOCKING (the merge-gate), **12 steps** (+2 this window). checkout **(`fetch-depth: 0`, NEW)** → setup-bun → `bun install --frozen-lockfile` → `bun run pretest` → `bun test compiler/tests/unit compiler/tests/conformance` → `bun test compiler/tests/*.test.js` (the S302 root-level step) → gauntlet quick check (compile `benchmarks/todomvc/app.scrml`, `node --check` the emitted client.js) → **`bun scripts/browser-baseline.ts --check` (NEW, S313 — bryan RULED promote)** → `bun scripts/snippet-gate.js` → `bun scripts/facts.ts --check` → `bun run scripts/regen-spec-index.ts --check` → **`bun scripts/s34-census.ts --check-new --base ${{ github.event.pull_request.base.sha || 'HEAD~1' }}` (NEW, the SPEC §34.0 row-provenance gate)**.
Triggers: push (paths-ignore: `**.md`, `handOffs/**`, `docs/**`), pull_request, **and `workflow_dispatch: {}` (NEW #454)**. `concurrency: group ci-${{ref}}, cancel-in-progress: true`. **Gate step COUNT is unchanged at 12 — #454 added a way to START a run, not a step and not a way to skip one.**

### `workflow_dispatch` — the manual re-fire lever (NEW #454). Read the two constraints BEFORE you need it.

**Why it exists.** GitHub does not re-deliver a webhook it dropped. During the 2026-08-06 Actions
outage ("webhook triggers remain throttled; many push/pull request events aren't triggering runs")
**FIVE PRs sat with ZERO checks and therefore could not merge**, `gate` being the sole required check.
S325 burned a whole session on it and tried force-push, close/reopen, a new commit, and a brand-new PR
— **all four produced nothing, because every one of them is just another webhook into the same
throttled pipe.** This was the SECOND outage with no lever; the first cost a session's landings.

```
gh workflow run CI --ref <branch>
```

**⚑ CONSTRAINT 1, MEASURED not assumed — the lever is PROSPECTIVE, not retroactive.** The dispatch
reads the workflow definition **FROM THE TARGET REF**, so `--ref <branch>` fails
`HTTP 422: Workflow does not have 'workflow_dispatch' trigger` on any branch cut BEFORE #454 landed.
**Rebase the branch onto main first, or dispatch `--ref main`.** Stated plainly because it is exactly
the wrong thing to learn during an outage: *this will not rescue a branch that predates it.* Proven
both ways — `--ref docs/s326-continuity` (a pre-merge cut) → 422; `--ref main` → run 31140159467,
**all three jobs green including `gate`**.

**⚑ CONSTRAINT 2 — a dispatched run's §34.0 row-provenance check is WEAKER, and this is the honest
caveat, not a footnote.** The step `s34-census --check-new --base` reads
`github.event.pull_request.base.sha`, which does not exist on a manual run, so it falls back to
`HEAD~1` — **a fallback that already existed; this is not new behaviour.** On a multi-commit branch
that compares against the previous commit rather than the merge base, so **rows added in EARLIER
commits of the same branch are not seen as NEW.** Every other step is event-independent and identical.
**Prefer a real push/PR event when one is available; reach for this when the platform has eaten the
event.**

**⚑ IT WEAKENS NO GATE.** It adds a way to START a run; it does not add a way to skip one. `gate` must
still go green on the head SHA before a merge is allowed, and `enforce_admins=true` is untouched. The
fork-rule row that matters is root-vs-position: **nudging a PR treats the symptom; a manual trigger
removes the class.**

Two placement facts that are deliberate, not incidental:
- **`fetch-depth: 0` exists FOR the §34.0 gate** — it diffs against the PR base SHA, and a shallow clone has no common ancestry, so merge-base fails and the gate cannot resolve what is NEW.
- **The browser gate sits AFTER the gauntlet step**, which compiles the TodoMVC benchmark and therefore materialises `benchmarks/todomvc/dist`. That makes `browser-baseline.ts`'s two env-exclusions moot IN THIS JOB (the pair passes here) — they still matter in `tracking`, which never builds it. Both sides of the comparison are filtered, so the check is correct either way.

**tracking** — NON-BLOCKING (`continue-on-error: true`). integration + lsp + commands tests (incl. `commands/db-migrate.test.js`) → **`bun scripts/browser-baseline.ts --check` (REPLACES the raw `bun test compiler/tests/browser`)** → the parser-conformance-within-node M6.x backlog. **The replacement fixed a second-order bug worth knowing: a FAILED step HALTS the job, and the browser step was permanently red, so `Within-node parser-parity + canary` — the step after it — reports `skipped` on run 30742472551 and had therefore NEVER RUN.** That is the S302 class (13 of 14 root-level files run by no workflow) recurring one job over: the tier was useless in both directions at once *and* it was silently eating the steps behind it.

**windows** — NON-BLOCKING (`continue-on-error: true`), `runs-on: windows-latest`. unit + conformance only. **Carried from the prior window (unchanged this pass):** the `Install deps` step now sets `PUPPETEER_SKIP_DOWNLOAD: "true"` before `bun install --frozen-lockfile` — this job never touches the browser tier, so the puppeteer postinstall download was pure cost AND a flake source (PR #382 witnessed an `ECONNRESET` failing `Install deps` before a single test ran, on IDENTICAL content that passed on a sibling run). **`gate` still downloads it — the browser NAME-SET assertion needs a real browser.**

Rationale banner in the workflow (S253): `gate` is the guaranteed-green-from-source core only — no self-host/within-node backlog noise. The live-PG DB-authoritative integration tests remain `tracking`-tier and skip-graceful.

## Gate topology — the two failure modes, and why they pull in opposite directions

**Read this before adding a test tier to a gate, or removing one.** Both rules below were violated in
this repo, one of them for the whole life of the root-level test files.

**FAILURE MODE 1 — a tier that NOTHING blocking runs.** The 14 root-level `compiler/tests/*.test.js`
(parser-conformance-\*, native-\*) had **no runner at all** for 13 of them; the 14th
(`parser-conformance-within-node`) ran only in `tracking`, which is `continue-on-error: true`. They
were also outside the pre-commit hook's unit/integration/conformance scope. **Measured cost: a
38-failure native-parity regression passed pre-commit AND the required `gate`**, surfacing solely as
a red `tracking` — the job everyone (correctly) reads as the documented browser/serve-tool baseline.
**The transferable rule: a gate that is correctly non-blocking and habitually red is where a real
regression hides.** Fixed at `b7dda491` by wiring the files into `gate` AND `pre-commit`; they are
deterministic (no dist / browser / network deps) and cost ~16s; green at wiring time at 6394 tests /
0 fail. Gap: `g-parity-canary-outside-every-blocking-gate`.

**FAILURE MODE 2 — a blocking tier pointed at a tree with a DOCUMENTED FAILURE BASELINE.** pre-push
used to run the WHOLE of `compiler/tests/`. browser / lsp / self-host / commands carry a documented
baseline of **~42 failures (2026-07-30)** that is assessed by comparing failure-NAME SETS, not counts.
**An exit-code gate cannot express "the same names as before"**, so that scope made the hook
structurally unpassable — every push blocked, on every clone, for a baseline no change caused. That
is the `pa-base` §8 cry-wolf shape: a gate that cannot pass is bypassed, and a bypassed gate gets
deleted. Fixed at S301 by narrowing pre-push to the same unit+integration+conformance subset
pre-commit and `gate` use (verified 21597 pass / 0 fail on a clean checkout — so it CAN go red for a
real regression and green otherwise, which is the whole point).

**FAILURE MODE 2 IS NOW HALF-SOLVED, and the solution is the general one.** S313 (`#361`, bryan RULED
promote) resolved the tension for the browser tier by **gating on the wrong thing less**: not the
COUNT (which says nothing about WHICH test broke) and not the exit code (permanently 1), but the
**failure NAME SET** — a condition an exit-code gate CAN carry, because `--check` exits 0 while the
set is unchanged and 1 the moment a name joins or leaves it. The tier is now in the BLOCKING `gate`.
**The shape generalizes and is deliberately not yet applied:** lsp / commands / self-host carry their
own baselines and have no name-set assertion (`g-lsp-commands-selfhost-tiers-have-no-failure-name-set-assertion`,
LOW). Extending it is mechanical once this is proven in anger.

The two original rules remain in tension and both are load-bearing: **widen a blocking gate only over
a subset that is reproducibly green from source OR name-set-assertable; never leave a tier whose only
runner is non-blocking.**

## CI/CD Pipeline  [.github/workflows/advisory-review.yml] — **DISABLED THIS WINDOW (#351)**
**`workflow_dispatch` ONLY**, with a required `pr` input. The `pull_request:` trigger and its paths
filter are GONE; the workflow name now reads `AI Code Review (advisory — DISABLED, manual fire only)`.
**Read the reason correctly: the missing `ANTHROPIC_API_KEY` is a COST decision by bryan, not a broken
secret.** A check that is always red is the `pa-base` §8 cry-wolf shape — it gets ignored, and then a
real failure gets ignored with it; this one had already been logged as a known non-regression in three
consecutive session hand-offs, and that tax is what was removed.
**What is NOT lost:** the MANDATORY adversarial pass (S239) is PA-side and local, and always was — the
contract requires it precisely because a dev-agent cannot invoke the review in-agent. THIS job was
explicitly advisory (S255), a SECOND opinion stacked on the PA's. Removing it deletes duplication, not
coverage; the gap it originally closed (human-authored PRs the PA never dispatched) is now covered by
the PA reviewing those PRs directly.
**To reinstate:** set the `ANTHROPIC_API_KEY` repo secret and restore the `pull_request:` trigger.
**Any map or doc line saying "that secret IS set — the daily cloud-maps run passes it" is RETIRED**;
`cloud-maps` no longer passes it at all.

## CI/CD Pipeline  [.github/workflows/cloud-maps.yml] — **STAGE 2 DELETED; NO SCHEDULED MAP REFRESH**

**The single most consequential build-side fact this window, and it is a silent one.**

**name:** `cloud-maps` · **job:** `regen` · **triggers:** `workflow_dispatch` + `schedule` cron
`17 9 * * *` (daily ~09:17 UTC) · **concurrency:** group `cloud-maps`, `cancel-in-progress: false` ·
**permissions:** `contents: write`, `pull-requests: write` (**`id-token: write` was DROPPED — it
existed solely for the removed claude-code-action OIDC**).

**Steps NOW.** checkout (token `secrets.MAPS_PAT`, `fetch-depth: 0`) → setup-bun → `bun install
--frozen-lockfile` → **Stage 1** `bun scripts/state.ts --write` (deterministic `@generated` rollup,
zero AI cost, and a HARD-FAIL surface — see "Gap-status vocabulary" below) → **Stage 1b**
`bun scripts/threads.ts --check && bun scripts/threads.ts` (`continue-on-error: true`) →
~~Stage 2 (project-mapper agent)~~ **REMOVED 2026-08-01 (#351)** → **Stage 3** if
`git status --porcelain -- .claude/maps master-list.md` is non-empty: branch `maps/regen-<run_id>`,
`git add -f .claude/maps master-list.md` (the `-f` is load-bearing — `.claude/` is gitignored and the
maps are force-tracked), commit, push, `gh pr create --base main`, `gh pr merge --squash --auto
--delete-branch`.

**CONSEQUENCE, STATED PLAINLY: nav-maps are NO LONGER refreshed on a schedule.** That reverts to the
PA at wrap (the contract's wrap step 6c), which is where it lived before this workflow existed.
**A reader who assumes a nightly refresh will trust a stale stamp.** Stages 1/1b remain deterministic
and free, so the `@generated` state rollup keeps drifting-checked — the map set does not.

**Why it was deleted rather than left red.** Stage 2 was the only Anthropic-billed step here, and
bryan ruled the cloud AI spend off. Leaving it erroring would have been the cry-wolf shape again; it
was already costing real time (an S310 boot spent part of itself root-causing this workflow's red
run). **The prior generation of this map spent ~35 lines diagnosing that red as a probable
credential/entitlement condition on `ANTHROPIC_API_KEY` — that analysis is now MOOT and has been
deleted, not carried.** The 17/17-failure history and its `1 turn / ~0.6s / $0 / is_error:true`
signature are in `docs/changelog.md` if anyone needs them.

**To reinstate:** restore an `anthropics/claude-code-action@v1` step with the project-mapper
FULL_COLD_START prompt and set the `ANTHROPIC_API_KEY` repo secret.

**Design constraints still worth not re-litigating:** it NEVER pushes to protected `main` — it opens
a PR and enables auto-merge, so `ci.yml`'s `gate` runs on it and auto-merge stamps it on green. The
PAT (not `GITHUB_TOKEN`) is required because a PR opened by `GITHUB_TOKEN` does not cascade events, so
`gate` would never fire and auto-merge would wait forever. Fine-grained PATs expire (≤1 yr) —
`MAPS_PAT` must be renewed or the bot goes dark.

## Gap-status vocabulary + LEDGER INTEGRITY — `scripts/state.ts` (CHANGED S299; THREE more integrity fixes #485, S334)

`scripts/state.ts` parses `<!-- @gap id=… sev=… status=… -->` markers out of `docs/known-gaps.md`
to generate the §0 counts rollup. It runs in `cloud-maps` **Stage 1** and via `bun scripts/state.ts
--write` locally.

**TWO silent-drop guards now exist, and the second one is new this window.**

**Guard 1 (S299) — an unrecognised STATUS.** The status was previously a CLOSED alternation *inside
the regex*, so a marker carrying any other status **did not match at all — not miscounted,
INVISIBLE.** Fourteen such markers had accumulated across six unrecognised statuses, **two of them
open HIGHs**. Surfaced by ARITHMETIC: a landing resolved two HIGH entries and the count moved 12 → 11.

**Guard 2 (S307, #335) — an unparsed MARKER.** The regex also required `status=` to be followed
IMMEDIATELY by `-->`, so **any marker carrying an extra attribute was silently dropped** — and
`pa-base v2.9` had just made `locus=` a REQUIRED field on this exact marker, so every entry filed
under the new rule became invisible, in the direction that under-reports open defects. Measured at
the fix: **3 markers dropped, 2 of them OPEN.** The parser (`gapMarkersFrom`) is now an ATTRIBUTE BAG
— any order, any extra attribute (`locus=`, and `prov=` as of S313) — it SKIPS the doc's own
`id=<placeholder>` format example so the guard cannot fire on the documentation of its own syntax,
and it **THROWS naming the offenders** when the parsed count disagrees with the marker count.
`parseGapMarkers` is EXPORTED and the CLI dispatch is gated on `import.meta.main`, **specifically so
the guard is testable** — a gate that cannot be exercised from a test is the `pa-base` §8 unproven
gate, indistinguishable from one that cannot fail (`compiler/tests/unit/gap-marker-parser-s307.test.js`).

**The guard has since fired on its author, correctly.** At S313 a marker used `status=partial-impl` —
a value `docs/known-gaps.md`'s own header legend already defines ("some sub-units shipped, others
pending") but the classifier did not know. **The throw was right**; the fix was to teach the script a
value the ledger sanctions (added to `GAP_STATUS_OPEN` — a half-built guarantee is a live gap), not to
downgrade the marker to fit the script.

**The fix is deliberately not "widen the alternation".** The regex now matches ANY
`status=([a-z-]+)` and classification happens in three named sets:

| Set | Members | Counts as |
|---|---|---|
| `GAP_STATUS_OPEN` | `open`, `in-progress`, `narrowed`, `ruling-gated`, **`partial-impl` (S313)** | OPEN |
| `GAP_STATUS_CLOSED` | `resolved`, `fixed`, `deferred`, `non-gap`, `forensic`, `root-caused-elsewhere` | CLOSED |
| `GAP_STATUS_NOMINAL` | `nominal` | NOMINAL |

**A status in none of the three THROWS.** That is the gate: the ledger cannot grow a seventh
vocabulary word without someone deciding how it counts. **Practical consequence — introducing a new
`status=` string in `docs/known-gaps.md` will break CI Stage 1 by design.** Add it to the right set
in `scripts/state.ts` in the same commit.

Author intent is preserved rather than normalized — `ruling-gated` is not rewritten to `open`,
because the distinction is real to a human reading the entry. Only the COUNTING semantics are
decided in the script. (Design rationale: a closed list that silently drops what it does not
recognise fails the `pa-base` §8 gate test — a gate whose blind spot is invisible is not a gate.)


**#485 (S334) added THREE ledger-integrity fixes, and each one is a distinct silent-omission class.
Together they are the argument for treating a probe as code-bearing.**

**(1) The marker parser TRUNCATED on an internal `>`.** The `@gap` attribute bag was matched with
`[^>]*?`, so a marker whose `prov=`/`locus=` value contains a literal `>` — a code literal like
`<msg> = ""`, or a `->` arrow — was cut at the internal `>` and **silently dropped from the count**.
Witnessed on a real marker on main. It is now `[\s\S]*?`; non-greedy still stops at the first `-->`,
so a well-formed marker is unaffected. **A character class that excludes a delimiter is a truncation
bug waiting for prose that contains it.**

**(2) Duplicate `@gap` ids DOUBLE-COUNTED.** The counts are per-ENTRY, but an entry may carry two
`@gap` markers sharing one id, and marker-granular counting counted both. `gapCountsFromTokens` now
dedupes to one token per id (first wins). **A same-id pair that fully AGREES collapses silently; a
pair with DIFFERING sev/status THROWS LOUD** — the count cannot resolve which is the entry's real
state, so guessing would be worse than failing. Same posture as this file's other silent-omission
guards.

**(3) Heading-vs-marker status drift is now DETECTED — and it is WARN-only ON PURPOSE.** Each entry
carries both a machine `@gap` marker and a human `### ` heading whose trailing `…; <SEV>; <status>`
span can drift from it (a fix flips the marker to `resolved` and leaves the heading reading `open`,
or the reverse). `state.ts` derives counts from the MARKER, so the CI gate passes while **the line a
human greps is wrong.** `headingMarkerDrift()` reports the disagreement; `open`/`deferred`/`nominal`
collapse to "open-ish" and only open-ish-vs-`resolved` counts, and only headings with a parseable
structured status tail are checked, so free-text headings never false-fire. **It never gates**:
pre-existing drift exists, a hard gate would block CI, and this is doc hygiene rather than a
currency guarantee. **At `616688ea` it reports 13 DRIFT** — up from the 10 the prior map generation
recorded as a Key Fact. See non-compliance.report.md.

**Also WARN-only in the same `--check` output, and worth knowing at boot:** `maps: N commits behind
HEAD (watermark <stamp>, HEAD <head>)`. **It reads the watermark off LINE 3 of `primary.map.md` and
does `git rev-list --count <watermark>..HEAD` with NO ancestry check** (invariant 48) — against an
off-main stamp it prints a number that means nothing and prints it as a staleness figure. Nothing
fails either way. At the start of this pass it read **19 commits behind**.

## Git Hooks (source-controlled, `.git/hooks/pre-commit` + `pre-push`; install via `scripts/git-hooks/install.sh`)
pre-commit — runs `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance **compiler/tests/*.test.js** --bail` (~2min; the last path is NEW this window — see "Gate topology" above; still excludes browser/e2e/self-host/lsp/commands); warns (non-blocking) on direct commits to `main`.
pre-push — **SCOPE AND TRIGGER BOTH CHANGED THIS WINDOW.**
  - **Scope:** `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance` — **NOT** the whole of `compiler/tests/`. See "Gate topology" FAILURE MODE 2.
  - **Trigger:** the suite is **SKIPPED on a NEW-REF push** (`remote_sha` all-zero = the ref does not exist upstream yet); the cloud `gate` on the PR is the authority for a feature branch (implements the S254 relaxation this hook had DOCUMENTED at step 2.5 but never applied at step 1). It DOES run on an update to an existing remote ref (including a force-push) and on any `refs/tags/v*`.
  - **STALE COMMENT, added this window and superseded within it:** the hook's step-2 banner now says
    the browser NAME-SET check "runs in CI `tracking` today" and that requiring it in the blocking
    `gate` "is bryan's to make — NOT taken unilaterally". **Bryan ruled promote in the same window and
    `ci.yml`'s `gate` runs it.** The hook's own SCOPE is unchanged and still correct; only that
    narration is stale. `browser-baseline.ts` is deliberately NOT run by this hook.
  - **`set -e` trap, worth knowing before editing this hook:** a bare `VAR=$(failing-cmd)` aborts the script THERE, before any reporting runs — an S301 blocked push printed only the banner and exited 1 with the diagnostic below it as dead code. `TEST_OUTPUT=$(…) || EXIT_CODE=$?` is load-bearing, not style. The failure summary greps `"^(fail)"`, not `-A2 "fail"`.
  - Also: gauntlet quick check; refreshes samples/compilation-tests/ fixtures first; the public snippet gate ONLY on a `refs/tags/v*` release-tag push; and **NEW S292, step 2.5 — a GENERATED-DOC CURRENCY gate** that mirrors the cloud gate's CHEAP checks so a stale generated artifact is caught locally instead of ~3 minutes later in CI. Runs `bun scripts/facts.ts --check` (~200ms) + `bun run scripts/regen-spec-index.ts --check` (~61ms) on EVERY non-deletion push, including the feature-branch pushes the S254 relaxation exempts from the full suite (exactly the ones that were failing). **`bun scripts/snippet-gate.js` is deliberately NOT in this hook — it costs ~48s**, and a hook that expensive gets bypassed, and a bypassed gate gets deleted. 261ms does not get bypassed. Skipped entirely when the push payload is deletions only. Failure message names the fix (`bun scripts/facts.ts --write && bun run scripts/regen-spec-index.ts`) and warns to regenerate AFTER the last content commit, not before — regenerating early and then editing `compiler/src` again is the exact loop this gate exists to catch (three rejected pushes in one S292 session).

## Docker
None. No Dockerfile / docker-compose in this repo — see infra.map.md.

## Tags
#scrml #map #build #gap-status-parser #state-ts #fail-loudly #known-gaps #cloud-maps-stage1 #cli-flags #semdiff #ci #ci-gate-layering #pre-commit #pre-push #bun-test #advisory-review #windows-ci #content-hash #cache-headers #adopter-82 #module-format #esm-chunks #snippet-gate #facts-gate #claim-gate #public-claims #dbauth #db-migrate #privilege-separation #migration-apply-seam #cloud-maps #maps-pat #spec-index-gate #generated-doc-currency #pre-push-currency #snippet-corpus-widened #npm-publishable #files-allowlist #gate-topology #gate-hole #root-level-tests #non-blocking-tier #documented-failure-baseline #failure-name-sets #cry-wolf #new-ref-push-skip #set-e-trap #pre-push-scope #b7dda491 #browser-baseline #failure-name-set #bidirectional-baseline #s34-census #§34.0 #row-provenance #fetch-depth-0 #diff-scoped-gate #ai-legs-killed #cost-decision #cloud-maps-stage2-deleted #no-scheduled-map-refresh #advisory-review-disabled #skipped-step-behind-red-step #gap-attribute-bag #locus-attr #partial-impl #proven-gate #import-meta-main #review-debt-script #pr-reviews-md #puppeteer-skip-download #windows-ci-flake #boot-step-0.6 #corpus-emit-differential #corpus-check-goggles #pre-land-gate #codegen-task-shape #dual-goggle #script-vs-module-goggle #node-check-blind-to-tla #bun-vm-script-blind #classic-script-no-type-module #truncated-probe #hard-req-markers #1878-sources #7254-artifacts #453-exclusions-printed #exit-code-2-invalid-comparison #compile-failure-is-data #u1-corpus-emit-retired #import-meta-classic-script #workflow-dispatch #manual-refire #dropped-webhook #prospective-not-retroactive #422-target-ref #s34-census-base-fallback #weakens-no-gate #root-vs-position #review-debt-code-bearing #two-rates-one-signal #volume-statistic-not-alarm #directory-whitelist-not-blacklist #scripts-is-code-bearing #count-threshold-not-percentage #bite-test #widen-before-you-count #auto-widen #widen-ceiling #epoch-clearing-not-list-full #cry-wolf-guard-deleted-not-tuned #state-ts-ledger-integrity #marker-truncation-internal-gt #duplicate-gap-id-double-count #throw-on-conflicting-status #heading-marker-drift-13 #warn-only-not-gated #maps-watermark-no-ancestry-check #s34-census-windows-fix-landed #fileurltopath #boot-read-set-gate #a-memory-navigates-it-does-not-gate #pickup-led-digest #delegate-dont-reimplement #detection-not-control #two-failure-classes-enumerated #behind-is-timing-not-a-defect #derive-dont-declare-guarded #needle-driftcheck #honest-residual-reverse-direction #windows-first #fileurltopath-not-url-pathname #dpa-debt-probe #a-channel-the-probe-does-not-read-does-not-exist #bidirectional-probe #stale-table #anchored-not-contains #third-instance-of-unanchored-match #ratification-lives-in-column-3 #run-not-ratify #source-text-regex-census #post-ast-source-text-rule #five-authors-one-substitution #invisible-to-differentials #pre-ast-is-exempt #ratio-not-inspection #reports-a-floor-not-a-count #never-quote-the-raw-regex-count #probe-inherited-its-own-blind-spot #structural-successor-named #new-or-touched-only #not-a-ci-gate #cry-wolf-shape #zero-github-diff #second-window-running

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [test.map.md](./test.map.md)
- [config.map.md](./config.map.md)
- [infra.map.md](./infra.map.md)
- [migrations.map.md](./migrations.map.md)
- [domain.map.md](./domain.map.md)
