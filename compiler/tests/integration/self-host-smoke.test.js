/**
 * Self-Host Smoke Test — Module Resolver
 *
 * Validates that the scrml translation (stdlib/compiler/module-resolver.scrml)
 * implements the same logic as the JS original (compiler/src/module-resolver.js).
 *
 * Strategy: Since compiled .scrml output is currently browser-targeted (no ES
 * module exports), we extract the function bodies from the .scrml source and
 * eval them, then compare outputs against the JS original.
 *
 * Supports two source formats:
 *   - Legacy: <program>${ ... }</program> — all logic in a single ${ } block
 *   - Idiomatic: top-level declarations directly inside <program>
 *
 * When library-mode codegen lands, this test should be updated to import
 * directly from the compiled .scrml output instead of eval-ing.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { resolve, dirname, join } from "path";

// ---------------------------------------------------------------------------
// Resolve paths (works in both main repo and worktrees)
// ---------------------------------------------------------------------------

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));

// Resolve the main project root. In a git worktree, --show-toplevel returns the
// worktree root (which may have only partial files). We need the main working tree
// where the full compiler source lives. Strategy: parse `git worktree list` and
// take the first entry (the main working tree), falling back to --show-toplevel.
function findMainProjectRoot() {
  try {
    const wtList = execSync("git -C " + testDir + " worktree list --porcelain", { encoding: "utf-8" });
    const firstLine = wtList.split("\n").find(l => l.startsWith("worktree "));
    if (firstLine) {
      const mainRoot = firstLine.replace("worktree ", "");
      // Verify the main root has the compiler source
      if (existsSync(resolve(mainRoot, "compiler/src/module-resolver.js"))) {
        return mainRoot;
      }
    }
  } catch { /* fall through */ }
  return execSync(
    "git -C " + testDir + " rev-parse --show-toplevel",
    { encoding: "utf-8" },
  ).trim();
}

// S89: a worktree may have edited the self-host scrml source ahead of the main
// branch. Resolve self-host scrml + TS-reference paths from the LOCAL worktree
// when both exist locally — otherwise fall back to main root. Build-output
// artifacts (compiler/self-host/dist/*.js) always read from main root because
// they are gitignored and only built in main.
function findSelfHostRoot() {
  const localRoot = execSync(
    "git -C " + testDir + " rev-parse --show-toplevel",
    { encoding: "utf-8" },
  ).trim();
  if (
    existsSync(resolve(localRoot, "compiler/src/module-resolver.js")) &&
    existsSync(resolve(localRoot, "stdlib/compiler/module-resolver.scrml"))
  ) {
    return localRoot;
  }
  return findMainProjectRoot();
}

const projectRoot = findMainProjectRoot();
// Self-host root may differ from projectRoot when an agent worktree is editing
// the scrml self-host source ahead of main. Build artifacts (dist/) still come
// from projectRoot.
const selfHostRoot = findSelfHostRoot();
const jsModulePath = resolve(selfHostRoot, "compiler/src/module-resolver.js");
const scrmlFilePath = resolve(selfHostRoot, "stdlib/compiler/module-resolver.scrml");

// ---------------------------------------------------------------------------
// Import the JS original
// ---------------------------------------------------------------------------

const jsModule = await import(jsModulePath);
const {
  buildImportGraph: jsBuildImportGraph,
  detectCircularImports: jsDetectCircularImports,
  topologicalSort: jsTopologicalSort,
  buildExportRegistry: jsBuildExportRegistry,
  validateImports: jsValidateImports,
  resolveModules: jsResolveModules,
  isStdlibImport: jsIsStdlibImport,
} = jsModule;

// ---------------------------------------------------------------------------
// Extract logic from scrml source
//
// Supports two source formats:
//
//   Legacy (${ } block):
//     <program>${ ... export function foo() {} ... }</program>
//     Extract the ${ } block body, strip ^{} meta blocks, strip `export`.
//
//   Idiomatic (top-level declarations):
//     <program>
//     ^{ ... }
//     export function foo() {}
//     export fn bar(x) { expr }
//     </program>
//     Strip <program> tags, strip ^{} meta blocks, strip `export`,
//     rewrite `fn name(p) { expr }` -> `function name(p) { return expr; }`.
//
// In both cases, import.meta.url is replaced with the JS original path
// and the result is wrapped in a Function constructor for eval.
// ---------------------------------------------------------------------------

