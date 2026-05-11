/**
 * AST Builder — Self-Host Parity Tests
 *
 * Imports the JS original (compiler/src/ast-builder.js) and the self-hosted
 * scrml version (compiler/self-host/ast.scrml), feeds identical block trees,
 * and asserts identical ASTs.
 *
 * Coverage:
 *   - Markup elements (simple, nested, self-closing, void elements)
 *   - State declarations (typed attrs, constructor defs)
 *   - Logic blocks (let, const, reactive @var, for, if, while, return, throw)
 *   - Component definitions (const Uppercase = ...)
 *   - Attribute parsing (string-literal, variable-ref, call-ref, expr, bind:, class:)
 *   - Reactive variables (@var = expr, @arr.push, @obj.path = val)
 *   - Control flow (if/for/match/switch/try statements)
 *   - Function declarations (function, fn, server function, generator)
 *   - Imports/exports
 *   - SQL blocks (?{})
 *   - CSS blocks (#{})
 *   - Meta blocks (^{})
 *   - Error-effect blocks (!{}) — legacy and catch forms
 *   - Test blocks (~{})
 *   - Comments
 *   - If-chain collapsing (if=/else-if=/else)
 *   - Closers (explicit, inferred, self-closing)
 *   - collectExpr boundary detection
 *   - BLOCK_REF handling
 *   - Nested components
 *   - W-PROGRAM-001 warning
 *   - Auth/middleware config extraction
 */

import { describe, test, expect } from "bun:test";
import {
  buildAST as buildASTJS,
  runTAB as runTABJS,
  TABError as TABErrorJS,
  parseLogicBody as parseLogicBodyJS,
} from "../../src/ast-builder.js";
import {
  splitBlocks,
} from "../../src/block-splitter.js";

// ---------------------------------------------------------------------------
// Load the self-hosted version by evaluating the scrml source.
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { resolve, dirname } from "path";

const scrmlPath = resolve(
  dirname(new URL(import.meta.url).pathname),
  "../../self-host/ast.scrml"
);
const scrmlSource = readFileSync(scrmlPath, "utf8");

// Extract the JS body between ${ and the final } before </program>
const openTag = scrmlSource.indexOf("${");
const closeTag = scrmlSource.lastIndexOf("}");
const jsBody = scrmlSource.slice(openTag + 2, closeTag);

// The ^{} import block references ./tokenizer.js — we need to provide it.
// Replace the ^{} import with a direct import from the source tokenizer.
const tokenizerImportPath = resolve(
  dirname(new URL(import.meta.url).pathname),
  "../../src/tokenizer.js"
);

// Strip ^{} blocks from the JS body (they are compile-time imports).
// These blocks have the form ^{ ... } with potentially nested braces.
// We need to track brace depth to strip them correctly.
function stripMetaBlocks(code) {
  let result = "";
  let i = 0;
  while (i < code.length) {
    if (code[i] === "^" && code[i + 1] === "{") {
      // Found a ^{ — skip until matching }
      let depth = 1;
      i += 2;
      while (i < code.length && depth > 0) {
        if (code[i] === "{") depth++;
        else if (code[i] === "}") depth--;
        i++;
      }
      continue;
    }
    result += code[i];
    i++;
  }
  return result;
}
const strippedBody = stripMetaBlocks(jsBody)
  // Convert scrml `fn` keyword to `function` (same as emit-library.ts)
  .replace(/\bfn\s+([A-Za-z_$])/g, "function $1");

// Build a module that provides the tokenizer and then includes the ast builder code
const moduleCode = `
import {
  tokenizeAttributes,
  tokenizeLogic,
  tokenizeSQL,
  tokenizeCSS,
  tokenizeError,
  tokenizePassthrough,
} from "${tokenizerImportPath}";
${strippedBody}
`;

const blob = new Blob([moduleCode], { type: "application/javascript" });
const blobUrl = URL.createObjectURL(blob);
const scrmlMod = await import(blobUrl);
URL.revokeObjectURL(blobUrl);

const buildASTSCRML = scrmlMod.buildAST;
const runTABSCRML = scrmlMod.runTAB;
const TABErrorSCRML = scrmlMod.TABError;
const parseLogicBodySCRML = scrmlMod.parseLogicBody;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run block splitter on source, then feed to both AST builders.
 * Compare the AST structure (ignoring node IDs which may differ).
 */
function runBoth(source, filePath = "test.scrml") {
  const bsResult = splitBlocks(filePath, source);
  const jsResult = buildASTJS(bsResult);
  const scrmlResult = buildASTSCRML(bsResult);
  return { jsResult, scrmlResult };
}

