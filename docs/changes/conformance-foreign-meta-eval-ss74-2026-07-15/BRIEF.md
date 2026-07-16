# BRIEF — sPA ss74: conformance codes-half, inline foreign §23.2 + meta-eval §22

**Change-id:** `conformance-foreign-meta-eval-ss74-2026-07-15`
**Branch base:** `spa/ss74` (== origin/main; 593/593 conformance green at dispatch)
**Isolation:** worktree. **Model:** you are scrml-js-codegen-engineer.

## Task

Author **conformance corpus cases** (codes-half only; these are all compile-time
diagnostics — NO runtime `(b)` half) pinning **8 diagnostic codes** in the inline-foreign
(§23.2 / §23.6) + meta-eval (§22) families. For each code: one case that FIRES it (a
reject case, dir suffix `-neg`) and clean coverage that it stays SILENT (dir suffix
`-pos`). Corpus naming convention (verified on disk): `-neg` = the case that SHOULD emit
the diagnostic; `-pos` = the clean/accepted case. **Follow that convention.**

Deliver **12 case dirs** (listed below). Each dir = `case.scrml` + `expected.json`.

## Method (conformance authoring)

1. Author each `case.scrml` from the impl trigger (cited below), then **compile it and
   confirm the target code fires (`-neg`) / is absent (`-pos`)** via
   `bun conformance/run.ts` (superset match — incidental `W-*` / other codes are fine;
   only the TARGET code's presence/absence is asserted).
2. `expected.json` schema — mirror the existing meta cases
   (`conformance/cases/meta/meta-invalid-token-neg/`, `.../meta-emit-clean-pos/`):
   ```jsonc
   {
     "id": "<case-id matches dir name>",
     "description": "<§cite> <CODE> — one-paragraph: what the source does + why the code fires/stays silent, citing the SPEC §>",
     "language-version": "1.0",
     "source-test": "compiler/SPEC.md §23.2",        // provenance — the SPEC § or the impl test
     "expect": {
       "codes":    ["E-FOREIGN-003"],                 // -neg: the code that must fire
       "notCodes": [],
       "severity": { "E-FOREIGN-003": "error" }       // per-code §34 severity (all these are "error")
     }
   }
   ```
   For `-pos` (clean) cases: `"codes": []` + `"notCodes": [...]` and/or
   `"notCodePrefixes": ["E-FOREIGN-"]` to assert the family stays silent.
3. **VERIFY GREEN**: `bun conformance/run.ts` must end `NNN/NNN cases pass` (was 593/593;
   you add 12 → expect 605/605). Do NOT leave any case red.

## The inline-foreign syntax (verified against the impl + tests)

**Library form** (a file with `export fn`s and NO `<program>` — this is the surface for
most of these). Logic lives in a top-level `${ … }` block; the language context is an
optional self-closing `<foreign lang="…" />` at file top:
```
<foreign lang="ts" />
${
  export fn compute() {
    const out = _={ 1 + 1 }=
    return out
  }
}
```
- `_={ <slice> }=` is the **inline value-returning foreign block**. Bound to a
  `const`/`let` or `return` → ADMITTED (value-returning) form. `in: { name }` before the
  slice declares crossing names, e.g. `_={ in: { x }  x + 1  }=`. Crossings are optional.
- A **bare** `_={ … }=` as a statement (not bound, not returned) is the
  non-value-returning form.
- `<foreign lang="…" />` resolves the file's single foreign-language context (like one
  `<db src>`). Omit it → no lang context.

**Program form** (a `<program>` file): lang goes on `<program lang="ts">`, e.g. the
capability case `conformance/cases/capability/inline-block-covered/case.scrml`:
```
<program lang="ts">
  export function fetchIt(url: string) {
    const out = _={ in: { url }
      await fetch(url).then(r => r.text())
    }=
    return out
  }
</program>
```

**Meta form** (`^{ }` compile-time block) — read
`conformance/cases/meta/meta-emit-clean-pos/case.scrml` for the exact template. The
canonical clean shape is `^{ emit("<p>ok</p>") }`. The `^{}` body executes at compile
time via `new Function("emit","reflect", body)`.

## The 12 cases — one per row (fire + clean coverage for all 8 codes)

### conformance/cases/foreign/  (NEW dir)

