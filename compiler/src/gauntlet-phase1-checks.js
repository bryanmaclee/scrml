/**
 * Gauntlet Phase 1 — additional declaration / scoping / preamble checks.
 *
 * This module implements the surgical post-TAB checks for diagnostics that
 * the existing pipeline otherwise emits silently. Each check is directly
 * traceable to a repro fixture in
 *   samples/compilation-tests/gauntlet-s19-phase1-decls/
 *
 * Checks emitted here:
 *
 *   E-IMPORT-001 — `export` declaration used outside any `${ }` logic block.
 *                  Only reported for file-level top-level placement (text block
 *                  beginning with the `export` keyword). Requires §21.6.
 *
 *   E-IMPORT-003 — `import` declaration used inside a function body. AST walk
 *                  finds any `import-decl` inside a `function-decl.body` (at
 *                  any depth); §21.6 requires imports at logic-top-level only.
 *                  Also catches the post-fall-through bare-expr form produced
 *                  when `import` appears inside `function ... { ... }` where
 *                  the nested parser has no import handler.
 *
 *   E-SCOPE-010 — File-scope `let` or `const` declared twice with the same
 *                 name. We compare top-level logic-body declarations across
 *                 all `${ }` blocks in the file. §7.6.
 *
 *   E-USE-001  — `use` declaration appearing inside a `${ }` logic block.
 *                `use` is a file-preamble construct. §41.2.2.
 *
 *   E-USE-002  — `use` declaration appearing AFTER the first markup element.
 *                §41.2.2.
 *
 *   E-USE-005  — `use` declaration with an unknown prefix (only `scrml:` and
 *                `vendor:` are legal). §41.
 *
 * All errors use the same shape as TAB/TS diagnostics — `{ code, message,
 * span, severity }` — and are collected into the compiler's global error
 * stream by the api.js driver.
 */

// ---------------------------------------------------------------------------
// Error class — matches TABError shape for uniform collection in api.js
// ---------------------------------------------------------------------------

class GauntletError {
  constructor(code, message, span, severity = "error") {
    this.code = code;
    this.message = message;
    this.span = span;
    this.severity = severity;
  }
}

// ---------------------------------------------------------------------------
// Span helpers
// ---------------------------------------------------------------------------

/**
 * Compute a span that points at the first non-whitespace offset within a
 * text block. Keeps the diagnostic pointing at the offending keyword rather
 * than the leading whitespace / comment run.
 */
function keywordSpan(block, filePath) {
  if (!block || !block.span) return { file: filePath, start: 0, end: 0, line: 1, col: 1 };
  const raw = block.raw ?? "";
  let offset = 0;
  let line = block.span.line;
  let col = block.span.col;
  while (offset < raw.length) {
    const ch = raw[offset];
    if (ch === " " || ch === "\t" || ch === "\r") {
      col++;
      offset++;
    } else if (ch === "\n") {
      line++;
      col = 1;
      offset++;
    } else {
      break;
    }
  }
  return {
    file: filePath,
    start: block.span.start + offset,
    end: block.span.end,
    line,
    col,
  };
}

// ---------------------------------------------------------------------------
// Check 1 — top-level text blocks: `export`, `use` (E-IMPORT-001, E-USE-*)
// ---------------------------------------------------------------------------

/**
 * Scan the top-level block list (file root) for text blocks that begin with a
 * preamble-only keyword misplaced outside any `${ }` context. Also tracks
 * whether a markup element has already been emitted so we can report
 * E-USE-002 for `use` lines that appear after markup.
 *
 * @param {object[]} blocks — BS output blocks (top-level, unlifted)
 * @param {string}   filePath
 * @param {GauntletError[]} errors
 */
