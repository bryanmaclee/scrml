import { emitExprField } from "../emit-expr.ts";

// ---------------------------------------------------------------------------
// M6.5 NO-OP-UNDER-NATIVE DISCLAIMER (commit 19957684, 2026-05-23)
// ---------------------------------------------------------------------------
// Every helper in this file (isLeakedComment, stripLeakedComments,
// splitBareExprStatements, splitMergedStatements) is a LEGACY LIVE-PIPELINE
// recovery routine for BPP-era boundary loss. When emit-logic.ts is fed by
// the NATIVE parser (compiler/native-parser/, opt-in via parser:"scrml-native"
// in compileScrml options), these helpers are FUNCTIONAL NO-OPS:
//
//   - emit-logic.ts:1174 (bare-expr) has a Phase 3 fast path on node.exprNode
//     that returns at :1276 BEFORE the string fallback at :1278-1340 ever
//     reaches stripLeakedComments / splitBareExprStatements / isLeakedComment.
//   - emit-logic.ts:1391 (let-decl) and :1492 (const-decl) have Phase 3 fast
//     paths on node.initExpr that return BEFORE the string fallback that
//     would trigger splitMergedStatements.
//   - splitMergedStatements has ZERO call sites in emit-logic.ts proper —
//     the import on emit-logic.ts:5 is dead. It is still exported because
//     compile.js:617 loads the self-host BPP module's version of it for the
//     self-host pipeline contract, and tests/unit/parser-workarounds.test.js
//     exercises it directly.
//
// Empirical verification: tests/integration/m6-5-parser-workarounds-noop-
// under-native.test.js installs spies via setBPPOverrides() and confirms
// ZERO invocations across a 6-file representative corpus under native
// upstream (01/02/03/08/14/19). See plan §M6.5 in
// /home/bryan/scrmlMaster/scrml-support/docs/deep-dives/
// m6-joint-retirement-cutover-plan-2026-05-23.md.
//
// These helpers are retained until M6.8 deletion. M6.8 must:
//   1. Confirm the live BS+TAB pipeline is fully retired (no caller passes
//      a `null` parser AND reaches the bare-expr string-fallback branch).
//   2. Delete this file, including the dead emit-logic.ts:5 import.
//   3. Delete rewrite.ts:1283's call site in fixBlockBody (or convert
//      fixBlockBody to a no-op alongside).
//   4. Strip compile.js:613-621's BPP self-host module loader entry.
//   5. Drop tests/unit/parser-workarounds.test.js (moved from the retired
//      tests/self-host/bpp.test.js by s430-stage-swap; or migrate any still-meaningful
//      assertions into native-parser conformance tests).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Self-host override support
// When the self-hosted BPP module is available, its functions replace these.
// Call setBPPOverrides(mod) before codegen to activate.
// ---------------------------------------------------------------------------
let _overrides = null;
export function setBPPOverrides(mod) { _overrides = mod; }
/** s430-emit-state-leak — read the installed overrides so a caller that installs
 *  them for ONE compile (api.js, `selfHostModules.bpp`) can restore the prior
 *  value afterwards instead of leaking its overrides into every later compile. */
export function getBPPOverrides() { return _overrides; }

/**
 * Detect if a string looks like a leaked comment (natural language text).
 * These are `//` comments that the tokenizer included in expressions.
 *
 * M6.5 NO-OP-UNDER-NATIVE: The native parser's lex-in-line-comment.js /
 * lex-in-block-comment.js partition comments out before they reach the Expr
 * layer, so this predicate returns false for every native-upstream input.
 * Empirically: zero invocations across the M6.5 representative corpus
 * (see file header). Retained until M6.8 deletion.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isLeakedComment(text) {
  if (_overrides?.isLeakedComment) return _overrides.isLeakedComment(text);
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  // Contains em-dash or en-dash (common in English comments, rare in code)
  if (/[—–]/.test(trimmed)) return true;
  // Starts with a capital letter followed by lowercase (natural language sentence)
  // and contains only word characters, spaces, and common punctuation (no operators, parens, dots)
  if (/^[A-Z][a-z]/.test(trimmed) && !/[(){}[\]=+<>@$.]/.test(trimmed)) return true;
  return false;
}

/**
 * Strip leaked comment text from a bare-expr string.
 * The tokenizer sometimes includes `// comment` text as regular expression tokens.
 * This function detects natural language sequences and strips them.
 *
 * M6.5 NO-OP-UNDER-NATIVE: emit-logic.ts:1289 is the sole call site and is
 * unreachable when node.exprNode is populated (which the native parser always
 * does for bare-expr — translate-stmt.js:367 makeBareExpr). When invoked under
 * a native-upstream input, returns the input unchanged. Empirically: zero
 * invocations across the M6.5 representative corpus. Retained until M6.8.
 *
 * @param {string} expr
 * @returns {string}
 */