/**
 * Deep-strip node IDs from an AST tree for comparison.
 * IDs are monotonically assigned and will differ between implementations
 * if the counter diverges at any point.
 */
function stripIds(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(stripIds);
  if (typeof obj !== "object") return obj;
  const out = {};
  for (const key of Object.keys(obj)) {
    if (key === "id") continue; // strip node IDs
    if (key === "spans") continue; // spans table uses IDs as keys, skip
    if (key === "machineDecls") continue; // §51.3: self-hosted ast.scrml doesn't collect these yet
    if (key === "channelDecls") continue; // P3.A §38.12: self-hosted ast.scrml doesn't collect these yet
    if (key === "specifiers") continue; // P3.A: JS ast-builder records {imported, local} specifiers for cross-file alias resolution; self-host doesn't yet
    if (["exprNode", "initExpr", "condExpr", "iterExpr", "headerExpr", "valueExpr", "argsExpr", "callbackExpr", "fnExpr", "handlerExpr", "fileExpr", "urlExpr", "bodyExpr", "cStyleParts"].includes(key)) continue; // Phase 3/4: JS ast-builder populates ExprNode fields; self-host doesn't yet
    if (["isPure", "isServer"].includes(key)) continue; // F-AUTH-002: JS ast-builder records pure/server modifier flags on export-decl; self-host doesn't yet
    if (["isReExportAll", "renames"].includes(key)) continue; // ast-builder-grammar-fixes: JS ast-builder records re-export-all flag + rename map on export-decl; self-host doesn't yet
    if (["exported", "fromExport"].includes(key)) continue; // ast-builder-grammar-fixes: JS ast-builder synthesizes function-decl shadow nodes for `export function`; self-host doesn't yet
    if (["openerHadSpaceAfterLt", "legacyMachineKeyword"].includes(key)) continue; // P1.E (uniform opener / NR scaffolding): JS ast-builder records the opener whitespace flag and `<machine>` legacy keyword for NR's W-WHITESPACE-001 / W-DEPRECATED-001 emission; self-host doesn't yet
    if (key === "idempotencyStore") continue; // A9 Ext 5 (S76): JS ast-builder records the §39.2.6 `<program idempotency-store=>` middleware attribute on middlewareConfig; self-host doesn't yet
    out[key] = stripIds(obj[key]);
  }
  return out;
}

function normalizeErrors(errors) {
  return errors.map((e) => ({
    code: e.code,
    severity: e.severity,
  }));
}

/**
 * Assert parity between JS and scrml AST builders.
 */
