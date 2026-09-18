# progress — g-e2e-render-map-populated-seed-is-inert

## S1 startup
- worktree: .../scrml/.claude/worktrees/agent-a0539fcdfaea3c866, clean at 9b3d8ab7
- `bun install` needed PUPPETEER_SKIP_DOWNLOAD=true (chrome cache dir exists, exe missing)
- `bun run pretest` OK -> 34 files in samples/compilation-tests/dist/

## S2 root-cause verification
CONFIRMED the seed writes an un-namespaced key. State keys after mount of 03-contact-book:
  ["00u8mn86$name","00u8mn86$email","00u8mn86$phone"]   (no `contacts` — async init failed)
Bare set("contacts") -> adds key "contacts", DOM unchanged (942 -> 942).

CONTRADICTION vs the brief: `_scrml_cs_reactive_set` is NOT reachable from the exec scope.
The whole client.js is wrapped `(function() { ... })()`, so the `const _scrml_cs_*` wrappers
are IIFE-local. `typeof _scrml_cs_reactive_set` is "undefined" at the harness's capture point.
=> "prefer _scrml_cs_reactive_set when the chunk defines them" cannot be implemented literally.
The namespace must be RECONSTRUCTED: the prologue emits
  `const _scrml_cs_key = (n) => { const raw = ...; return raw ? "01hrlbd8$" + raw : raw; }`
so the prefix is statically extractable from clientJs (and observable at runtime from
`_scrml_state` keys). Prefix is per-compile (content-hash-ish), never hardcodable.

Probe with bareSet(prefix + name):
  03-contact-book : readback OK, DOM 942 -> 1207, contact rows RENDER      (seed now LIVE)
  06-kanban-board : readback returns the APP's data, not the seed -> `todo` is a DERIVED cell;
                    real cell is `cards`. DOM unchanged. FIXTURE BUG, not a harness bug.
  16-remote-data  : readback OK, DOM unchanged — render is gated on a `<match>` over `phase`,
                    which the seed does not set. FIXTURE GAP.
  25-triage-board : readback OK, DOM 1078 -> 843 (SHRANK); inner each-mounts render EMPTY.
                    Possible real app/codegen bug. REPORT.

## S3 BEFORE states (bun observe-one.js, all four apps, both cells)
  03-contact-book  empty=renders-clean  populated=renders-clean
  06-kanban-board  empty=renders-clean  populated=renders-clean
  16-remote-data   empty=renders-clean  populated=renders-clean
  25-triage-board  empty=renders-clean  populated=renders-clean

## S4 fix landed (render-harness.js only)
- `extractChunkNamespaces(clientJs)` — static read of the `_scrml_cs_key` prologue prefix
- `namespacesFromStateKeys(keys)` — runtime second source, union'd (drift insurance)
- `applySeed(seed, obs, namespaces, doc)` — writes namespaced key(s) first, falls back to the
  BARE key when none read back (or when there is no namespace at all); returns an evidence
  report {namespaces, writes[{name,key,namespaced,readBack}], domChanged, htmlBefore/After,
  observable, errors}
- `mountAndObserve` now also captures `_scrml_state` KEYS (never values)
- the report rides on `cell.detail.seed` (baseline keeps `detail` for RED cells only -> no
  baseline perturbation of these four green cells)

## S5 AFTER measurement (populated cells)
  03-contact-book  ns=["01q57zl7$"] readBack=true  domChanged=true  942 -> 1207  OBSERVABLE
  06-kanban-board  ns=["011wz7qb$"] readBack=FALSE on ns key -> bare fallback; domChanged=false
  16-remote-data   ns=["00asb4om$"] readBack=true  domChanged=FALSE 454 -> 454
  25-triage-board  ns=["018at6xf$"] readBack=true  domChanged=true  1078 -> 843  OBSERVABLE
All four cells still score `renders-clean`. D6 does NOT fire anywhere => limb 2 IS still needed.

CORRECTION to the S2 note on 25-triage-board: the shrink is NOT a codegen bug. The app declares
`const columns = ["Inbox", "Doing", "Done"]` and filters `@tasks.filter(t => t.column == col)`,
while the seed's tasks carry lowercase `column: "todo"/"doing"`. Nothing matches, so all three
columns render empty and the app's own four default tasks are replaced by nothing. That is this
file's own documented SEED-SHAPE INVARIANT being violated by the fixture.

## S6 new test + bite proofs
Added to e2e-render-map.test.js §1a: "a populated seed lands on the app's OWN cell key and is
observable in the DOM" — a per-app TABLE (SEED_OBSERVABILITY) of {readBack, domChanged} plus a
hard `liveCount > 0`. The table reds in BOTH directions (live->inert AND inert->live).

MUTATION-1 `extractChunkNamespaces` -> `return []`  : test STILL PASSES.
  Not a gap — `namespacesFromStateKeys` recovers the prefix from the live store keys. The two
  discovery sources are genuinely redundant, which is the point of having both.
