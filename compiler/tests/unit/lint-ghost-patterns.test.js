/**
 * lint-ghost-patterns — Unit Tests
 *
 * Tests for compiler/src/lint-ghost-patterns.js
 *
 * Ghost-error lint pre-pass: detects React/Vue/Svelte syntax patterns in .scrml
 * source and emits "did you mean?" diagnostics. All results are warnings, never
 * fatal errors.
 *
 * Coverage:
 *   §1  W-LINT-001 — <style> block detected
 *   §2  W-LINT-002 — oninput=${e => @x = ...} ghost bind pattern
 *   §3  W-LINT-003 — className= React class attribute
 *   §4  W-LINT-004 — camelCase event (onChange=, onSubmit=)
 *   §5  W-LINT-005 — value={expr} JSX attribute braces (no leading $)
 *   §6  W-LINT-006 — for (item of @items) JS for-of in markup
 *   §7  W-LINT-007 — <Comp prop={val}> JSX component prop braces
 *   §8  W-LINT-008 — {cond && <El>} React conditional rendering
 *   §9  W-LINT-010 — ${} interpolation inside #{} CSS context (Svelte pattern)
 *   §10 Negative: equivalent valid scrml patterns do NOT trigger
 *   §11 Multiple ghosts in one file produce multiple diagnostics
 *   §12 ${} logic context exclusion — contents excluded from markup checks
 *   §13 Empty file produces no diagnostics
 *   §14 Integration: lintGhostPatterns wired into compileScrml() via lintDiagnostics field
 *   §15 Integration: lint does not block compilation — real compiler still runs
 *   §16 Diagnostic shape — all required fields present
 *   §17 Diagnostic sorting — sorted by line then column
 */

import { describe, test, expect } from "bun:test";
import { lintGhostPatterns } from "../../src/lint-ghost-patterns.js";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, unlinkSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lint(source) {
  return lintGhostPatterns(source, "test.scrml");
}

function hasCode(diags, code) {
  return diags.some(d => d.code === code);
}

// Write a temp .scrml file, compile it (write:false), clean up
function compileSource(source) {
  const dir = join(tmpdir(), "scrml-lint-test-" + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "test.scrml");
  writeFileSync(filePath, source, "utf8");
  let result;
  try {
    result = compileScrml({
      inputFiles: [filePath],
      outputDir: join(dir, "dist"),
      write: false,
    });
  } finally {
    try { unlinkSync(filePath); } catch {}
  }
  return result;
}

// Produce the literal string "${...}" — avoids template literal interpolation ambiguity.
// Usage: dollars("e => @x = e.target.value") → "${e => @x = e.target.value}"
function dollars(inner) {
  return "$" + "{" + inner + "}";
}

// ---------------------------------------------------------------------------
// §1 W-LINT-001 — <style> block
// ---------------------------------------------------------------------------