export function stripLeakedComments(expr) {
  if (_overrides?.stripLeakedComments) return _overrides.stripLeakedComments(expr);
  if (!expr || typeof expr !== "string") return expr;

  // Split on newlines and process each line
  const lines = expr.split(/\n/);
  const cleaned = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // For lines that mix code and comments, try to extract just the code part first.
    // Pattern: code (ending with `)`) followed by "  Comment text" (double space + capital letter)
    const codeCommentSplit = trimmed.match(/^(.*?\)\s*)\s{2,}([A-Z][a-z].*)$/);
    if (codeCommentSplit) {
      cleaned.push(codeCommentSplit[1]);
      continue;
    }
    // Skip lines that are entirely natural language (no code-like tokens)
    if (isLeakedComment(trimmed)) continue;
    cleaned.push(line);
  }
  return cleaned.join("\n");
}

/**
 * Split a bare-expr string that may contain multiple merged statements.
 * This handles the BPP bug where statement boundaries are lost and multiple
 * statements are concatenated into a single bare-expr string.
 *
 * Detection: After a closing `)` followed by whitespace and an identifier
 * that starts a new expression (not a operator like `.`, `+`, etc.), we
 * have a statement boundary.
 *
 * M6.5 NO-OP-UNDER-NATIVE: Two call sites in emit-logic.ts (:1306, :1318)
 * sit downstream of the `node.exprNode` Phase 3 fast path at :1174, which
 * the native parser always satisfies via translate-stmt.js:367 makeBareExpr
 * (`exprNode: nativeExpr` populated for every bare-expr). One additional
 * call site in rewrite.ts:1283 lives inside fixBlockBody, which operates on
 * source-text bodies — not driven by native parser output. When invoked
 * under a native-upstream input the helper returns `[trimmed-input]`
 * (single-element array, no split). Empirically: zero invocations across
 * the M6.5 representative corpus. Retained until M6.8.
 *
 * @param {string} expr
 * @returns {string[]}
 */