MUTATION-1 + MUTATION-2 (`namespacesFromStateKeys` -> `return []`) = the EXACT pre-fix bridge:
  test REDS, and the diff is exactly the reproduced bug — all four apps flip to
  domChanged:false / observable:false / readBackThroughAppKey:false / namespaces:false.
Both mutations removed by FILE COPY (never git stash). `grep -c MUTATION` == 0.

## S7 full tier
`bun test compiler/tests/e2e-render-map/` -> 68 pass, 0 fail, 1107 expect() calls, 51.9s.
WARN-only deltas printed (all pre-existing, all `#empty`, none reachable from the seed path):
  - GREEN->RED (2): benchmarks/todomvc/app.scrml#empty, examples/09-error-handling.scrml#empty
    A/B'd against the base harness (base file copied into place, then copied back):
    BOTH reproduce IDENTICALLY at base => pre-existing, NOT caused by this change.
  - NEW cells (3) + ORPHAN (1): baseline drift, owed to the POSIX baseline regen (out of scope).
Baseline NOT regenerated. No file under compiler/src/ touched.

## S8 D6
D6 does not fire anywhere. Both now-live cells still score `renders-clean` because
`hasRenderedContent` is body-global and the page chrome (h1 / form / column titles) satisfies it
before any data arrives — for 25-triage-board the three task lists render EMPTY under the seed and
the cell is STILL green. => LIMB 2 IS STILL NEEDED, and it is now the only thing standing between
D6 and a real subject.

## S9 follow-up gaps found (NOT fixed here — fixture data, separate decision)
1. 06-kanban-board seed targets the DERIVED cell `todo`; the source cell is `cards`.
2. 16-remote-data seed sets `contacts` but not `phase`, so the `<match>` gate never opens.
3. 25-triage-board seed's `column` values do not match the app's `["Inbox","Doing","Done"]`.
All three are now LOUD (`detail.seed.observable` + the pinned table), not silent.

---

# FIX ROUND (on top of 4944c329) — adversarial pass found 2 HIGH; both confirmed against source

## S10 verification of the findings (done BEFORE changing anything)

**HIGH-1 — `readBack` certifies nothing. CONFIRMED, and worse than reported.**
`compiler/src/runtime-template.js:548` declares `const _scrml_state = {};` — a plain object.
`_scrml_reactive_get(name)` (`:819`) returns `_scrml_state[name]` for any non-derived name, and
`_scrml_reactive_set` (`:853`) is `_scrml_state[name] = value`. So EVERY invented key reads back.
Consequences, all real:
  - "first key that reads back wins" was just "first candidate wins"; the documented bare-key
    fallback was unreachable whenever >=1 namespace was discovered.
  - `_scrml_reactive_set` runs `_scrml_propagate_dirty` and notifies subscribers, so a speculative
    probe write can fire effects on the very subject the detectors then read (LOW-5).
  - **MY 16-remote-data ROW WAS A FALSE CLAIM.** `examples/16-remote-data.scrml` declares exactly
    ONE cell, `<phase>: ContactsPhase = .Idle` (line 63). There is no `contacts` cell: the list is
    `<each in=rows>` (line 159) where `rows` is the MATCH BINDING of `@phase = .Loaded(rows)`
    (line 85). I reported "it DOES read back through the app's own key" — it read back through a
    key nothing in that app ever reads. My stated remedy ("a complete seed sets phase too") is also
    wrong: `.Loaded(rows)` is a payload variant, not a value a plain cell-set can produce.

**HIGH-2 — a per-run token would reach the committed baseline. CONFIRMED.**
`generate-baseline.js` runCorpus: `if (!GREEN_STATES.has(cell.state)) { map[key].detail = cell.detail ?? {}; }`
then `writeFileSync(BASELINE_PATH, JSON.stringify(obj, null, 2) + "\n")` (`:286`). I checked only the
GREEN half and wrote "no baseline perturbation" — the RED path is exactly where detail IS persisted,
and reddening a seeded cell is D6's whole purpose. Measured directly: two observations of the SAME
app minted `01dw75n3$contacts` and `005ywi75$contacts`.
This is the class I was sent to fix, recreated one level away: I put a non-deterministic value into
a committed artifact while fixing an observability bug.

**MED-3 — two prologue forms. CONFIRMED.** `codegen/index.ts cellScopeKeyFn` (`:590`) emits the
compact no-owner form (ternary) AND the dotted-root OWNER form, which ends `return "<prefix>" + raw;`
with no ternary. My regex matched only the first. But `buildCellScopePrologue` (`:628`) emits
`// --- chunk cell scope (<token>) ---` for BOTH — a far better anchor than the key-fn body.

## S11 what changed

