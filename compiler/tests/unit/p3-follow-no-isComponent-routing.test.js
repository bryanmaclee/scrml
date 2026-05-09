/**
 * P3-FOLLOW — Migration Invariant Test
 *
 * Asserts that no compiler-source file routes on the legacy `isComponent`
 * boolean for state-type / component decisions. The migration goal is:
 *
 *   - NR (Stage 3.05) stamps `resolvedKind` / `resolvedCategory` on every
 *     tag-bearing AST node.
 *   - Downstream stages (CE, type-system, validators, codegen) READ those
 *     fields for routing decisions.
 *   - The legacy `isComponent` boolean is retained as a *derived backcompat
 *     field* — stamped by BS/TAB at the boundary, but no longer read as the
 *     authoritative routing signal.
 *
 * This test grep-asserts the source tree to catch regressions where a
 * future change introduces a new isComponent-routing read site outside
 * the explicitly-allowed list.
 *
 * Allowed sites (verified line-by-line at migration time):
 *
 *   compiler/src/block-splitter.js
 *     - WRITE-side: BS stamps `isComp` from uppercase first char and
 *       propagates it as `isComponent` on emitted blocks.
 *
 *   compiler/src/ast-builder.js
 *     - WRITE-side: ast-builder copies BS's `isComp` onto markup nodes as
 *       `isComponent: <bool>`. Some intra-stage reads (line 670, 7212, 7226)
 *       look at peer block flags during TAB construction — pre-NR, so
 *       `isComponent` is the correct syntactic source there.
 *     - parseAttributes() takes a local boolean parameter named `isComponent`
 *       — that's a function param, not a routing read.
 *
 *   compiler/src/module-resolver.js
 *     - WRITE-side: stamps `info.isComponent` derived from PascalCase + kind.
 *
 *   compiler/src/component-expander.ts
 *     - WRITE-side: synthesized nodes carry `isComponent: false` for HTML
 *       and `isComponent: true` for the bare-component-ref re-parse path.
 *     - Re-parse find-first path (line ~2267): operates on a freshly-
 *       constructed mini-AST (BS+TAB only — no NR), so `isComponent` is
 *       the correct syntactic predicate. (See in-file comment.)
 *     - The helper isUserComponentMarkup() at the top of the file is the
 *       NR-prefer-with-fallback predicate; routing reads call it.
 *
 *   compiler/src/types/ast.ts
 *     - DECLARES the `isComponent: boolean` field on MarkupNode for shape
 *       backcompat. Marked with deprecation note pointing at resolvedKind.
 *
 *   compiler/src/gauntlet-phase1-checks.js
 *     - Pre-NR check (operates on BS blocks before AST is fully built).
 *
 *   compiler/src/api.js
 *     - Doc comments referencing the historical isComponent path.
 *
 *   compiler/src/name-resolver.ts
 *     - Type field declaration on input interface (legacy registry shape)
 *       and a fallback-only consumer at line ~430 (older registry entries).
 *     - Doc comments referencing the historical isComponent path.
 *
 *   compiler/src/validators/post-ce-invariant.ts
 *     - No remaining isComponent reads (migrated to resolvedKind).
 *
 *   compiler/src/type-system.ts
 *     - No remaining isComponent reads (migrated to resolvedCategory).
 *
 * Disallowed: any new file or new read site outside this allowlist that
 * checks `node.isComponent === true` (or equivalent) as a routing decision.
 */

import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SRC_DIR = join(__dirname, "../../src");

