#!/usr/bin/env bun
/**
 * generate-api-reference.js
 *
 * Parses compiler/SPEC.md and compiler/SPEC-INDEX.md to produce
 * docs/api-reference.md — a quick-reference guide for scrml developers.
 *
 * Usage: bun scripts/generate-api-reference.js
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const ROOT = join(import.meta.dir, "..");
const SPEC_PATH = join(ROOT, "compiler", "SPEC.md");
const INDEX_PATH = join(ROOT, "compiler", "SPEC-INDEX.md");
const OUTPUT_PATH = join(ROOT, "docs", "api-reference.md");

// ⚑ Normalize CRLF→LF at the READ, not at each split. On a Windows checkout
// (core.autocrlf=true) every line carries a trailing \r, which silently defeats BOTH
// end-sensitive constructs below at exit 0: the `…\|$` table-row regexes in
// extractSectionSummaries() and extractErrorCodes() (`.` never matches \r, so `$` is
// unreachable — 0 of 66 section rows and 0 of 408 code rows matched), and the
// `specLines[end] === "---"` compare (0 of 247). The generator still wrote a
// well-formed file, just missing both tables — the pa-base §8 hollow-gate shape.
// Normalizing once here covers every consumer, including compares a per-split fix
// would miss. PA-verified by execution against both encodings (S401). LF-identical.
const eolNorm = (s) => s.replace(/\r\n/g, "\n");

const spec = eolNorm(readFileSync(SPEC_PATH, "utf-8"));
const specLines = spec.split("\n");
const index = eolNorm(readFileSync(INDEX_PATH, "utf-8"));

// ---------------------------------------------------------------------------
// 1. Section summaries from SPEC-INDEX.md
// ---------------------------------------------------------------------------

function extractSectionSummaries() {
  const rows = [];
  const tableRe =
    /^\|\s*(\d+|—)\s*\|\s*(.+?)\s*\|\s*([\d–-]+)\s*\|\s*(\d+)\s*\|\s*(.+?)\s*\|$/;
  for (const line of index.split("\n")) {
    const m = line.match(tableRe);
    if (m) {
      const [, num, name, lines, , summary] = m;
      if (num === "—") continue; // skip TOC row
      rows.push({ num, name: name.trim(), lines: lines.trim(), summary: summary.trim() });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 2. Context sigils from §3 context table + spec sections
// ---------------------------------------------------------------------------

function extractContextSigils() {
  return [
    {
      sigil: "`@`",
      name: "Reactive Sigil",
      meaning:
        "Declares and references reactive variables. `@name` creates a reactive binding that triggers UI updates on mutation.",
      section: "§6 Reactivity",
      example: '@count = 0\n<button onclick=${@count = @count + 1}>Clicked ${@count} times/',
    },
    {
      sigil: "`${}`",
      name: "Logic Context",
      meaning:
        "Opens a JavaScript logic block inside markup. Code inside `${}` can declare variables, call functions, and produce values that are coerced to markup in the parent context.",
      section: "§7 Logic Contexts",
      example: '<p>${ userName.toUpperCase() }/',
    },
    {
      sigil: "`?{}`",
      name: "SQL Context",
      meaning:
        "Opens a SQL context for database queries. Uses bun:sqlite passthrough. Bound parameters use `${expr}` inside the SQL string.",
      section: "§8 SQL Contexts",
      example: "?{`SELECT * FROM users WHERE id = ${userId}`}",
    },
    {
      sigil: "`#{}`",
      name: "CSS Inline Context",
      meaning:
        "Opens an inline CSS context inside markup or state blocks. Returns CSS class bindings.",
      section: "§9 CSS Contexts",
      example: '<div #{color: @themeColor; padding: 8px}>content/',
    },
    {
      sigil: "`^{}`",
      name: "Meta Context",
      meaning:
        "Opens a metaprogramming context with access to the compiler's AST, type registry, and reactive dependency graph. Can be compile-time or runtime.",
      section: "§22 Metaprogramming",
      example: "^{ reflect(MyComponent).props }",
    },
    {
      sigil: "`!{}`",
      name: "Error Context",
      meaning:
        "Attaches error handlers to an expression. Arms match error types with `| ::ErrorType name -> body` syntax. Wildcard `_` catches all.",
      section: "§19 Error Handling",
      example:
        'let user = getUser(id) !{\n    | ::NetworkError e -> null\n    | ::NotFoundError e -> null\n    | _ e -> { @error = e; null }\n}',
    },
  ];
}

// ---------------------------------------------------------------------------
// 3. Keywords from §4.11 (lines ~520-555)
// ---------------------------------------------------------------------------

function extractKeywords() {
  // Extract from the spec text around section 4.11
  const keywords = [];

  // Find section 4.11
  const start = specLines.findIndex((l) =>
    l.match(/^#{2,4}\s+4\.11\s+Canonical Keywords/)
  );
  if (start === -1) return keywords;

  const end = Math.min(start + 80, specLines.length);
  const section = specLines.slice(start, end).join("\n");

  // Extract keyword subsections
  const subsections = [
    {
      keyword: "`lift`",
      description:
        "Emits a value from a logic context `${}` to its parent markup context. The canonical keyword for value-emission (§10).",
      error: "E-SYNTAX-003 if `extract` is used instead",
    },
    {
      keyword: "`?{`",
      description:
        "Canonical SQL context sigil. Opens a SQL context for database queries (§8).",
      error: null,
    },
    {
      keyword: "`!{`",
      description:
        "Error context sigil. Opens an error handling context attached to an expression (§19).",
      error: null,
    },
    {
      keyword: "`is`",
      description:
        "Context-sensitive keyword valid only as an arm pattern keyword in `match` contexts (§18). In all other contexts, `is` is a valid identifier.",
      error: null,
    },
    {
      keyword: "`pure`",
      description:
        "Declares a function as side-effect-free. The compiler statically verifies purity constraints (§32).",
      error: "E-PURE-001, E-PURE-002",
    },
    {
      keyword: "`lin`",
      description:
        "Declares a linear variable that must be consumed exactly once. Enforced at compile time by static analysis (§34).",
      error: "E-LIN-001, E-LIN-002, E-LIN-003",
    },
    {
      keyword: "`match`",
      description:
        "Pattern matching expression. Supports enum variants, destructuring, wildcards, literal arms, and exhaustiveness checking (§18).",
      error: null,
    },
    {
      keyword: "`server`",
      description:
        "Marks a function for server-side execution. The compiler generates the RPC boundary, fetch calls, and serialization automatically (§12, §13).",
      error: null,
    },
    {
      keyword: "`export` / `import`",
      description:
        "Module system keywords. Exports are declared inside `${}` logic contexts. Imports use ES module syntax (§21, §40).",
      error: "E-IMPORT-001 through E-IMPORT-004",
    },
    {
      keyword: "`protect=`",
      description:
        "Attribute on state objects that restricts field access to server-only code. Protected fields cannot be read on the client (§11).",
      error: "E-PROTECT-001, E-PROTECT-002",
    },
    {
      keyword: "`~`",
      description:
        "Implicit pipeline accumulator. A built-in `lin` variable initialized by unassigned expressions and consumed exactly once (§31).",
      error: "E-TILDE-001, E-TILDE-002",
    },
  ];

  return subsections;
}

// ---------------------------------------------------------------------------
// 4. Error codes from §33
// ---------------------------------------------------------------------------

function extractErrorCodes() {
  const codes = [];
  // ⚑ §34, not §33 — a SECOND, independent defect found while proving the CRLF fix above
  // (S401). Error Codes moved to §34 and §33 became `pure` (now itself deprecated), so this
  // findIndex returned -1 and the function returned [] at exit 0 — the generator wrote a
  // well-formed reference with its entire error-code table missing, and nothing failed.
  // Two unrelated causes, one silent symptom; fixing only the CRLF one leaves it empty.
  const start = specLines.findIndex((l) => l.match(/^## 34\.\s+Error Codes/));
  if (start === -1) return codes;

  // Find the end of the section (next ## heading or ---)
  let end = start + 1;
  while (end < specLines.length) {
    if (specLines[end].match(/^## \d+\./) && end > start + 2) break;
    if (specLines[end] === "---" && end > start + 5) break;
    end++;
  }

  const tableRe =
    /^\|\s*(E-[A-Z]+-\d+|W-[A-Z]+-\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(Error|Warning)\s*\|$/;
  for (let i = start; i < end; i++) {
    const m = specLines[i].match(tableRe);
    if (m) {
      codes.push({
        code: m[1],
        section: m[2].trim(),
        trigger: m[3].trim(),
        severity: m[4],
      });
    }
  }

  return codes;
}

// ---------------------------------------------------------------------------
// 5. Built-in state types from §35
// ---------------------------------------------------------------------------

function extractInputStateTypes() {
  const types = [];

  // <keyboard>
  types.push({
    name: "`<keyboard>`",
    syntax: '<keyboard id="keys"/>',
    description:
      "Reactive access to keyboard state. Manages `keydown` and `keyup` event listeners on `document`. Auto-cleans up on scope destruction.",
    properties: [
      "`.pressed(key)` — true while key is held",
      "`.justPressed(key)` — true from keydown until keyup",
      "`.justReleased(key)` — true from keyup until keydown",
      "`.modifiers` — `{ shift, ctrl, alt, meta }` booleans",
      "`.lastKey` — most recently pressed key (string | null)",
    ],
    section: "§35.2",
  });

  // <mouse>
  types.push({
    name: "`<mouse>`",
    syntax: '<mouse id="cursor"/>\n<mouse id="canvasMouse" target=@canvasEl/>',
    description:
      "Reactive access to mouse position and button state. Manages `mousemove`, `mousedown`, `mouseup`, and `wheel` listeners. Supports scoping to a specific element via `target=`.",
    properties: [
      "`.x` — current X position in pixels",
      "`.y` — current Y position in pixels",
      "`.buttons` — bitmask of pressed buttons",
      "`.pressed(button)` — true if button is pressed (0=left, 1=middle, 2=right)",
      "`.wheel` — accumulated scroll delta",
    ],
    section: "§35.3",
  });

  // <gamepad>
  types.push({
    name: "`<gamepad>`",
    syntax: '<gamepad id="pad"/>\n<gamepad id="pad1" index=1/>',
    description:
      "Reactive access to gamepad input via polling (`requestAnimationFrame`). Supports up to 4 gamepads (index 0-3).",
    properties: [
      "`.connected` — true when a gamepad is connected",
      "`.axes` — array of axis values, each in [-1, 1]",
      "`.buttons` — array of `{ pressed, value }` objects",
      "`.pressed(index)` — true if button at index is pressed",
    ],
    section: "§35.4",
  });

  return types;
}

// ---------------------------------------------------------------------------
// 6. Attribute syntax from §5
// ---------------------------------------------------------------------------

function extractAttributeSyntax() {
  return [
    {
      name: "Static string",
      syntax: 'attr="value"',
      description: "Static string literal, fixed at compile time.",
      section: "§5.1",
    },
    {
      name: "Variable reference",
      syntax: "attr=name",
      description:
        "Unquoted identifier resolved at runtime from the current scope.",
      section: "§5.1",
    },
    {
      name: "Call expression",
      syntax: "attr=fn()",
      description:
        "Logic invocation. On event attributes, wired as event listener. On non-event attributes, must return a compatible value.",
      section: "§5.1",
    },
    {
      name: "`bind:value`",
      syntax: "bind:value=@var",
      description:
        "Two-way binding between an input element and a reactive variable. Expands to `value=@var oninput=${@var = event.target.value}`.",
      section: "§5.4",
    },
    {
      name: "`bind:checked`",
      syntax: "bind:checked=@var",
      description:
        "Two-way binding for checkbox state. Expands to `checked=@var onchange=${@var = event.target.checked}`.",
      section: "§5.4",
    },
    {
      name: "`bind:selected`",
      syntax: "bind:selected=@var",
      description:
        "Two-way binding for `<select>` elements. Alternative to `bind:value`.",
      section: "§5.4",
    },
    {
      name: "`bind:group`",
      syntax: "bind:group=@var",
      description:
        "Radio group binding. Binds a shared reactive variable to the `value` of the selected radio input.",
      section: "§5.4",
    },
    {
      name: "`show=`",
      syntax: "show=@condition",
      description:
        "Conditionally shows/hides an element using CSS `display: none`. The element remains in the DOM.",
      section: "§17",
    },
    {
      name: "`if=`",
      syntax: "if=@condition",
      description:
        "Conditionally renders an element. When false, the element is removed from the DOM entirely.",
      section: "§17",
    },
    {
      name: "`class:name=`",
      syntax: "class:active=@isActive",
      description:
        "Conditional class binding. Adds the named class when the reactive condition is truthy.",
      section: "§5.5",
    },
    {
      name: "Dynamic class interpolation",
      syntax: 'class="card ${@isActive ? \'active\' : \'\'}"',
      description:
        "Template literal syntax inside a quoted class attribute for dynamic class composition.",
      section: "§5.5",
    },
  ];
}

// ---------------------------------------------------------------------------
// 7. Syntax blocks — extract fenced code blocks from the spec
// ---------------------------------------------------------------------------

function extractSyntaxBlocks() {
  const blocks = [];
  let inBlock = false;
  let currentBlock = [];
  let currentLang = "";
  let currentSection = "Unknown";
  let blockStartLine = 0;

  for (let i = 0; i < specLines.length; i++) {
    const line = specLines[i];

    // Track current section
    const sectionMatch = line.match(/^##\s+(\d+)\.\s+(.+)/);
    if (sectionMatch) {
      currentSection = `§${sectionMatch[1]} ${sectionMatch[2]}`;
    }

    if (!inBlock && line.match(/^```(\w*)/)) {
      inBlock = true;
      currentLang = line.match(/^```(\w*)/)[1] || "text";
      currentBlock = [];
      blockStartLine = i + 1;
    } else if (inBlock && line === "```") {
      inBlock = false;
      if (currentLang === "scrml" && currentBlock.length > 0 && currentBlock.length <= 15) {
        blocks.push({
          code: currentBlock.join("\n"),
          section: currentSection,
          line: blockStartLine,
        });
      }
    } else if (inBlock) {
      currentBlock.push(line);
    }
  }

  // Limit to representative examples (first from each section)
  const seen = new Set();
  return blocks.filter((b) => {
    if (seen.has(b.section)) return false;
    seen.add(b.section);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Build the output document
// ---------------------------------------------------------------------------

function generate() {
  const sections = extractSectionSummaries();
  const sigils = extractContextSigils();
  const keywords = extractKeywords();
  const errorCodes = extractErrorCodes();
  const inputTypes = extractInputStateTypes();
  const attrSyntax = extractAttributeSyntax();
  const syntaxBlocks = extractSyntaxBlocks();

  const out = [];

  out.push("# scrml API Reference");
  out.push("");
  out.push("> Quick-reference guide extracted from the scrml Language Specification.");
  out.push("> For full details, see `compiler/SPEC.md`.");
  out.push("");

  // Table of contents
  out.push("## Table of Contents");
  out.push("");
  out.push("- [Spec Sections Overview](#spec-sections-overview)");
  out.push("- [Context Sigils](#context-sigils)");
  out.push("- [Keywords](#keywords)");
  out.push("- [Attribute Syntax](#attribute-syntax)");
  out.push("- [Built-in Input State Types](#built-in-input-state-types)");
  out.push("- [Syntax Examples](#syntax-examples)");
  out.push("- [Error Codes](#error-codes)");
  out.push("");
  out.push("---");
  out.push("");

  // --- Spec Sections Overview ---
  out.push("## Spec Sections Overview");
  out.push("");
  out.push("One-line summary per spec section.");
  out.push("");
  out.push("| Section | Name | Lines | Summary |");
  out.push("|---------|------|-------|---------|");
  for (const s of sections) {
    out.push(`| §${s.num} | ${s.name} | ${s.lines} | ${s.summary} |`);
  }
  out.push("");
  out.push("---");
  out.push("");

  // --- Context Sigils ---
  out.push("## Context Sigils");
  out.push("");
  out.push(
    "scrml uses sigils to switch between contexts. Each sigil opens a block with distinct syntax rules."
  );
  out.push("");
  for (const s of sigils) {
    out.push(`### ${s.sigil} — ${s.name}`);
    out.push("");
    out.push(s.meaning);
    out.push("");
    out.push(`**Spec reference:** ${s.section}`);
    out.push("");
    out.push("```scrml");
    out.push(s.example);
    out.push("```");
    out.push("");
  }
  out.push("---");
  out.push("");

  // --- Keywords ---
  out.push("## Keywords");
  out.push("");
  out.push("Reserved and context-sensitive keywords in scrml.");
  out.push("");
  out.push("| Keyword | Description |");
  out.push("|---------|-------------|");
  for (const k of keywords) {
    const desc = k.error
      ? `${k.description} (${k.error})`
      : k.description;
    out.push(`| ${k.keyword} | ${desc} |`);
  }
  out.push("");
  out.push("---");
  out.push("");

  // --- Attribute Syntax ---
  out.push("## Attribute Syntax");
  out.push("");
  out.push(
    "scrml attributes follow a three-way distinction based on quoting, plus special directives."
  );
  out.push("");
  out.push("| Form | Syntax | Description | Section |");
  out.push("|------|--------|-------------|---------|");
  for (const a of attrSyntax) {
    out.push(
      `| ${a.name} | \`${a.syntax}\` | ${a.description} | ${a.section} |`
    );
  }
  out.push("");
  out.push("### Bind Syntax Examples");
  out.push("");
  out.push("```scrml");
  out.push('// Two-way text binding');
  out.push('@name = ""');
  out.push("<input bind:value=@name>");
  out.push('<p>Hello, ${@name}!/');
  out.push("");
  out.push("// Checkbox binding");
  out.push("@agreed = false");
  out.push('<input type="checkbox" bind:checked=@agreed>');
  out.push("");
  out.push("// Radio group binding");
  out.push('@color = "red"');
  out.push(
    '<input type="radio" name="color" value="red" bind:group=@color>'
  );
  out.push(
    '<input type="radio" name="color" value="blue" bind:group=@color>'
  );
  out.push("```");
  out.push("");
  out.push("### Conditional Rendering");
  out.push("");
  out.push("```scrml");
  out.push("// if= removes element from DOM when false");
  out.push("<div if=@loggedIn>Welcome back!/");
  out.push("");
  out.push("// show= hides with CSS display:none (element stays in DOM)");
  out.push("<div show=@expanded>Details here/");
  out.push("");
  out.push("// Conditional class");
  out.push("<button class:active=@isActive>Toggle/");
  out.push("```");
  out.push("");
  out.push("---");
  out.push("");

  // --- Built-in Input State Types ---
  out.push("## Built-in Input State Types");
  out.push("");
  out.push(
    "Input state types provide reactive access to keyboard, mouse, and gamepad input. They emit no HTML output and auto-clean up on scope destruction."
  );
  out.push("");
  for (const t of inputTypes) {
    out.push(`### ${t.name}`);
    out.push("");
    out.push(t.description);
    out.push("");
    out.push(`**Spec reference:** ${t.section}`);
    out.push("");
    out.push("**Syntax:**");
    out.push("");
    out.push("```scrml");
    out.push(t.syntax);
    out.push("```");
    out.push("");
    out.push("**Properties:**");
    out.push("");
    for (const p of t.properties) {
      out.push(`- ${p}`);
    }
    out.push("");
  }
  out.push("---");
  out.push("");

  // --- Syntax Examples ---
  out.push("## Syntax Examples");
  out.push("");
  out.push(
    "Representative scrml syntax examples, one per spec section."
  );
  out.push("");
  for (const b of syntaxBlocks) {
    out.push(`### ${b.section}`);
    out.push("");
    out.push(`> Line ${b.line} in SPEC.md`);
    out.push("");
    out.push("```scrml");
    out.push(b.code);
    out.push("```");
    out.push("");
  }
  out.push("---");
  out.push("");

  // --- Error Codes ---
  out.push("## Error Codes");
  out.push("");
  out.push(
    "All compiler error and warning codes. Each is defined normatively in the referenced spec section."
  );
  out.push("");

  // Group by prefix
  const groups = {};
  for (const e of errorCodes) {
    const prefix = e.code.replace(/-\d+$/, "");
    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push(e);
  }

  for (const [prefix, codes] of Object.entries(groups)) {
    out.push(`### ${prefix}`);
    out.push("");
    out.push("| Code | Trigger | Section | Severity |");
    out.push("|------|---------|---------|----------|");
    for (const c of codes) {
      out.push(`| \`${c.code}\` | ${c.trigger} | ${c.section} | ${c.severity} |`);
    }
    out.push("");
  }

  out.push("---");
  out.push("");
  out.push(
    "*Auto-generated from SPEC.md — do not edit manually.*"
  );
  out.push("");
  out.push(
    `*Generated: ${new Date().toISOString().split("T")[0]} from SPEC.md v0.5.0-draft*`
  );
  out.push("");

  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
const content = generate();
writeFileSync(OUTPUT_PATH, content);

const lineCount = content.split("\n").length;
console.log(`Generated ${OUTPUT_PATH}`);
console.log(`  ${lineCount} lines`);
console.log(`  ${content.length} bytes`);
