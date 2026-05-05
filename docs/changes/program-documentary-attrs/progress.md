# Progress: program-documentary-attrs

## Baseline
- [16:00] Branch `feature-program-documentary-attrs` created from d28f6f7
- [16:00] `bun install` clean (113 packages, 0 errors)
- [16:01] `bun run pretest` clean
- [16:02] `bun run test` baseline:
  - Run 1: 8744 pass / 43 skip / 2 fail (network ECONNREFUSED — flake)
  - Run 2: **8745 pass / 43 skip / 0 fail / 8788 tests** — matches expected baseline
  - Baseline-stable per flake protocol

## Plan
1. Survey: locate `<head>` emission in emit-html.ts, find `<program>` attr extraction path
2. Spec: SPEC.md §40.7 NEW + §34 W-PROGRAM-TITLE-NESTED + SPEC-INDEX entry
3. Impl: codegen/index.ts head injection + warning emission
4. Tests: program-documentary-attrs.test.js (~10 cases)
5. Article: tier-ladder-promotion-devto-2026-05-04.md update + callout
6. Validate: full bun run test, 0 regressions

## Survey Findings (16:10)

**Head emission locus:** NOT in `emit-html.ts`. Lives in `compiler/src/codegen/index.ts` lines 530-555 within the `runCG()` per-file loop.

```ts
// codegen/index.ts:530-555
const base = basename(filePath, ".scrml");
let html: string | null = null;
if (htmlBody) {
  const docParts: string[] = [];
  docParts.push("<!DOCTYPE html>");
  docParts.push("<html lang=\"en\">");
  docParts.push("<head>");
  docParts.push("  <meta charset=\"UTF-8\">");
  docParts.push("  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">");
  docParts.push(`  <title>${escapeHtmlAttr(base)}</title>`);  // <-- default <title> = filename basename
  if (css) {
    docParts.push(`  <link rel="stylesheet" href="${base}.css">`);
  }
  ...
```

**Default `<title>`:** Auto-injects `<title>${basename}</title>` always. Documentary `title=` should override the default.

**Author-written `<title>`:** No special handling — appears as a generic markup tag in `htmlBody` (which goes inside `<body>`). To detect "author-written `<title>`" I scan the AST under the top-level `<program>` for any `kind: "markup", tag: "title"` node. If found, suppress the documentary `title=` (and the default basename `<title>`) entirely.

**Top-level `<program>` AST node:** `nodes.find(n => n.kind === "markup" && n.tag === "program")` — pattern already used in ast-builder.js:8248 for auth config extraction. `.attrs` is array of `{name, value}` where `value` is `{kind: "string-literal", value: "..."}` or `{kind: "variable-ref", name: "..."}`. For documentary attrs, only string-literals are spec-meaningful.

**Nested `<program>` detection:** Walk `nodes` recursively — any `<program>` at depth >= 1. Worker extraction (codegen/index.ts:222) strips workers BEFORE codegen runs. My new pre-pass `detectNestedDocAttrs` runs BEFORE `extractWorkerPrograms` so worker programs are still discoverable.

**Warning emission path:** `errors.push(new CGError(code, msg, span, "warning"))`. The api.js layer routes warnings to `result.warnings` (separate from `result.errors`). Discovered this during test runs — initial test 8/11 failures were because they queried `result.errors` instead of `result.warnings`.

**Design choices:**
- Insert spec section as **§40.7 Documentary Attributes** (after current §40.6 Error Codes), to avoid renumbering churn (§40.3-§40.6 already exist with cross-refs in module-resolver.js to §40.4 / §40.5).
- Empty-string attribute (`title=""`) treated as ABSENT — no emission. Documented in spec normative statement.
- Attribute emission order: title, description, application-version, author, license — fixed deterministic order.
- HTML-escape via existing `escapeHtmlAttr()` helper from `codegen/utils.ts`.
- Default basename `<title>` is suppressed when documentary `title=` is present OR when an author-written `<title>` exists in source.

## Implementation Steps

- [16:14] **Spec — §40.7 NEW** (`compiler/SPEC.md`):
  - +88 lines: §40.7 with attribute table, normative statements, 3 worked examples (top-level / author override / nested-warning), cross-refs to §40.2, §43, §34
  - +1 row in §4.12.9 error table: W-PROGRAM-TITLE-NESTED
  - +1 row in §34 catalog: W-PROGRAM-TITLE-NESTED → §40.7
  - SPEC-INDEX.md +1 Quick Lookup entry
  - Committed: f3bad48

