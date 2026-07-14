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
 *   E-SCHEMA-003 — `<schema>` block placed anywhere other than as an immediate
 *                  child of the `<program>` root. Per §39.3 normative + §39.12
 *                  full prose, schemas SHALL appear as immediate children of
 *                  `<program>`. Nesting inside `<db>`, component bodies,
 *                  `<page>`, engine state-children, etc. is an error. A
 *                  standalone `<schema>` at file top (no `<program>` parent)
 *                  is also illegal. (Catalog row added S84 Wave 2 #5;
 *                  placement enforcement landed S133 — Phase 2 amendment
 *                  closure F-019.)
 *
 *   E-SCHEMA-001 — `<schema>` block whose enclosing `<program>` root has no
 *                  `db=` attribute. §39.3: a `<schema>` is valid only inside a
 *                  file whose `<program>` root has a `db=`. (The standalone
 *                  no-`<program>` case stays E-SCHEMA-003 — placement.)
 *
 *   E-SCHEMA-002 — More than one `<schema>` block in the same file. §39.3: a
 *                  file SHALL NOT contain more than one `<schema>` block. Fired
 *                  on the 2nd and each subsequent block.
 *
 *   W-SCHEMA-001 — A table declaration has no `primary key` column. §39.5.1.
 *                  Warning (routes to result.warnings via the W- prefix).
 *
 *   (E-SCHEMA-006 — references-target validation — is NOT wired here: §39.5.5
 *    permits a `references` target to be a table in the EXISTING database
 *    schema when it is not being re-created, so a within-block-only check
 *    false-positives on valid incremental-migration schemas and never sees the
 *    referenced column. It re-scopes to the real-DB adapter work — like
 *    E-SCHEMA-005/007/009 it needs live-DB context to be sound.)
 *
 * All errors use the same shape as TAB/TS diagnostics — `{ code, message,
 * span, severity }` — and are collected into the compiler's global error
 * stream by the api.js driver.
 */