function extractScrmlLogic() {
  if (!existsSync(scrmlFilePath)) {
    return null;
  }

  const source = readFileSync(scrmlFilePath, "utf-8");

  // Brace-balanced removal of ^{...} meta blocks.
  function removeMetaBlocks(code) {
    let result = "";
    let i = 0;
    while (i < code.length) {
      if (code[i] === "^" && code[i + 1] === "{") {
        let depth = 1;
        i += 2;
        while (i < code.length && depth > 0) {
          if (code[i] === "{") depth++;
          else if (code[i] === "}") depth--;
          i++;
        }
      } else {
        result += code[i];
        i++;
      }
    }
    return result;
  }

  // Rewrite `fn name(params) { body }` to `function name(params) { return body; }`.
  // scrml `fn` has an implicit return — the body is a single expression.
  // This handles the simple case (single-expression body, no nested braces).
  // More complex fn bodies are not expected in this module.
  function rewriteFnKeyword(code) {
    return code.replace(
      /\bfn\s+(\w+)\s*(\([^)]*\))\s*\{([^}]*)\}/g,
      (_, name, params, body) => `function ${name}${params} { return ${body.trim()}; }`,
    );
  }

  // S89 null-eradication self-host: rewrite scrml `not`-syntax to the JS-runtime
  // equivalent emitted by emit-expr.ts. scrml `not` keyword compiles to JS `null`;
  // `is not` compiles to `(x === null || x === undefined)`; `is some` compiles
  // to `(x !== null && x !== undefined)`. This rewriter mirrors that codegen so
  // the eval-extraction harness can validate scrml source that uses the canonical
  // absence-as-`not` form (per S89 user ruling: `null does NOT EXIST IN SCRML`).
  // The transformations are token-boundary aware to avoid mangling identifiers,
  // string literals, or template-literal content.
  function rewriteNotSyntax(code) {
    // Strategy: scan character-by-character, tracking whether we are inside a
    // string/template/comment so we only transform code-level tokens.
    let out = "";
    let i = 0;
    const len = code.length;
    const isIdentChar = (ch) => /[A-Za-z0-9_$]/.test(ch);
    while (i < len) {
      const ch = code[i];
      // Line comment
      if (ch === "/" && code[i + 1] === "/") {
        const nl = code.indexOf("\n", i);
        const end = nl === -1 ? len : nl + 1;
        out += code.substring(i, end);
        i = end;
        continue;
      }
      // Block comment
      if (ch === "/" && code[i + 1] === "*") {
        const e = code.indexOf("*/", i + 2);
        const end = e === -1 ? len : e + 2;
        out += code.substring(i, end);
        i = end;
        continue;
      }
      // String literal (single, double, or backtick)
      if (ch === "\"" || ch === "'" || ch === "`") {
        const quote = ch;
        out += ch;
        i++;
        while (i < len) {
          const c = code[i];
          if (c === "\\") {
            out += c + (code[i + 1] || "");
            i += 2;
            continue;
          }
          if (c === quote) {
            out += c;
            i++;
            break;
          }
          // Template-literal ${...} — recurse trivially: just pass through;
          // the rewriter doesn't need to descend (would only be wrong if user
          // had `not`/`is not`/`is some` inside template interpolation, which
          // scrml's compile-output handles identically per codegen).
          out += c;
          i++;
        }
        continue;
      }
      // Look-ahead for `is not`, `is some`, or bare `not` at a token boundary.
      // Token boundary: previous char is not an identifier char (or start).
      const prevCh = i === 0 ? "" : code[i - 1];
      if (!isIdentChar(prevCh)) {
        // `is some` and `is not not` and `is not` — check in order of length
        // (longest first to avoid `is not` swallowing `is not not`).
        if (code.substr(i, 10) === "is not not" && !isIdentChar(code[i + 10] || "")) {
          // `x is not not` → `(x !== null && x !== undefined)`. We need to
          // restructure with the left operand. Use a regex-replace at the
          // statement level via deferred token: emit a sentinel that the
          // surrounding `LEFT is not not` consumer will recognize. The
          // simplest path: rewrite `(LEFT) is not not` post-hoc with a
          // capturing regex in a separate pass below.
          out += "is not not";
          i += 10;
          continue;
        }
        if (code.substr(i, 7) === "is some" && !isIdentChar(code[i + 7] || "")) {
          out += "is some";
          i += 7;
          continue;
        }
        if (code.substr(i, 6) === "is not" && !isIdentChar(code[i + 6] || "")) {
          out += "is not";
          i += 6;
          continue;
        }
        if (code.substr(i, 3) === "not" && !isIdentChar(code[i + 3] || "")) {
          // Bare `not` → JS `null`. (scrml emit-expr.ts: LitExpr `not` → "null")
          out += "null";
          i += 3;
          continue;
        }
      }
      out += ch;
      i++;
    }
    // Second pass: rewrite `LEFT is some` / `LEFT is not` / `LEFT is not not`
    // into the JS-runtime equivalent. Per emit-expr.ts:
    //   is-not        → (LEFT === null || LEFT === undefined)
    //   is-some       → (LEFT !== null && LEFT !== undefined)
    //   is-not-not    → (LEFT !== null && LEFT !== undefined)
    // LEFT here is the operand on the left — a simple identifier, member
    // access, or parenthesized expression. We restrict to a conservative
    // grammar (identifier with optional `.name` chain or `[idx]` access).
    const operandPat = /([\w$]+(?:\??\.[\w$]+|\[[^\]]+\])*)/.source;
    out = out.replace(
      new RegExp(operandPat + "\\s+is not not\\b", "g"),
      "($1 !== null && $1 !== undefined)",
    );
    out = out.replace(
      new RegExp(operandPat + "\\s+is some\\b", "g"),
      "($1 !== null && $1 !== undefined)",
    );
    out = out.replace(
      new RegExp(operandPat + "\\s+is not\\b", "g"),
      "($1 === null || $1 === undefined)",
    );
    return out;
  }

  // Determine source format. Legacy format has ${ immediately after <program>.
  // Idiomatic format has top-level declarations with no ${ wrapper.
  const logicStart = source.indexOf("${");
  const hasDollarBlock = logicStart !== -1 &&
    source.substring(0, logicStart).replace(/<program[^>]*>/, "").trim() === "";

  let logicBody;

  if (hasDollarBlock) {
    // Legacy: extract body of the ${ } block
    const logicEnd = source.lastIndexOf("}");
    logicBody = source.substring(logicStart + 2, logicEnd);
  } else {
    // Idiomatic: extract everything between <program> and </program>
    const programStart = source.indexOf("<program>");
    const programEnd = source.lastIndexOf("</program>");
    if (programStart === -1 || programEnd === -1) return null;
    logicBody = source.substring(programStart + "<program>".length, programEnd);
  }

  // Strip ^{} meta blocks (async imports we provide manually below)
  logicBody = removeMetaBlocks(logicBody);

  // S89: rewrite scrml `not`/`is not`/`is some` absence-syntax to the JS-runtime
  // equivalent emitted by emit-expr.ts. Done BEFORE `fn` keyword rewrite so
  // any `fn` bodies that use `not` get the substitution.
  logicBody = rewriteNotSyntax(logicBody);

  // Rewrite scrml `fn` keyword to JS `function` with explicit return
  logicBody = rewriteFnKeyword(logicBody);

  // Strip `export` keyword before declarations (class/function/const/let/var/fn)
  logicBody = logicBody.replace(/^(\s*)export\s+(class|function|const|let|var|fn)\b/gm, "$1$2");

  // Replace import.meta.url with a synthetic value — not available inside new Function()
  logicBody = logicBody.replace(
    /import\.meta\.url/g,
    JSON.stringify("file://" + jsModulePath),
  );

  const fnBody = `
      ${logicBody}

      return {
        ModuleError,
        buildImportGraph,
        detectCircularImports,
        topologicalSort,
        buildExportRegistry,
        validateImports,
        resolveModules,
        isStdlibImport,
      };
  `;

  try {
    const fn = new Function(
      "resolve", "dirname", "join", "existsSync",
      fnBody,
    );
    // Pass the modules that ^{} would have provided
    return fn(resolve, dirname, join, existsSync);
  } catch (e) {
    console.error("Failed to eval scrml logic:", e.message);
    if (e.message.includes("Unexpected")) {
      const match = e.message.match(/\((\d+):(\d+)\)/);
      if (match) {
        const lines = fnBody.split("\n");
        const lineNum = parseInt(match[1]) - 1;
        console.error(`Error near line ${lineNum}: ${lines[lineNum]}`);
      }
    }
    return null;
  }
}