- [16:24] **Implementation — codegen/index.ts** (`compiler/src/codegen/index.ts`):
  - Pre-pass `detectNestedDocAttrs(nodes, depth)` — walks AST before `extractWorkerPrograms`, emits W-PROGRAM-TITLE-NESTED for documentary attrs at depth >= 1
  - Inline at head-emit site: extract 5 documentary attrs from top-level `<program>` via `getDocAttr()`; detect author-written `<title>` via `hasAuthorTitle()` recursive walk
  - Head emission rule: if author `<title>` present → no compiler `<title>`; else if documentary `title=` → use documentary; else → default basename
  - 4 documentary `<meta>` tags emit unconditionally in fixed order
  - Empty-string and non-string-literal values silently ignored
  - Committed: 5af942a

- [16:33] **Tests — program-documentary-attrs.test.js** (NEW):
  - 12 test cases covering: each attr individually (1-3); all 5 together with order check (4); author `<title>` override (5); no-attrs default (6); HTML escape (7); nested `<program title=>` warning (8); nested without doc attrs (9); empty-string fallback (10); per-attr warning multiplicity (11); nested doc attrs not in head (12)
  - **Discovery 1:** Initial run failed test 7 — scrml parser does NOT decode HTML entities in attribute values. The literal text in source becomes the value verbatim. Fixed by using literal `&`, `<`, `>` chars instead of `&amp;`/`&lt;`/`&gt;` source.
  - **Discovery 2:** Initial run failed tests 8 & 11 — warnings route to `result.warnings`, not `result.errors`. Fixed by querying the right field.
  - **Discovery 3:** First-pass run also fired W-ATTR-001 for the 5 documentary attrs (validators/attribute-allowlist.ts looks them up in attribute-registry.js). Registered all 5 in attribute-registry.js (program element). Also added 4 of them to html-elements.js (title was already in GLOBAL_ATTRIBUTES).
  - Final: 12/12 pass
  - Committed: 23c27a7

- [16:50] **Article — tier-ladder-promotion-devto-2026-05-04.md**:
  - First code block now uses `<program title="Counter" description="..." version="0.1.0" license="MIT">`
  - Inserted one-paragraph callout after the first code block describing `<program>` as inline config (middleware + head metadata + execution-context boundary; same wrapper, multiple roles)
  - `published: false` unchanged
  - Committed: 5466f76

## Final Test Results
- **8757 pass / 43 skip / 0 fail / 8800 tests**
- 8745 (baseline) → 8757 = +12 new tests (matches test count exactly)
- 0 regressions

## DoD Checklist
- [x] SPEC.md §40.7 NEW (~80 lines + W-code in §4.12.9 + §34 catalog + SPEC-INDEX entry)
- [x] codegen/index.ts head injection + W-PROGRAM-TITLE-NESTED warning emission
- [x] attribute-registry.js + html-elements.js register the 5 attrs as known on `<program>`
- [x] New test file `program-documentary-attrs.test.js` with 12 cases all green
- [x] Pre-commit hook green; full `bun run test` green at 8757 pass / 43 skip / 0 fail / 8800
- [x] 0 regressions on existing 8745 tests
- [x] Article updated; `published: false` stays
- [x] No `--no-verify`
- [x] progress.md complete with timestamps + survey + design choices + delta
- [x] Branch clean; no modifications to Step 3's exclusion list

## Files Changed (final)
- `compiler/SPEC.md` (+89 lines)
- `compiler/SPEC-INDEX.md` (+1 line)
- `compiler/src/codegen/index.ts` (+114 lines, -1 line)
- `compiler/src/attribute-registry.js` (+6 lines)
- `compiler/src/html-elements.js` (+5 lines)
- `compiler/tests/integration/program-documentary-attrs.test.js` (+239 lines, NEW)
- `docs/articles/tier-ladder-promotion-devto-2026-05-04.md` (+5 lines, -1 line)
- `docs/changes/program-documentary-attrs/progress.md` (this file, NEW)

## Step 3 Exclusion List Compliance
Did NOT touch:
- compiler/src/ast-builder.js
- compiler/src/name-resolver.ts
- compiler/src/type-system.ts
- compiler/tests/integration/parse-shapes-v0next.test.js

(Verified via final `git diff main...feature-program-documentary-attrs --name-only`.)