| dir | code | shape |
|---|---|---|
| `foreign-inline-no-lang-neg` | **E-FOREIGN-003** fires | library file, NO `<foreign lang>`, bound `_={ 1 + 1 }=` in `${ export fn }`. No ancestor lang → E-FOREIGN-003 (`type-system.ts:21748`). |
| `foreign-inline-lang-declared-pos` | clean (003/004/005 silent) | same as above but WITH `<foreign lang="ts" />` at top + bound `_={}`. Assert `"notCodePrefixes": ["E-FOREIGN-"]`. |
| `foreign-bare-block-neg` | **E-FOREIGN-004** fires | `<foreign lang="ts" />` + `${ export fn f() { _={ globalThis.x = 1 }= } }` — a BARE (unbound) `_={}` statement → E-FOREIGN-004 (`type-system.ts:21745`). |
| `foreign-lang-unsupported-neg` | **E-FOREIGN-005** fires | `<foreign lang="python" />` + bound `_={ 1 + 1 }=`. Resolved lang ∉ {ts,js} → E-FOREIGN-005 (`type-system.ts:21765`). (The `foreign-lang-library-decl` test confirms non-ts/js `<foreign lang>` → E-FOREIGN-005.) |
| `foreign-crossing-shadow-neg` | **E-FOREIGN-006** fires | `<foreign lang="ts" />` + `${ export fn f(x) { const out = _={ in: { x }  const x = 1  x + 1 }= return out } }` — a crossing name `x` the slice ALSO declares (`const x`) at top level → crossing-shadow (`codegen/emit-logic.ts:2980`). |
| `foreign-crossing-clean-pos` | clean (006 silent) | same but the slice USES `x` without redeclaring it: `_={ in: { x }  x + 1 }=`. Assert `"notCodes": ["E-FOREIGN-006"]`. |
| `foreign-lang-duplicate-neg` | **E-FOREIGN-LANG-DUPLICATE** fires | library file, TWO top-level `<foreign lang="ts" />` + `<foreign lang="js" />`, then `${ export fn f(x) { const o = _={ in: { x } x }= return o } }` → DUPLICATE on the 2nd block (`type-system.ts:21266`). |
| `foreign-lang-single-pos` | clean (DUPLICATE + IN-PROGRAM silent) | ONE `<foreign lang="ts" />` library file. Assert `"notCodes": ["E-FOREIGN-LANG-DUPLICATE","E-FOREIGN-LANG-IN-PROGRAM"]`. |
| `foreign-lang-in-program-neg` | **E-FOREIGN-LANG-IN-PROGRAM** fires | a file with a top-level `<program>…</program>` AND a top-level `<foreign lang="ts" />` block → IN-PROGRAM (`type-system.ts:21247`). The two don't stack (§23.6.1). |

### conformance/cases/meta/  (existing dir — siblings of meta-emit-clean-pos)

| dir | code | shape |
|---|---|---|
| `meta-eval-runtime-error-neg` | **E-META-EVAL-001** fires | a `^{ … }` block whose body THROWS at compile-time eval, e.g. `^{ throw new Error("boom") }` or `^{ notDefined() }` (ReferenceError). `new Function(...)` call throws → E-META-EVAL-001 (`meta-eval.ts:466`). |
| `meta-eval-reparse-error-neg` | **E-META-EVAL-002** fires | a `^{ emit("…") }` where eval SUCCEEDS but the EMITTED string fails to re-parse, e.g. `^{ emit("<div") }` (unterminated) — iterate until the emitted markup specifically triggers the re-parse failure (`meta-eval.ts:392/404`) and NOT E-META-EVAL-001. |
| `meta-eval-clean-pos` | clean (001 + 002 silent) | `^{ emit("<p>ok</p>") }`. Assert `"notCodePrefixes": ["E-META-EVAL-"]`. |

## TWO DIVERGENCES — author to the IMPL, FLAG for escalation (do NOT decide)

The ss74 work-list DESCRIPTIONS diverge from the actual impl on two codes. **Author the
cases to the IMPL behavior** (impl#1 is the codes-half ground truth), and in your final
report, flag each so the PA can reconcile the list/SPEC:

1. **E-FOREIGN-006** — the list says "crosses a **client/server boundary**". The impl at
   `emit-logic.ts:2980` fires on a **crossing NAME that the slice redeclares**
   (crossing-shadow, §23.2.4a), NOT a client/server boundary. Author the crossing-shadow
   case. In `description`/`rationale`, cite **§23.2.4a**; if SPEC §23.2.4a describes
   something materially different, note it in your report (do not silently reconcile).
2. **E-FOREIGN-003** — the list says "a foreign block with **no content**". The impl at
   `type-system.ts:21748` fires on "foreign code block has **no `lang=` declaration** in
   any ancestor `<program>`" — a MISSING-LANG check, not empty-content. Author the
   missing-lang case.

Also: **any other impl-vs-SPEC divergence you hit while authoring → report it, don't
decide it.** (E.g. if `<program lang="python">` or `<foreign lang="python" />` is
rejected by some OTHER check before reaching E-FOREIGN-005, report the blocker.)

## Definition of done

- 12 case dirs authored (9 foreign + 3 meta), each `case.scrml` + `expected.json`.
- All 8 codes have a firing `-neg` case; each is covered clean by a `-pos` case.
- `bun conformance/run.ts` ends green (605/605 expected — 593 + 12). Paste the final line.
- Report: (a) per-case one-line confirmation the target code fired/was-absent; (b) the two
  divergences above (+ any new ones); (c) final green count.

## Scope guard

ONLY add files under `conformance/cases/foreign/` and `conformance/cases/meta/`. Do NOT
touch compiler source, SPEC, or any other case. Do NOT commit (the sPA lands on `spa/ss74`).