export function splitBareExprStatements(expr) {
  if (_overrides?.splitBareExprStatements) return _overrides.splitBareExprStatements(expr);
  if (!expr || typeof expr !== "string") return [expr];
  const trimmed = expr.trim();
  if (!trimmed) return [trimmed];

  // Scan the expression to find statement boundaries.
  // A statement boundary is detected when, at depth 0:
  // 1. After `)` followed by whitespace and then an identifier (not `.`, `,`, operator)
  // 2. After a value token (identifier, @reactive, "string", number) followed by whitespace
  //    and then an identifier that starts a new statement (e.g., `ctx.prop = val ctx.other = ...`)
  const statements = [];
  let depth = 0; // paren/bracket depth
  let braceDepth = 0;
  let i = 0;
  let stmtStart = 0;
  let inString = null;

  while (i < trimmed.length) {
    const ch = trimmed[i];

    // Track string literals
    if (inString === null) {
      if (ch === '"' || ch === "'" || ch === '`') {
        inString = ch;
        i++;
        continue;
      }
    } else {
      if (ch === '\\') { i += 2; continue; }
      if (ch === inString) { inString = null; }
      i++;
      continue;
    }

    if (ch === '(' || ch === '[') { depth++; i++; continue; }
    if (ch === ')' || ch === ']') { depth--; i++; continue; }
    if (ch === '{') { braceDepth++; i++; continue; }
    if (ch === '}') { braceDepth--; i++; continue; }

    // Only split at top level (not inside parens/braces/brackets)
    if (depth === 0 && braceDepth === 0 && i > stmtStart) {
      // Check for statement boundary after value tokens followed by whitespace + identifier
      // Previous char must be end of value: `)`, identifier char, `@`, quote, digit
      const prevCh = trimmed[i - 1];
      const isValueEnd = prevCh === ')' || prevCh === ']' || prevCh === '}' ||
                          /[a-zA-Z0-9_$@]/.test(prevCh) ||
                          prevCh === '"' || prevCh === "'";

      if (isValueEnd && /\s/.test(ch)) {
        // Skip whitespace
        let j = i;
        while (j < trimmed.length && /\s/.test(trimmed[j])) j++;
        if (j < trimmed.length && j > i) {
          // Check what follows the whitespace
          const nextCh = trimmed[j];
          // Must be identifier start or @reactive — not an operator
          if (/[a-zA-Z_$@]/.test(nextCh)) {
            // Check it's NOT an operator or chaining context
            if (nextCh !== '.' && nextCh !== ',' && nextCh !== '?' &&
                nextCh !== ':' && nextCh !== '+' && nextCh !== '-' &&
                nextCh !== '*' && nextCh !== '/' && nextCh !== '&' &&
                nextCh !== '|' && nextCh !== '=' && nextCh !== '<' &&
                nextCh !== '>' && nextCh !== '!') {
              // Look further to see if this starts a statement (not a keyword continuation)
              const rest = trimmed.slice(j);
              const nextWord = rest.match(/^[@a-zA-Z_$][\w$.]*/)?.[0] ?? "";

              // Don't split before operators that could be binary: `of`, `in`, `instanceof`, etc.
              const JS_OPERATORS = new Set(["of", "in", "instanceof", "typeof", "void", "delete", "new"]);
              // Don't split before block-continuation keywords (else, catch, finally)
              // These follow a closing `}` but are NOT new statements.
              const BLOCK_CONTINUATIONS = new Set(["else", "catch", "finally"]);
              if (BLOCK_CONTINUATIONS.has(nextWord)) { i++; continue; }
              // Don't split after keywords that expect a following expression
              const prevSegment0 = trimmed.slice(stmtStart, i).trim();
              const prevLastWord = prevSegment0.match(/(\w+)\s*$/)?.[1] ?? "";
              const EXPR_KEYWORDS = new Set(["match", "return", "throw", "case", "yield", "await", "typeof", "void", "delete", "new", "else", "extends", "default", "let", "const", "var", "if", "for", "while", "switch", "try", "catch", "finally", "function", "class", "import", "export"]);
              if (!JS_OPERATORS.has(nextWord) && !EXPR_KEYWORDS.has(prevLastWord)) {
                // Check if the previous segment looks complete (not an incomplete expression)
                const prevSegment = trimmed.slice(stmtStart, i).trim();
                // Don't split after incomplete expressions (e.g., "x =" without value)
                if (prevSegment && !prevSegment.endsWith("=") && !prevSegment.endsWith(",") &&
                    !prevSegment.endsWith("(") && !prevSegment.endsWith("[") &&
                    !prevSegment.endsWith("{") && !prevSegment.endsWith(".") &&
                    !prevSegment.endsWith("?") && !prevSegment.endsWith(":") &&
                    !prevSegment.endsWith("&&") && !prevSegment.endsWith("||") &&
                    !prevSegment.endsWith("=>") && !prevSegment.endsWith(":>")) {
                  // This is a statement boundary
                  statements.push(prevSegment);
                  stmtStart = j;
                  i = j;
                  continue;
                }
              }
            }
          }
        }
      }
    }

    i++;
  }

  // Push remaining
  const last = trimmed.slice(stmtStart).trim();
  if (last) statements.push(last);

  return statements.length > 0 ? statements : [trimmed];
}