function checkTopLevelTextPreamble(blocks, filePath, errors) {
  let sawMarkup = false;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block) continue;

    if (block.type === "markup") {
      sawMarkup = true;
      continue;
    }

    if (block.type !== "text") continue;
    const raw = block.raw ?? "";
    // Trim leading whitespace but preserve position info via keywordSpan().
    const trimmed = raw.replace(/^\s+/, "");
    if (trimmed.length === 0) continue;

    // E-IMPORT-001 — `export` outside ${ } logic.
    //
    // P2 (state-as-primary unification, 2026-04-30) — SPEC §21.2 Form 1:
    //   `export <ComponentName ...>...</>` at top level is a valid CANONICAL
    //   form. The Block Splitter emits this as two sibling blocks:
    //     1. text  "export "        (this block)
    //     2. markup <ComponentName>  (next block, isComponent === true)
    //   When the trailing token of the text block is a bare `export` AND the
    //   next sibling is a PascalCase markup, suppress E-IMPORT-001 — TAB's
    //   liftBareDeclarations pairs them into a synthetic logic block of the
    //   form `${ export const ComponentName = <markup-raw> }`, which is
    //   parsed and exported normally.
    if (/^export\b/.test(trimmed)) {
      // Test the Form-1 pairing: text block trailing token is bare `export`,
      // next block is markup whose name starts uppercase.
      const trimmedTrailingExport = /(^|\s)export\s*$/.test(raw);
      const nextBlock = blocks[i + 1];
      const nextIsComponentMarkup =
        nextBlock &&
        nextBlock.type === "markup" &&
        nextBlock.isComponent === true &&
        typeof nextBlock.name === "string" &&
        nextBlock.name.length > 0;
      // P3.A: Form 1 also covers `export <channel name="X" ...>...</>`.
      // The next block is markup with name === "channel" (lowercase, so
      // isComponent === false). TAB's liftBareDeclarations recognizes this
      // pattern and synthesizes a paired ExportDeclNode with
      // exportKind: "channel".
      const nextIsChannelMarkup =
        nextBlock &&
        nextBlock.type === "markup" &&
        nextBlock.name === "channel";
      // C15 (Phase A1c, 2026-05-09): Form 1 also covers
      // `export <engine for=Type ...>` per SPEC §21.8 line 12340 + §51.0.D.
      // The next block is markup with name === "engine" (or "machine" for the
      // legacy alias per §51.3 deprecated keyword). TAB's machineDecls walker
      // (`module-resolver.js:175-189`) reads the engine-decl's `isExported`
      // flag (set by ast-builder via the `_b14IsExport` propagation at
      // `ast-builder.js:945-967`) and registers the export with `kind:
      // "engine"` for SYM PASS 10.B's cross-file mount validation. The
      // existing engine-binding-b14.test.js test
      // (`export <engine ...> Form 1 sets isExported:true`, line 170-181)
      // already exercises the TAB-side wiring; this GCP1 suppression closes
      // the gap that blocked the end-to-end pipeline (compileScrml) from
      // accepting Form 1 export-of-engine syntax.
      const nextIsEngineMarkup =
        nextBlock &&
        nextBlock.type === "markup" &&
        (nextBlock.name === "engine" || nextBlock.name === "machine");
      if (trimmedTrailingExport && (nextIsComponentMarkup || nextIsChannelMarkup || nextIsEngineMarkup)) {
        // Form 1 (P2 component / P3.A channel / C15 engine) — fall through to TAB. No diagnostic.
        continue;
      }

      errors.push(new GauntletError(
        "E-IMPORT-001",
        `E-IMPORT-001: \`export\` declaration is placed outside a \`\${ }\` logic block. ` +
        `All \`export\` statements must appear inside a \`\${ }\` logic context. ` +
        `Wrap the declaration: \`\${ export ${extractFirstToken(trimmed.slice("export".length)) || "..."} }\`.`,
        keywordSpan(block, filePath),
      ));
      continue;
    }

    // `use` preamble violations — E-USE-002 (after markup) and E-USE-005 (bad prefix)
    if (/^use\b/.test(trimmed)) {
      // Extract the specifier following `use`
      const afterUse = trimmed.slice("use".length).replace(/^\s+/, "");
      const specMatch = afterUse.match(/^([A-Za-z_][\w-]*:)?[\w./-]*/);
      const specifier = specMatch ? specMatch[0] : "";
      const prefixMatch = specifier.match(/^([A-Za-z_][\w-]*):/);
      const prefix = prefixMatch ? prefixMatch[1] : null;

      // E-USE-002 fires before E-USE-005 — position in file is the primary cue.
      if (sawMarkup) {
        errors.push(new GauntletError(
          "E-USE-002",
          `E-USE-002: \`use ${specifier || "..."}\` appears after the first markup element. ` +
          `\`use\` declarations must live in the file preamble — before any markup. ` +
          `Move this line to the top of the file, above \`<${firstMarkupTagName(blocks) || "tag"}>\`.`,
          keywordSpan(block, filePath),
        ));
        continue;
      }

      // E-USE-005 — unknown / missing prefix
      if (!prefix || (prefix !== "scrml" && prefix !== "vendor")) {
        const shown = specifier || afterUse.split(/\s/)[0] || "";
        errors.push(new GauntletError(
          "E-USE-005",
          `E-USE-005: \`use ${shown}\` has an unknown prefix. ` +
          `Only \`scrml:\` (stdlib) and \`vendor:\` (project-local vendor module) are legal for \`use\`. ` +
          `Change the specifier to \`scrml:${shown.replace(/^[^:]*:?/, "") || "name"}\` for a stdlib capability, or ` +
          `\`vendor:${shown.replace(/^[^:]*:?/, "") || "name"}\` for a vendored package.`,
          keywordSpan(block, filePath),
        ));
        continue;
      }
      // Legal top-level `use` — no error.
      continue;
    }
  }
}