import { parseSchemaBlock } from "./schema-differ.js";

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

      // Bug-batch S93 (Bug 6A — non-entry pure-module file):
      // Per S85 Q2, non-entry files (modules) have NO `<program>` wrapper
      // at all — their entire content is logic-default at file-top. Bare
      // `export type X`, `export function f`, `export fn f`, `export const x`,
      // `export let x`, `export server function f`, `export server fn f`
      // forms are valid file-top declarations that TAB's liftBareDeclarations
      // (BARE_DECL_RE at ast-builder.js:327) lifts into a synthetic `${...}`
      // logic block automatically. The E-IMPORT-001 was authored when `${}`
      // was the only logic-context-bearing construct; the rule was never
      // extended for non-entry files at S85 ratification.
      //
      // Suppress E-IMPORT-001 when the export trailer matches one of these
      // bare-decl shapes — TAB's lift takes over.
      //
      // The check is conservative: matches only the trailer-keyword shape;
      // any other `export` form (e.g. `export X` re-export, `export *`) still
      // fires E-IMPORT-001 because TAB has no lift for them.
      const exportTail = trimmed.slice("export".length).replace(/^\s+/, "");
      const BARE_EXPORT_KEYWORD_RE =
        /^(?:server\s+(?:fn|function)\s|type\s+\w|fn\s+\w|function\s+\w|let\s+[A-Za-z_]|const\s+[A-Za-z_])/;
      if (BARE_EXPORT_KEYWORD_RE.test(exportTail)) {
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
      //
      // §23.4 exemption: a `use foreign:name { … }` sidecar declaration is
      // top-level-valid (SPEC §23.4) but arrives as a bare text block in v0.3
      // default-logic mode, so the lift pass wraps it in a synthetic `${...}` to
      // route it to parseLogicBody's `use` handler — which has already failed it
      // closed with the honest E-FOREIGN-SIDECAR-NOMINAL. Don't pile on the
      // misleading "move it out of the logic block" E-USE-001 (the lift is an
      // internal mechanism, not author placement).
      if (node.kind === "use-decl" && !node._foreignSidecarNominal) {
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
// Check 4 — `<schema>` placement enforcement (E-SCHEMA-003)
// ---------------------------------------------------------------------------

/**
 * Per SPEC §39.3 + §39.12, a `<schema>` block SHALL appear as an immediate
 * child of the `<program>` root. Any other placement (nested inside `<db>`,
 * a component body, `<page>`, an engine state-child, etc.) is a compile error
 * (E-SCHEMA-003). A standalone `<schema>` at file top (no `<program>` wrapper)
 * is also illegal.
 *
 * Note on logic-context placement: when a `<schema>` literal appears inside a
 * `${ }` logic block, the parser converts the markup to an `html-fragment`
 * string (see ast-builder.js parseLogicBody — `<` in expression position is
 * not markup). Such a "schema" never enters the AST as a `state` node with
 * `stateType === "schema"`, so this check does not fire for that shape. That
 * is an orthogonal concern (silent swallow of markup in logic position) and
 * is not in scope for E-SCHEMA-003.
 *
 * Implementation: a top-down AST walk with a parent-kind stack. Whenever a
 * `kind:"state", stateType:"schema"` node is encountered, we inspect the
 * immediate parent on the stack:
 *
 *   - Parent is the `<program>` root markup (kind:"markup", tag:"program")
 *     → OK.
 *   - Parent is anything else → E-SCHEMA-003.
 *   - No parent (top of `ast.nodes` with no `<program>` wrapping)
 *     → E-SCHEMA-003 (the SPEC text is "immediate children of `<program>`
 *       only" — a standalone schema has no `<program>` parent).
 *
 * The walker descends through every container field we know about for the
 * 12-member ASTNode union plus a few project-internal node shapes that hold
 * markup descendants: `children`, `body`, `bodyChildren` (engine-decl),
 * `defChildren` (state-constructor-def), `then`/`else`/`consequent`/`alternate`
 * (control-flow), `arms[].body` (match). Logic-block `body` IS walked via the
 * generic `body` descent, but logic statements never carry a real `<schema>`
 * state node — the parser converts markup-in-logic to an html-fragment string,
 * as documented above.
 *
 * @param {object} ast — FileAST
 * @param {string} filePath
 * @param {GauntletError[]} errors
 */
function checkSchemaPlacement(ast, filePath, errors) {
  if (!ast) return;
  const topNodes = ast.nodes ?? [];

  /** Returns a stable description of the parent container for the message. */
  function parentDescription(parentNode) {
    if (!parentNode || typeof parentNode !== "object") return "the file root";
    if (parentNode.kind === "markup") {
      const t = parentNode.tag || "?";
      // Distinguish lowercase HTML/scrml-structural elements from PascalCase
      // user-component callsites in the message.
      return `\`<${t}>\``;
    }
    if (parentNode.kind === "state") {
      const st = parentNode.stateType || "?";
      return `\`<${st}>\``;
    }
    if (parentNode.kind === "engine-decl") {
      return "`<engine>`";
    }
    if (parentNode.kind === "component-def") {
      const n = parentNode.name || "?";
      return `the body of component \`${n}\``;
    }
    return `a \`${parentNode.kind}\` node`;
  }

  /**
   * Returns true if `n` is the `<program>` root markup element.
   */
  function isProgramRoot(n) {
    return n && typeof n === "object" && n.kind === "markup" && n.tag === "program";
  }

  /**
   * Recursive walker. `parentStack` carries the chain of container nodes from
   * file-root down to (but not including) the current node. The immediate
   * parent of the current node is `parentStack[parentStack.length - 1]`, or
   * `undefined` at the top level.
   */
  function walk(nodes, parentStack) {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;

      // Detect a `<schema>` state node.
      if (node.kind === "state" && node.stateType === "schema") {
        const immediateParent = parentStack[parentStack.length - 1];
        if (!isProgramRoot(immediateParent)) {
          const where = parentDescription(immediateParent);
          errors.push(new GauntletError(
            "E-SCHEMA-003",
            `E-SCHEMA-003: \`<schema>\` block is placed inside ${where}, but \`<schema>\` SHALL appear as an immediate child of the \`<program>\` root only. ` +
            `Nesting a schema inside any other block (\`<db>\`, component body, \`<page>\`, engine state-child, etc.) is forbidden. ` +
            `Move the \`<schema>\` block out so it is a direct child of \`<program>\`.` +
            ` (See SPEC §39.3 + §39.12.)`,
            node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
          ));
        }
        // Still descend; nested `<schema>` blocks inside the schema body
        // (pathological) would each be reported separately. The body of a
        // legitimately-placed `<schema>` is parsed by the schema DSL, not as
        // child AST nodes, so this descent is normally a no-op.
      }

      // Push current node onto stack and descend into known container fields.
      const nextStack = [...parentStack, node];
      if (Array.isArray(node.children))     walk(node.children, nextStack);
      if (Array.isArray(node.body))         walk(node.body, nextStack);
      if (Array.isArray(node.bodyChildren)) walk(node.bodyChildren, nextStack);
      if (Array.isArray(node.defChildren))  walk(node.defChildren, nextStack);
      if (Array.isArray(node.then))         walk(node.then, nextStack);
      if (Array.isArray(node.else))         walk(node.else, nextStack);
      if (Array.isArray(node.consequent))   walk(node.consequent, nextStack);
      if (Array.isArray(node.alternate))    walk(node.alternate, nextStack);
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
// Check 5 — `<schema>` declaration validation
//   E-SCHEMA-001 (db-anchor) · E-SCHEMA-002 (singleton) ·
//   W-SCHEMA-001 (no primary key)
//
// NOTE: E-SCHEMA-004 (column type not in the §39.4 legal set) is intentionally
// NOT wired here. Strict §39.4 enforcement fires on the pervasive corpus
// convention of JS-style schema types (`string` / `number` / `int` in place of
// `text` / `integer` / `real`) — 32 files / ~124 columns as of 2026-07-13,
// including shipped examples (26-type-derived-schema, 32-external-api,
// schemaFor-basic). Landing a fatal E-SCHEMA-004 would break those examples'
// compilation and requires a corpus migration (with `number`→`integer`-vs-`real`
// judgment) that is a separate, PA-scoped task. See the dispatch report.
//
// NOTE: E-SCHEMA-006 (references target) is also NOT wired here. §39.5.5 allows
// a `references` target to be a table in the EXISTING database schema when it is
// not being re-created, so a within-block-only static check false-positives on a
// valid incremental-migration schema (and never validates the referenced
// column, which §39.5.5 also requires). It re-scopes to the real-DB adapter work
// where live-DB context is available (like E-SCHEMA-005/007/009).
// ---------------------------------------------------------------------------

/**
 * Concatenate the `text`-kind children of a `<schema>` state node into its raw
 * body text — the same shape schema-differ's `parseSchemaBlock` consumers read
 * (mirrors protect-analyzer.ts `collectSchemaBodyText`; inlined here so this
 * post-TAB module stays dependency-light and does not pull the protect-analyzer
 * import chain).
 */
function schemaBodyText(node) {
  const children = node && node.children;
  if (!Array.isArray(children)) return "";
  let text = "";
  for (const c of children) {
    if (c && c.kind === "text" && typeof c.value === "string") text += c.value;
  }
  return text;
}

/**
 * Read the `db=` attribute string off a `<program>` markup node, or `null` when
 * absent/empty. Mirrors the codegen/index.ts attr-reading shape
 * (`node.attributes ?? node.attrs`; value in `.value.value` or `.value.name`).
 */
function programDbValue(programNode) {
  const attrs = programNode.attributes ?? programNode.attrs ?? [];
  if (!Array.isArray(attrs)) return null;
  const dbAttr = attrs.find((a) => a && a.name === "db");
  if (!dbAttr) return null;
  const v = dbAttr.value?.value ?? dbAttr.value?.name ?? "";
  return String(v).trim() === "" ? null : String(v);
}

/**
 * Per §39.3 / §39.5.1, validate each `<schema>` block:
 *
 *   - E-SCHEMA-001: the schema's enclosing `<program>` root has no `db=`.
 *   - E-SCHEMA-002: more than one `<schema>` block in the file (2nd+).
 *   - W-SCHEMA-001: a table with no `primary key` column.
 *
 * Implementation: one top-down walk collects every `<schema>` state node with
 * the nearest enclosing `<program>` root, then the body-level check parses each
 * block via schema-differ's `parseSchemaBlock` (no hand DSL re-parse).
 *
 * @param {object} ast — FileAST
 * @param {string} filePath
 * @param {GauntletError[]} errors
 */
function checkSchemaDeclarations(ast, filePath, errors) {
  if (!ast) return;
  const topNodes = ast.nodes ?? [];

  /** @type {Array<{ node: object, programRoot: object|null }>} */
  const schemaEntries = [];

  function walk(nodes, programRoot) {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const nextProgram =
        node.kind === "markup" && node.tag === "program" ? node : programRoot;
      if (node.kind === "state" && node.stateType === "schema") {
        schemaEntries.push({ node, programRoot: nextProgram });
      }
      if (Array.isArray(node.children))     walk(node.children, nextProgram);
      if (Array.isArray(node.body))         walk(node.body, nextProgram);
      if (Array.isArray(node.bodyChildren)) walk(node.bodyChildren, nextProgram);
      if (Array.isArray(node.defChildren))  walk(node.defChildren, nextProgram);
      if (Array.isArray(node.then))         walk(node.then, nextProgram);
      if (Array.isArray(node.else))         walk(node.else, nextProgram);
      if (Array.isArray(node.consequent))   walk(node.consequent, nextProgram);
      if (Array.isArray(node.alternate))    walk(node.alternate, nextProgram);
      if (Array.isArray(node.arms)) {
        for (const arm of node.arms) {
          if (arm && Array.isArray(arm.body)) walk(arm.body, nextProgram);
        }
      }
    }
  }
  walk(topNodes, null);

  if (schemaEntries.length === 0) return;

  const fallbackSpan = { file: filePath, start: 0, end: 0, line: 1, col: 1 };

  // §39.4 legal `<schema>` column types (the fixed set that maps to SQLite
  // affinities). A raw column-type token outside this set is E-SCHEMA-004.
  // NB `boolean` + `timestamp` ARE canonical scrml-flavored names (not literal
  // SQLite affinities); the JS-style `string`/`int`/`number`/`bool`/`float` are not.
  const LEGAL_SCHEMA_COLUMN_TYPES = new Set([
    "text", "integer", "real", "blob", "boolean", "timestamp",
  ]);

  // E-SCHEMA-002 — a file SHALL NOT contain more than one `<schema>` block.
  // Fire on the 2nd and each subsequent block (the first is the legal one).
  for (let i = 1; i < schemaEntries.length; i++) {
    errors.push(new GauntletError(
      "E-SCHEMA-002",
      `E-SCHEMA-002: this file contains more than one \`<schema>\` block ` +
      `(${schemaEntries.length} found). A file SHALL contain at most one \`<schema>\` block. ` +
      `Merge the table declarations into a single \`<schema>\`. (See SPEC §39.3.)`,
      schemaEntries[i].node.span ?? fallbackSpan,
    ));
  }

  for (const { node, programRoot } of schemaEntries) {
    const span = node.span ?? fallbackSpan;

    // E-SCHEMA-001 — the enclosing `<program>` root must carry a `db=`
    // attribute. When there is no `<program>` ancestor at all (a standalone
    // file-top `<schema>`), placement is already reported as E-SCHEMA-003 by
    // Check 4; we do not double-report the db-anchor there.
    if (programRoot && programDbValue(programRoot) === null) {
      errors.push(new GauntletError(
        "E-SCHEMA-001",
        `E-SCHEMA-001: this \`<schema>\` block's enclosing \`<program>\` root has no \`db=\` attribute. ` +
        `A \`<schema>\` is valid only inside a file whose \`<program>\` root declares the database path ` +
        `(\`<program db="./app.db">\`). Add a \`db=\` attribute to the \`<program>\` root. (See SPEC §39.3.)`,
        span,
      ));
    }

    // Body-level checks — parse the DSL once via schema-differ.
    const body = schemaBodyText(node);
    if (!body || body.trim().length === 0) continue;
    let parsed;
    try {
      parsed = parseSchemaBlock(body);
    } catch {
      parsed = { tables: [] };
    }
    const tables = Array.isArray(parsed.tables) ? parsed.tables : [];

    for (const table of tables) {
      if (!table || typeof table.name !== "string") continue;
      const cols = Array.isArray(table.columns) ? table.columns : [];

      // W-SCHEMA-001 — the table has no `primary key` column (§39.5.1).
      if (cols.length > 0 && !cols.some((c) => c && c.primaryKey)) {
        errors.push(new GauntletError(
          "W-SCHEMA-001",
          `W-SCHEMA-001: table \`${table.name}\` has no \`primary key\` column. ` +
          `Every table should designate exactly one \`primary key\` column ` +
          `(e.g. \`id: integer primary key\`). (See SPEC §39.5.1.)`,
          span,
          "warning",
        ));
      }

      // E-SCHEMA-004 — a column type name outside the §39.4 legal set. `scrmlType`
      // is the RAW author token (lowercased). Constraints (`req`/`unique`/`primary
      // key`/…) are parsed into their own fields, so this never mis-fires on a
      // constraint; a `${ schemaFor(T) }` delegation body has no `name: type` lines,
      // so parseColumns yields no column and this stays silent for that form.
      for (const col of cols) {
        if (col && typeof col.scrmlType === "string" &&
            !LEGAL_SCHEMA_COLUMN_TYPES.has(col.scrmlType)) {
          errors.push(new GauntletError(
            "E-SCHEMA-004",
            `E-SCHEMA-004: column \`${col.name}\` in table \`${table.name}\` has unrecognized ` +
            `type \`${col.scrmlType}\`. Legal \`<schema>\` column types are: text, integer, real, ` +
            `blob, boolean, timestamp. (See SPEC §39.4.)`,
            span,
          ));
        }
      }
    }
  }
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
  checkSchemaPlacement(tabResult?.ast, filePath, errors);
  checkSchemaDeclarations(tabResult?.ast, filePath, errors);

  return errors;
}

export { GauntletError };
