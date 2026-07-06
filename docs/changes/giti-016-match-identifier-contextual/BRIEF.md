# BRIEF — GITI-016: make `match` a CONTEXTUAL keyword (usable as an identifier) — Option A (user-ruled S241)

**Ruling:** bryan S241 — **Option A: `match` is contextual** (usable as an identifier, like the `to`/`from`
contextual keywords), NOT reserved. Dispatch AFTER F4 (6nz textarea) lands — clean base, avoid a parser-file
3-way merge.
**Severity:** MED (adopter DX — `match` is the conventional regex-result identifier name; the rename
workaround is an ongoing cost). Adopter: giti (`repro-12`; `match`→`m` workaround retained). Last remaining
giti open bug after GITI-033.
**Class:** loud but MISLEADING — `E-SCOPE-001: Undeclared identifier 'is'` (points at the wrong token).
**Reproduced (R26, PA-side @ `59dc5287`):**
```scrml
${ export function v(raw) {
     const match = raw.match(/x/)
     const name = match is some ? match[1] : "fb"
     return name
} }
```
→ `E-SCOPE-001: Undeclared identifier 'is'`. The `m`-renamed control compiles clean. Repro + control in
`docs/changes/giti-016-match-identifier-contextual/`.

## Root cause (pinned)
`preprocessMatchExprs` (`compiler/src/expression-parser.ts:1813`) scans with `/\bmatch\s+/g` and then grabs
the **next `{` anywhere** (`s.indexOf("{", …)`) as the arm-block, taking everything between as the subject.
So `match is some ? match[1] : "fb"` fires the regex on `match ` (in `match is`), treats `is some ? …` as
the subject, and `is` dangles → E-SCOPE-001. The `const match = …` decl ALSO trips it (`match ` before `=`).
The regex requires `match` + **whitespace**, so `match[1]` / `match.foo` / `match(x)` (no space) are already
NOT matched — the ambiguity is narrower than the general `match(x){}` case: the live failures are `match `
followed by an operator/`is`/`=`.

## The fix — Option A disambiguation (the `:>` arm-block tell)
`match` is the value-return match-expression keyword ONLY when it is `match <subject> { <arms> }` where the
brace block contains **at least one top-level `:>` arm**. Otherwise `match` is an ordinary identifier.

In `preprocessMatchExprs` (and any sibling site — see below), before treating a `\bmatch\s+` hit as a
match-expression, REQUIRE:
1. The matched `{…}` block contains a **top-level `:>`** (the arm separator — §18.2). A value-return match
   ALWAYS has `pattern :> body` arms; a false brace (an object literal, a following code block, an unrelated
   `{`) does not. This is the robust disambiguator.
2. Guard the identifier-usage cases: `match` immediately followed (after the required space) by `is` / `=` /
   a binary operator / `?` / `:` / `,` / `)` → it is an identifier; do NOT preprocess. (Subsumed by #1 in
   most cases, but an explicit early-out keeps the misleading E-SCOPE-001 from ever firing.)
3. The subject scan must not cross a statement boundary (a newline followed by a new `const`/`let`/`return`
   between `match` and the `{` means this is not a match-expression — the `{` belongs to something else).

Also check the fast-path bail at **`expression-parser.ts:767`** (`/::|\?\{|\bmatch\b|\bis\b/.test(expr)`) —
it treats any `match`/`is` as "can't safe-parse." Confirm it doesn't independently break the identifier case
(it may just force the slow path, which is fine — but verify `match is some` reaches a correct parse).

**Scope discipline:** `match` stays a keyword in the STRUCTURAL `<match for=T>` block form (that's markup, a
different parse path — §18.0.1). This change is about the value-return `match expr {}` expression form vs a
bare `match` identifier in logic/expression context. Do NOT touch the `<match>` block parsing.

## Edges the dev MUST verify
1. `const match = raw.match(/x/)` + `match is some ? match[1] : "fb"` (the repro) → compiles, `match` is the
   identifier, `is some` lowers to the absence check.
2. A real value-return match still works: `const label = match @phase { .Idle :> "i"  .Done :> "d" }`.
3. `match` as: a fn param (`function f(match) { return match.x }`), a member (`obj.match`), a call
   (`raw.match(re)`), an array index (`match[1]`), an assignment target.
4. A value-return match whose SUBJECT contains the word `match` (`match user.match { … :> … }`) — nested/inner
   `match` identifier inside a real match-expr subject.
5. `match` immediately followed by `{` with NO subject and NO `:>` (e.g. `match { }` — an object? or malformed)
   — must not misfire.
6. No regression to the existing match-expr corpus (run the full suite + conformance).

## SPEC (Rule 4)
§18.2 (match grammar) + wherever the value-return `match expr {}` is specified. This makes `match` a
**contextual keyword** — mirror the `to`/`from` contextual-keyword language (§14.12 `to`, §21.3 `from`). Add
a normative note: `match` is reserved ONLY in the value-return-expression position (`match <subject> {
<:>-arms> }`) and the `<match>` structural element; elsewhere it is a legal identifier. If a diagnostic is
needed for a genuinely-ambiguous residual, NAME it. Likely a small §18.2 amendment + the impl; author the
SPEC note in the same landing.

## Gate
- Unit tests (`compiler/tests/unit/`): the repro + all 6 edges; emitted `.client.js` `node --check` clean;
  `match is some` lowers to `(match !== null && match !== undefined) ? …`.
- A merge-blocker conformance case (`conformance/`): `match`-as-identifier compiles + runs (codes-half: no
  E-SCOPE-001; runtime-half: the regex-result path returns the right value) AND a real value-return match
  still works (guard against over-disambiguation).
- `bun test compiler/tests/{unit,integration,conformance}` — ZERO delta vs env-floor.
- R26: recompile giti's `ui/repros/repro-12-match-identifier-parse-confusion.scrml` clean.

## Files (expected)
- `compiler/src/expression-parser.ts` (`preprocessMatchExprs` @ 1813 + the :767 fast-path guard + any sibling
  `match`-preprocess site: :945/:1341).
- `compiler/SPEC.md` §18.2 (contextual-keyword note).
- `compiler/tests/unit/` + `conformance/`.

## Dispatch (AFTER F4 lands)
Base = the post-F4 (and post-clean-print if it touched expression-parser.ts) main HEAD. iso: worktree
(S88/S99). S67 file-delta landing. PA-side adversarial `/code-review high` before landing (S239). Do NOT land
to main. Agent: general-purpose (scrml-js-codegen-engineer unavailable this machine), opus.