function extractFirstToken(s) {
  const m = s.trim().match(/^\S+/);
  return m ? m[0] : null;
}

function firstMarkupTagName(blocks) {
  for (const b of blocks) {
    if (b && b.type === "markup") return b.name || "tag";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Check 2 — AST walk: import inside function-decl body, use-decl inside logic
// (E-IMPORT-003, E-USE-001)
// ---------------------------------------------------------------------------

/**
 * Regex matching the text form an `import ... from '...'` takes after it
 * falls through parseOneStatement's bare-expr path. The nested-statement
 * parser has no `import` handler, so the token run becomes a single
 * bare-expr whose `.expr` begins with `import`.
 */
const IMPORT_BARE_EXPR_RE = /^\s*import\b/;

/**
 * Walk the FileAST and report:
 *   - E-IMPORT-003 for any `import-decl` or bare-expr-`import` nested inside
 *     a `function-decl.body`.
 *   - E-USE-001    for any `use-decl` found anywhere — `use-decl` only exists
 *                  in the AST when `use` appeared inside a `${ }` block (the
 *                  top-level form is a text block, never reaches TAB).
 *
 * @param {object} ast — FileAST
 * @param {string} filePath
 * @param {GauntletError[]} errors
 */
function checkAstMisplacedDecls(ast, filePath, errors) {
  if (!ast) return;
  const topNodes = ast.nodes ?? [];
  // Suppress cascaded duplicate reports for the same function body.
  const reportedFunctions = new Set();

  /**
   * Recursive walker. `insideFunction` becomes true once we descend into a
   * `function-decl.body`; any `import-decl` seen while true fires E-IMPORT-003.
   */
  function walk(nodes, fnStack) {
    if (!Array.isArray(nodes)) return;
    const insideFunction = fnStack.length > 0;
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;

      // E-USE-001 — `use` inside `${ }` logic (the only way a use-decl node
      // enters the AST is via parseLogicBody).
      if (node.kind === "use-decl") {
        errors.push(new GauntletError(
          "E-USE-001",
          `E-USE-001: \`use ${node.source ?? "..."}\` appears inside a \`\${ }\` logic block. ` +
          `\`use\` is a file-preamble declaration — it must be placed at the top of the file, outside any logic block. ` +
          `Move \`use ${node.source ?? ""}\` above the first \`\${ }\` / markup element.`,
          node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
        ));
        continue;
      }

      // E-IMPORT-003 — `import` inside a function body. Two node shapes:
      //   1. An `import-decl` node — only happens when a nested parser re-uses
      //      parseLogicBody semantics (rare but possible for metas or fns).
      //   2. A `bare-expr` whose text begins with `import` — the normal case:
      //      `parseOneStatement` has no `import` branch, so it falls through
      //      to the default bare-expr collector which swallows the full
      //      `import { X } from '...'` token run.
      if (insideFunction) {
        const isImportDecl = node.kind === "import-decl";
        const isImportBareExpr =
          node.kind === "bare-expr" &&
          typeof node.expr === "string" &&
          IMPORT_BARE_EXPR_RE.test(node.expr);
        if (isImportDecl || isImportBareExpr) {
          const enclosingFn = fnStack[fnStack.length - 1];
          const fnKey = enclosingFn && enclosingFn.span
            ? `${enclosingFn.span.start}:${enclosingFn.span.end}`
            : "<anon>";
          if (!reportedFunctions.has(fnKey)) {
            reportedFunctions.add(fnKey);
            const fnName = (enclosingFn && enclosingFn.name) || "this function";
            const rawText = (node.raw ?? node.expr ?? "import ...").toString().trim();
            errors.push(new GauntletError(
              "E-IMPORT-003",
              `E-IMPORT-003: \`import\` declaration appears inside the body of \`${fnName}\`. ` +
              `Imports must live at the top of a \`\${ }\` logic block, not nested inside \`function\` / \`fn\` declarations. ` +
              `Move \`${rawText.split(/\r?\n/)[0]}\` out of \`${fnName}\` to the file's logic preamble.`,
              node.span ?? (enclosingFn ? enclosingFn.span : { file: filePath, start: 0, end: 0, line: 1, col: 1 }),
            ));
          }
          continue;
        }
      }

      // Recurse into every child container we know about.
      const nextStack = node.kind === "function-decl"
        ? [...fnStack, node]
        : fnStack;
      if (Array.isArray(node.body))       walk(node.body, nextStack);
      if (Array.isArray(node.children))   walk(node.children, nextStack);
      if (Array.isArray(node.defChildren)) walk(node.defChildren, nextStack);
      if (Array.isArray(node.then))       walk(node.then, nextStack);
      if (Array.isArray(node.else))       walk(node.else, nextStack);
      if (Array.isArray(node.consequent)) walk(node.consequent, nextStack);
      if (Array.isArray(node.alternate))  walk(node.alternate, nextStack);
      if (Array.isArray(node.arms)) {
        for (const arm of node.arms) {
          if (arm && Array.isArray(arm.body)) walk(arm.body, nextStack);
        }
      }
    }
  }

  walk(topNodes, []);
}

// ---------------------------------------------------------------------------
// Check 3 — file-scope let/const duplicate binding (E-SCOPE-010)
// ---------------------------------------------------------------------------

/**
 * File-scope `let` / `const` declarations live at the top level of `${ }`
 * logic blocks that sit at file root (not nested inside a function or
 * markup). Two `${ }` blocks declaring the same name both resolve into
 * the file-level scope — §7.6 forbids the second declaration.
 *
 * @param {object} ast
 * @param {string} filePath
 * @param {GauntletError[]} errors
 */
function checkFileScopeDuplicateBindings(ast, filePath, errors) {
  if (!ast) return;
  const topNodes = ast.nodes ?? [];
  /** @type {Map<string, object>} */
  const seen = new Map();

  /**
   * Collect top-of-logic-body declarations from file-root logic blocks.
   * We also descend into `<program>` / `<head>` / `<body>` markup because
   * users commonly place file-scope `${}` inside the program element.
   */
  function visitTop(nodes) {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node) continue;
      if (node.kind === "logic" && Array.isArray(node.body)) {
        for (const stmt of node.body) {
          if (!stmt) continue;
          if (stmt.kind !== "let-decl" && stmt.kind !== "const-decl") continue;
          const name = stmt.name;
          if (!name) continue;
          const prior = seen.get(name);
          if (prior) {
            errors.push(new GauntletError(
              "E-SCOPE-010",
              `E-SCOPE-010: \`${name}\` is already declared at file scope ` +
              `(first declaration at line ${prior.span?.line ?? "?"}). ` +
              `Two file-scope \`\${ }\` blocks cannot declare the same \`${stmt.kind === "const-decl" ? "const" : "let"}\` name. ` +
              `Rename this declaration, or merge the two \`\${ }\` blocks into one.`,
              stmt.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
            ));
          } else {
            seen.set(name, stmt);
          }
        }
        continue;
      }
      // Recurse into markup containers (`<program>` etc.) — file-scope logic
      // blocks can live as children of the root markup element.
      if (node.kind === "markup" && Array.isArray(node.children)) {
        visitTop(node.children);
      }
    }
  }

  visitTop(topNodes);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Run all Phase 1 gauntlet checks for a single file. Returns a new array of
 * errors to be merged into the compiler's global stream.
 *
 * @param {{ blocks: object[] }}            bsResult
 * @param {{ filePath: string, ast: object }} tabResult
 * @returns {GauntletError[]}
 */
export function runGauntletPhase1Checks(bsResult, tabResult) {
  const errors = [];
  const filePath = tabResult?.filePath ?? bsResult?.filePath ?? "<unknown>";

  checkTopLevelTextPreamble(bsResult?.blocks ?? [], filePath, errors);
  checkAstMisplacedDecls(tabResult?.ast, filePath, errors);
  checkFileScopeDuplicateBindings(tabResult?.ast, filePath, errors);

  return errors;
}

export { GauntletError };