const scrmlModule = extractScrmlLogic();

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeFile(filePath, imports = [], exports = []) {
  return {
    filePath,
    ast: {
      filePath,
      imports: imports.map(imp => ({
        kind: "import-decl",
        names: imp.names,
        source: imp.source,
        isDefault: imp.isDefault || false,
        span: { file: filePath, start: 0, end: 0, line: 1, col: 1 },
      })),
      exports: exports.map(exp => ({
        kind: "export-decl",
        exportedName: exp.name,
        exportKind: exp.kind || "type",
        reExportSource: exp.reExportSource || null,
        span: { file: filePath, start: 0, end: 0, line: 1, col: 1 },
      })),
    },
  };
}

/**
 * Compare the output of a JS-original function against the scrml-extracted function.
 * Deep-compares Maps, arrays, and plain objects.
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [key, val] of a) {
      if (!b.has(key) || !deepEqual(val, b.get(key))) return false;
    }
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(k => deepEqual(a[k], b[k]));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Smoke tests — JS vs scrml parity
// ---------------------------------------------------------------------------

describe("self-host smoke: scrml file exists and is parseable", () => {
  test("stdlib/compiler/module-resolver.scrml exists", () => {
    expect(existsSync(scrmlFilePath)).toBe(true);
  });

  test("scrml logic block can be extracted and evaluated", () => {
    expect(scrmlModule).not.toBeNull();
    expect(typeof scrmlModule.buildImportGraph).toBe("function");
    expect(typeof scrmlModule.resolveModules).toBe("function");
    expect(typeof scrmlModule.isStdlibImport).toBe("function");
  });
});

describe("self-host smoke: buildImportGraph parity", () => {
  const files = [
    makeFile("/app/main.scrml", [{ names: ["Foo"], source: "./types.scrml" }]),
    makeFile("/app/types.scrml", [], [{ name: "Foo", kind: "type" }]),
  ];

  test("same graph size", () => {
    if (!scrmlModule) return;
    const jsResult = jsBuildImportGraph(files);
    const scrmlResult = scrmlModule.buildImportGraph(files);
    expect(scrmlResult.graph.size).toBe(jsResult.graph.size);
  });

  test("same import resolution", () => {
    if (!scrmlModule) return;
    const jsResult = jsBuildImportGraph(files);
    const scrmlResult = scrmlModule.buildImportGraph(files);

    const jsMain = jsResult.graph.get("/app/main.scrml");
    const scrmlMain = scrmlResult.graph.get("/app/main.scrml");
    expect(scrmlMain.imports.length).toBe(jsMain.imports.length);
    expect(scrmlMain.imports[0].absSource).toBe(jsMain.imports[0].absSource);
  });

  test("same export collection", () => {
    if (!scrmlModule) return;
    const jsResult = jsBuildImportGraph(files);
    const scrmlResult = scrmlModule.buildImportGraph(files);

    const jsTypes = jsResult.graph.get("/app/types.scrml");
    const scrmlTypes = scrmlResult.graph.get("/app/types.scrml");
    expect(scrmlTypes.exports.length).toBe(jsTypes.exports.length);
    expect(scrmlTypes.exports[0].name).toBe(jsTypes.exports[0].name);
  });
});

describe("self-host smoke: detectCircularImports parity", () => {
  test("both detect A->B->A cycle", () => {
    if (!scrmlModule) return;
    const files = [
      makeFile("/app/a.scrml", [{ names: ["X"], source: "./b.scrml" }]),
      makeFile("/app/b.scrml", [{ names: ["Y"], source: "./a.scrml" }]),
    ];
    const { graph } = jsBuildImportGraph(files);

    const jsErrors = jsDetectCircularImports(graph);
    const scrmlErrors = scrmlModule.detectCircularImports(graph);

    expect(scrmlErrors.length).toBe(jsErrors.length);
    expect(scrmlErrors[0].code).toBe(jsErrors[0].code);
  });

  test("both report no cycle for linear chain", () => {
    if (!scrmlModule) return;
    const files = [
      makeFile("/app/a.scrml", [{ names: ["X"], source: "./b.scrml" }]),
      makeFile("/app/b.scrml"),
    ];
    const { graph } = jsBuildImportGraph(files);

    expect(jsDetectCircularImports(graph)).toHaveLength(0);
    expect(scrmlModule.detectCircularImports(graph)).toHaveLength(0);
  });
});

describe("self-host smoke: topologicalSort parity", () => {
  test("same compilation order for three-file chain", () => {
    if (!scrmlModule) return;
    const files = [
      makeFile("/app/a.scrml", [{ names: ["X"], source: "./b.scrml" }]),
      makeFile("/app/b.scrml", [{ names: ["Y"], source: "./c.scrml" }]),
      makeFile("/app/c.scrml"),
    ];
    const { graph } = jsBuildImportGraph(files);

    const jsOrder = jsTopologicalSort(graph);
    const scrmlOrder = scrmlModule.topologicalSort(graph);

    expect(scrmlOrder).toEqual(jsOrder);
  });
});

describe("self-host smoke: buildExportRegistry parity", () => {
  test("same registry structure", () => {
    if (!scrmlModule) return;
    const files = [
      makeFile("/app/types.scrml", [], [
        { name: "Status", kind: "type" },
        { name: "UserCard", kind: "const" },
        { name: "helper", kind: "function" },
      ]),
    ];
    const { graph } = jsBuildImportGraph(files);

    const jsRegistry = jsBuildExportRegistry(graph);
    const scrmlRegistry = scrmlModule.buildExportRegistry(graph);

    expect(scrmlRegistry.size).toBe(jsRegistry.size);

    const jsNames = jsRegistry.get("/app/types.scrml");
    const scrmlNames = scrmlRegistry.get("/app/types.scrml");
    expect(scrmlNames.size).toBe(jsNames.size);

    // Check isComponent detection (PascalCase const = component)
    expect(scrmlNames.get("UserCard").isComponent).toBe(jsNames.get("UserCard").isComponent);
    expect(scrmlNames.get("helper").isComponent).toBe(jsNames.get("helper").isComponent);
  });
});

describe("self-host smoke: validateImports parity", () => {
  test("both detect missing export", () => {
    if (!scrmlModule) return;
    const files = [
      makeFile("/app/main.scrml", [{ names: ["Missing"], source: "./types.scrml" }]),
      makeFile("/app/types.scrml", [], [{ name: "Present", kind: "type" }]),
    ];
    const { graph } = jsBuildImportGraph(files);
    const registry = jsBuildExportRegistry(graph);

    const jsErrors = jsValidateImports(graph, registry);
    const scrmlErrors = scrmlModule.validateImports(graph, registry);

    expect(scrmlErrors.length).toBe(jsErrors.length);
    expect(scrmlErrors[0].code).toBe(jsErrors[0].code);
    expect(scrmlErrors[0].message).toContain("Missing");
  });
});

describe("self-host smoke: resolveModules full pipeline parity", () => {
  test("same result for two-file dependency", () => {
    if (!scrmlModule) return;
    const files = [
      makeFile("/app/main.scrml", [{ names: ["Status"], source: "./types.scrml" }]),
      makeFile("/app/types.scrml", [], [{ name: "Status", kind: "type" }]),
    ];

    const jsResult = jsResolveModules(files);
    const scrmlResult = scrmlModule.resolveModules(files);

    expect(scrmlResult.errors.length).toBe(jsResult.errors.length);
    expect(scrmlResult.compilationOrder).toEqual(jsResult.compilationOrder);
  });

  test("same result for empty input", () => {
    if (!scrmlModule) return;
    const jsResult = jsResolveModules([]);
    const scrmlResult = scrmlModule.resolveModules([]);

    expect(scrmlResult.errors.length).toBe(jsResult.errors.length);
    expect(scrmlResult.compilationOrder.length).toBe(jsResult.compilationOrder.length);
  });

  test("both detect self-import cycle", () => {
    if (!scrmlModule) return;
    const files = [
      makeFile("/app/self.scrml", [{ names: ["X"], source: "./self.scrml" }], [{ name: "X", kind: "type" }]),
    ];

    const jsResult = jsResolveModules(files);
    const scrmlResult = scrmlModule.resolveModules(files);

    const jsHasCycle = jsResult.errors.some(e => e.code === "E-IMPORT-002");
    const scrmlHasCycle = scrmlResult.errors.some(e => e.code === "E-IMPORT-002");
    expect(scrmlHasCycle).toBe(jsHasCycle);
  });
});

describe("self-host smoke: isStdlibImport parity", () => {
  test("same results for all import types", () => {
    if (!scrmlModule) return;
    const cases = ["scrml:crypto", "scrml:data", "./local.scrml", "vendor:foo", "https://cdn.example.com/lib.js"];

    for (const source of cases) {
      expect(scrmlModule.isStdlibImport(source)).toBe(jsIsStdlibImport(source));
    }
  });
});

// ---------------------------------------------------------------------------
// Compiled output assessment (documents current state for library-mode work)
// ---------------------------------------------------------------------------

describe("self-host smoke: compiled output assessment", () => {
  const distDir = resolve(projectRoot, "stdlib/compiler/dist");

  test("compiled output exists", () => {
    // This may fail if compilation hasn't been run — that's informative
    const htmlExists = existsSync(resolve(distDir, "module-resolver.html"));
    const clientJsExists = existsSync(resolve(distDir, "module-resolver.client.js"));

    if (!htmlExists && !clientJsExists) {
      console.log("No compiled output found — compile with: bun compiler/src/cli.js compile stdlib/compiler/module-resolver.scrml -o stdlib/compiler/dist/");
      return;
    }

    expect(htmlExists).toBe(true);
    expect(clientJsExists).toBe(true);
  });

  test("compiled output is browser-targeted (not library-mode)", () => {
    const htmlPath = resolve(distDir, "module-resolver.html");
    if (!existsSync(htmlPath)) return;

    const html = readFileSync(htmlPath, "utf-8");
    // Current output wraps in a full HTML document — library mode wouldn't do this
    expect(html).toContain("<!DOCTYPE html>");
    // v0.3.x SPA tree-shake Phase B 3.3 — runtime filename is hashed
    // (`scrml-runtime.<hash>.js`). Match either the new hashed shape
    // or the legacy literal (pre-existing dists committed before the
    // Phase B landing may still carry the older name).
    expect(html).toMatch(/<script src="scrml-runtime(?:\.[^"]+)?\.js">/);
  });

  test("compiled output lacks ES module exports (library-mode gap)", () => {
    const clientJsPath = resolve(distDir, "module-resolver.client.js");
    if (!existsSync(clientJsPath)) return;

    const clientJs = readFileSync(clientJsPath, "utf-8");
    // Library mode should have export statements — current output does not
    expect(clientJs).not.toContain("export function");
    expect(clientJs).not.toContain("export class");
    // Current output has broken meta-context eval
    expect(clientJs).toContain("_scrml_meta_effect");
  });
});

// ---------------------------------------------------------------------------
// §B: Block Splitter Self-Host Parity
// ---------------------------------------------------------------------------

describe("Self-host: block-splitter parity", () => {
  const bsDistPath = resolve(projectRoot, "compiler/self-host/dist/bs.js");

  test("compiled bs.js exists", () => {
    expect(existsSync(bsDistPath)).toBe(true);
  });

  test("compiled bs.js exports splitBlocks", async () => {
    if (!existsSync(bsDistPath)) return;
    const mod = await import(bsDistPath);
    expect(typeof mod.splitBlocks).toBe("function");
  });

  test("self-hosted splitBlocks matches JS original on simple input", async () => {
    if (!existsSync(bsDistPath)) return;
    const { splitBlocks: jsSplitBlocks } = await import(resolve(projectRoot, "compiler/src/block-splitter.js"));
    const { splitBlocks: scrmlSplitBlocks } = await import(bsDistPath);

    const testSource = `<program>
<div>hello</div>
\${ let x = 1 }
</program>`;

    const jsResult = jsSplitBlocks("/test.scrml", testSource);
    const scrmlResult = scrmlSplitBlocks("/test.scrml", testSource);

    expect(scrmlResult.blocks.length).toBe(jsResult.blocks.length);
    for (let i = 0; i < jsResult.blocks.length; i++) {
      expect(scrmlResult.blocks[i].type).toBe(jsResult.blocks[i].type);
      expect(scrmlResult.blocks[i].content).toBe(jsResult.blocks[i].content);
    }
  });

  test("self-hosted splitBlocks handles empty program", async () => {
    if (!existsSync(bsDistPath)) return;
    const { splitBlocks: jsSplitBlocks } = await import(resolve(projectRoot, "compiler/src/block-splitter.js"));
    const { splitBlocks: scrmlSplitBlocks } = await import(bsDistPath);

    const testSource = `<program></program>`;
    const jsResult = jsSplitBlocks("/empty.scrml", testSource);
    const scrmlResult = scrmlSplitBlocks("/empty.scrml", testSource);

    expect(scrmlResult.blocks.length).toBe(jsResult.blocks.length);
  });

  test("selfHostModules.splitBlocks slot works in compileScrml", async () => {
    if (!existsSync(bsDistPath)) return;
    const { splitBlocks: scrmlSplitBlocks } = await import(bsDistPath);
    const { compileScrml } = await import(resolve(projectRoot, "compiler/src/api.js"));

    // Compile a sample file with and without self-hosted BS
    const samplePath = resolve(projectRoot, "samples/compilation-tests/hello-world.scrml");
    if (!existsSync(samplePath)) return;

    const jsResult = compileScrml({ inputFiles: [samplePath], write: false });
    const scrmlResult = compileScrml({
      inputFiles: [samplePath],
      write: false,
      selfHostModules: { splitBlocks: scrmlSplitBlocks },
    });

    expect(scrmlResult.errors.length).toBe(jsResult.errors.length);
    expect(scrmlResult.fileCount).toBe(jsResult.fileCount);
  });
});

// ---------------------------------------------------------------------------
// §C: Tokenizer (TAB) Self-Host Parity
// ---------------------------------------------------------------------------

describe("Self-host: tokenizer parity", () => {
  const tabDistPath = resolve(projectRoot, "compiler/self-host/dist/tab.js");

  test("compiled tab.js exists", () => {
    expect(existsSync(tabDistPath)).toBe(true);
  });

  test("compiled tab.js exports tokenizeBlock", async () => {
    if (!existsSync(tabDistPath)) return;
    const mod = await import(tabDistPath);
    expect(typeof mod.tokenizeBlock).toBe("function");
  });

  test("compiled tab.js exports all tokenizer functions", async () => {
    if (!existsSync(tabDistPath)) return;
    const mod = await import(tabDistPath);
    expect(typeof mod.tokenizeAttributes).toBe("function");
    expect(typeof mod.tokenizeLogic).toBe("function");
    expect(typeof mod.tokenizeSQL).toBe("function");
    expect(typeof mod.tokenizeCSS).toBe("function");
    expect(typeof mod.tokenizeError).toBe("function");
    expect(typeof mod.tokenizePassthrough).toBe("function");
    expect(typeof mod.tokenizeBlock).toBe("function");
  });
});
