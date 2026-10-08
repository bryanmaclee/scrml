# s452-boot-determinism — progress (append-only)

## Governing SPEC text (§58 is Nominal — only the determinism property is built here)

§58.1: "scrml treats compilation as a **pure function of two inputs** … Given the same
`(source, buildStory)` pair, any party SHALL be able to reconstruct the exact compiler and produce a
**bit-identical artifact**.\*" — and normatively: "No build axis outside `(source, buildStory)` —
wall-clock time, environment variables, build-host identity, telemetry — SHALL participate in
artifact content."

§58.12 `*` gap 1: "There is no spec statement, and no audit, establishing that *every* compiler stage
(tokenize → parse → type → codegen) is free of nondeterministic iteration order, hash-map ordering,
wall-clock, or randomness. The bit-identical claim requires a whole-compiler determinism audit and a
normative 'every stage SHALL be deterministic' statement." Gap 2 (worker/`Atomics` output order): the
bootstrap has no workers — not applicable.

No lockfile / Merkle closure built (out of scope per brief).

## Survey (bootstrap compiler + its drivers)

The bootstrap's scrml (`compiler/self-host-v2/*.scrml`) touches no ambient state: no Date/clock (the
only `Date` is `Date.now()` as a *program's* host call, emitted for runtime), no Math.random, no env,
no Map/Set/Object.keys iteration, no localeCompare, no sort; numbers print via JS Number→string
(ECMA-262-exact). Its only order-sensitive input is the ORDER of the files it is handed: node ids
(parse `firstId` threading), symbol numbering, declaration/type order in Core and diagnostic order all
follow it. The drivers (JS) each fed that order from the caller's list.

| site | class | fix |
|---|---|---|
| `slice-m2/lowered.js frontEnd` — files parsed + analyzed in LISTED order; entry = last listed | (a)+(b) — reversing a 2-file program changed client JS/HTML (dropdown) and diag order (theme) | link.scrml `parseProgram`: sort by path (code unit, tie-break text) → link order from imports (path tie-break, cycle → first in path order) → parse in link order; entry an explicit arg |
| `scripts/bootstrap-conformance.ts frontEnd` — a COPY of the above | (a)+(b) | deleted; calls the one driver with entry `"case.scrml"` |
| conformance `Object.keys(auxFiles)` (readdir-ordered) | (a)+(b) via the above | moot — the compiler canonicalizes |
| `conformance/run.ts loadCases` `localeCompare` | (b) report order is host-locale dependent | re-sorted by code unit in bootstrap-conformance.ts (run.ts is shared with impl#1 — not touched; DEFERRED) |
| bootstrap-conformance.ts NOT-TWINNED tie-break `localeCompare` | (b) report text | code-unit compare |
| absolute paths | (b) potential — compiler names files only by what it is handed | driver `assertProjectRelative` refuses absolute / `\` paths; new `projectSources(root)` names files root-relative |
| `slice-m1/harness.js loadBundle` readdir chunk order | (c) — module load order of a pure bundle | sorted anyway (hygiene) |
| `frontEnd` `ms` (performance.now) | (c) — timing metadata, not artifact/diag | none |
| mkdtemp random dirs (bundle build, loadProgram, runtime half) | (c) — fixed file names inside; never in artifacts | none |
| `Date.now()` in emitted programs | (c) — program semantics (§66.19.5) | none |

## Gate — slice-m4/determinism.test.js (10 tests)

Four-file program (dropdown split: app / lib/accent / lib/dropdown / lib/openness): path order ≠ link
order, and two libs are import-independent. (i) twice → identical JS/HTML/Core/ASTs/diags;
(ii) all 24 orders → identical; (iii) on disk under two roots (depth 0 and 3, written in opposite
orders), each compiled with cwd = root → identical to each other and to the in-memory compile; no
root/tmpdir/cwd string in any output; absolute path refused; (iv) a diagnostic in every file, 24
orders → one list (order + text). Plus link.scrml unit tests.

### Bite proof
1. link.scrml `const sorted = canonicalSources(xs)` → `= xs`: RED — (ii) [Core + ASTs differ],
   (iv), and the cycle test (3 fail / 7 pass). (iii) stayed green: both roots' readdir orders agreed
   with the in-memory listing by chance — (ii) is the order gate, (iii) the root/cwd gate. Restored → 10/10.
2. lowered.js `projectSources` naming files `join(root, rel)` (absolute): RED — both (iii) tests.
   Restored → green.
   (Before the 3→4-file change, bite 1 only failed the cycle test: a chain's link order is forced, so
   the gate needed import-independent files — fixed by adding lib/accent.)

## Counter
`bun scripts/bootstrap-conformance.ts`: PASS 120 (was 119 in the committed doc; the doc was already
STALE on main — #1276 added `error/handler-pipeless-arms-rt` without regenerating; no other verdict
moved with the driver change). Regenerated; `--check` current. `gen-bootstrap-severity --check` current.

## r2 (BRIEF-r2.md — review LAND-WITH-NITS)
- MED: `frontEnd`'s positional entry default removed. Omitted entry → `deriveEntry`: one file → itself;
  else the single file with a top-level `<program>` (link.scrml `programPaths`, order-independent);
  0 or ≥2 → throw (name the entry). No caller needed changing: every existing multi-file caller has
  exactly one `<program>` (all slices green unmodified).
- LOW: `assertProjectRelative` rejects `.`/`..`/empty segments. LOW: duplicate paths → driver error.
- Tests +5 (diamond, all rotations/orders entry-omitted; 4-file rotations entry-omitted == named;
  0/2-program throws; non-normal paths; duplicates). Bite: restoring `entry = files[last].path` →
  3 r2 tests RED; restored → 15/15.
- Merged origin/main (handOffs/dpa-queue.md only).