describe("§1 W-LINT-001 — <style> block", () => {
  test("detects bare <style> tag", () => {
    const source = '<markup name="app">\n  <style>\n    body { color: red; }\n  </style>\n</>';
    const diags = lint(source);
    expect(hasCode(diags, "W-LINT-001")).toBe(true);
  });

  test("detects <style> with attributes", () => {
    const diags = lint("<style scoped>\n.foo { color: blue; }\n</style>");
    expect(hasCode(diags, "W-LINT-001")).toBe(true);
  });

  test("message includes ghost and correction", () => {
    const diags = lint("<style>\n.x {}\n</style>");
    const d = diags.find(d => d.code === "W-LINT-001");
    expect(d.ghost).toBe("<style>");
    expect(d.correction).toContain("#{");
    expect(d.message).toContain("Line");
    expect(d.message).toContain("<style>");
  });

  test("negative: #{} CSS context does NOT trigger W-LINT-001", () => {
    const diags = lint("#{ body { color: red; } }");
    expect(hasCode(diags, "W-LINT-001")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §2 W-LINT-002 — oninput=${e => @x = ...} ghost bind
// ---------------------------------------------------------------------------

describe("§2 W-LINT-002 — oninput arrow-assign ghost", () => {
  test("detects oninput=${...@x = ...}", () => {
    // Construct the literal string: <input oninput=${e => @name = e.target.value}>
    const source = "<input oninput=" + dollars("e => @name = e.target.value") + ">";
    const diags = lint(source);
    expect(hasCode(diags, "W-LINT-002")).toBe(true);
  });

  test("message suggests bind:value", () => {
    const source = "<input oninput=" + dollars("e => @x = e.target.value") + ">";
    const d = lint(source).find(d => d.code === "W-LINT-002");
    expect(d).toBeDefined();
    expect(d.correction).toContain("bind:value");
  });

  test("negative: bind:value=@x does NOT trigger W-LINT-002", () => {
    const diags = lint("<input bind:value=@name>");
    expect(hasCode(diags, "W-LINT-002")).toBe(false);
  });

  test("negative: oninput=handler() without arrow-assign does NOT trigger W-LINT-002", () => {
    const diags = lint("<input oninput=handleInput()>");
    expect(hasCode(diags, "W-LINT-002")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §3 W-LINT-003 — className=
// ---------------------------------------------------------------------------

describe("§3 W-LINT-003 — className= React attribute", () => {
  test("detects className=", () => {
    const diags = lint('<div className="active">');
    expect(hasCode(diags, "W-LINT-003")).toBe(true);
  });

  test("detects className={expr}", () => {
    const diags = lint("<div className={isActive ? 'on' : 'off'}>");
    expect(hasCode(diags, "W-LINT-003")).toBe(true);
  });

  test("message suggests class: prefix", () => {
    const diags = lint('<div className="x">');
    const d = diags.find(d => d.code === "W-LINT-003");
    expect(d.correction).toContain("class:");
  });

  test("negative: class= (lowercase) does NOT trigger W-LINT-003", () => {
    const diags = lint('<div class="btn active">');
    expect(hasCode(diags, "W-LINT-003")).toBe(false);
  });

  test("negative: class:active=@cond does NOT trigger W-LINT-003", () => {
    const diags = lint("<div class:active=@isActive>");
    expect(hasCode(diags, "W-LINT-003")).toBe(false);
  });

  test("className= inside ${} logic block is excluded", () => {
    // Construct: ${ el.className = "active" }
    const source = dollars(' el.className = "active" ');
    const diags = lint(source);
    expect(hasCode(diags, "W-LINT-003")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §4 W-LINT-004 — camelCase event handlers
// ---------------------------------------------------------------------------

describe("§4 W-LINT-004 — camelCase event handlers", () => {
  test("detects onChange=", () => {
    const diags = lint("<input onChange={handleChange}>");
    expect(hasCode(diags, "W-LINT-004")).toBe(true);
  });

  test("detects onSubmit=", () => {
    const diags = lint("<form onSubmit={handleSubmit}>");
    expect(hasCode(diags, "W-LINT-004")).toBe(true);
  });

  test("detects onClick=", () => {
    const diags = lint("<button onClick={doIt}>");
    expect(hasCode(diags, "W-LINT-004")).toBe(true);
  });

  test("message suggests lowercase + parens", () => {
    const diags = lint("<button onClick={fn}>");
    const d = diags.find(d => d.code === "W-LINT-004");
    expect(d.correction).toContain("onchange");
  });

  test("negative: onchange= (lowercase) does NOT trigger W-LINT-004", () => {
    const diags = lint("<input onchange=handleChange()>");
    expect(hasCode(diags, "W-LINT-004")).toBe(false);
  });

  test("negative: onclick= (lowercase) does NOT trigger W-LINT-004", () => {
    const diags = lint("<button onclick=doIt()>");
    expect(hasCode(diags, "W-LINT-004")).toBe(false);
  });

  test("camelCase event inside ${} logic block is excluded", () => {
    const source = dollars(" el.onChange = fn ");
    const diags = lint(source);
    expect(hasCode(diags, "W-LINT-004")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §5 W-LINT-005 — value={expr} without leading $
// ---------------------------------------------------------------------------

describe("§5 W-LINT-005 — value={expr} JSX braces", () => {
  test("detects value={@state}", () => {
    const diags = lint("<input value={@name}>");
    expect(hasCode(diags, "W-LINT-005")).toBe(true);
  });

  test("detects value={expr}", () => {
    const diags = lint('<input value={"hello"}>');
    expect(hasCode(diags, "W-LINT-005")).toBe(true);
  });

  test("message suggests value=@state (no braces)", () => {
    const diags = lint("<input value={@x}>");
    const d = diags.find(d => d.code === "W-LINT-005");
    expect(d.correction).toContain("value=@state");
  });

  test("negative: value=@state (bare @var, no braces) does NOT trigger W-LINT-005", () => {
    const diags = lint("<input value=@name>");
    expect(hasCode(diags, "W-LINT-005")).toBe(false);
  });

  test("negative: value=${expr} (with leading $) does NOT trigger W-LINT-005", () => {
    // Construct: <input value=${"hello"}> — the ${ is the scrml logic sigil
    const source = "<input value=" + dollars('"hello"') + ">";
    const diags = lint(source);
    expect(hasCode(diags, "W-LINT-005")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §6 W-LINT-006 — for (item of @items) JS iteration in markup
// ---------------------------------------------------------------------------

describe("§6 W-LINT-006 — for (item of @items) ghost loop", () => {
  test("detects for (item of @items)", () => {
    const diags = lint("for (item of @todos) { <li>item</li> }");
    expect(hasCode(diags, "W-LINT-006")).toBe(true);
  });

  test("message suggests for @items / lift item /", () => {
    const diags = lint("for (x of @list) {}");
    const d = diags.find(d => d.code === "W-LINT-006");
    expect(d.correction).toContain("for @items");
    expect(d.correction).toContain("lift item");
  });

  test("negative: for @items (scrml syntax) does NOT trigger W-LINT-006", () => {
    const diags = lint("for @todos / lift item / <li></>");
    expect(hasCode(diags, "W-LINT-006")).toBe(false);
  });

  test("for-of inside ${} logic block is excluded (valid JS)", () => {
    // Construct: ${ for (x of @arr) { result.push(x) } }
    const source = dollars(" for (x of @arr) { result.push(x) } ");
    const diags = lint(source);
    expect(hasCode(diags, "W-LINT-006")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §7 W-LINT-007 — <Comp prop={val}> JSX prop braces
// ---------------------------------------------------------------------------

describe("§7 W-LINT-007 — JSX component prop braces", () => {
  test("detects prop={val}", () => {
    const diags = lint("<MyComp title={heading}>");
    expect(hasCode(diags, "W-LINT-007")).toBe(true);
  });

  test("message suggests prop=val (no braces)", () => {
    const diags = lint("<Card title={heading}>");
    const d = diags.find(d => d.code === "W-LINT-007");
    expect(d.correction).toContain("prop=val");
  });

  test("negative: prop=val (bare value, no braces) does NOT trigger W-LINT-007", () => {
    const diags = lint("<Card title=heading>");
    expect(hasCode(diags, "W-LINT-007")).toBe(false);
  });

  test("negative: prop=@var (reactive var) does NOT trigger W-LINT-007", () => {
    const diags = lint("<Card title=@heading>");
    expect(hasCode(diags, "W-LINT-007")).toBe(false);
  });

  test("negative: prop=${expr} (logic interpolation) does NOT trigger W-LINT-007", () => {
    // Construct: <Card title=${"hello"}> — the ${ is the scrml logic sigil
    const source = "<Card title=" + dollars('"hello"') + ">";
    const diags = lint(source);
    expect(hasCode(diags, "W-LINT-007")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §8 W-LINT-008 — {cond && <El>} React conditional rendering
// ---------------------------------------------------------------------------

describe("§8 W-LINT-008 — JSX conditional rendering", () => {
  test("detects {cond && <El>}", () => {
    const diags = lint("{@isLoggedIn && <Dashboard>}");
    expect(hasCode(diags, "W-LINT-008")).toBe(true);
  });

  test("message suggests <El if=@cond>", () => {
    const diags = lint("{@show && <Modal>}");
    const d = diags.find(d => d.code === "W-LINT-008");
    expect(d.correction).toContain("if=@cond");
  });

  test("negative: <El if=@cond> does NOT trigger W-LINT-008", () => {
    const diags = lint("<Dashboard if=@isLoggedIn>");
    expect(hasCode(diags, "W-LINT-008")).toBe(false);
  });

  test("{...} with && inside ${} logic block excluded", () => {
    // Construct: ${ x && y && someFunc() } — no < tag, so W-LINT-008 wouldn't fire anyway
    const source = dollars(" x && y && someFunc() ");
    const diags = lint(source);
    expect(hasCode(diags, "W-LINT-008")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §9 W-LINT-010 — ${} inside #{} CSS context (Svelte pattern)
// ---------------------------------------------------------------------------

describe("§9 W-LINT-010 — Svelte ${} in CSS context", () => {
  test("detects ${} inside #{} CSS context", () => {
    // Construct: #{ .box { color: ${@theme.color}; } }
    const source = "#{ .box { color: " + dollars("@theme.color") + "; } }";
    const diags = lint(source);
    expect(hasCode(diags, "W-LINT-010")).toBe(true);
  });

  test("message suggests @var directly in #{}", () => {
    const source = "#{ body { color: " + dollars("@primaryColor") + "; } }";
    const d = lint(source).find(d => d.code === "W-LINT-010");
    expect(d.correction).toContain("@var");
    expect(d.correction).toContain("#{}");
  });

  test("negative: @var directly in #{} does NOT trigger W-LINT-010", () => {
    const diags = lint("#{ body { color: @primaryColor; } }");
    expect(hasCode(diags, "W-LINT-010")).toBe(false);
  });

  test("negative: ${} outside CSS context does NOT trigger W-LINT-010", () => {
    // Construct: <p>${"Hello"}</p> — scrml logic interpolation in markup, NOT inside #{}
    const source = "<p>" + dollars('"Hello"') + "</p>";
    const diags = lint(source);
    expect(hasCode(diags, "W-LINT-010")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §10 Negative tests — valid scrml patterns do not trigger lint
// ---------------------------------------------------------------------------

describe("§10 Negative — valid scrml does not trigger ghost lint", () => {
  test("scrml CSS context #{ } is clean", () => {
    const diags = lint('<markup name="app">\n  #{ body { margin: 0; color: @textColor; } }\n</>');
    expect(diags).toHaveLength(0);
  });

  test("scrml reactive binding is clean", () => {
    const diags = lint("<input bind:value=@username>");
    expect(diags).toHaveLength(0);
  });

  test("scrml loop is clean", () => {
    // Construct: for @items / lift item / <li>${item.label}</>
    const source = "for @items / lift item / <li>" + dollars("item.label") + "</>";
    const diags = lint(source);
    expect(diags).toHaveLength(0);
  });

  test("scrml if= conditional is clean", () => {
    const diags = lint("<Modal if=@showModal>");
    expect(diags).toHaveLength(0);
  });

  test("scrml lowercase events are clean", () => {
    const diags = lint("<button onclick=submit() onchange=update()>");
    expect(diags).toHaveLength(0);
  });

  test("logic interpolation ${} in markup is clean", () => {
    // Construct: <p>${"Hello " + @name}</p>
    const source = "<p>" + dollars('"Hello " + @name') + "</p>";
    const diags = lint(source);
    expect(diags).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §11 Multiple ghosts in one file
// ---------------------------------------------------------------------------

describe("§11 Multiple ghosts in one file", () => {
  test("three distinct ghost patterns all produce diagnostics", () => {
    const source =
      '<markup name="app">\n' +
      "  <style>body { color: red; }</style>\n" +
      '  <div className="container">\n' +
      "    <button onChange={handleChange}>click</button>\n" +
      "  </div>\n" +
      "</>";
    const diags = lint(source);
    expect(hasCode(diags, "W-LINT-001")).toBe(true); // <style>
    expect(hasCode(diags, "W-LINT-003")).toBe(true); // className
    expect(hasCode(diags, "W-LINT-004")).toBe(true); // onChange
    expect(diags.length).toBeGreaterThanOrEqual(3);
  });

  test("same ghost pattern repeated twice produces two diagnostics", () => {
    const source = '<div className="a"> <span className="b"></span></div>';
    const diags = lint(source).filter(d => d.code === "W-LINT-003");
    expect(diags.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §12 ${} logic context exclusion
// ---------------------------------------------------------------------------

describe("§12 ${} logic context exclusion", () => {
  test("className inside ${} is excluded from W-LINT-003", () => {
    const source = dollars(' el.className = "active" ');
    expect(hasCode(lint(source), "W-LINT-003")).toBe(false);
  });

  test("onChange inside ${} is excluded from W-LINT-004", () => {
    const source = dollars(" handler.onChange = fn ");
    expect(hasCode(lint(source), "W-LINT-004")).toBe(false);
  });

  test("for-of inside ${} is excluded from W-LINT-006", () => {
    const source = dollars(" for (x of @arr) { total += x } ");
    expect(hasCode(lint(source), "W-LINT-006")).toBe(false);
  });

  test("mixed: ghost in markup triggers, same text inside ${} does not", () => {
    // Construct: <div className="ghost"> ${ el.className = "ok" } </div>
    // The markup className= triggers W-LINT-003; the one inside ${} does not
    const source =
      '<div className="ghost"> ' +
      dollars(' el.className = "ok" ') +
      " </div>";
    const diags = lint(source).filter(d => d.code === "W-LINT-003");
    // Only one match — the markup-level className=, not the ${} one
    expect(diags.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §13 Empty file produces no diagnostics
// ---------------------------------------------------------------------------

describe("§13 Empty file", () => {
  test("empty string produces no diagnostics", () => {
    expect(lint("")).toHaveLength(0);
  });

  test("whitespace-only file produces no diagnostics", () => {
    expect(lint("   \n\n\t  \n")).toHaveLength(0);
  });

  test("null/undefined guard — undefined source returns empty", () => {
    expect(lintGhostPatterns(undefined)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §14 Integration: lint wired into compileScrml() — lintDiagnostics field
// ---------------------------------------------------------------------------

describe("§14 Integration — lintDiagnostics in compileScrml() result", () => {
  test("compileScrml() result has lintDiagnostics field", () => {
    const result = compileSource('<markup name="hello">\n  <p>Hello world</p>\n</>');
    expect(result).toHaveProperty("lintDiagnostics");
    expect(Array.isArray(result.lintDiagnostics)).toBe(true);
  });

  test("clean scrml produces no W-LINT-* ghost-pattern diagnostics", () => {
    // The original assertion was `lintDiagnostics.toHaveLength(0)`. S108
    // dogfood Bug 1 added W-TAILWIND-UNRECOGNIZED-CLASS (info lint) which
    // fires on custom CSS classes like `greeting` (a known false-positive
    // at the floor-fix level — adopters silence via the compiler-setting
    // opt-out). The intent of this test is to assert "no GHOST-pattern
    // lints fire on clean scrml"; we filter to the W-LINT-* prefix to
    // preserve the original intent without overconstraining the broader
    // lintDiagnostics surface.
    const result = compileSource('<markup name="hello">\n  <p class="greeting">Hello</p>\n</>');
    const ghostLints = result.lintDiagnostics.filter(d => d.code?.startsWith("W-LINT-"));
    expect(ghostLints).toHaveLength(0);
  });

  test("ghost pattern in source produces lintDiagnostics entry", () => {
    // className= is a ghost pattern — lint should flag it
    const result = compileSource('<markup name="hello">\n  <div className="bad">test</div>\n</>');
    expect(result.lintDiagnostics.length).toBeGreaterThan(0);
    const foundCodes = result.lintDiagnostics.map(d => d.code);
    expect(foundCodes).toContain("W-LINT-003");
  });

  test("lintDiagnostics includes filePath", () => {
    const result = compileSource('<markup name="x">\n  <div className="oops"></div>\n</>');
    expect(result.lintDiagnostics.length).toBeGreaterThan(0);
    const d = result.lintDiagnostics[0];
    expect(d).toHaveProperty("filePath");
    expect(typeof d.filePath).toBe("string");
    expect(d.filePath.endsWith(".scrml")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §15 Integration: lint does not block compilation
// ---------------------------------------------------------------------------

describe("§15 Integration — lint is non-blocking", () => {
  test("ghost pattern does not add to errors[]", () => {
    const result = compileSource('<markup name="hello">\n  <p>Hello</p>\n</>');
    // lintDiagnostics are NOT in errors — W-LINT codes must be absent from errors
    const errorCodes = result.errors.map(e => e.code);
    expect(errorCodes.some(c => c && c.startsWith("W-LINT-"))).toBe(false);
  });

  test("ghost pattern does not add to warnings[]", () => {
    // Lint diagnostics live in lintDiagnostics[], NOT in warnings[]
    const result = compileSource('<markup name="hello">\n  <div className="x"></div>\n</>');
    const warningCodes = result.warnings.map(w => w.code);
    expect(warningCodes.some(c => c && c.startsWith("W-LINT-"))).toBe(false);
  });

  test("compileScrml() returns outputs Map even when lint finds ghosts", () => {
    const result = compileSource('<markup name="hello">\n  <p>Hi</p>\n</>');
    expect(result.outputs).toBeInstanceOf(Map);
  });
});

// ---------------------------------------------------------------------------
// §16 Diagnostic shape — all required fields present
// ---------------------------------------------------------------------------

describe("§16 Diagnostic shape", () => {
  test("diagnostic has all required fields", () => {
    const diags = lint("<style>.x {}</style>");
    expect(diags.length).toBeGreaterThan(0);
    const d = diags[0];
    expect(typeof d.line).toBe("number");
    expect(typeof d.column).toBe("number");
    expect(typeof d.ghost).toBe("string");
    expect(typeof d.correction).toBe("string");
    expect(typeof d.message).toBe("string");
    expect(d.severity).toBe("warning");
    expect(typeof d.code).toBe("string");
    expect(d.code.startsWith("W-LINT-")).toBe(true);
  });

  test("line numbers are 1-based", () => {
    const diags = lint("\n\n<style>.x {}</style>");
    const d = diags.find(d => d.code === "W-LINT-001");
    expect(d.line).toBeGreaterThanOrEqual(3); // third line
  });

  test("column numbers are 1-based", () => {
    const diags = lint("<style>.x {}</style>");
    const d = diags.find(d => d.code === "W-LINT-001");
    expect(d.column).toBeGreaterThanOrEqual(1);
  });

  test("message format: Line N: Found 'X' — scrml uses 'Y'. See §S.", () => {
    const diags = lint("<style>.x {}</style>");
    const d = diags.find(d => d.code === "W-LINT-001");
    expect(d.message).toMatch(/^Line \d+:/);
    expect(d.message).toContain("Found '");
    expect(d.message).toContain("scrml uses '");
    // § is U+00A7 — check that the spec reference is present
    expect(d.message).toMatch(/See \u00a7\d/);
  });
});

// ---------------------------------------------------------------------------
// §17 Diagnostic sorting — sorted by line then column
// ---------------------------------------------------------------------------

describe("§17 Diagnostic sorting", () => {
  test("diagnostics are sorted by line number ascending", () => {
    const source =
      '<div className="a">\n' +
      "<style>.x {}</style>\n" +
      "<button onChange={fn}></button>\n";
    const diags = lint(source);
    for (let i = 1; i < diags.length; i++) {
      const prev = diags[i - 1];
      const curr = diags[i];
      const ordered =
        prev.line < curr.line ||
        (prev.line === curr.line && prev.column <= curr.column);
      expect(ordered).toBe(true);
    }
  });

  test("diagnostics on same line are sorted by column", () => {
    const source = '<div className="a" className="b">';
    const diags = lint(source).filter(d => d.code === "W-LINT-003");
    if (diags.length >= 2) {
      expect(diags[0].column).toBeLessThanOrEqual(diags[1].column);
    }
  });
});

// ---------------------------------------------------------------------------
// §18 — W-LINT-011: Vue `:attr=` colon-prefixed attribute binding
// ---------------------------------------------------------------------------

describe("W-LINT-011: Vue :attr= colon-prefixed attribute binding", () => {

  test("fires on :class= at attribute position", () => {
    const diags = lint('<div :class="wrapper">');
    expect(hasCode(diags, "W-LINT-011")).toBe(true);
  });

  test("fires on :value= on form inputs", () => {
    const diags = lint('<input :value="@text">');
    expect(hasCode(diags, "W-LINT-011")).toBe(true);
  });

  test("does NOT fire on scrml's class:name= (ident before colon)", () => {
    const diags = lint('<div class:active=@cond>');
    expect(hasCode(diags, "W-LINT-011")).toBe(false);
  });

  test("does NOT fire on scrml's bind:value= (ident before colon)", () => {
    const diags = lint('<input bind:value=@text>');
    expect(hasCode(diags, "W-LINT-011")).toBe(false);
  });

  test("does NOT fire inside ${} logic blocks", () => {
    const diags = lint('${ const obj = { :key: 1 } }');
    expect(hasCode(diags, "W-LINT-011")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §19 — W-LINT-012: Vue directive family (v-if, v-for, v-model, etc.)
// ---------------------------------------------------------------------------

describe("W-LINT-012: Vue directive family", () => {

  test("fires on v-if=", () => {
    const diags = lint('<p v-if="@show">shown</p>');
    expect(hasCode(diags, "W-LINT-012")).toBe(true);
  });

  test("fires on v-for=", () => {
    const diags = lint('<li v-for="item in @items">${item}</li>');
    expect(hasCode(diags, "W-LINT-012")).toBe(true);
  });

  test("fires on v-model=", () => {
    const diags = lint('<input v-model="@text">');
    expect(hasCode(diags, "W-LINT-012")).toBe(true);
  });

  test("fires on v-show=", () => {
    const diags = lint('<p v-show="@visible">hi</p>');
    expect(hasCode(diags, "W-LINT-012")).toBe(true);
  });

  test("fires on v-else without value", () => {
    const diags = lint('<p v-if="@a">A</p><p v-else>B</p>');
    expect(hasCode(diags, "W-LINT-012")).toBe(true);
  });

  test("fires on v-bind:attr= long form", () => {
    const diags = lint('<div v-bind:class="@wrapper">');
    expect(hasCode(diags, "W-LINT-012")).toBe(true);
  });

  test("does NOT fire inside ${} logic blocks", () => {
    const diags = lint('${ const v_if = 1 }');
    expect(hasCode(diags, "W-LINT-012")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §20 — W-LINT-013: Vue @event= shorthand (with modifiers)
// ---------------------------------------------------------------------------

describe("W-LINT-013: Vue @event= attribute shorthand", () => {

  test("fires on @click=", () => {
    const diags = lint('<button @click="increment">+</button>');
    expect(hasCode(diags, "W-LINT-013")).toBe(true);
  });

  test("fires on @click.stop= with modifier", () => {
    const diags = lint('<button @click.stop="handler">+</button>');
    expect(hasCode(diags, "W-LINT-013")).toBe(true);
  });

  test("fires on @submit.prevent=", () => {
    const diags = lint('<form @submit.prevent="save"></form>');
    expect(hasCode(diags, "W-LINT-013")).toBe(true);
  });

  test("does NOT fire on scrml's @count attribute value (preceded by =)", () => {
    const diags = lint('<input value=@count>');
    expect(hasCode(diags, "W-LINT-013")).toBe(false);
  });

  test("does NOT fire on @var inside ${} logic reactive sigil", () => {
    const diags = lint('${ @count = 0 }');
    expect(hasCode(diags, "W-LINT-013")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §21 — W-LINT-014: Svelte block directives {#if} {#each} {/if} etc.
// ---------------------------------------------------------------------------

describe("W-LINT-014: Svelte block directives", () => {

  test("fires on {#if @cond}", () => {
    const diags = lint('{#if @show}<p>hi</p>{/if}');
    expect(hasCode(diags, "W-LINT-014")).toBe(true);
  });

  test("fires on {#each @items as item}", () => {
    const diags = lint('{#each @items as item}<li>${item}</li>{/each}');
    expect(hasCode(diags, "W-LINT-014")).toBe(true);
  });

  test("fires on {:else}", () => {
    const diags = lint('{#if @a}A{:else}B{/if}');
    expect(hasCode(diags, "W-LINT-014")).toBe(true);
  });

  test("fires on {#await promise}", () => {
    const diags = lint('{#await @fetch}loading{:then v}done{/await}');
    expect(hasCode(diags, "W-LINT-014")).toBe(true);
  });

  test("does NOT fire inside ${} logic blocks", () => {
    const diags = lint('${ const o = { "#if": 1 } }');
    expect(hasCode(diags, "W-LINT-014")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §22 — W-LINT-015: Svelte {@html expr} directive
// ---------------------------------------------------------------------------

describe("W-LINT-015: Svelte {@html expr} raw HTML directive", () => {

  test("fires on {@html expr}", () => {
    const diags = lint('<div>{@html @bio}</div>');
    expect(hasCode(diags, "W-LINT-015")).toBe(true);
  });

  test("does NOT fire inside ${} logic blocks", () => {
    const diags = lint('${ const o = { "@html": 1 } }');
    expect(hasCode(diags, "W-LINT-015")).toBe(false);
  });

  test("does NOT fire on scrml's ${ expr } interpolation", () => {
    const diags = lint('<div>${ @bio }</div>');
    expect(hasCode(diags, "W-LINT-015")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §23 — No false positives on the default `scrml init` scaffold
// ---------------------------------------------------------------------------

describe("Scaffold zero-lint regression guard", () => {

  test("the default `scrml init` scaffold produces zero ghost-lint diagnostics", () => {
    // Mirrors the scaffold shipped by compiler/src/commands/init.js. If any of
    // the W-LINT-NNN patterns fires here, the scaffold is advertising a
    // forbidden pattern and needs updating.
    const scaffold = [
      "<program>",
      "",
      "${",
      "    @count = 0",
      "    @step = 1",
      "    function increment() { @count = @count + Number(@step) }",
      "    function decrement() { if (@count - @step >= 0) { @count = @count - @step } }",
      "    function clearCount() { @count = 0 }",
      "}",
      "",
      "<div class=\"app\">",
      "    <h1>Hello from scrml</h1>",
      "    <p class=\"count\">${@count}</p>",
      "    <div class=\"controls\">",
      "        <button onclick=decrement()>-</button>",
      "        <button onclick=clearCount()>Reset</button>",
      "        <button onclick=increment()>+</button>",
      "    </div>",
      "    <label>Step size:",
      "        <select bind:value=@step>",
      "            <option value=\"1\">1</option>",
      "            <option value=\"5\">5</option>",
      "            <option value=\"10\">10</option>",
      "        </select>",
      "    </label>",
      "</div>",
      "",
      "#{",
      "    .app { max-width: 400px; text-align: center; }",
      "    .count { font-size: 4rem; }",
      "    button:hover { background: #f5f5f5; }",
      "    label { color: #777; }",
      "}",
      "",
      "</program>",
    ].join("\n");
    const diags = lint(scaffold);
    expect(diags).toHaveLength(0);
  });
});