// Files explicitly allowed to mention isComponent (write-side, doc, or
// pre-NR syntactic predicates). Each entry is a relative path under
// compiler/src/ plus an upper bound on the count of `isComponent` matches.
// The upper bound is a smoke-test: if it grows the migration may have
// regressed; reviewer must look.
const ALLOWED = {
  "block-splitter.js": 18,         // 14 stamps + doc comments
  "ast-builder.js": 25,            // 20 stamps + parseAttributes param + comments
  "module-resolver.js": 8,         // info.isComponent stamp + doc + signature mentions
  "component-expander.ts": 20,     // helper + write-side stamps + doc + re-parse fallback
  "gauntlet-phase1-checks.js": 5,  // pre-NR check + doc
  "api.js": 5,                     // doc comments only
  "name-resolver.ts": 10,          // type field + fallback consumer + doc
  "types/ast.ts": 5,               // field declaration + deprecation note
  "validators/post-ce-invariant.ts": 7, // doc comments only — no code reads
  "type-system.ts": 2,             // single doc-comment line
  "symbol-table.ts": 8,            // type-signature mentions only — registry value
                                   // shape `{kind, category, isComponent}` from MOD's
                                   // exportRegistry; B4 imports the type but never
                                   // reads `.isComponent` for routing decisions. S75
                                   // path-shape fix added 2 mentions: one in the new
                                   // `lookupExportRegistry` helper's signature, one in
                                   // its return type — both are pure type-shape, no
                                   // routing reads.
  // C15 — exportRegistry plumbing into codegen carries the same value
  // shape `{kind, category, isComponent}` as MOD's registry entries. The
  // `isComponent` field appears in the TYPE ANNOTATION only; codegen
  // routing reads `category` (e.g. `=== "engine"`) — never `.isComponent`.
  "codegen/context.ts": 2,         // type-signature mention only (CompileContext.exportRegistry shape)
  "codegen/index.ts": 2,           // type-signature mention only (CgInput.exportRegistry shape)
  "codegen/emit-engine.ts": 3,     // type-signature mentions + lookupSourceMap path-shape comment
  // (state-type-routing.ts deleted by P3-FOLLOW.)
};

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listFiles(full));
    } else if (full.endsWith(".js") || full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function countOccurrences(text, needle) {
  let n = 0;
  let i = 0;
  while ((i = text.indexOf(needle, i)) !== -1) {
    n++;
    i += needle.length;
  }
  return n;
}

/**
 * Strip line and block comments so we can count code-only occurrences.
 * (Approximate — does not handle string-literals containing `//` etc., but
 * good enough for an isComponent-as-routing-signal check.)
 */
function stripComments(text) {
  // Remove block comments
  let out = text.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove line comments
  out = out.replace(/\/\/[^\n]*/g, "");
  return out;
}

describe("P3-FOLLOW: isComponent routing reads are bounded", () => {
  test("each compiler/src/ file's isComponent count is within its allowlist budget", () => {
    const files = listFiles(SRC_DIR);
    const violations = [];
    for (const file of files) {
      const rel = relative(SRC_DIR, file);
      const text = readFileSync(file, "utf8");
      const count = countOccurrences(text, "isComponent");
      if (count === 0) continue; // file doesn't mention isComponent — fine
      if (!(rel in ALLOWED)) {
        violations.push(
          `New file uses isComponent (${count} occurrences): ${rel}. ` +
          `If this is a routing read, migrate to NR's resolvedKind / resolvedCategory ` +
          `(see compiler/src/component-expander.ts isUserComponentMarkup() helper). ` +
          `If this is a write-side stamp or pre-NR syntactic check, add this file to ` +
          `the ALLOWED list with an appropriate budget.`
        );
        continue;
      }
      const budget = ALLOWED[rel];
      if (count > budget) {
        violations.push(
          `${rel}: ${count} isComponent occurrences exceed budget of ${budget}. ` +
          `If the new occurrences are routing reads, migrate to resolvedKind. ` +
          `If they are doc/comments/write-side, raise the budget.`
        );
      }
    }
    if (violations.length > 0) {
      throw new Error(
        "P3-FOLLOW migration regressions detected:\n" +
        violations.map((v) => "  - " + v).join("\n")
      );
    }
  });

  test("validators/post-ce-invariant.ts has no isComponent CODE reads (doc comments allowed)", () => {
    const file = join(SRC_DIR, "validators/post-ce-invariant.ts");
    const text = readFileSync(file, "utf8");
    const codeOnly = stripComments(text);
    expect(countOccurrences(codeOnly, "isComponent")).toBe(0);
  });

  test("type-system.ts has no isComponent CODE reads (doc comments allowed)", () => {
    const file = join(SRC_DIR, "type-system.ts");
    const text = readFileSync(file, "utf8");
    const codeOnly = stripComments(text);
    expect(countOccurrences(codeOnly, "isComponent")).toBe(0);
  });

  test("state-type-routing.ts has been deleted (transitional file disposed)", () => {
    let exists = false;
    try {
      statSync(join(SRC_DIR, "state-type-routing.ts"));
      exists = true;
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});