/**
 * Split merged statements from a BPP bug where multiple declarations
 * are concatenated into a single node's init string.
 *
 * Pattern: "value1 @name2 = value2 @name3 = value3"
 * Also handles: "value1 let name2 = value2" (mixed let/reactive)
 *
 * When the final value contains trailing bare expression statements
 * (e.g., `"" saveTodos()` or `expr.map(...) callback()`), they are
 * split out using splitBareExprStatements.
 *
 * M6.5 NO-OP-UNDER-NATIVE / DEAD IMPORT: This helper has ZERO call sites in
 * emit-logic.ts proper. The import on emit-logic.ts:5 is dead. let-decl
 * (:1391 fast path on initExpr) and const-decl (:1492 fast path on initExpr)
 * never need this helper because the native parser surfaces a structured
 * Expr the codegen can emit directly. Still exported because:
 *   - compile.js:617 loads the self-host BPP module's version of it for the
 *     self-host pipeline contract (selfHostModules.bpp.splitMergedStatements).
 *   - bpp.test.js exercises it directly to lock the self-host contract.
 * Empirically: zero invocations across the M6.5 representative corpus.
 * Retained until M6.8.
 *
 * @param {string} firstName — the first variable name
 * @param {string} initStr — the concatenated init string
 * @param {string} declType — "let", "const", or "reactive"
 * @returns {string} — multiple JS statements separated by newlines
 */
export function splitMergedStatements(firstName, initStr, declType) {
  if (_overrides?.splitMergedStatements) return _overrides.splitMergedStatements(firstName, initStr, declType);
  const statements = [];
  let remaining = initStr;
  let currentName = firstName;
  let currentType = declType;

  while (remaining) {
    // Try to match: value @name = rest
    const reactiveMatch = remaining.match(/^(.*?)\s+@([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([\s\S]*)$/);
    // Try to match: value let/const name = rest
    const letMatch = remaining.match(/^(.*?)\s+(?:let|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([\s\S]*)$/);

    let match = null;
    // Pick the match that has the longer first capture (i.e., matches later in the string)
    if (reactiveMatch && letMatch) {
      match = reactiveMatch[1].length >= letMatch[1].length ? reactiveMatch : letMatch;
    } else {
      match = reactiveMatch || letMatch;
    }

    if (match) {
      const currentValue = match[1].trim();
      if (currentType === "reactive" || currentType === "state-decl") {
        statements.push(`_scrml_reactive_set(${JSON.stringify(currentName)}, ${emitExprField(null, currentValue, { mode: "client" })});`);
      } else {
        statements.push(`${currentType} ${currentName} = ${emitExprField(null, currentValue, { mode: "client" })};`);
      }
      currentName = match[2];
      // Determine type of next declaration
      if (match === reactiveMatch) {
        currentType = "reactive";
      } else {
        const typeMatch = remaining.match(/^.*?\s+(let|const)\s+/);
        currentType = typeMatch ? typeMatch[1] : "let";
      }
      remaining = match[3];
    } else {
      // No more @name = or let/const = splits.
      // Check if the remaining value contains trailing bare expression statements
      // (e.g., `"" saveTodos()` — the final value has a trailing function call).
      const finalValue = remaining.trim();
      const valueParts = splitBareExprStatements(finalValue);
      if (valueParts.length > 1) {
        // First part is the actual variable value; rest are trailing statements
        if (currentType === "reactive" || currentType === "state-decl") {
          statements.push(`_scrml_reactive_set(${JSON.stringify(currentName)}, ${emitExprField(null, valueParts[0].trim(), { mode: "client" })});`);
        } else {
          statements.push(`${currentType} ${currentName} = ${emitExprField(null, valueParts[0].trim(), { mode: "client" })};`);
        }
        for (let k = 1; k < valueParts.length; k++) {
          const s = valueParts[k].trim();
          if (s) statements.push(`${emitExprField(null, s, { mode: "client" })};`);
        }
      } else {
        // Single value — emit as-is
        if (currentType === "reactive" || currentType === "state-decl") {
          statements.push(`_scrml_reactive_set(${JSON.stringify(currentName)}, ${emitExprField(null, finalValue, { mode: "client" })});`);
        } else {
          statements.push(`${currentType} ${currentName} = ${emitExprField(null, finalValue, { mode: "client" })};`);
        }
      }
      remaining = null;
    }
  }

  return statements.join("\n");
}