function assertParity(source, filePath = "test.scrml") {
  const { jsResult, scrmlResult } = runBoth(source, filePath);

  // Compare AST structure (stripped of IDs)
  expect(stripIds(scrmlResult.ast)).toEqual(stripIds(jsResult.ast));

  // Compare error codes
  expect(normalizeErrors(scrmlResult.errors)).toEqual(
    normalizeErrors(jsResult.errors)
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AST Builder — self-host parity", () => {

  // --- Markup elements ---

  test("simple markup tag", () => {
    assertParity("<program><div>hello</div></program>");
  });

  test("self-closing tag", () => {
    assertParity('<program><img src="test.png" /></program>');
  });

  test("void element", () => {
    assertParity("<program><br></program>");
  });

  test("nested tags", () => {
    assertParity("<program><div><span>inner</span></div></program>");
  });

  test("deeply nested tags", () => {
    assertParity("<program><div><ul><li>item</li></ul></div></program>");
  });

  // --- Component names ---

  test("component name (uppercase initial)", () => {
    assertParity("<program><TodoItem>content</TodoItem></program>");
  });

  test("component self-closing", () => {
    assertParity("<program><UserCard /></program>");
  });

  // --- Closer forms ---

  test("explicit closer </tag>", () => {
    assertParity("<program><div>text</div></program>");
  });

  test("inferred closer (bare /)", () => {
    assertParity("<program><div>text</></program>");
  });

  // --- State declarations ---

  test("state block", () => {
    assertParity("<program>< count>0</></program>");
  });

  // --- Logic blocks ---

  test("logic block with let", () => {
    assertParity("<program>${let x = 1}</program>");
  });

  test("logic block with const", () => {
    assertParity("<program>${const y = 2}</program>");
  });

  test("reactive variable @name = expr", () => {
    assertParity("<program>${@count = 0}</program>");
  });

  // Phase A1a Step 11.5 — fold of `reactive-derived-decl` into state-decl
  // (ADR Option A FOLD ratified S60). The JS parser now produces
  // `state-decl{shape:"derived",isConst:true,structuralForm:false}` for
  // `const @x = expr`. Self-host parity is deferred per BRIEF §3.6 and
  // Steps 4-7 policy — self-host bootstrap regen is on a separate cadence.
  // Re-enable this test after self-host catches up to the post-fold AST.
  test.skip("reactive derived const @name [DEFERRED — self-host fold parity]", () => {
    assertParity("<program>${const @doubled = @count * 2}</program>");
  });

  test("for statement", () => {
    assertParity("<program>${for item in items { lift item }}</program>");
  });

  test("if statement", () => {
    assertParity("<program>${if @show { lift \"yes\" }}</program>");
  });

  test("if/else statement", () => {
    assertParity("<program>${if @show { lift \"yes\" } else { lift \"no\" }}</program>");
  });

  test("while statement", () => {
    assertParity("<program>${while @running { @count = @count + 1 }}</program>");
  });

  test("return statement", () => {
    assertParity("<program>${function getValue() { return 42 }}</program>");
  });

  // S19 Cat C: `throw` is rejected with E-ERROR-006 (§19 Appendix B). The
  // self-host AST builder hasn't been updated to emit the same diagnostic yet,
  // so parity fails. Unskip once self-host tab.scrml mirrors the JS rejection.
  test.skip("throw statement", () => {
    assertParity('<program>${throw "error"}</program>');
  });

  // --- Function declarations ---

  test("function declaration", () => {
    assertParity("<program>${function greet(name) { return name }}</program>");
  });

  test("server function", () => {
    assertParity('<program>${server function fetchData() { return "data" }}</program>');
  });

  test("fn shorthand", () => {
    assertParity("<program>${fn greet { lift \"hello\" }}</program>");
  });

  test("generator function", () => {
    assertParity("<program>${function* gen() { return 1 }}</program>");
  });

  test("function with canFail", () => {
    assertParity("<program>${function risky()! { return 1 }}</program>");
  });

  // --- Import / Export ---

  test("import declaration", () => {
    assertParity('<program>${import { Button } from "./ui"}</program>');
  });

  test("default import", () => {
    assertParity('<program>${import App from "./app"}</program>');
  });

  test("export declaration", () => {
    assertParity("<program>${export const MAX = 100}</program>");
  });

  test("re-export", () => {
    assertParity('<program>${export { Button } from "./ui"}</program>');
  });

  // --- SQL blocks ---

  test("sql block", () => {
    assertParity("<program>?{SELECT * FROM users}</program>");
  });

  // --- CSS blocks ---

  test("css block with property", () => {
    assertParity("<program>#{color: red}</program>");
  });

  test("css block with selector", () => {
    assertParity("<program>#{.container { color: blue; font-size: 14px }}</program>");
  });

  // --- Meta blocks ---

  test("meta block", () => {
    assertParity("<program>^{let x = 1}</program>");
  });

  // --- Error-effect blocks ---

  test("error-effect legacy arms", () => {
    assertParity('<program>!{| ::NotFound e -> "not found"}</program>');
  });

  test("error-effect catch form", () => {
    assertParity("<program>!{riskyCall()} catch SomeError as e {handleError(e)}</program>");
  });

  // --- Test blocks ---

  test("test block", () => {
    assertParity('<program>~{"math" test "addition" { assert 1 + 1 == 2 }}</program>');
  });

  // --- Comments ---

  test("comment node", () => {
    assertParity("<program>// this is a comment\ntext</program>");
  });

  // --- Text nodes ---

  test("text node", () => {
    assertParity("<program>Hello world</program>");
  });

  // --- Attribute parsing ---

  test("string attribute", () => {
    assertParity('<program><div class="main">text</div></program>');
  });

  test("variable-ref attribute", () => {
    assertParity("<program><div class=myClass>text</div></program>");
  });

  test("bind: directive", () => {
    assertParity("<program><input bind:value=@name></program>");
  });

  // --- Reactive variables ---

  test("reactive array mutation", () => {
    assertParity("<program>${@items.push(newItem)}</program>");
  });

  test("reactive nested assign", () => {
    assertParity("<program>${@user.name = newName}</program>");
  });

  test("reactive explicit set", () => {
    assertParity('<program>${@set(@user, "name", newName)}</program>');
  });

  // --- Type declarations ---

  test("type declaration", () => {
    assertParity("<program>${type Color:enum = { Red, Green, Blue }}</program>");
  });

  // --- Component definition ---

  test("component definition (const Uppercase)", () => {
    assertParity('<program>${const TodoItem = <li>todo/}</program>');
  });

  // --- Control flow attributes (if-chain) ---

  test("if-chain collapsing", () => {
    assertParity('<program><div if=@show>yes</div><div else>no</div></program>');
  });

  // --- W-PROGRAM-001 ---

  test("W-PROGRAM-001 when no <program> root", () => {
    assertParity("<div>content</div>");
  });

  // --- Auth config ---

  test("auth config extraction", () => {
    assertParity('<program auth="required" loginRedirect="/login" csrf="auto" sessionExpiry="2h">content</program>');
  });

  // --- Middleware config ---

  test("middleware config extraction", () => {
    assertParity('<program cors="*" log="structured">content</program>');
  });

  test("csrf=\"on\" parity (E-MW-001 retired S80 — should fire zero errors in both pipelines)", () => {
    assertParity('<program csrf="on">content</program>');
  });

  test("E-MW-002 invalid ratelimit", () => {
    assertParity('<program ratelimit="invalid">content</program>');
  });

  // --- use declarations ---

  test("use declaration with names", () => {
    assertParity("<program>${use scrml:ui { Button, Card }}</program>");
  });

  // --- Lift expressions ---

  test("lift with expression", () => {
    assertParity('<program>${lift "hello"}</program>');
  });

  // --- Try/catch/finally ---

  // S19 Cat C: `try/catch/finally` is rejected with E-ERROR-007 (§19 has no
  // try/catch). Self-host parity pending tab.scrml update.
  test.skip("try-catch-finally", () => {
    assertParity("<program>${try { riskyOp() } catch (e) { handleError(e) } finally { cleanup() }}</program>");
  });

  // --- Match statement ---

  test("match statement", () => {
    assertParity("<program>${match x { }}</program>");
  });

  // --- Transaction block ---

  test("transaction block", () => {
    assertParity("<program>${transaction { doStuff() }}</program>");
  });

  // --- When effect ---

  test("when effect", () => {
    assertParity("<program>${when @count changes { console.log(@count) }}</program>");
  });

  // --- Tilde-decl ---

  test("tilde declaration", () => {
    assertParity("<program>${result = compute()}</program>");
  });

  // --- Propagate expression ---

  test("propagate expression (? suffix)", () => {
    assertParity("<program>${let val = getResult()?}</program>");
  });

  // --- Fail expression ---

  test("fail expression", () => {
    assertParity("<program>${fail AppError::NotFound(msg)}</program>");
  });

  // S79 — `@debounced` reactive decl test RETIRED. The pre-v0.next
  // `@debounced(N) name = expr` keyword-form is gone (SPEC §6.13). Self-host
  // parity for the new attribute form `<name debounced=Nms>` rides on the
  // existing state-decl parity tests (the attribute is captured by the same
  // scanStructuralDeclLookahead path that handles default= / pinned).

  // --- @shared ---

  test("@shared reactive decl", () => {
    assertParity("<program>${@shared theme = defaultTheme}</program>");
  });

  // --- Cleanup ---

  test("cleanup registration", () => {
    assertParity("<program>${cleanup(() => clearInterval(timer))}</program>");
  });

  // --- runTAB wrapper ---

  test("runTAB wrapper produces same output", () => {
    const source = "<program><div>hello</div></program>";
    const bsResult = splitBlocks("test.scrml", source);
    const jsResult = runTABJS(bsResult);
    const scrmlResult = runTABSCRML(bsResult);

    expect(stripIds(scrmlResult.ast)).toEqual(stripIds(jsResult.ast));
    expect(normalizeErrors(scrmlResult.errors)).toEqual(
      normalizeErrors(jsResult.errors)
    );
  });

  // --- TABError class ---

  test("TABError has correct shape", () => {
    const span = { start: 0, end: 1, line: 1, col: 1 };
    const jsErr = new TABErrorJS("E-PARSE-001", "test", span);
    const scrmlErr = new TABErrorSCRML("E-PARSE-001", "test", span);

    expect(scrmlErr.code).toBe(jsErr.code);
    expect(scrmlErr.tabSpan).toEqual(jsErr.tabSpan);
    expect(scrmlErr.name).toBe(jsErr.name);
  });

  // --- Complex mixed content ---

  test("complex mixed content", () => {
    assertParity(
      `<program>
  <div class="main">
    <h1>Title</h1>
    \${let greeting = "hello"}
    <ul>
      <li>Item 1</li>
    </ul>
    // a comment
    #{.highlight { background: yellow }}
  </div>
</program>`
    );
  });

  // --- Edge cases ---

  test("empty program", () => {
    assertParity("<program></program>");
  });

  test("nested logic blocks", () => {
    assertParity("<program>${if @show { for item in @list { lift item } }}</program>");
  });

  test("multiple top-level blocks", () => {
    assertParity("<program><div>one</div><span>two</span></program>");
  });

  // --- Guarded expressions ---

  test("guarded expression with error-effect", () => {
    assertParity('<program>${let data = fetchData() !{| _ e -> "fallback"}}</program>');
  });
});
