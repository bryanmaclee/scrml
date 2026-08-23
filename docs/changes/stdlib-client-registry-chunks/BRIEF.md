# BRIEF — stdlib client registry chunks (S368-bryan dispatch)

DONE-PROBE: bun -e 'const{RUNTIME_CHUNK_ORDER}=await import("./compiler/src/codegen/runtime-chunks.ts");const n=RUNTIME_CHUNK_ORDER.filter(c=>c.startsWith("stdlib-")).length;process.exit(n>=10?0:1)'

## The defect (PA-reproduced by EXECUTION on main @ 772c0fb2)

A client-side `import { slug } from 'scrml:format'` compiles clean, emits a complete artifact
set, and the page is **dead on arrival**:
`TypeError: Cannot destructure property 'slug' from null or undefined value` at bundle load.

Root: the client bundle lowers a stdlib import to a registry read
(`const { slug } = _scrml_stdlib.format;` — a classic script cannot resolve bare specifiers),
and `RUNTIME_CHUNK_ORDER` in `compiler/src/codegen/runtime-chunks.ts:154-157` declares only
FOUR stdlib chunks: `stdlib-auth`, `stdlib-crypto`, `stdlib-data`, `stdlib-host`.
`runtime-template.js:538` ships `const _scrml_stdlib = {};`. The other 17 of 21 modules
destructure `undefined`.

Filed: `g-stdlib-client-registry-chunk-missing-for-17-of-21-modules` (HIGH) in `docs/known-gaps.md`.

## Scope — three limbs, limb 2 is the load-bearing one

**Limb 1 — register the client-safe modules.** Add the missing `stdlib-<name>` entries to
`RUNTIME_CHUNK_ORDER` and matching entries to `CHUNK_MARKERS`, and wire `detectRuntimeChunks`
to activate them on a `scrml:<name>` import. Confirmed broken and client-relevant (PA-swept,
6 of 6): **format · math · random · regex · time · router**. Decide the rest ON EVIDENCE, not
on my list — some are server-only by design (`store` is already documented as intentionally
absent; `fs`/`process`/`redis`/`cron`/`oauth`/`http` are in `SERVER_ONLY_SCRML_MODULES` at
`route-inference.ts:579`). For each module you do NOT wire, leave a one-line comment saying why.

**Limb 2 — re-point the gate at the property that decides the outcome.** `W-STDLIB-SHIM-MISSING`
(`compiler/src/api.js:474-488`) fires on `!existsSync(compiler/runtime/stdlib/<name>.js)` — "does
a shim FILE exist". All 21 exist, so it never fires. The property that decides whether a CLIENT
import works is "is `stdlib-<name>` in `RUNTIME_CHUNK_ORDER`". A client-reachable `scrml:NAME`
import whose module has no registry chunk MUST produce a diagnostic. **Without this limb the next
module added hides exactly the same way** — this is pa-base §10 (an obligation and the probe that
reads it must resolve to the SAME artifact), the contract's most-repeated failure.

**Limb 3 — a merge-blocker conformance/integration case that EXECUTES the emitted bundle.**
A grep-level assertion ("the marker is present") CANNOT see this class — that is the S265
theme-switch lesson verbatim. The case must load the emitted runtime + client bundle and assert
the page is not DOA.

## Verification you MUST do (do not mark DONE without these)

1. **Reproduce first, on your own base**, before changing anything. Do not take this brief's
   symptom on trust — PA-asserted loci are hypotheses (pa-base §5). Report whether the locus held,
   was refined, or was wrong.
2. **Execute, do not grep.** Reproducer harness that works (verified by me):
   happy-dom `Window`, `document.write(<the emitted html>)`, publish `window`/`document` and the
   usual DOM globals onto `globalThis`, then `(0, eval)(runtime + '\n;\n' + client)` — two classic
   scripts in ONE shared script scope, which is the browser's model. `vm.createContext(win)` does
   NOT work (happy-dom's Window is not a usable vm context) and `win.eval` does not exist.
3. **Positive control.** `scrml:data` is already wired and MUST still execute clean after your
   change — if you break the working case you have moved the bug, not fixed it.
4. **Direction-of-change classification (pa-base §8).** Making previously-DOA programs run is
   almost certainly `newly-accepting` at the RUNTIME level while `inert` at the language level —
   state which, and if any source that previously compiled now REJECTS (limb 2 adds a diagnostic),
   that is `newly-rejecting` and owes a **MEASURED** corpus migration: grep `samples/`, `examples/`,
   `conformance/cases/` for client-reachable stdlib imports and report the COUNT and FILES.
   Assumed-zero is not measured-zero.
5. **Bite proof on limb 2.** Deliberately remove a chunk registration, confirm the new diagnostic
   goes RED, restore, confirm GREEN. A gate that has never failed is indistinguishable from one
   that CANNOT fail.
6. Full suite green: `bun run test` (chains `pretest`; `bun test` directly gives ~130
   ECONNREFUSED-shaped failures). Conformance: `bun conformance/run.ts`. Known pre-existing
   baseline failures (self-host ×3 / self-compilation / session) are NOT yours.

## Out of scope — do NOT fix these here

- `g-stdlib-internal-reexport-noise-reaches-the-adopter` (MED, filed alongside): importing one
  stdlib fn emits 23 `W-STDLIB-SEED-FAILCLOSED` warnings about scrml's own stdlib internals.
  Independent defect, separate arc.
- The compile-FAILED-but-artifacts-written behaviour (the S354 Q3 write-on-failure gap).
- Anything under `compiler/src/codegen/emit-each.ts`, `exportRegistry`, or the name-resolver —
  **a concurrent session owns that surface right now.** Do not touch it.

## Process

- Commit after each meaningful unit; WIP commits expected. Append to `progress.md` in this
  directory (append-only, timestamped: what was just done, what is next, blockers). The branch +
  progress.md are your ONLY crash-recovery anchor.
- NEVER `--no-verify`, and never override `core.hooksPath` to skip a hook. If a gate blocks you,
  report it — do not route around it.
- Report at the end: files touched, final SHA, whether the PA's locus held, and any DEFERRED items
  WITH THE REASON (a deferral with no recorded reason cannot be re-derived).
