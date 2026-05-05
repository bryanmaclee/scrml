// ===========================================================================
// SECTION: emit-lift (from emit-lift.js)
// ===========================================================================

// ---------------------------------------------------------------------------
// Attribute string parser
// ---------------------------------------------------------------------------

/**
 * Parse a tokenizer-spaced attribute string into an array of {name, value} pairs.
 *
 * The tokenizer produces attribute strings with spaces around `=` and around
 * attribute values. Examples:
 *   `class = "card"`  →  [{name: "class", value: "card"}]
 *   `href = "#"`      →  [{name: "href", value: "#"}]
 *   `checked`         →  [{name: "checked", value: null}]
 *   `src = "${img}" alt = "Photo"` → [{name:"src",value:"${img}"},{name:"alt",value:"Photo"}]
 *
 * Attribute values may contain `${expr}` interpolations — preserve them as-is.
 *
 * @param {string} attrsStr — raw attribute string
 * @returns {Array<{name: string, value: string|null}>}
 */
function parseAttrs(attrsStr) {
  if (!attrsStr || !attrsStr.trim()) return [];
  const attrs = [];
  let i = 0;
  const s = attrsStr.trim();

  while (i < s.length) {
    // Skip whitespace
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;

    // Skip trailing / (self-closer marker)
    if (s[i] === '/') { i++; continue; }

    // Read attribute name (alphanumeric, -, :, .)
    let nameStart = i;
    while (i < s.length && /[A-Za-z0-9_:\-.]/.test(s[i])) i++;
    let name = s.slice(nameStart, i).trim();
    if (!name) { i++; continue; }

    // BUG-4 fix: handle tokenizer-spaced hyphenated names like `data - id`.
    // After reading "data", if whitespace is followed by `-` then more name chars,
    // merge them into a single hyphenated attribute name.
    while (true) {
      let j = i;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (j < s.length && s[j] === '-') {
        let k = j + 1;
        while (k < s.length && /\s/.test(s[k])) k++;
        if (k < s.length && /[A-Za-z]/.test(s[k])) {
          let nameEnd = k;
          while (nameEnd < s.length && /[A-Za-z0-9_:\-.]/.test(s[nameEnd])) nameEnd++;
          let afterName = nameEnd;
          while (afterName < s.length && /\s/.test(s[afterName])) afterName++;
          const nextPart = s.slice(k, nameEnd);
          name = name + "-" + nextPart;
          i = nameEnd;
          continue;
        }
      }
      break;
    }

    // Skip whitespace
    while (i < s.length && /\s/.test(s[i])) i++;

    // Check for = sign
    if (i < s.length && s[i] === '=') {
      i++; // consume =
      // Skip whitespace
      while (i < s.length && /\s/.test(s[i])) i++;

      let value = "";
      if (i < s.length && (s[i] === '"' || s[i] === "'")) {
        // Quoted value
        const quote = s[i];
        i++; // consume opening quote
        const valueStart = i;
        while (i < s.length && s[i] != quote) {
          if (s[i] === '\\') i++; // skip escaped char
          i++;
        }
        value = s.slice(valueStart, i);
        if (i < s.length) i++; // consume closing quote
      } else {
        // Unquoted value — read until whitespace, but track paren depth
        const valueStart = i;
        let depth = 0;
        while (i < s.length) {
          if (s[i] === '(') depth++;
          else if (s[i] === ')') {
            depth--;
            if (depth < 0) break;
            if (depth === 0) { i++; break; }
          } else if (/\s/.test(s[i]) && depth === 0) {
            let peek = i;
            while (peek < s.length && /\s/.test(s[peek])) peek++;
            if (peek < s.length && s[peek] === '(') {
              i++;
              continue;
            }
            break;
          }
          i++;
        }
        value = s.slice(valueStart, i);
      }
      attrs.push({ name, value });
    } else {
      // Boolean attribute (no value)
      attrs.push({ name, value: null });
    }
  }

  return attrs;
}

// ---------------------------------------------------------------------------
// Content text parser (for interpolation segments)
// ---------------------------------------------------------------------------

/**
 * Parse lift content text that may contain `$$ { expr }` (literal $ + interpolation)
 * or `$ { expr }` interpolation patterns from the tokenizer.
 * Pushes { type: "text" | "expr", value } items into the parts array.
 */
export function parseLiftContentParts(text, parts) {
  let i = 0;
  let literalStart = 0;

  while (i < text.length) {
    // Check for $$ { pattern — literal $ followed by ${ interpolation
    if (text[i] === '$' && text[i + 1] === '$' && i + 2 < text.length) {
      let j = i + 2;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (j < text.length && text[j] === '{') {
        let depth = 1;
        let k = j + 1;
        while (k < text.length && depth > 0) {
          if (text[k] === '{') depth++;
          else if (text[k] === '}') depth--;
          k++;
        }
        if (depth === 0) {
          if (i > literalStart) {
            parts.push({ type: "text", value: text.slice(literalStart, i) });
          }
          parts.push({ type: "text", value: "$" });
          const exprInside = text.slice(j + 1, k - 1).trim();
          parts.push({ type: "expr", value: exprInside });
          literalStart = k;
          i = k;
          continue;
        }
      }
    }
    // Check for ${ pattern — interpolation (compact form)
    if (text[i] === '$' && text[i + 1] === '{') {
      let j = i + 2;
      let depth = 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      if (depth === 0) {
        if (i > literalStart) {
          parts.push({ type: "text", value: text.slice(literalStart, i) });
        }
        const exprInside = text.slice(i + 2, j - 1).trim();
        parts.push({ type: "expr", value: exprInside });
        literalStart = j;
        i = j;
        continue;
      }
    }
    // Check for `$ { expr }` (tokenizer spaces $ away from {)
    if (text[i] === '$' && i + 1 < text.length && /\s/.test(text[i + 1])) {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (j < text.length && text[j] === '{') {
        let depth = 1;
        let k = j + 1;
        while (k < text.length && depth > 0) {
          if (text[k] === '{') depth++;
          else if (text[k] === '}') depth--;
          k++;
        }
        if (depth === 0) {
          if (i > literalStart) {
            parts.push({ type: "text", value: text.slice(literalStart, i) });
          }
          const exprInside = text.slice(j + 1, k - 1).trim();
          parts.push({ type: "expr", value: exprInside });
          literalStart = k;
          i = k;
          continue;
        }
      }
    }
    i++;
  }

  // Push remaining literal
  if (literalStart < text.length) {
    const remaining = text.slice(literalStart);
    if (remaining.trim()) {
      parts.push({ type: "text", value: remaining });
    }
  }
}

// ---------------------------------------------------------------------------
// Nested tag detection helpers
// ---------------------------------------------------------------------------

/**
 * Check if a string contains a tokenizer-spaced opening tag like `< div` or `< a`.
 * @param {string} s
 * @returns {boolean}
 */
function hasNestedTag(s) {
  return /<\s*[A-Za-z]/.test(s);
}

/**
 * Check if a string is a tokenizer-spaced closing tag like `< / a >` or `< / li >`.
 * @param {string} s
 * @returns {boolean}
 */
function isClosingTagFragment(s) {
  return /^<\s*\//.test(s);
}

/**
 * Check if a string contains a tokenizer-spaced closing tag like `< / div >`.
 * @param {string} s
 * @returns {boolean}
 */
function containsClosingTag(s) {
  return /<\s*\/\s*[A-Za-z]/.test(s);
}

/**
 * Split a content string containing multiple tokenizer-spaced tags into segments.
 * Each segment is { type: "text"|"open-tag"|"close-tag", ... }.
 *
 * @param {string} s — content that may contain tokenizer-spaced tags
 * @returns {Array<{type: string, tag?: string, attrsStr?: string, text?: string}>}
 */
