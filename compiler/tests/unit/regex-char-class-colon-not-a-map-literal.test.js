/* SPDX-License-Identifier: MIT
 *
 * Unit — g-regex-char-class-colon-mislowered-as-map-literal (S411).
 *
 * §59.3's map-literal recognizer runs as a SOURCE-TEXT preprocessor
 * (`preprocessMapLiterals`, expression-parser.ts) BEFORE acorn, so it sees text and
 * not a tree. A `:` inside a regex CHARACTER CLASS is an ordinary character, but it
 * satisfied the depth-1 entry-colon test, so `/[A-Za-z0-9_\-:@]/` was rewritten to
 * `__scrml_map_lit__(…)` — emitting a syntactically valid regex that matches the
 * literal text of that call and is therefore FALSE for every ordinary input.
 * Compiled at exit 0 with zero diagnostics: `semantics-changed`, silent-wrong.
 *
 * ⚑ THIS IS THE DEFECT THAT CAUSED THE S406 HOST LOCKUP. `compiler/self-host/tab.scrml`'s
 * `isAttrIdentPart` became always-false, so `tokenizeAttributes`' attribute-name scan
 * never advanced `pos` and the enclosing loop re-entered forever while pushing a token
 * each pass — an unbounded allocator reaching ~82 GB and taking the machine down.
 *
 * The fix skips regex-literal and comment interiors in that scanner, mirroring the
 * GITI-017 twin already in the same file (`regexAllowedAfter` + `scanRegexLiteralEnd`)
 * rather than inventing a second regex-vs-division heuristic that could drift from it.
 *
 * ⚑ THE NEGATIVES BELOW ARE LOAD-BEARING. The fix makes the scanner SKIP regions it
 * used to process, so the failure direction to guard is a real map literal going
 * unrewritten — which is why the map cases are pinned alongside the regex cases.
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
/**
 * Compile a source and return its emitted JS.
 *
 * ⚑ `browser`, not `library`. A map literal inside a `fn` body does NOT lower under
 * `mode:"library"` — it fails `E-CODEGEN-INVALID-LOGIC` identically on origin/main and
 * on this branch (A/B-verified), so that is a pre-existing limitation and NOT this
 * fix's doing. Pinning the map negatives in library mode would have made this file red
 * for a reason it does not own, and would have read as "the fix broke maps".
 * Filed separately as `g-map-literal-in-fn-body-does-not-lower-in-library-mode`.
 */
function emit(source, name) {
  TMP = TMP || mkdtempSync(join(tmpdir(), "rx-class-colon-"));
  const file = join(TMP, `${name}.scrml`);
  writeFileSync(file, source.endsWith("\n") ? source : source + "\n");
  const outDir = join(TMP, `${name}.dist`);
  const r = compileScrml({
    inputFiles: [file], outputDir: outDir, mode: "browser",
    write: true, verbose: false, log: () => {},
  });
  let js = "";
  try {
    for (const f of readdirSync(outDir)) {
      if (f.endsWith(".js")) js += readFileSync(join(outDir, f), "utf8");
    }
  } catch { /* no artifact */ }
  return { js, errors: r.errors || [] };
}

describe("a colon in a regex character class is not a map literal (S411)", () => {
  test("the reported shape — `/[a-z:@]/` survives codegen intact", () => {
    const { js, errors } = emit(
      `\${\n  export fn hasColonClass(c) { return /[a-z:@]/.test(c) }\n}`,
      "colon-class",
    );
    expect(errors.length).toBe(0);
    expect(js).toContain("/[a-z:@]/");
    // The exact mangling this gap is about.
    expect(js).not.toContain("__scrml_map_lit__");
  });

  test("the self-host shape verbatim — `/[A-Za-z0-9_\\-:@]/`", () => {
    // Byte-for-byte the `isAttrIdentPart` body from compiler/self-host/tab.scrml,
    // whose mangling produced the 82 GB runaway.
    const { js, errors } = emit(
      `\${\n  export fn isAttrIdentPart(c) { return /[A-Za-z0-9_\\-:@]/.test(c) }\n}`,
      "selfhost-shape",
    );
    expect(errors.length).toBe(0);
    expect(js).toContain("/[A-Za-z0-9_\\-:@]/");
    expect(js).not.toContain("__scrml_map_lit__");
  });

  test("CONTROL — the same class without a colon was never affected", () => {
    const { js } = emit(`\${\n  export fn noColon(c) { return /[a-z@]/.test(c) }\n}`, "no-colon");
    expect(js).toContain("/[a-z@]/");
  });

  test("CONTROL — a colon OUTSIDE a character class was never affected", () => {
    const { js } = emit(`\${\n  export fn outside(c) { return /a:b/.test(c) }\n}`, "colon-outside");
    expect(js).toContain("/a:b/");
  });

  // --- the direction the fix could break: skipped regions ------------------------
  test("NEGATIVE — a real map literal still lowers (the scanner did not over-skip)", () => {
    const { js, errors } = emit(
      `\${\n  export fn realMap() { let m = ["k": 1, "j": 2]; return m }\n}`,
      "real-map",
    );
    expect(errors.length).toBe(0);
    // The map literal must STILL be rewritten — skipping too much would leave it raw
    // and acorn would reject it, or worse it would change meaning silently.
    expect(js).toContain("_scrml_map");
  });

  test("NEGATIVE — an empty map literal `[:]` still lowers", () => {
    const { errors } = emit(
      `\${\n  export fn emptyMap() { let m = [:]; return m }\n}`,
      "empty-map",
    );
    expect(errors.length).toBe(0);
  });

  test("NEGATIVE — a ternary colon is still not read as a map entry", () => {
    const { js, errors } = emit(
      `\${\n  export fn tern(a) { let x = [a ? 1 : 2]; return x }\n}`,
      "ternary",
    );
    expect(errors.length).toBe(0);
    expect(js).toContain("?");
  });

  test("NEGATIVE — division is not mistaken for a regex opener", () => {
    // `regexAllowedAfter` returns false after an identifier, so `b / c` stays
    // division and the map literal AFTER it is still rewritten. If the scanner
    // wrongly treated `/` as a regex opener it would swallow to the next `/`.
    const { js, errors } = emit(
      `\${\n  export fn divThenMap(b, c) { let q = b / c; let m = ["k": q]; return m }\n}`,
      "div-then-map",
    );
    expect(errors.length).toBe(0);
    expect(js).toContain("_scrml_map");
  });
});
