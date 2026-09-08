# BRIEF — library-mode: the structural emitter exists; the routing predicate is the defect

**Change-id:** `library-mode-structural-routing-2026-09-06`
**Gap:** `g-library-mode-no-typed-payload-match` (MED, open) — PARTIALLY STALE, see §1.
**Dispatched by:** S403-peter. **Base:** `origin/main` @ `499eecce`.
**Direction-of-change:** newly-accepting **TOWARD THE CONTRACT** = conformance restoration (§2).

---

## 1. The gap is partially stale — measured, not assumed

The ledger entry names THREE failures. Re-run on `499eecce`:

| # | shape | ledger says | measured NOW |
|---|---|---|---|
| a | param/return annotations `fn f(n: int) -> int` | broken | ✅ **FIXED** — the entry's own recorded reproducer compiles clean, 0 diagnostics across `errors`/`warnings`/`lintDiagnostics` |
| a2 | **local** annotations `let acc: int` / `const s: string` | (entry says "params/returns/locals") | ❌ **STILL BROKEN** — `E-CODEGEN-INVALID-LOGIC`, `: int` leaked verbatim |
| b | `match` lowering | broken | ✅ **FIXED** — real structured lowering, executed and correct |
| c | payload-variant construction `return .Ok(n)` | broken | ❌ **STILL BROKEN** — `.Ok(n)` leaked verbatim |

Update the ledger entry to reflect this; do not leave it claiming the fixed halves are broken.

## 2. Governing-sentence gate — PASSED, quoted (this is why it is a fix, not a ruling)

- **§7.5:** *"Type annotations appear on variable declarations, function parameters, and function
  return types throughout scrml logic contexts."* Normative: *"Type annotations SHALL be optional on
  all variable declarations and function parameters."*
- **§14.10 (SPEC.md:9437):** *"A bare variant reference SHALL be resolved by the compiler when the type
  at the position can be inferred from … a function return type (`return .V` where the return is typed `T`)."*

Both forms are already-legal scrml that the implementation wrongly rejects → **conformance restoration**
(pa-base §8, toward-the-contract limb). It is NOT a widening and does NOT need a bryan ruling.

## 3. ⚑ THE ROOT — and it is a HYPOTHESIS. Falsify it before building on it.

**PA claim:** the lowering is NOT missing. `compiler/src/codegen/emit-library.ts` is a **raw-source-text
slicer** with per-construct **span-splice patches**; a full structured per-function emitter
(`emitLibraryFnMember`, `emit-library-shared.ts`) already exists and lowers both broken shapes
CORRECTLY — but a function only reaches it when the routing predicate says so.

**The gate — `emit-library.ts:669`:**
```ts
if (alreadyRouted.has(node.name)) continue;
if (containsSqlOrTransaction(node)) continue;
if (!fnBodyContainsMatch(node)) continue;   // ← a fn without a `match` never routes structurally
```

**PA evidence (run these; they are the falsification test):**
- `export fn calc(n: int) -> int { let acc: int = n * 2  return acc }` → **fails** (annotation leaks).
- The SAME body **plus a dummy `match` on a typed param** → **compiles**, emitting `let acc = n * 2;`.
- `export fn wrap(n: int) -> Res { return .Ok(n) }` → **fails**.
- The SAME body plus a dummy `match` → **compiles**, emitting `return { variant: "Ok", data: { n: n } };`.

So the two remaining halves are already lowered correctly by the structural path; they are simply not
routed to it. ⚑ **This FALSIFIES the ledger's stated fix direction** (a "~13-22h structural
emit-library rewrite" to build typed-payload/match/payload-variant lowering). Do not build lowering
that already exists. **If your own measurement contradicts this root, SAY SO and re-derive — you have
full licence to. The symptom table in §1 is the evidence; the root here is my inference from it.**

## 4. Success = closing the CLASS, not the two instances

The file's history is one span-splice pass per discovered construct — `!{}` guarded-expr, `_={}=`
foreign, top-level `const = match` (`g-library-mode-toplevel-decl-match-leaks`), SQL fns. Locals and
payload-variants are the NEXT TWO MEMBERS OF THAT CLASS, not the last two. **A fix that adds a sixth
and seventh splice pass is the wrong fix** (base FORK RULE row 4: root beats position; overlay Rule 7:
do not ask the text what the tree already knows).

**Target shape:** route library function bodies through the structural emitter BY DEFAULT, with the
raw-text slicer as the fallback — not the reverse. Widen the predicate at `:669` toward
"route unless we must not", and make the fallback the exception with a stated reason.

**Class-closing probe (author it, and report its output):** a battery of library-shaped fixtures, each
a bare `${ export fn … }` with NO `match`, one per scrml-specific construct: local type annotations ·
bare-variant construction (payload + unit) · `is not` / `is some` / `given` · `~` · typed struct
literal · `T?` / `T[]` annotations · `!{}` · `_={}=`. Report a pass/fail row per construct. Constructs
that still fail after the fix are the residual — FILE them, do not paper over them.

## 5. Blast radius — MEASURE IT, and use the compiler's OWN classifier

Routing more functions structurally changes emitted output for files that compile today. For those,
the change MUST be **INERT (byte-identical)** or it is a regression.

⚑ **Do NOT hand-roll a "library-shaped file" grep.** The PA tried (`no <program>` + `has export`) and
got 26 files while EXCLUDING all 53 `stdlib/*.scrml`, because stdlib files mention `<program` in prose.
Use the compiler's own predicate — `isPureModuleFile` / the `api.js` mode-flip
(`!hasProgramRoot && all-non-markup && exports>0`) — so the population you measure is the population
the fix touches (pa-base §10: the obligation and the probe must resolve to the same artifact).

Method: enumerate with the compiler's classifier → compile ALL of them at `499eecce` and save outputs →
apply fix → recompile → **diff**. Report: N files, N byte-identical, N changed (with the diff for every
changed one), N newly-compiling, N newly-failing (must be zero).
⚑ `scripts/corpus-emit-differential.ts` false-diffs across checkout paths (S400: 1027 of 7427 under an
INCOMPARABLE verdict). Diff before/after on the SAME checkout; do not trust that instrument's verdict.

## 6. Gates before you report DONE

1. `bun run test` (chains pretest) — full suite from the WORKTREE. Report pass/skip/fail.
2. The §5 differential, with the numbers above.
3. The §4 class battery, per-construct rows.
4. R26 empirical: the four PA fixtures in §3, plus every stdlib library module still compiling.
5. Commit tests that PROVE THE BITE both ways (fail before the fix, pass after) — at minimum a local
   annotation and a payload-variant construction in a `match`-free library fn.
6. `bun scripts/facts.ts --write` if you add/remove a test file or change compiler/src LOC.

## 7. Out of scope — do not touch
The entry-ness arc · the apostrophe / native-parser arc (`engine-statechild-parser.ts`) · `ast-builder.js` ·
`api.js` · `codegen/index.ts` · `component-expander.ts` · `types/ast.ts` · `library-shape.js` — a
CONCURRENT session (S402-bryan) owns those RIGHT NOW. If the fix appears to require one of them, STOP
and report rather than editing it.