function splitTagSegments(s) {
  const segments = [];
  let i = 0;
  let textStart = 0;

  while (i < s.length) {
    // Check for tag opening `<`
    if (s[i] === '<') {
      // Flush preceding text
      if (i > textStart) {
        const text = s.slice(textStart, i).trim();
        if (text) segments.push({ type: "text", text });
      }

      // Determine if closing tag or opening tag
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;

      if (j < s.length && s[j] === '/') {
        // Closing tag: `< / tagname >`
        j++;
        while (j < s.length && /\s/.test(s[j])) j++;
        let tagStart = j;
        while (j < s.length && /[A-Za-z0-9-]/.test(s[j])) j++;
        const tag = s.slice(tagStart, j);
        // Skip to >
        while (j < s.length && s[j] != '>') j++;
        if (j < s.length) j++; // consume >
        segments.push({ type: "close-tag", tag });
        textStart = j;
        i = j;
        continue;
      } else if (j < s.length && /[A-Za-z]/.test(s[j])) {
        // Opening tag: `< tagname attrs >`
        let tagStart = j;
        while (j < s.length && /[A-Za-z0-9-]/.test(s[j])) j++;
        const tag = s.slice(tagStart, j);

        // Read attributes until >
        const attrsStart = j;
        while (j < s.length) {
          if (s[j] === '>') break;
          if (s[j] === '"' || s[j] === "'") {
            const q = s[j]; j++;
            while (j < s.length && s[j] != q) {
              if (s[j] === '\\') j++;
              j++;
            }
            if (j < s.length) j++;
            continue;
          }
          j++;
        }
        const attrsStr = s.slice(attrsStart, j).trim();
        if (j < s.length && s[j] === '>') j++; // consume >
        segments.push({ type: "open-tag", tag, attrsStr });
        textStart = j;
        i = j;
        continue;
      }
    }
    i++;
  }

  // Flush remaining text
  if (textStart < s.length) {
    const text = s.slice(textStart).trim();
    if (text) segments.push({ type: "text", text });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// createElement emission helpers
// ---------------------------------------------------------------------------

/**
 * Emit setAttribute calls for a parsed attrs array.
 *
 * @param {string} elVar — the variable name of the element
 * @param {Array<{name: string, value: string|null}>} attrs
 * @returns {string[]}
 */
function emitSetAttrs(elVar, attrs) {
  const lines = [];
  for (const attr of attrs) {
    if (attr.value === null) {
      // Boolean attribute
      lines.push(`${elVar}.setAttribute(${JSON.stringify(attr.name)}, "");`);
    } else if (/^on[a-z]/.test(attr.name)) {
      // BUG-6 fix: event attributes like onclick, ondblclick, onsubmit
      // must use addEventListener, not setAttribute
      const eventName = attr.name.replace(/^on/, "");
      const handlerExpr = attr.value.includes('${') || /\$\s*\{/.test(attr.value)
        ? (() => {
            const parts = [];
            parseLiftContentParts(attr.value, parts);
            return parts.map(p => p.type === "expr" ? rewriteExpr(p.value) : p.value).join("");
          })()
        : rewriteExpr(attr.value);
      lines.push(`${elVar}.addEventListener(${JSON.stringify(eventName)}, function(event) { ${handlerExpr}; });`);
    } else {
      // Check if the value contains interpolation (compact or tokenizer-spaced)
      if (attr.value.includes('${') || /\$\s*\{/.test(attr.value)) {
        // Rebuild as template literal with rewritten expressions
        const parts = [];
        parseLiftContentParts(attr.value, parts);
        let tpl = "`";
        for (const p of parts) {
          if (p.type === "expr") {
            tpl += String.fromCharCode(36) + String.fromCharCode(123) + rewriteExpr(p.value) + String.fromCharCode(125);
          } else {
            tpl += p.value.replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
          }
        }
        tpl += "`";
        lines.push(`${elVar}.setAttribute(${JSON.stringify(attr.name)}, ${tpl});`);
      } else {
        lines.push(`${elVar}.setAttribute(${JSON.stringify(attr.name)}, ${JSON.stringify(attr.value)});`);
      }
    }
  }
  return lines;
}

/**
 * Emit JS statements that set the text content of an element from a list of parts.
 *
 * @param {string} elVar — the variable name of the element
 * @param {Array<{type: string, value: string}>} parts — text/expr parts
 * @returns {string[]} — JS lines
 */
function emitSetContent(elVar, parts) {
  if (!parts || parts.length === 0) return [];

  const hasExpr = parts.some(p => p.type === "expr");

  if (!hasExpr) {
    const combined = parts.map(p => p.value).join("");
    if (!combined.trim()) return [];
    return [`${elVar}.textContent = ${JSON.stringify(combined)};`];
  }

  // Build a template literal for mixed text/expression content
  let tpl = "`";
  for (const p of parts) {
    if (p.type === "expr") {
      tpl += String.fromCharCode(36) + String.fromCharCode(123) + rewriteExpr(p.value) + String.fromCharCode(125);
    } else {
      tpl += p.value.replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
    }
  }
  tpl += "`";
  return [`${elVar}.appendChild(document.createTextNode(${tpl}));`];
}

/**
 * Walk a markup AST node recursively and emit createElement chains.
 * Returns the variable name of the root element.
 *
 * @param {object} node — markup AST node { kind:"markup", tag, attributes, children }
 * @param {string[]} lines — accumulator for JS lines
 * @returns {string} — the variable name of the created element
 */
function emitCreateElementFromMarkup(node, lines) {
  const tag = node.tag ?? node.tagName ?? "div";
  const attrs = node.attributes ?? node.attrs ?? [];
  const children = node.children ?? [];
  const isVoid = VOID_ELEMENTS.has(tag);

  const elVar = genVar(`lift_el`);
  lines.push(`const ${elVar} = document.createElement(${JSON.stringify(tag)});`);

  // Emit setAttribute calls
  for (const attr of attrs) {
    if (!attr) continue;
    const name = attr.name;
    const val = attr.value;

    if (!val || val.kind === "absent") {
      lines.push(`${elVar}.setAttribute(${JSON.stringify(name)}, "");`);
    } else if (val.kind === "string-literal") {
      lines.push(`${elVar}.setAttribute(${JSON.stringify(name)}, ${JSON.stringify(val.value)});`);
    } else if (val.kind === "variable-ref") {
      const varName = (val.name || "").replace(/^@/, "");
      lines.push(`${elVar}.setAttribute(${JSON.stringify(name)}, ${rewriteExpr(varName)});`);
    } else if (val.kind === "call-ref") {
      // Event handler — use addEventListener
      const eventName = name.replace(/^on/, "");
      lines.push(`${elVar}.addEventListener(${JSON.stringify(eventName)}, ${val.name});`);
    } else if (typeof val === "string") {
      // Raw string value
      lines.push(`${elVar}.setAttribute(${JSON.stringify(name)}, ${JSON.stringify(val)});`);
    }
  }

  if (!isVoid) {
    for (const child of children) {
      if (!child) continue;

      if (child.kind === "text") {
        const text = child.value ?? child.text ?? "";
        if (text.trim()) {
          lines.push(`${elVar}.appendChild(document.createTextNode(${JSON.stringify(text)}));`);
        }
      } else if (child.kind === "markup") {
        const childVar = emitCreateElementFromMarkup(child, lines);
        lines.push(`${elVar}.appendChild(${childVar});`);
      } else if (child.kind === "logic") {
        // Logic block in markup — emit as a text node with the evaluated expression
        if (child.body) {
          for (const logicChild of child.body) {
            if (logicChild && logicChild.kind === "bare-expr" && logicChild.expr) {
              const rewritten = rewriteExpr(logicChild.expr);
              lines.push(`${elVar}.appendChild(document.createTextNode(String(${rewritten} ?? "")));`);
            }
          }
        }
      }
    }
  }

  return elVar;
}

// ---------------------------------------------------------------------------
// Tag expression string parser (for tokenizer-fragmented lift expressions)
// ---------------------------------------------------------------------------

/**
 * Parse a tokenizer-spaced tag expression string into { tag, attrsStr, content }.
 *
 * @param {string} expr
 * @returns {{ tag: string, attrsStr: string, content: string } | null}
 */
function parseTagExprString(expr) {
  if (!expr) return null;
  const s = expr.trim();
  if (s[0] != '<') return null;

  let i = 1;

  // Skip whitespace after <
  while (i < s.length && /\s/.test(s[i])) i++;

  // Skip if next char is / (closing tag)
  if (i < s.length && s[i] === '/') return null;

  // Read tag name
  const tagStart = i;
  while (i < s.length && /[A-Za-z0-9-]/.test(s[i])) i++;
  if (i === tagStart) return null; // No tag name
  const tag = s.slice(tagStart, i);

  // Read attributes — everything up to (but not including) the first unquoted >
  const attrsStart = i;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '>') break;
    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      while (i < s.length && s[i] != q) {
        if (s[i] === '\\') i++;
        i++;
      }
      if (i < s.length) i++; // consume closing quote
      continue;
    }
    i++;
  }
  const attrsStr = s.slice(attrsStart, i).trim();

  // Consume the > if present
  if (i < s.length && s[i] === '>') i++;

  // Skip whitespace after >
  while (i < s.length && /\s/.test(s[i])) i++;

  // Content is everything after the `>`, with the trailing `/` (lift closer) stripped
  let content = s.slice(i);
  content = content.replace(/\s*\/\s*$/, "").trim();

  return { tag, attrsStr, content };
}

/**
 * Emit createElement JS from a tokenizer-spaced tag expression string.
 * Returns { lines: string[], varName: string } or null if not a tag expression.
 *
 * @param {string} expr — raw tokenizer string like `< li > ${item} /`
 * @returns {{ lines: string[], varName: string } | null}
 */
function emitCreateElementFromExprString(expr) {
  const parsed = parseTagExprString(expr);
  if (!parsed) return null;

  const { tag, attrsStr, content } = parsed;
  const isVoid = VOID_ELEMENTS.has(tag);
  const lines = [];
  const elVar = genVar(`lift_el`);

  lines.push(`const ${elVar} = document.createElement(${JSON.stringify(tag)});`);

  // Parse and emit attributes
  if (attrsStr) {
    const attrs = parseAttrs(attrsStr);
    const attrLines = emitSetAttrs(elVar, attrs);
    for (const l of attrLines) lines.push(l);
  }

  // Emit content only if it doesn't contain nested tag markers.
  if (content && !isVoid && !hasNestedTag(content)) {
    const parts = [];
    parseLiftContentParts(content, parts);
    if (parts.length > 0) {
      const contentLines = emitSetContent(elVar, parts);
      for (const l of contentLines) lines.push(l);
    }
  }

  return { lines, varName: elVar };
}

// ---------------------------------------------------------------------------
// Fragmented for-loop body detection
// ---------------------------------------------------------------------------

/**
 * Check if a for-loop body contains a lift-expr followed by fragmented HTML/logic nodes.
 */
export function hasFragmentedLiftBody(body) {
  if (!body || body.length < 2) return false;
  const hasLift = body.some(n => n && n.kind === "lift-expr");
  // Pattern 1: bare-expr with HTML chars (< > /) — explicit HTML fragment
  const hasBareHtmlFragment = body.some(n => n && n.kind === "bare-expr" &&
    typeof n.expr === "string" && /[<>/]/.test(n.expr));
  // Pattern 2: tilde-decl with lowercase HTML attribute name — attribute tokens misparsed
  const hasTildeDeclFragment = body.some(n => n && n.kind === "tilde-decl" &&
    typeof n.name === "string" && /^[a-z][a-z0-9\-_:]*$/.test(n.name));
  return hasLift && (hasBareHtmlFragment || hasTildeDeclFragment);
}

// ---------------------------------------------------------------------------
// emitForStmtWithContainer — for-loop emitter that routes inner lift to parent
// ---------------------------------------------------------------------------

/**
 * Emit a for-of loop where inner lift-expr calls target containerElVar instead
 * of calling _scrml_lift() globally.
 *
 * @param {object} forNode — for-stmt AST node
 * @param {string} containerElVar — variable name of the enclosing element to append to
 * @returns {string}
 */
function emitForStmtWithContainer(forNode, containerElVar) {
  const lines = [];
  let varName = forNode.variable ?? forNode.name ?? 'item';
  let iterable = forNode.iterable ?? forNode.collection ?? '[]';

  if (typeof iterable === 'string') {
    // C-style for loop: pass through to emitLogicNode (containerVar not needed for C-style)
    const cStyleMatch = iterable.match(/^\(\s*(.*?)\s*;\s*(.*?)\s*;\s*(.*?)\s*\)$/s);
    if (cStyleMatch) {
      return emitLogicNode(forNode, {});
    }
    // Match "( [let|const|var] VAR of EXPR )" or "( VAR of EXPR )"
    const forOfMatch = iterable.match(/^\(\s*(?:(?:let|const|var)\s+)?(\w+)\s+of\s+(.*)\s*\)$/s);
    if (forOfMatch) {
      if (varName === 'item' && forOfMatch[1] != 'item') {
        varName = forOfMatch[1];
      }
      iterable = forOfMatch[2].trim();
    }
  }

  const rewrittenIterable = rewriteExpr(iterable);
  lines.push(`for (const ${varName} of ${rewrittenIterable}) {`);

  const body = forNode.body ?? [];
  for (const child of body) {
    if (!child) continue;
    if (child.kind === 'lift-expr') {
      // Route inner lift to the container element — NOT to _scrml_lift() globally
      const code = emitLiftExpr(child, { containerVar: containerElVar });
      if (code) {
        for (const line of code.split('\n')) lines.push('  ' + line);
      }
    } else {
      const code = emitLogicNode(child, {});
      if (code) lines.push('  ' + code);
    }
  }

  lines.push('}');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// emitConsolidatedLift — fragmented for-loop body path
// ---------------------------------------------------------------------------

/**
 * Emit createElement JS from a fragmented for-loop body.
 *
 * @param {object[]} body
 * @param {object} [opts] — optional context
 * @param {string} [opts.containerVar] — when set, emit `containerVar.appendChild(factory())`
 * @param {boolean} [opts.directReturn] — when set, emit return rootVar instead of lift call
 */
export function emitConsolidatedLift(body, opts = {}) {
  // Find the first lift-expr
  const liftIdx = body.findIndex(n => n && n.kind === "lift-expr");
  if (liftIdx === -1) return "";

  const containerVar = opts.containerVar ?? null;
  const directReturn = opts.directReturn ?? false;

  // Pre-statements (before the lift)
  const preStatements = [];
  for (let i = 0; i < liftIdx; i++) {
    const child = body[i];
    if (!child) continue;
    const code = emitLogicNode(child, opts);
    if (code) preStatements.push(code);
  }

  // Check if the lift-expr has a full markup AST — emit directly
  const firstLift = body[liftIdx];
  if (firstLift && firstLift.kind === "lift-expr" && firstLift.expr) {
    const liftExpr = firstLift.expr;
    if (liftExpr.kind === "markup" && liftExpr.node) {
      const lines = [];
      const rootVar = emitCreateElementFromMarkup(liftExpr.node, lines);
      const factoryBody = lines.join("\n    ");
      let factoryCode;
      if (directReturn) {
        factoryCode = `${factoryBody}\n  return ${rootVar};`;
      } else if (containerVar) {
        factoryCode = `${containerVar}.appendChild((() => {\n    ${factoryBody}\n    return ${rootVar};\n  })());`;
      } else {
        factoryCode = `_scrml_lift(() => {\n    ${factoryBody}\n    return ${rootVar};\n  });`;
      }
      const allLines = [...preStatements, factoryCode];
      return allLines.join("\n  ");
    }
  }

  // -----------------------------------------------------------------------
  // Nested element tree builder
  // -----------------------------------------------------------------------

  const lines = [];
  // Element stack: [{ varName, tag }]
  const elementStack = [];

  // pendingAttrName: tracks when a BLOCK_REF splits an attribute
  let pendingAttrName = null;

  /** Get the current parent element variable (top of stack) */
  function currentParent() {
    return elementStack.length > 0 ? elementStack[elementStack.length - 1].varName : null;
  }

  /** Get the current element entry (top of stack). */
  function currentElement() {
    return elementStack.length > 0 ? elementStack[elementStack.length - 1] : null;
  }

  /**
   * Create a new element, emit setAttribute calls, and optionally
   * appendChild to the current parent.
   */
  function pushElement(tag, attrsStr) {
    pendingAttrName = null;
    const elVar = genVar(`lift_el`);
    lines.push(`const ${elVar} = document.createElement(${JSON.stringify(tag)});`);
    if (attrsStr) {
      // Detect and strip a trailing incomplete attribute (e.g. `checked =` or `data - id =`)
      let cleanAttrsStr = attrsStr.trim();
      const trailingMatch = /([a-z][a-z0-9_]*(?:\s*-\s*[a-z][a-z0-9_]*)*)\s*=\s*$/.exec(cleanAttrsStr);
      if (trailingMatch) {
        cleanAttrsStr = cleanAttrsStr.slice(0, cleanAttrsStr.length - trailingMatch[0].length).trim();
        pendingAttrName = trailingMatch[1].replace(/\s*-\s*/g, "-");
      }
      const attrs = parseAttrs(cleanAttrsStr);
      const attrLines = emitSetAttrs(elVar, attrs);
      for (const l of attrLines) lines.push(l);
    }
    const parent = currentParent();
    if (parent) {
      lines.push(`${parent}.appendChild(${elVar});`);
    }
    elementStack.push({ varName: elVar, tag });
    return elVar;
  }

  /** Pop element stack on closing tag. */
  function popElement(tag) {
    pendingAttrName = null;
    if (elementStack.length > 1) {
      elementStack.pop();
    }
  }

  /** Add text/expression content to the current element. */
  function addContentToCurrentElement(parts) {
    const parent = currentParent();
    if (!parent || parts.length === 0) return;
    // Do not add text content to void elements (e.g. <input>, <br>, <img>)
    const curEl = currentElement();
    if (curEl && VOID_ELEMENTS.has(curEl.tag)) return;
    const contentLines = emitSetContent(parent, parts);
    for (const l of contentLines) lines.push(l);
  }

  /**
   * Process a content string that may contain multiple nested tags.
   */
  function processContentWithTags(content) {
    if (!content || !content.trim()) return;

    // If no HTML tags at all, treat as plain content
    if (!hasNestedTag(content) && !containsClosingTag(content)) {
      const parts = [];
      // Strip trailing / (lift closer)
      const cleaned = content.replace(/\s*\/\s*$/, "").trim();
      if (cleaned) {
        parseLiftContentParts(cleaned, parts);
        addContentToCurrentElement(parts);
      }
      return;
    }

    const segments = splitTagSegments(content);
    for (const seg of segments) {
      if (seg.type === "open-tag") {
        pushElement(seg.tag, seg.attrsStr || "");
      } else if (seg.type === "close-tag") {
        popElement(seg.tag);
      } else if (seg.type === "text") {
        let text = seg.text;
        // Strip trailing / (lift closer)
        text = text.replace(/\s*\/\s*$/, "").trim();
        // Skip bare > fragments (tag closers that got separated from the tag)
        if (!text || text === ">") continue;
        const parts = [];
        parseLiftContentParts(text, parts);
        addContentToCurrentElement(parts);
      }
    }
  }

  // Parse the root element from the lift-expr
  let rootTag = "div";
  let rootAttrsStr = "";
  let rootContent = "";

  const liftNode = body[liftIdx];
  if (liftNode && liftNode.kind === "lift-expr" && liftNode.expr) {
    const liftExpr = liftNode.expr;
    if (liftExpr.kind === "expr" && typeof liftExpr.expr === "string") {
      const expr = liftExpr.expr.trim();
      const parsed = parseTagExprString(expr);
      if (parsed) {
        rootTag = parsed.tag;
        rootAttrsStr = parsed.attrsStr;
        rootContent = parsed.content || "";
      }
    }
  }

  // Create the root element
  const rootVar = pushElement(rootTag, rootAttrsStr);

  // Process any content/nested tags from the lift-expr itself
  if (rootContent) {
    processContentWithTags(rootContent);
  }

  // Walk remaining body nodes after the lift-expr
  for (let i = liftIdx + 1; i < body.length; i++) {
    const child = body[i];
    if (!child) continue;

    if (child.kind === "logic" && child.body) {
      // Logic block: ${expr} interpolation or ${for loop} or ${if stmt}
      const hasComplexChildren = child.body.some(n => n && (
        n.kind === "for-stmt" || n.kind === "if-stmt" || n.kind === "while-stmt" ||
        n.kind === "lift-expr" || n.kind === "function-decl"
      ));

      if (hasComplexChildren) {
        // Complex logic block — emit each child, routing lift output to current parent
        const parent = currentParent();
        for (const logicChild of child.body) {
          if (!logicChild) continue;
          if (logicChild.kind === "lift-expr") {
            const code = emitLiftExpr(logicChild, { containerVar: parent });
            if (code) lines.push(code);
          } else if (logicChild.kind === "for-stmt" && parent) {
            const code = emitForStmtWithContainer(logicChild, parent);
            if (code) lines.push(code);
          } else {
            // Other nodes (if-stmt, while-stmt, function-decl) — emit via emitLogicNode
            const code = emitLogicNode(logicChild, opts);
            if (code) lines.push(code);
          }
        }
      } else {
        // Simple interpolation — extract bare-expr values as content or attribute values
        for (const logicChild of child.body) {
          if (logicChild && logicChild.kind === "bare-expr" && logicChild.expr) {
            if (pendingAttrName !== null) {
              // This logic node is the value for a BLOCK_REF-split attribute
              const elVar = currentParent();
              if (elVar) {
                const attrName = pendingAttrName;
                pendingAttrName = null;
                const rewritten = rewriteExpr(logicChild.expr);
                lines.push(`${elVar}.setAttribute(${JSON.stringify(attrName)}, String(${rewritten} ?? ""));`);
              }
            } else {
              const parts = [{ type: "expr", value: logicChild.expr }];
              addContentToCurrentElement(parts);
            }
          }
        }
      }
    } else if (child.kind === "bare-expr" && typeof child.expr === "string") {
      let expr = child.expr.trim();
      if (!expr) continue;
      // Skip bare / (lift closer)
      if (/^\/\s*$/.test(expr)) continue;
      // Skip bare >
      if (expr === ">") continue;

      // Detect attribute continuation
      const isAttrContinuation = !expr.startsWith("<") &&
        /^[a-z][a-z0-9\-_:]*\s*=/.test(expr);
      if (isAttrContinuation) {
        const elEntry = currentElement();
        if (elEntry) {
          const firstTagIdx = expr.search(/<\s*[A-Za-z/]/);
          const attrPart = firstTagIdx === -1 ? expr : expr.slice(0, firstTagIdx);
          const remainder = firstTagIdx === -1 ? "" : expr.slice(firstTagIdx);
          const attrs = parseAttrs(attrPart);
          const attrLines = emitSetAttrs(elEntry.varName, attrs);
          for (const l of attrLines) lines.push(l);
          pendingAttrName = null;
          if (remainder.trim()) {
            processContentWithTags(remainder);
          }
        }
        continue;
      }

      // Process content that may contain opening/closing tags
      if (hasNestedTag(expr) || isClosingTagFragment(expr) || containsClosingTag(expr)) {
        processContentWithTags(expr);
      } else {
        // Plain text/expression content
        expr = expr.replace(/\s*\/\s*$/, "").trim();
        if (expr) {
          const parts = [];
          parseLiftContentParts(expr, parts);
          addContentToCurrentElement(parts);
        }
      }
    }
    // tilde-decl: an HTML attribute assignment that the AST builder misidentified as a
    // variable declaration.
    else if (child.kind === "tilde-decl" && /^[a-z][a-z0-9\-_:]*$/.test(child.name || "")) {
      const elEntry = currentElement();
      if (elEntry) {
        const attrName = child.name;
        const rawInit = (child.init || "").trim();

        // Split the init at the first ` / >` self-closer, respecting paren depth.
        let attrValue = rawInit;
        let remainder = "";
        let depth = 0;
        let selfCloserIdx = -1;
        for (let ci = 0; ci < rawInit.length; ci++) {
          if (rawInit[ci] === "(") depth++;
          else if (rawInit[ci] === ")") depth--;
          else if (depth === 0 && rawInit[ci] === "/") {
            let j = ci + 1;
            while (j < rawInit.length && /\s/.test(rawInit[j])) j++;
            if (j < rawInit.length && rawInit[j] === ">") {
              selfCloserIdx = ci;
              break;
            }
          }
        }
        if (selfCloserIdx != -1) {
          attrValue = rawInit.slice(0, selfCloserIdx).trim();
          let afterSelfCloser = selfCloserIdx + 1;
          while (afterSelfCloser < rawInit.length && /\s/.test(rawInit[afterSelfCloser])) afterSelfCloser++;
          afterSelfCloser++; // skip `>`
          while (afterSelfCloser < rawInit.length && /\s/.test(rawInit[afterSelfCloser])) afterSelfCloser++;
          remainder = rawInit.slice(afterSelfCloser).trim();
        }

        // Apply the attribute to the current element
        const syntheticAttrsStr = attrName + " = " + attrValue;
        const attrs = parseAttrs(syntheticAttrsStr);
        const attrLines = emitSetAttrs(elEntry.varName, attrs);
        for (const l of attrLines) lines.push(l);
        pendingAttrName = null;

        // Pop void elements that are now fully closed
        if (selfCloserIdx != -1 && VOID_ELEMENTS.has(elEntry.tag)) {
          popElement(elEntry.tag);
        }

        // Process any content following the self-closer
        if (remainder) {
          processContentWithTags(remainder);
        }
      }
    }
    // Other node kinds (for-stmt, if-stmt at top level of body)
    else if (child.kind === "for-stmt") {
      const parent = currentParent();
      if (parent) {
        const code = emitForStmtWithContainer(child, parent);
        if (code) lines.push(code);
      } else {
        const code = emitLogicNode(child, opts);
        if (code) lines.push(code);
      }
    } else if (child.kind === "if-stmt" || child.kind === "while-stmt") {
      const code = emitLogicNode(child, opts);
      if (code) lines.push(code);
    }
  }

  const factoryBody = lines.join("\n    ");
  let factoryCode;
  if (directReturn) {
    factoryCode = `${factoryBody}\n  return ${rootVar};`;
  } else if (containerVar) {
    factoryCode = `${containerVar}.appendChild((() => {\n    ${factoryBody}\n    return ${rootVar};\n  })());`;
  } else {
    factoryCode = `_scrml_lift(() => {\n    ${factoryBody}\n    return ${rootVar};\n  });`;
  }
  const allLines = [...preStatements, factoryCode];
  return allLines.join("\n  ");
}

// ---------------------------------------------------------------------------
// emitLiftExpr — main entry point
// ---------------------------------------------------------------------------

/**
 * Emit a lift expression — generates a _scrml_lift(() => element) runtime call.
 *
 * @param {object} node — lift-expr AST node
 * @param {object} [opts] — optional context
 * @param {string} [opts.containerVar] — when set, emit `containerVar.appendChild(factory())`
 * @returns {string}
 */
export function emitLiftExpr(node, opts = {}) {
  if (!node || !node.expr) return "";

  const containerVar = opts.containerVar ?? null;
  const liftExpr = node.expr;

  if (liftExpr.kind === "markup" && liftExpr.node) {
    // Full markup AST node — walk recursively and emit createElement chains
    const lines = [];
    const rootVar = emitCreateElementFromMarkup(liftExpr.node, lines);
    const factoryBody = lines.join("\n  ");
    if (containerVar) {
      return `${containerVar}.appendChild((() => {\n  ${factoryBody}\n  return ${rootVar};\n})());`;
    }
    return `_scrml_lift(() => {\n  ${factoryBody}\n  return ${rootVar};\n});`;
  }

  if (liftExpr.kind === "expr" && typeof liftExpr.expr === "string") {
    const expr = liftExpr.expr.trim();

    // Try to parse `< tag attrs > content /` pattern
    const result = emitCreateElementFromExprString(expr);
    if (result) {
      const { lines, varName } = result;
      const factoryBody = lines.join("\n  ");
      if (containerVar) {
        return `${containerVar}.appendChild((() => {\n  ${factoryBody}\n  return ${varName};\n})());`;
      }
      return `_scrml_lift(() => {\n  ${factoryBody}\n  return ${varName};\n});`;
    }

    // No tag pattern — emit as text node with the expression value
    const rewritten = rewriteExpr(expr);
    if (containerVar) {
      return `${containerVar}.appendChild(document.createTextNode(String(${rewritten} ?? "")));`;
    }
    return `_scrml_lift(() => document.createTextNode(String(${rewritten} ?? "")));`;
  }

  return "";
}

// ===========================================================================
// SECTION: emit-control-flow (from emit-control-flow.ts)
// ===========================================================================

// ---------------------------------------------------------------------------
// if / else
// ---------------------------------------------------------------------------

/**
 * Emit an if statement.
 */
export function emitIfStmt(node, opts = {}) {
  const lines = [];
  lines.push(`if (${rewriteExpr(node.condition ?? node.test ?? "true")}) {`);

  const consequent = node.consequent ?? node.body ?? [];

  if (hasFragmentedLiftBody(consequent)) {
    const liftCode = emitConsolidatedLift(consequent);
    if (liftCode) lines.push(`  ${liftCode}`);
  } else {
    for (const child of consequent) {
      const code = emitLogicNode(child, opts);
      if (code) lines.push(`  ${code}`);
    }
  }

  lines.push(`}`);
  if (node.alternate) {
    const alternate = Array.isArray(node.alternate) ? node.alternate : [node.alternate];

    if (hasFragmentedLiftBody(alternate)) {
      lines.push(`else {`);
      const liftCode = emitConsolidatedLift(alternate);
      if (liftCode) lines.push(`  ${liftCode}`);
      lines.push(`}`);
    } else {
      lines.push(`else {`);
      for (const child of alternate) {
        const code = emitLogicNode(child, opts);
        if (code) lines.push(`  ${code}`);
      }
      lines.push(`}`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// for
// ---------------------------------------------------------------------------

/**
 * Emit a for statement.
 *
 * When the iteration source is a reactive variable (`@varName`), the generated JS
 * subscribes to that variable and re-renders the loop body on changes.
 */
export function emitForStmt(node) {
  const lines = [];
  let varName = node.variable ?? node.name ?? "item";
  let iterable = node.iterable ?? node.collection ?? "[]";

  if (typeof iterable === "string") {
    // Check for C-style for loop: "( let i = 0 ; i < 10 ; i++ )"
    const cStyleMatch = iterable.match(/^\(\s*(.*?)\s*;\s*(.*?)\s*;\s*(.*?)\s*\)$/s);
    if (cStyleMatch) {
      const init = rewriteExpr(cStyleMatch[1].trim().replace(/\s*\+\s*\+/g, "++").replace(/\s*-\s*-/g, "--"));
      const cond = rewriteExpr(cStyleMatch[2].trim());
      const update = rewriteExpr(cStyleMatch[3].trim().replace(/\s*\+\s*\+/g, "++").replace(/\s*-\s*-/g, "--"));
      lines.push(`for (${init}; ${cond}; ${update}) {`);

      const body = node.body ?? [];
      for (const child of body) {
        const code = emitLogicNode(child);
        if (code) lines.push(`  ${code}`);
      }
      lines.push(`}`);
      return lines.join("\n");
    }

    // Match "( [let|const|var] VAR of EXPR )" or "( VAR of EXPR )"
    const forOfMatch = iterable.match(/^\(\s*(?:(?:let|const|var)\s+)?(\w+)\s+of\s+(.*)\s*\)$/s);
    if (forOfMatch) {
      if (varName === "item" && forOfMatch[1] != "item") {
        varName = forOfMatch[1];
      }
      iterable = forOfMatch[2].trim();
    }
  }

  // Detect reactive iterable: bare `@varName` (e.g. "@items").
  const reactiveMatch = typeof iterable === "string"
    ? iterable.trim().match(/^@([A-Za-z_$][A-Za-z0-9_$]*)$/)
    : null;

  if (reactiveMatch) {
    // Reactive for/lift path — §6.5.3 with keyed reconciliation
    const reactiveVarName = reactiveMatch[1];
    const wrapperVar = genVar("list_wrapper");
    const renderFn = genVar("render_list");
    const createFnVar = genVar("create_item");
    const tmpContainerVar = genVar("tmp");
    const rewrittenIterable = rewriteExpr(iterable);
    const body = node.body ?? [];

    lines.push(`const ${wrapperVar} = document.createElement("div");`);
    lines.push(`_scrml_lift(${wrapperVar});`);

    lines.push(`function ${createFnVar}(${varName}, _scrml_idx) {`);

    if (hasFragmentedLiftBody(body)) {
      const liftCode = emitConsolidatedLift(body, { directReturn: true });
      if (liftCode) {
        for (const line of liftCode.split("\n")) {
          lines.push(`  ${line}`);
        }
      }
    } else {
      // Fallback: use DocumentFragment for non-consolidated lift bodies
      lines.push(`  const ${tmpContainerVar} = document.createDocumentFragment();`);
      for (const child of body) {
        if (child && child.kind === "lift-expr") {
          const code = emitLiftExpr(child, { containerVar: tmpContainerVar });
          if (code) {
            for (const line of code.split("\n")) {
              lines.push(`  ${line}`);
            }
          }
        } else {
          const code = emitLogicNode(child);
          if (code) {
            for (const line of code.split("\n")) {
              lines.push(`  ${line}`);
            }
          }
        }
      }
      lines.push(`  return ${tmpContainerVar}.firstChild;`);
    }
    lines.push(`}`);

    lines.push(`function ${renderFn}() {`);
    lines.push(`  _scrml_reconcile_list(${wrapperVar}, ${rewrittenIterable}, (item, i) => item?.id !== undefined ? item.id : i, ${createFnVar});`);
    lines.push(`}`);
    lines.push(`${renderFn}();`);
    lines.push(`_scrml_effect_static(${renderFn});`);
    return lines.join("\n");
  }

  // Non-reactive path — plain for loop
  iterable = rewriteExpr(iterable);
  lines.push(`for (const ${varName} of ${iterable}) {`);

  const body = node.body ?? [];

  if (hasFragmentedLiftBody(body)) {
    const liftCode = emitConsolidatedLift(body);
    if (liftCode) {
      lines.push(`  ${liftCode}`);
    }
  } else {
    for (const child of body) {
      const code = emitLogicNode(child);
      if (code) lines.push(`  ${code}`);
    }
  }
  lines.push(`}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// while
// ---------------------------------------------------------------------------

/**
 * Emit a while statement.
 */
export function emitWhileStmt(node) {
  const lines = [];
  const condition = rewriteExpr(node.condition ?? "true");
  lines.push(`while (${condition}) {`);
  for (const child of (node.body ?? [])) {
    const code = emitLogicNode(child);
    if (code) lines.push(`  ${code}`);
  }
  lines.push(`}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// try / catch / finally
// ---------------------------------------------------------------------------

/**
 * Emit a try-catch-finally statement.
 */
export function emitTryStmt(node) {
  const lines = [];
  lines.push(`try {`);
  for (const child of (node.body ?? [])) {
    const code = emitLogicNode(child);
    if (code) {
      for (const line of code.split("\n")) {
        lines.push(`  ${line}`);
      }
    }
  }
  lines.push(`}`);

  if (node.catchNode) {
    let catchParam = node.catchNode.header ? node.catchNode.header.trim() : "";
    if (catchParam.startsWith("(") && catchParam.endsWith(")")) {
      catchParam = catchParam.slice(1, -1).trim();
    }
    const catchParamStr = catchParam ? ` (${catchParam})` : "";
    lines.push(`catch${catchParamStr} {`);
    for (const child of (node.catchNode.body ?? [])) {
      const code = emitLogicNode(child);
      if (code) {
        for (const line of code.split("\n")) {
          lines.push(`  ${line}`);
        }
      }
    }
    lines.push(`}`);
  }

  if (node.finallyNode) {
    lines.push(`finally {`);
    for (const child of (node.finallyNode.body ?? [])) {
      const code = emitLogicNode(child);
      if (code) {
        for (const line of code.split("\n")) {
          lines.push(`  ${line}`);
        }
      }
    }
    lines.push(`}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// match
// ---------------------------------------------------------------------------

/**
 * Parse a single match arm text into a structured arm descriptor.
 *
 * Recognized arm forms (tried in order — new scrml-native syntax first, then legacy fallback):
 *
 * NEW (scrml-native):
 *   1. .Variant => expr          — enum variant (dot-prefix, capital letter required)
 *   2. .Variant(binding) => expr — enum variant with payload binding
 *   3. "string" => expr          — string literal (double-quoted)
 *   4. 'string' => expr          — string literal (single-quoted)
 *   5. else => expr              — wildcard/catch-all arm
 *
 * LEGACY (Rust-style fallback — recognized but not canonical):
 *   6. ::Variant -> expr          — old enum variant syntax
 *   7. ::Variant(binding) -> expr — old enum variant with payload
 *   8. "string" -> expr           — old string literal (double-quoted)
 *   9. 'string' -> expr           — old string literal (single-quoted)
 *  10. _ -> expr                  — old wildcard syntax
 */
function parseMatchArm(trimmed) {
  // NEW Form 1 & 2: .Variant => result or .Variant(binding) => result
  const newVariantMatch = trimmed.match(/^\.\s*([A-Z][A-Za-z0-9_]*)(?:\s*\(\s*(\w+)\s*\))?\s*=>\s*([\s\S]+)$/);
  if (newVariantMatch) {
    return { kind: "variant", test: newVariantMatch[1], binding: newVariantMatch[2] ?? null, result: newVariantMatch[3].trim() };
  }

  // NEW Form 3: "string" => expr (double-quoted)
  const newDqStringMatch = trimmed.match(/^"((?:[^"\\]|\\.)*)"\s*=>\s*([\s\S]+)$/);
  if (newDqStringMatch) {
    return { kind: "string", test: `"${newDqStringMatch[1]}"`, binding: null, result: newDqStringMatch[2].trim() };
  }

  // NEW Form 4: 'string' => expr (single-quoted)
  const newSqStringMatch = trimmed.match(/^'((?:[^'\\]|\\.)*)'\s*=>\s*([\s\S]+)$/);
  if (newSqStringMatch) {
    return { kind: "string", test: `'${newSqStringMatch[1]}'`, binding: null, result: newSqStringMatch[2].trim() };
  }

  // NEW Form 5a: not => expr — absence arm (§42: `not` in match arms)
  const notArmMatch = trimmed.match(/^not\s*=>\s*([\s\S]+)$/);
  if (notArmMatch) {
    return { kind: "not", test: null, binding: null, result: notArmMatch[1].trim() };
  }

  // NEW Form 5b: else => expr (or bare: else expr) — wildcard arm
  const newWildcardMatch = trimmed.match(/^else\s*(?:=>\s*)?([\s\S]+)$/);
  if (newWildcardMatch) {
    return { kind: "wildcard", test: null, binding: null, result: newWildcardMatch[1].trim() };
  }

  // LEGACY Form 1 & 2: ::Variant -> result or ::Variant(binding) -> result
  const legacyVariantMatch = trimmed.match(/^::\s*(\w+)(?:\s*\(\s*(\w+)\s*\))?\s*->\s*([\s\S]+)$/);
  if (legacyVariantMatch) {
    return { kind: "variant", test: legacyVariantMatch[1], binding: legacyVariantMatch[2] ?? null, result: legacyVariantMatch[3].trim() };
  }

  // LEGACY Form 3: "string" -> expr (double-quoted)
  const legacyDqStringMatch = trimmed.match(/^"((?:[^"\\]|\\.)*)"\s*->\s*([\s\S]+)$/);
  if (legacyDqStringMatch) {
    return { kind: "string", test: `"${legacyDqStringMatch[1]}"`, binding: null, result: legacyDqStringMatch[2].trim() };
  }

  // LEGACY Form 4: 'string' -> expr (single-quoted)
  const legacySqStringMatch = trimmed.match(/^'((?:[^'\\]|\\.)*)'\s*->\s*([\s\S]+)$/);
  if (legacySqStringMatch) {
    return { kind: "string", test: `'${legacySqStringMatch[1]}'`, binding: null, result: legacySqStringMatch[2].trim() };
  }

  // LEGACY Form 5: _ -> expr (old wildcard)
  const legacyWildcardMatch = trimmed.match(/^_\s*->\s*([\s\S]+)$/);
  if (legacyWildcardMatch) {
    return { kind: "wildcard", test: null, binding: null, result: legacyWildcardMatch[1].trim() };
  }

  // §42 presence arm: (identifier) => expr
  const presenceArmMatch = trimmed.match(/^\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)\s*=>\s*([\s\S]+)$/);
  if (presenceArmMatch) {
    return { kind: "wildcard", test: null, binding: presenceArmMatch[1], result: presenceArmMatch[2].trim() };
  }

  return null;
}

/**
 * Split a string containing multiple concatenated match arms into individual arm strings.
 */
function splitMultiArmString(s) {
  const armStartPositions = [];
  let inString = null;
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    // Track string literal boundaries (skip content inside strings)
    if (inString !== null) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === inString) { inString = null; }
      i++;
      continue;
    }

    // Skip whitespace
    if (/\s/.test(ch)) { i++; continue; }

    // New variant arm: .UpperCase or . UpperCase (BS adds spaces around .)
    if (ch === "." && i + 1 < s.length) {
      let nextNonSpace = i + 1;
      while (nextNonSpace < s.length && s[nextNonSpace] === " ") nextNonSpace++;
      if (nextNonSpace < s.length && /[A-Z]/.test(s[nextNonSpace])) {
        const prevCh = i > 0 ? s[i - 1] : null;
        if (prevCh === null || !/[A-Za-z0-9_$]/.test(prevCh)) {
          armStartPositions.push(i);
        }
      }
      i++;
      continue;
    }

    // String literal arm: "..." => / "..." -> or '...' => / '...' ->
    if (ch === '"' || ch === "'") {
      const q = ch;
      let j = i + 1;
      while (j < s.length && s[j] != q) {
        if (s[j] === "\\") j++;
        j++;
      }
      if (j < s.length) {
        let k = j + 1;
        while (k < s.length && /\s/.test(s[k])) k++;
        if (s.slice(k, k + 2) === "=>" || s.slice(k, k + 2) === "->") {
          armStartPositions.push(i);
          inString = q;
          i++;
          continue;
        }
      }
      // Not an arm boundary — string is inside a result expression; track it
      inString = q;
      i++;
      continue;
    }

    // §42 absence arm: not => expr
    if (s.slice(i, i + 3) === "not" && (i + 3 >= s.length || /[\s=]/.test(s[i + 3]))) {
      const prevCh = i > 0 ? s[i - 1] : null;
      if (prevCh === null || /\s/.test(prevCh)) {
        let k = i + 3;
        while (k < s.length && /\s/.test(s[k])) k++;
        if (s.slice(k, k + 2) === "=>") {
          armStartPositions.push(i);
          i += 3;
          continue;
        }
      }
    }

    // Wildcard arm: else
    if (s.slice(i, i + 4) === "else" && (i + 4 >= s.length || /[\s=>]/.test(s[i + 4]))) {
      const prevCh = i > 0 ? s[i - 1] : null;
      if (prevCh === null || /\s/.test(prevCh)) {
        armStartPositions.push(i);
        i += 4;
        continue;
      }
    }

    // Legacy variant arm: ::Letter
    if (ch === ":" && i + 1 < s.length && s[i + 1] === ":" && i + 2 < s.length && /[A-Za-z_]/.test(s[i + 2])) {
      armStartPositions.push(i);
      i += 2;
      continue;
    }

    // Legacy wildcard: _ ->
    if (ch === "_") {
      let k = i + 1;
      while (k < s.length && /\s/.test(s[k])) k++;
      if (s.slice(k, k + 2) === "->") {
        armStartPositions.push(i);
      }
    }

    // §42 presence arm: (identifier) => — only when preceded by whitespace or start
    if (ch === "(") {
      const prevCh = i > 0 ? s[i - 1] : null;
      if (prevCh === null || /\s/.test(prevCh)) {
        const presenceRe = /^\(\s*[A-Za-z_$][A-Za-z0-9_$]*\s*\)\s*=>/;
        if (presenceRe.test(s.slice(i))) {
          armStartPositions.push(i);
        }
      }
    }

    i++;
  }

  if (armStartPositions.length <= 1) return [s];

  const result = [];
  for (let idx = 0; idx < armStartPositions.length; idx++) {
    const start = armStartPositions[idx];
    const end = idx + 1 < armStartPositions.length ? armStartPositions[idx + 1] : s.length;
    const arm = s.slice(start, end).trim();
    if (arm) result.push(arm);
  }
  return result.length > 0 ? result : [s];
}

/**
 * Emit a match expression compiled to a JS if/else IIFE.
 */
export function emitMatchExpr(node) {
  const header = rewriteExpr((node.header ?? "").trim());
  const body = node.body ?? [];

  const tmpVar = genVar("match");

  const arms = [];
  for (const child of body) {
    if (!child) continue;
    const armExpr = child.expr ?? child.header ?? "";
    if (typeof armExpr != "string") continue;
    const trimmed = armExpr.trim();
    if (!trimmed) continue;

    // A single body child may contain all arms concatenated on one line.
    const armStrings = splitMultiArmString(trimmed);
    for (const armStr of armStrings) {
      const arm = parseMatchArm(armStr);
      if (arm) arms.push(arm);
    }
  }

  if (arms.length === 0) {
    return `/* match expression could not be compiled */ ${rewriteExpr(header)};`;
  }

  const iifeLines = [];
  iifeLines.push(`(function() {`);
  iifeLines.push(`  const ${tmpVar} = ${header};`);

  let conditionIndex = 0;
  for (const arm of arms) {
    if (arm.kind === "wildcard") {
      if (arm.binding) {
        // §42 presence arm: (x) => expr — bind x to the matched value
        iifeLines.push(`  else { const ${arm.binding} = ${tmpVar}; return ${rewriteExpr(arm.result)}; }`);
      } else {
        iifeLines.push(`  else return ${rewriteExpr(arm.result)};`);
      }
    } else {
      const prefix = conditionIndex === 0 ? "if" : "else if";
      let condition;
      if (arm.kind === "not") {
        // §42: `not` match arm checks for absence (null or undefined)
        condition = `${tmpVar} === null || ${tmpVar} === undefined`;
      } else if (arm.kind === "variant") {
        condition = `${tmpVar} === "${arm.test}"`;
      } else {
        condition = `${tmpVar} === ${arm.test}`;
      }
      iifeLines.push(`  ${prefix} (${condition}) return ${rewriteExpr(arm.result)};`);
      conditionIndex++;
    }
  }

  iifeLines.push(`})()`);
  return iifeLines.join("\n");
}

// ---------------------------------------------------------------------------
// switch
// ---------------------------------------------------------------------------

/**
 * Emit a switch statement.
 */
export function emitSwitchStmt(node) {
  const header = rewriteExpr((node.header ?? "").trim());
  const lines = [];
  let cleanHeader = header;
  if (cleanHeader.startsWith("(") && cleanHeader.endsWith(")")) {
    cleanHeader = cleanHeader.slice(1, -1).trim();
  }
  lines.push(`switch (${cleanHeader}) {`);

  const body = node.body ?? [];
  let i = 0;
  while (i < body.length) {
    const child = body[i];
    if (!child) { i++; continue; }

    if (child.kind === "bare-expr" && typeof child.expr === "string") {
      const exprTrimmed = child.expr.trim();

      const breakCaseMatch = exprTrimmed.match(/^break\s+(case\s+.*|default\s*:.*)$/s);
      if (breakCaseMatch) {
        lines.push(`    break;`);
        lines.push(`  }`);
        const caseLabel = breakCaseMatch[1].trim();
        lines.push(`  ${rewriteExpr(caseLabel)} {`);
        i++;
        continue;
      }

      if (/^case\s/.test(exprTrimmed) || /^default\s*:/.test(exprTrimmed)) {
        lines.push(`  ${rewriteExpr(exprTrimmed)} {`);
        i++;
        continue;
      }
    }

    const code = emitLogicNode(child);
    if (code) {
      for (const line of code.split("\n")) {
        lines.push(`    ${line}`);
      }
    }
    i++;
  }

  if (body.some(c => c && c.kind === "bare-expr" && typeof c.expr === "string" &&
    (/^case\s/.test(c.expr.trim()) || /^default\s*:/.test(c.expr.trim()) || /^break\s+(case|default)/.test(c.expr.trim())))) {
    lines.push(`  }`);
  }

  lines.push(`}`);
  return lines.join("\n");
}

// ===========================================================================
// SECTION: emit-logic (from emit-logic.ts)
// ===========================================================================

// ---------------------------------------------------------------------------
// Deep reactive wrapping helper (Reactivity Phase 1)
// ---------------------------------------------------------------------------

/**
 * Wrap a rewritten expression with _scrml_deep_reactive() if the original
 * expression looks like it produces an object or array literal.
 */
function _wrapDeepReactive(rewrittenExpr, rawExpr) {
  const trimmed = rawExpr.trim();
  if (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("new ") ||
    trimmed.startsWith("Array") ||
    trimmed.startsWith("Object")
  ) {
    return `_scrml_deep_reactive(${rewrittenExpr})`;
  }
  return rewrittenExpr;
}

// ---------------------------------------------------------------------------
// Helper: emit a guarded-expr arm body
// ---------------------------------------------------------------------------

function emitArmBody(arm, errVar) {
  const handler = (arm.handler ?? "").trim();
  if (!handler) return "";
  const rewritten = rewriteExpr(handler);
  if (rewritten.trim().startsWith("{")) {
    return rewritten.trim().slice(1, -1).trim();
  }
  return rewritten.trim().endsWith(";") ? rewritten.trim() : rewritten.trim() + ";";
}

// ---------------------------------------------------------------------------
// Helpers for 4-argument _scrml_meta_effect emission (§22.5)
// ---------------------------------------------------------------------------

/**
 * Emit the capturedBindings argument for _scrml_meta_effect.
 * Reads node.capturedScope (set by meta-checker.ts).
 * Returns "null" if no scope data is available.
 */
function emitCapturedBindings(node) {
  const scope = node.capturedScope;
  if (!Array.isArray(scope) || scope.length === 0) return "null";

  const props = [];
  for (const entry of scope) {
    const { name, kind } = entry;
    if (!name || typeof name != "string") continue;
    if (kind === "reactive") {
      // Getter returns live reactive value; auto-tracking intercepts the read
      props.push(`  get ${name}() { return _scrml_reactive_get("${name}"); }`);
    } else {
      // let/const/function — direct reference to the compiled JS variable
      props.push(`  ${name}: ${name}`);
    }
  }

  if (props.length === 0) return "null";
  return ["Object.freeze({", ...props, "})"].join("\n");
}

/**
 * Emit the typeRegistry argument for _scrml_meta_effect.
 * Reads node.typeRegistrySnapshot (set by meta-checker.ts).
 * Returns "null" if no type data is available.
 */
function emitTypeRegistryLiteral(node) {
  const entries = node.typeRegistrySnapshot;
  if (!Array.isArray(entries) || entries.length === 0) return "null";

  const typeProps = [];
  for (const entry of entries) {
    if (!entry.name || typeof entry.name != "string") continue;
    const typeData = serializeTypeEntry(entry);
    typeProps.push(`  ${JSON.stringify(entry.name)}: ${typeData}`);
  }

  if (typeProps.length === 0) return "null";
  return ["({", ...typeProps, "})"].join("\n");
}

/**
 * Serialize a single TypeRegistryEntry to a JavaScript object literal string.
 */
function serializeTypeEntry(entry) {
  const parts = [`kind: ${JSON.stringify(entry.kind)}`];

  if (entry.kind === "enum") {
    const variants = entry.variants ?? [];
    const variantStrings = variants.map(v =>
      `{name: ${JSON.stringify(v.name)}}`
    );
    parts.push(`variants: [${variantStrings.join(", ")}]`);
  } else if (entry.kind === "struct") {
    const fields = entry.fields ?? [];
    const fieldStrings = fields.map(f =>
      `{name: ${JSON.stringify(f.name)}, type: ${JSON.stringify(f.type)}}`
    );
    parts.push(`fields: [${fieldStrings.join(", ")}]`);
  } else if (entry.kind === "state") {
    const attrs = entry.attributes ?? [];
    const attrStrings = attrs.map(a =>
      `{name: ${JSON.stringify(a.name)}, type: ${JSON.stringify(a.type)}}`
    );
    parts.push(`attributes: [${attrStrings.join(", ")}]`);
  }

  return `{${parts.join(", ")}}`;
}

// ---------------------------------------------------------------------------
// §22.4.2 reflect() rewrite for runtime meta blocks
// ---------------------------------------------------------------------------

const REFLECT_CALL_RE = /\breflect\s*\(\s*([^)]*)\s*\)/g;

export function rewriteReflectForRuntime(code) {
  if (!code || typeof code != "string") return code;
  return code.replace(REFLECT_CALL_RE, (_match, arg) => {
    const trimmed = (arg || "").trim();
    if (!trimmed) return `meta.types.reflect(${trimmed})`;
    // Already a string literal — pass through
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return `meta.types.reflect(${trimmed})`;
    }
    // Bare identifier — check if PascalCase (type name) or variable
    if (/^[A-Z][A-Za-z0-9_$]*$/.test(trimmed)) {
      // PascalCase type name → quote it
      return `meta.types.reflect("${trimmed}")`;
    }
    // camelCase, @var, or complex expression — leave as-is
    return `meta.types.reflect(${trimmed})`;
  });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function emitLogicNode(node, opts = {}) {
  if (!node || typeof node != "object") return "";

  // §4.12.6: Inherit dbVar from node annotation if not already set in opts
  if (!opts.dbVar && node._dbVar) {
    opts = { ...opts, dbVar: node._dbVar };
  }

  const derivedNames = opts.derivedNames ?? null;

  switch (node.kind) {
    case "bare-expr": {
      let bareExpr = node.expr ?? "";
      if (bareExpr.trim() === "/" || bareExpr.trim() === "") return "";

      if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(bareExpr.trim())) return "";

      bareExpr = stripLeakedComments(bareExpr);

      // §42 Presence guard: `( identifier ) => { body }` → `if (x !== null && x !== undefined) { body }`
      const presenceGuardMatch = bareExpr.trim().match(/^\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)\s*=>\s*\{([\s\S]*)\}\s*$/);
      if (presenceGuardMatch) {
        const varName = presenceGuardMatch[1];
        const body = presenceGuardMatch[2];
        const rewrittenBody = rewriteExpr(body.trim());
        return `if (${varName} !== null && ${varName} !== undefined) {\n  ${rewrittenBody}\n}`;
      }

      const destructMatch = bareExpr.trim().match(/^\{\s*([a-zA-Z_$][\w$]*(?:\s*,\s*[a-zA-Z_$][\w$]*)*)\s*\}\s*=\s*([\s\S]+)$/);
      if (destructMatch) {
        const vars = destructMatch[1];
        const init = destructMatch[2].trim();
        const initSplit = splitBareExprStatements(init);
        if (initSplit.length > 1) {
          const lines = [`const { ${vars} } = ${rewriteExpr(initSplit[0].trim())};`];
          for (let i = 1; i < initSplit.length; i++) {
            const s = initSplit[i].trim();
            if (s) lines.push(`${rewriteExpr(s)};`);
          }
          return lines.filter(l => l != ";").join("\n");
        }
        return `const { ${vars} } = ${rewriteExpr(init)};`;
      }

      const splitStmts = splitBareExprStatements(bareExpr);
      if (splitStmts.length > 1) {
        return splitStmts
          .map(s => s.trim())
          .filter(s => s && !isLeakedComment(s))
          .map(s => `${rewriteExpr(s)};`)
          .filter(s => s != ";")
          .join("\n");
      }
      const trimmed = bareExpr.trim();
      if (isLeakedComment(trimmed)) return `// ${trimmed}`;
      return `${rewriteExpr(bareExpr)};`;
    }

    case "let-decl": {
      const letInit = node.init ?? "";
      if (typeof letInit === "string" && /@[A-Za-z_$][A-Za-z0-9_$]*\s*=/.test(letInit)) {
        return splitMergedStatements(node.name, letInit, "let");
      }
      if (typeof letInit === "string" && letInit.trim()) {
        const letSplit = splitBareExprStatements(letInit);
        if (letSplit.length > 1) {
          const lines = [`let ${node.name} = ${rewriteExpr(letSplit[0].trim())};`];
          for (let i = 1; i < letSplit.length; i++) {
            const s = letSplit[i].trim();
            if (s) lines.push(`${rewriteExpr(s)};`);
          }
          return lines.filter(l => l != ";").join("\n");
        }
      }
      return `let ${node.name}${letInit ? ` = ${rewriteExpr(letInit)}` : ""};`;
    }

    case "const-decl":
    case "tilde-decl": {
      if (!node.name) return "";
      const constInit = node.init ?? "";
      if (typeof constInit === "string" && /@[A-Za-z_$][A-Za-z0-9_$]*\s*=/.test(constInit)) {
        return splitMergedStatements(node.name, constInit, "const");
      }
      if (typeof constInit === "string" && constInit.trim()) {
        const constSplit = splitBareExprStatements(constInit);
        if (constSplit.length > 1) {
          const lines = [`const ${node.name} = ${rewriteExpr(constSplit[0].trim())};`];
          for (let i = 1; i < constSplit.length; i++) {
            const s = constSplit[i].trim();
            if (s) lines.push(`${rewriteExpr(s)};`);
          }
          return lines.filter(l => l != ";").join("\n");
        }
      }
      return `const ${node.name}${constInit ? ` = ${rewriteExpr(constInit)}` : ""};`;
    }

    case "state-decl": {
      const initStr = node.init ?? "undefined";
      const ctx = opts.encodingCtx;
      const encodedName = ctx ? ctx.encode(node.name) : node.name;
      if (typeof initStr === "string" && /\s+(?:@[A-Za-z_$]|let\s|const\s)/.test(initStr)) {
        return splitMergedStatements(node.name, initStr, "reactive");
      }
      if (typeof initStr === "string" && initStr != "undefined") {
        const initSplit = splitBareExprStatements(initStr);
        if (initSplit.length > 1) {
          const firstExpr = rewriteExpr(initSplit[0].trim());
          const wrappedFirst = _wrapDeepReactive(firstExpr, initSplit[0].trim());
          const lines = [`_scrml_reactive_set(${JSON.stringify(encodedName)}, ${wrappedFirst});`];
          for (let i = 1; i < initSplit.length; i++) {
            const s = initSplit[i].trim();
            if (s) lines.push(`${rewriteExpr(s)};`);
          }
          return lines.filter(l => l != ";").join("\n");
        }
      }
      const rewrittenInit = rewriteExpr(initStr);
      const wrappedInit = _wrapDeepReactive(rewrittenInit, initStr);
      return `_scrml_reactive_set(${JSON.stringify(encodedName)}, ${wrappedInit});`;
    }

    case "reactive-derived-decl": {
      // const @name = expr → derived reactive value (§6.6)
      const derivedInit = node.init ?? "";
      const reactiveDepsFound = extractReactiveDeps(derivedInit);
      const hasReactiveDeps = reactiveDepsFound.size > 0;

      if (!hasReactiveDeps) {
        return `/* W-DERIVED-001: const @${node.name} has no reactive dependencies — treating as const */ const ${node.name} = ${rewriteExpr(derivedInit)};`;
      }

      const rewrittenBody = rewriteExprWithDerived(derivedInit, derivedNames);
      const ctx = opts.encodingCtx;
      const encodedDeclName = ctx ? ctx.encode(node.name) : node.name;

      const lines = [];
      lines.push(`_scrml_derived_declare(${JSON.stringify(encodedDeclName)}, () => ${rewrittenBody});`);
      for (const dep of reactiveDepsFound) {
        const encodedDep = ctx ? ctx.encode(dep) : dep;
        lines.push(`_scrml_derived_subscribe(${JSON.stringify(encodedDeclName)}, ${JSON.stringify(encodedDep)});`);
      }
      return lines.join("\n");
    }

    case "return-stmt": {
      const retExpr = (node.expr ?? node.value ?? "").trim();
      const retSplit = splitBareExprStatements(retExpr);
      if (retSplit.length > 1) {
        const firstTrimmed = retSplit[0].trim();
        const looksLikeStatement = /^[a-zA-Z_$][\w$.]*\s*\.\s*[a-zA-Z_$]/.test(firstTrimmed) ||
                                    /^[a-zA-Z_$][\w$.]*\s*=\s/.test(firstTrimmed);
        if (looksLikeStatement) {
          const stmts = retSplit.map(s => `${rewriteExpr(s.trim())};`).filter(s => s != ";");
          return `return;\n${stmts.join("\n")}`;
        }
        const remaining = retSplit.slice(1).map(s => `${rewriteExpr(s.trim())};`).filter(s => s != ";");
        return `return ${rewriteExpr(retSplit[0].trim())};\n${remaining.join("\n")}`;
      }
      return `return ${rewriteExpr(retExpr)};`;
    }

    case "if-stmt":
      return emitIfStmt(node);

    case "for-stmt":
      return emitForStmt(node);

    case "while-stmt":
      return emitWhileStmt(node);

    case "lift-expr":
      return emitLiftExpr(node);

    case "sql": {
      const rawQuery = node.query ?? node.body ?? "";
      const calls = node.chainedCalls ?? [];
      const { sql, params } = extractSqlParams(rawQuery);
      const db = opts.dbVar ?? "_scrml_db";
      if (calls.length > 0) {
        const call = calls[0];
        const argList = params.length > 0 ? params.map(p => rewriteExpr(p)).join(", ") : "";
        return `${db}.query(${JSON.stringify(sql)}).${call.method}(${argList});`;
      }
      if (params.length > 0) {
        const argList = params.map(p => rewriteExpr(p)).join(", ");
        return `${db}.query(${JSON.stringify(sql)}).run(${argList});`;
      }
      return `_scrml_sql_exec(${JSON.stringify(rawQuery)});`;
    }

    case "fail-expr": {
      const enumType = node.enumType ?? "";
      const variant = node.variant ?? "";
      const args = node.args ? rewriteExpr(node.args) : "undefined";
      return `return { __scrml_error: true, type: ${JSON.stringify(enumType)}, variant: ${JSON.stringify(variant)}, data: ${args} };`;
    }

    case "propagate-expr": {
      const tmpVar = genVar("_scrml_tmp");
      const expr = rewriteExpr(node.expr ?? "");
      const lines = [];
      lines.push(`const ${tmpVar} = ${expr};`);
      lines.push(`if (${tmpVar}.__scrml_error) return ${tmpVar};`);
      if (node.binding) {
        lines.push(`const ${node.binding} = ${tmpVar};`);
      }
      return lines.join("\n");
    }

    case "throw-stmt": {
      const throwExpr = rewriteExpr(node.expr ?? "");
      const cleaned = throwExpr.trim();
      const needsNew = /^[A-Z][A-Za-z0-9_]*\s*\(/.test(cleaned) && !cleaned.startsWith("new ");
      return needsNew ? `throw new ${cleaned};` : `throw ${cleaned};`;
    }

    case "error-effect": {
      // Standalone `!{ tryBody } catch Type [as binding] { handler }` form
      const arms = node.arms ?? [];
      const tryBody = node.body ?? [];
      const errVar = genVar("_scrml_err");
      const lines = [];

      lines.push(`try {`);
      for (const bodyNode of tryBody) {
        const code = emitLogicNode(bodyNode);
        if (code) {
          for (const line of code.split("\n")) lines.push(`  ${line}`);
        }
      }
      lines.push(`} catch (${errVar}) {`);

      if (arms.length > 0) {
        let isFirst = true;
        for (const arm of arms) {
          if (arm.pattern === "_") {
            lines.push(`  ${isFirst ? "" : "else "}{`);
            if (arm.binding && arm.binding != "_") {
              lines.push(`    const ${arm.binding} = ${errVar};`);
            }
            const armCode = emitArmBody(arm, errVar);
            for (const line of armCode.split("\n")) lines.push(`    ${line}`);
            lines.push(`  }`);
          } else {
            const typeName = arm.pattern ?? "";
            const cond = `${errVar} instanceof ${typeName} || (${errVar} && ${errVar}.type === ${JSON.stringify(typeName)})`;
            lines.push(`  ${isFirst ? "if" : "else if"} (${cond}) {`);
            if (arm.binding && arm.binding != "_") {
              lines.push(`    const ${arm.binding} = ${errVar};`);
            }
            const armCode = emitArmBody(arm, errVar);
            for (const line of armCode.split("\n")) lines.push(`    ${line}`);
            lines.push(`  }`);
          }
          isFirst = false;
        }
      } else {
        lines.push(`  throw ${errVar};`);
      }
      lines.push(`}`);
      return lines.join("\n");
    }

    case "guarded-expr": {
      const guardedNode = node.guardedNode;
      const arms = node.arms ?? [];
      const lines = [];
      const errVar = genVar("_scrml_err");
      const resultVar = genVar("_scrml_result");

      lines.push(`let ${resultVar};`);
      lines.push(`try {`);

      if (guardedNode) {
        if (guardedNode.kind === "let-decl" && guardedNode.name) {
          const initExpr = rewriteExpr(guardedNode.init ?? "undefined");
          lines.push(`  ${resultVar} = ${initExpr};`);
          lines.push(`  var ${guardedNode.name} = ${resultVar};`);
        } else if ((guardedNode.kind === "const-decl" || guardedNode.kind === "tilde-decl") && guardedNode.name) {
          const initExpr = rewriteExpr(guardedNode.init ?? "undefined");
          lines.push(`  ${resultVar} = ${initExpr};`);
          lines.push(`  var ${guardedNode.name} = ${resultVar};`);
        } else {
          const bodyCode = emitLogicNode(guardedNode);
          if (bodyCode) {
            for (const line of bodyCode.split("\n")) {
              lines.push(`  ${line}`);
            }
          }
        }
      }

      lines.push(`} catch (${errVar}) {`);

      if (arms.length > 0) {
        const hasWildcard = arms.some(a => a.pattern === "_");
        let isFirst = true;
        for (const arm of arms) {
          if (arm.pattern === "_") {
            const armCode = emitArmBody(arm, errVar);
            lines.push(`  ${isFirst ? "" : "else "}{`);
            if (arm.binding && arm.binding != "_") {
              lines.push(`    const ${arm.binding} = ${errVar};`);
            }
            for (const line of armCode.split("\n")) {
              lines.push(`    ${line}`);
            }
            lines.push(`  }`);
          } else {
            const typeName = (arm.pattern ?? "").replace(/^::/, "");
            const cond = `${errVar} instanceof ${typeName} || (${errVar} && ${errVar}.type === ${JSON.stringify(typeName)})`;
            lines.push(`  ${isFirst ? "if" : "else if"} (${cond}) {`);
            if (arm.binding && arm.binding != "_") {
              lines.push(`    const ${arm.binding} = ${errVar};`);
            }
            const armCode = emitArmBody(arm, errVar);
            for (const line of armCode.split("\n")) {
              lines.push(`    ${line}`);
            }
            lines.push(`  }`);
          }
          isFirst = false;
        }
        if (!hasWildcard) {
          lines.push(`  else { throw ${errVar}; }`);
        }
      } else {
        lines.push(`  throw ${errVar};`);
      }

      lines.push(`}`);
      return lines.join("\n");
    }

    case "cleanup-registration": {
      const callback = node.callback ?? "() => {}";
      return `_scrml_register_cleanup(${rewriteExpr(callback)});`;
    }

    case "when-effect": {
      const body = rewriteExpr(node.bodyRaw ?? "");
      return `_scrml_effect(function() { ${body}; });`;
    }

    case "upload-call": {
      const file = rewriteExpr(node.file ?? "null");
      const url = rewriteExpr(node.url ?? '""');
      return `_scrml_upload(${file}, ${url});`;
    }

    case "reactive-nested-assign": {
      const ctx = opts.encodingCtx;
      const encodedTarget = ctx ? ctx.encode(node.target) : node.target;
      const target = JSON.stringify(encodedTarget);
      const path = JSON.stringify(node.path ?? []);
      const value = rewriteExpr(node.value ?? "undefined");
      return `_scrml_reactive_set(${target}, _scrml_deep_set(_scrml_reactive_get(${target}), ${path}, ${value}));`;
    }

    case "reactive-array-mutation": {
      const ctx = opts.encodingCtx;
      const encodedTarget = ctx ? ctx.encode(node.target) : node.target;
      const target = JSON.stringify(encodedTarget);
      const method = node.method;
      const args = rewriteExpr(node.args ?? "");

      // With Proxy-based reactivity, array mutations go through the Proxy traps
      // which automatically notify fine-grained effects.
      switch (method) {
        case "push":
          return `{ _scrml_reactive_get(${target}).push(${args}); _scrml_reactive_set(${target}, _scrml_reactive_get(${target})); }`;
        case "unshift":
          return `{ _scrml_reactive_get(${target}).unshift(${args}); _scrml_reactive_set(${target}, _scrml_reactive_get(${target})); }`;
        case "pop":
          return `{ _scrml_reactive_get(${target}).pop(); _scrml_reactive_set(${target}, _scrml_reactive_get(${target})); }`;
        case "shift":
          return `{ _scrml_reactive_get(${target}).shift(); _scrml_reactive_set(${target}, _scrml_reactive_get(${target})); }`;
        case "splice":
          return `{ _scrml_reactive_get(${target}).splice(${args}); _scrml_reactive_set(${target}, _scrml_reactive_get(${target})); }`;
        case "sort":
          return `{ _scrml_reactive_get(${target}).sort(${args}); _scrml_reactive_set(${target}, _scrml_reactive_get(${target})); }`;
        case "reverse":
          return `{ _scrml_reactive_get(${target}).reverse(); _scrml_reactive_set(${target}, _scrml_reactive_get(${target})); }`;
        case "fill":
          return `{ _scrml_reactive_get(${target}).fill(${args}); _scrml_reactive_set(${target}, _scrml_reactive_get(${target})); }`;
        default:
          return `_scrml_reactive_set(${target}, _scrml_reactive_get(${target}));`;
      }
    }

    case "reactive-explicit-set": {
      const args = rewriteExpr(node.args ?? "");
      return `_scrml_reactive_explicit_set(${args});`;
    }

    case "reactive-debounced-decl": {
      const delay = node.delay ?? 300;
      const init = node.init ?? "undefined";
      const ctx = opts.encodingCtx;
      const encodedName = ctx ? ctx.encode(node.name) : node.name;
      return `_scrml_reactive_debounced(${JSON.stringify(encodedName)}, () => ${rewriteExpr(init)}, ${delay});`;
    }

    case "debounce-call": {
      const fn = rewriteExpr(node.fn ?? "() => {}");
      const delay = node.delay ?? 300;
      return `_scrml_debounce(${fn}, ${delay});`;
    }

    case "throttle-call": {
      const fn = rewriteExpr(node.fn ?? "() => {}");
      const delay = node.delay ?? 100;
      return `_scrml_throttle(${fn}, ${delay});`;
    }

    case "transaction-block": {
      const lines = [];
      const db = opts.dbVar ?? "_scrml_db";
      lines.push(`${db}.exec("BEGIN");`);
      lines.push(`try {`);
      for (const stmt of (node.body ?? [])) {
        const code = emitLogicNode(stmt, opts);
        if (code) {
          for (const line of code.split("\n")) {
            lines.push(`  ${line}`);
          }
          if (stmt.kind === "fail-expr") {
            const lastIdx = lines.length - 1;
            const lastLine = lines[lastIdx];
            if (lastLine.trimStart().startsWith("return {")) {
              lines[lastIdx] = `  ${db}.exec("ROLLBACK");`;
              lines.push(`  ${lastLine.trim()}`);
            }
          }
        }
      }
      lines.push(`  ${db}.exec("COMMIT");`);
      lines.push(`} catch (_scrml_txn_err) {`);
      lines.push(`  ${db}.exec("ROLLBACK");`);
      lines.push(`  throw _scrml_txn_err;`);
      lines.push(`}`);
      return lines.join("\n");
    }

    case "try-stmt":
      return emitTryStmt(node);

    case "match-stmt":
      return emitMatchExpr(node);

    case "switch-stmt":
      return emitSwitchStmt(node);

    case "meta": {
      const metaBody = node.body;
      if (!Array.isArray(metaBody) || metaBody.length === 0) return "";

      const metaScopeId = node.id != null
        ? `"_scrml_meta_${node.id}"`
        : JSON.stringify(genVar("meta_scope"));

      const bodyLines = [];
      for (const stmt of metaBody) {
        const code = emitLogicNode(stmt);
        if (code) {
          // Rewrite reflect() → meta.types.reflect() in runtime meta bodies.
          const rewritten = rewriteReflectForRuntime(code);
          for (const line of rewritten.split("\n")) {
            bodyLines.push(`  ${line}`);
          }
        }
      }

      if (bodyLines.length === 0) return "";

      // §22.5: emit 4-argument form with capturedBindings and typeRegistry
      const capturedBindings = emitCapturedBindings(node);
      const typeRegistryLiteral = emitTypeRegistryLiteral(node);

      return [
        `_scrml_meta_effect(${metaScopeId}, function(meta) {`,
        ...bodyLines,
        `}, ${capturedBindings}, ${typeRegistryLiteral});`
      ].join("\n");
    }

    case "function-decl": {
      const fnName = node.name ?? "anon";
      const params = node.params ?? [];
      const paramNames = params.map((p, i) =>
        typeof p === "string" ? p : (p.name ?? `_scrml_arg_${i}`)
      );
      const generatorStar = node.isGenerator ? "*" : "";

      const fnLines = [];
      fnLines.push(`function${generatorStar} ${fnName}(${paramNames.join(", ")}) {`);

      for (const stmt of (node.body ?? [])) {
        const code = emitLogicNode(stmt, opts);
        if (code) {
          for (const line of code.split("\n")) {
            fnLines.push(`  ${line}`);
          }
        }
      }

      fnLines.push(`}`);
      return fnLines.join("\n");
    }

    default:
      return "";
  }
}

// ===========================================================================
// SECTION: scheduling (from scheduling.ts)
// ===========================================================================

/**
 * Extract direct callee names from an expression string.
 * @param {string} expr
 * @returns {string[]}
 */
export function extractCalleeNames(expr) {
  const names = [];
  const re = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  let m;
  while ((m = re.exec(expr)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/**
 * Check if a function node has any callees that are server-boundary.
 * @param {object} fnNode
 * @param {object} routeMap
 * @param {string} filePath
 * @returns {boolean}
 */
export function hasServerCallees(fnNode, routeMap, filePath) {
  // Build a set of server function names from routeMap
  const serverFnNames = new Set();
  for (const [, route] of routeMap.functions) {
    if (route.boundary === "server" && route.functionName) {
      serverFnNames.add(route.functionName);
    }
  }
  if (serverFnNames.size === 0) return false;

  const body = fnNode.body ?? [];
  for (const stmt of body) {
    if (!stmt) continue;
    if (stmt.kind === "bare-expr") {
      const callees = extractCalleeNames(stmt.expr ?? "");
      for (const callee of callees) {
        if (serverFnNames.has(callee)) return true;
      }
    }
  }
  return false;
}

/**
 * Find the DG node ID matching a logic statement.
 * @param {object} stmt
 * @param {object} depGraph
 * @param {string} filePath
 * @returns {string|null}
 */
export function findDGNodeForStmt(stmt, depGraph, filePath) {
  if (!depGraph.nodes || !stmt.span) return null;
  const stmtSpan = stmt.span;
  for (const [nodeId, dgNode] of depGraph.nodes) {
    if (dgNode.span && dgNode.span.start === stmtSpan.start &&
        (dgNode.span.file === stmtSpan.file || dgNode.span.file === filePath)) {
      return nodeId;
    }
  }
  return null;
}

/**
 * Check if a statement is a server call expression.
 * @param {object} stmt
 * @param {object} routeMap
 * @param {string} filePath
 * @returns {boolean}
 */
export function isServerCallExpr(stmt, routeMap, filePath) {
  if (!stmt) return false;
  const expr = stmt.expr ?? stmt.init ?? "";
  if (!expr) return false;
  const callees = extractCalleeNames(typeof expr === "string" ? expr : "");
  // Build a set of server function names from routeMap
  const serverFnNames = new Set();
  for (const [fnNodeId, route] of routeMap.functions) {
    if (route.boundary === "server" && route.functionName) {
      serverFnNames.add(route.functionName);
    }
  }
  for (const callee of callees) {
    if (serverFnNames.has(callee)) return true;
  }
  return false;
}

/**
 * Extract the initializer expression from a let-decl or const-decl.
 * @param {object} stmt
 * @returns {string}
 */
export function extractInitExpr(stmt) {
  if (stmt.init) return rewriteExpr(typeof stmt.init === "string" ? stmt.init : String(stmt.init));
  if (stmt.expr) return rewriteExpr(typeof stmt.expr === "string" ? stmt.expr : String(stmt.expr));
  return "undefined";
}

/**
 * Schedule statements in a function body using dependency graph information.
 *
 * Identifies groups of independent operations and wraps them in Promise.all.
 * Dependent operations are chained with await.
 *
 * Security invariant: SQL nodes, transaction blocks, and server-context meta nodes
 * MUST NOT be scheduled for client emission. If encountered, emit E-CG-006 and skip.
 *
 * @param {object[]} body
 * @param {object} fnNode
 * @param {object} routeMap
 * @param {object} depGraph
 * @param {string} filePath
 * @param {CGError[]} [errors]
 * @returns {string[]}
 */
export function scheduleStatements(body, fnNode, routeMap, depGraph, filePath, errors = []) {
  const lines = [];

  // Only use complex scheduling (Promise.all) for functions with actual server calls.
  const fnHasServerCalls = hasServerCallees(fnNode, routeMap, filePath);
  if (!fnHasServerCalls || !depGraph || !depGraph.nodes || depGraph.nodes.size === 0) {
    // No server calls or no dependency graph info — emit sequentially
    for (const stmt of body) {
      // Security guard: SQL, transaction-block, and server-context meta nodes must
      // not appear in client-boundary function bodies. RI should have caught this.
      if (isServerOnlyNode(stmt)) {
        errors.push(new CGError(
          "E-CG-006",
          `E-CG-006: ${stmt.kind} node found in client-boundary function body. ` +
          `Server-only constructs (SQL, transactions, server-context meta) must not ` +
          `reach client output. This indicates an RI invariant violation.`,
          stmt.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
        ));
        continue;
      }
      const code = emitLogicNode(stmt);
      if (code) lines.push(code);
    }
    return lines;
  }

  // Build a map of which statements (by index) have awaits edges to other statements
  const stmtNodeIds = [];
  for (const stmt of body) {
    if (!stmt || !stmt.span) {
      stmtNodeIds.push(null);
      continue;
    }
    const matchId = findDGNodeForStmt(stmt, depGraph, filePath);
    stmtNodeIds.push(matchId);
  }

  // Build dependency sets: which statement indices does each stmt depend on?
  const depSets = body.map(() => new Set());
  for (const edge of (depGraph.edges ?? [])) {
    if (edge.kind != "awaits") continue;
    const fromIdx = stmtNodeIds.indexOf(edge.from ?? null);
    const toIdx = stmtNodeIds.indexOf(edge.to ?? null);
    if (fromIdx >= 0 && toIdx >= 0) {
      depSets[fromIdx].add(toIdx);
    }
  }

  // Group independent statements (those with no inter-dependencies among the group)
  const visited = new Set();
  let i = 0;
  while (i < body.length) {
    if (visited.has(i)) { i++; continue; }

    // Find a maximal group of independent statements starting from i
    const group = [i];
    visited.add(i);

    for (let j = i + 1; j < body.length; j++) {
      if (visited.has(j)) continue;
      // Check if j is independent of all current group members
      let independent = true;
      for (const gi of group) {
        if (depSets[j].has(gi) || depSets[gi].has(j)) {
          independent = false;
          break;
        }
      }
      if (independent) {
        group.push(j);
        visited.add(j);
      }
    }

    if (group.length > 1) {
      // Multiple independent operations — wrap in Promise.all
      const varNames = [];
      const callExprs = [];

      for (const idx of group) {
        const stmt = body[idx];
        // Security guard: skip server-only nodes in client scheduling path
        if (isServerOnlyNode(stmt)) {
          errors.push(new CGError(
            "E-CG-006",
            `E-CG-006: ${stmt.kind} node found in client-boundary function body. ` +
            `Server-only constructs must not reach client output. RI invariant violation.`,
            stmt.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
          ));
          continue;
        }
        const code = emitLogicNode(stmt);
        if (!code) continue;

        if (stmt.kind === "let-decl" || stmt.kind === "const-decl") {
          varNames.push(stmt.name || genVar("tmp"));
          callExprs.push(extractInitExpr(stmt));
        } else {
          varNames.push(genVar("tmp"));
          callExprs.push(code.replace(/;$/, ""));
        }
      }

      if (callExprs.length > 1) {
        lines.push(`const [${varNames.join(", ")}] = await Promise.all([`);
        for (let k = 0; k < callExprs.length; k++) {
          const comma = k < callExprs.length - 1 ? "," : "";
          lines.push(`  ${callExprs[k]}${comma}`);
        }
        lines.push(`]);`);
      } else if (callExprs.length === 1) {
        lines.push(`const ${varNames[0]} = await ${callExprs[0]};`);
      }
    } else {
      // Single statement — emit with await if it has dependencies on prior statements
      const stmt = body[group[0]];
      // Security guard: skip server-only nodes in client scheduling path
      if (isServerOnlyNode(stmt)) {
        errors.push(new CGError(
          "E-CG-006",
          `E-CG-006: ${stmt.kind} node found in client-boundary function body. ` +
          `Server-only constructs must not reach client output. RI invariant violation.`,
          stmt.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
        ));
        i++;
        continue;
      }
      const code = emitLogicNode(stmt);
      if (code) {
        if (isServerCallExpr(stmt, routeMap, filePath)) {
          if (stmt.kind === "let-decl" || stmt.kind === "const-decl") {
            const name = stmt.name || genVar("tmp");
            lines.push(`const ${name} = await ${extractInitExpr(stmt)};`);
          } else {
            lines.push(`await ${code.replace(/;$/, "")};`);
          }
        } else {
          lines.push(code);
        }
      }
    }

    i++;
  }

  return lines;
}