`extractChunkNamespaces` + `namespacesFromStateKeys` + the `_scrml_state` key capture are GONE,
replaced by:
- `parseChunkCellScopes(clientJs)` — segments the bundle on the `// --- chunk cell scope (token) ---`
  header (both prologue forms), and per chunk collects `token`/`prefix`, the `_scrml_cs_owners` map,
  `cells` (every name passed to a `_scrml_cs_*` accessor = the chunk's REAL cell set) and `derived`
  (names from `_scrml_cs_derived_declare`). An unrecognised prologue THROWS (MED-3) instead of
  returning `[]` and silently degrading to bare-key seeding. MED-4's first-`$` split is gone with the
  function that had it.
- `cellKeyIn(scope, name)` — a faithful mirror of the emitted `_scrml_cs_key`, INCLUDING the
  dotted-root owner lookup, so an imported cell keys under the exporter's token.
- `applySeed` — resolves STATICALLY and writes at most ONE key, or none: `no-such-cell` (fixture
  names a cell the app does not have) and `derived-cell` (runtime recomputes it; writing leaves junk
  in a slot the runtime never writes) both write NOTHING. No read-back is consulted anywhere.
  `domChanged` is load-bearing; `observable = wrote && domChanged`.
- The report is names, booleans and reason codes only — no keys, no prefixes, no tokens, no lengths.
  Error strings carry the NAME, never the key.

## S12 CORRECTED before/after table

| app `#populated`   | BEFORE (pre-S420) | AFTER | resolution | DOM |
|--------------------|-------------------|-------|------------|-----|
| 03-contact-book    | renders-clean     | renders-clean | `written`      | CHANGED — rows render |
| 06-kanban-board    | renders-clean     | renders-clean | `derived-cell` | unchanged, NOTHING written |
| 16-remote-data     | renders-clean     | renders-clean | `no-such-cell` | unchanged, NOTHING written |
| 25-triage-board    | renders-clean     | renders-clean | `written`      | CHANGED (shrinks) |

vs the previous (withdrawn) round: 06 and 16 previously had junk written into their stores — 06 into
a DERIVED slot the runtime never writes, 16 under a key for a cell that does not exist.

## S13 bite proofs on the NEW tip (all by FILE COPY; `grep -c MUTATION` == 0 after each)
- **MUTATION-A** `cellKeyIn(...)` -> `name` (the exact pre-fix bare-key bridge): REDS. 03 and 25 flip
  to `namespaced:false, domChanged:false, observable:false`.
- **MUTATION-B** drop the cell validation (`?? scopes[0]`): REDS on 16-remote-data —
  `no-such-cell` -> `written`. Proves the validation is load-bearing and that the app has no such cell.
- **MUTATION-C** drop the derived guard: REDS on 06-kanban — `derived-cell` -> `written`.
- **MUTATION-D** put `key` back on the write record: REDS the determinism test, printing the two
  differing tokens. Direct proof of HIGH-2.
- **MUTATION-E** break the prologue header regex: REDS — and the cell itself goes
  `compiles-but-throws` / `D2-CONSOLE-ERROR` with the `[seed-bridge]` message. A silent bare-key
  degrade is now structurally impossible.

## S14 D6 — unchanged conclusion, now on honest inputs
D6 still fires nowhere; all four cells remain `renders-clean`. `hasRenderedContent` is body-global and
page chrome satisfies it before data arrives. 25-triage-board renders all three task lists EMPTY under
a live seed and is still green. LIMB 2 IS STILL NEEDED.

## S15 follow-up gaps (fixture data — NOT fixed here, separate decision)
1. 06-kanban-board seeds the DERIVED cell `todo`; the source cell is `cards`.
2. 16-remote-data seeds `contacts`, a cell THIS APP DOES NOT HAVE. No plain cell-set drives it —
   `.Loaded(rows)` is a payload variant.
3. 25-triage-board's `column` values do not match the app's `["Inbox","Doing","Done"]`.
All three are now loud (`detail.seed.writes[].reason` + the pinned table), not silent.

## S16 LOW — the determinism test's comment over-claimed; made the claim real (option b)

The comment said "the two runs really did mint DIFFERENT tokens", but `tokensOf` was applied only
to `a.detail.seed`, which by construction contains no token. Nothing asserted the runs differed, so
`sa === sb` rested on an unasserted premise. Same shape as the bug this PR fixes: a comment claiming
a property the code does not check.

Took option (b) — it is ~12 lines and it pins the PREMISE of the whole HIGH-2 argument (that the
harness really does compile into fresh staging dirs). The test now reads the token from the one
artifact that legitimately still carries it, the `// --- chunk cell scope (<token>) ---` header of
each run's emitted client body, and asserts the two differ. The report-equality and the
no-token-at-all assertions both stay, now resting on something proven.

Bite proofs (file copy; `grep -c MUTATION` == 0 after each):
- MUTATION-F `token: head.token` -> `token: "STABLE"`: REDS on the new guard
  (`expect(received).not.toEqual(expected) / Expected: not "STABLE"`). The non-vacuity is real.
- MUTATION-D (re-run on this tip) still REDS, printing `01604swh$contacts` vs `00q1vd04$contacts`.

Tier re-run: 69 pass, 0 fail, 1116 expect() calls, 44.8s. render-harness.js byte-identical to
7d6d9bc1; only the test file changed.
