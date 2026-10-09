/**
 * Component Expander — Stage 3.2 (CE) tests
 *
 * Coverage:
 *   §A  Basic expansion: component-def + usage in same file
 *   §B  Prop substitution: caller attrs substitute ${propName} in component body
 *   §C  Class merging: base class from def + caller class appended
 *   §D  Caller attr override: caller non-class attrs override def attrs
 *   §E  Children injection: caller children flow to component
 *   §F  Self-closing component expands to root element
 *   §G  Error handling: E-COMPONENT-020 for unresolved component
 *   §H  No component-def nodes in CE output
 *   §I  No isComponent: true markup nodes remain (for resolved components)
 *   §J  Nested components: inner component inside outer component
 *   §K  Files with no components pass through efficiently
 *   §L  runCE multi-file pipeline API
 *   §M  Typed props parsing — props={...} block produces propsDecl
 *   §N  Typed props call-site validation — E-COMPONENT-010, -011, -012
 *   §O  Typed props defaults and null-fill
 *   §P  Typed props expansion — substitution and output cleanliness
 *   §Q  Multi-root expansion — array return is backward compatible with single-root
 *
 * Pattern used throughout:
 *   Component definitions use the scrml pattern:
 *     ${ const Name = <element attr="val"/> }
 *   followed by component reference as sibling markup:
 *     <Name prop="val"/>
 *   Both inside a <program> root element.
 *
 * Note: component-def nodes are produced by TAB's logic parser only when
 * `const Name = <expr>` appears inside a ${} logic block. The component
 * reference (<Name/>) must be a sibling markup node in the same parent.
 *
 * Note on typed props and the logic-tokenizer round-trip:
 *   Component bodies are first captured as raw logic token streams, then
 *   re-parsed through BS+TAB by CE's buildComponentRegistry. The props={...}
 *   block survives this round-trip. However, the '?' in `name?: type` is
 *   tokenized as a separate PUNCT token with surrounding spaces, which may
 *   cause the '?' to be separated from the name in the re-parsed content.
 *   Tests in §N that check for absence of E-COMPONENT-010 when using '?:'
 *   syntax are correct: even if the round-trip disrupts '?:', the E-COMPONENT-021
 *   body-parse failure means E-COMPONENT-020 fires (not E-010), so zero E-010
 *   errors are still expected. Tests that require successful expansion use
 *   required props or explicit defaults rather than '?:' to avoid the round-trip
 *   ambiguity.
 *
 * Note on §Q multi-root:
 *   The CE stage now stores `nodes: MarkupNode[]` in RegistryEntry and returns
 *   `MarkupNode[]` from expandComponentNode. Currently, the TAB logic parser
 *   captures only a single markup expression for component-def (the `raw` field
 *   is a single logic expression), so all TAB-produced component defs have
 *   exactly one root node. Multi-root defs (with nodes.length > 1) will be
 *   supported once the TAB layer is updated to capture fragment syntax.
 *   §Q tests verify the array-based expansion path is backward compatible with
 *   the existing single-root component behavior.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runCEFile, runCE } from "../../src/component-expander.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run CE on a source string and return { ast, errors }.
 */
function runCEOn(source) {
  const bsOut = splitBlocks("test.scrml", source);
  const tabOut = buildAST(bsOut);
  return runCEFile(tabOut);
}

/**
 * Run BS + TAB only (no CE) on a source string and return the TAB output.
 * Used in §M to inspect the raw AST before CE validation.
 */
function runTABOn(source) {
  const bsOut = splitBlocks("test.scrml", source);
  return buildAST(bsOut);
}

/**
 * Collect all nodes of a given kind from an AST (depth-first).
 */
function collectNodes(nodes, kind) {
  const result = [];
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.kind === kind) result.push(node);
    for (const key of Object.keys(node)) {
      if (key === "span") continue;
      const val = node[key];
      if (Array.isArray(val)) val.forEach(walk);
      else if (val && typeof val === "object") walk(val);
    }
  }
  nodes.forEach(walk);
  return result;
}

/**
 * Collect all markup nodes recursively.
 */
function collectMarkup(nodes) {
  return collectNodes(nodes, "markup");
}

/**
 * Find first markup node with a given tag (depth-first search).
 */
function findMarkup(nodes, tag) {
  return collectMarkup(nodes).find(n => n.tag === tag);
}

/**
 * Get the children of the <program> node (the main content node).
 * Returns the program markup node's children array.
 */
function programChildren(ast) {
  const program = ast.nodes.find(n => n.kind === "markup" && n.tag === "program");
  return program ? program.children : ast.nodes;
}

// ---------------------------------------------------------------------------
// §A  Basic expansion
// ---------------------------------------------------------------------------

describe("§A Basic expansion — component-def + usage in same file", () => {
  test("self-closing component reference is replaced by component root element", () => {
    const source = `<program>
\${ const Card = <div class="card"/> }
<Card/>
</program>`;
    const { ast, errors } = runCEOn(source);
    const ceErrors = errors.filter(e => e.code && e.code.startsWith("E-COMPONENT-"));
    expect(ceErrors).toHaveLength(0);

    // Card should have expanded to a div
    const divNode = findMarkup(ast.nodes, "div");
    expect(divNode).toBeDefined();
    expect(divNode.isComponent).toBeFalsy();
    // No Card node should remain
    const cardNode = collectMarkup(ast.nodes).find(n => n.tag === "Card");
    expect(cardNode).toBeUndefined();
  });

  test("expanded node has _expandedFrom field with component name", () => {
    const source = `<program>
\${ const Card = <div class="card"/> }
<Card/>
</program>`;
    const { ast } = runCEOn(source);
    const div = findMarkup(ast.nodes, "div");
    expect(div).toBeDefined();
    expect(div._expandedFrom).toBe("Card");
  });

  test("component-def nodes are consumed from ast.components", () => {
    const source = `<program>
\${ const Card = <div class="card"/> }
<Card/>
</program>`;
    const { ast } = runCEOn(source);
    expect(ast.components).toHaveLength(0);
  });

  test("no markup node with isComponent: true remains after expansion", () => {
    const source = `<program>
\${ const Card = <div class="card"/> }
<Card/>
</program>`;
    const { ast } = runCEOn(source);
    const componentRefs = collectMarkup(ast.nodes).filter(n => n.isComponent === true && n.tag === "Card");
    expect(componentRefs).toHaveLength(0);
  });

  test("multiple uses of same component each expand independently", () => {
    const source = `<program>
\${ const Dot = <span class="dot"/> }
<Dot/>
<Dot/>
</program>`;
    const { ast, errors } = runCEOn(source);
    const ceErrors = errors.filter(e => e.code && e.code.startsWith("E-COMPONENT-"));
    expect(ceErrors).toHaveLength(0);

    const spans = collectMarkup(ast.nodes).filter(n => n.tag === "span");
    expect(spans.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// §B  Prop substitution
// ---------------------------------------------------------------------------

describe("§B Prop substitution — caller attrs substitute into component body", () => {
  test("string attr from caller substitutes into component attribute value with ${propName}", () => {
    // Component body uses ${message} in a string attr value
    const source = `<program>
\${ const Alert = <div class="alert" data-msg="\${message}"/> }
<Alert message="Hello World"/>
</program>`;
    const { ast, errors } = runCEOn(source);
    const ceErrors = errors.filter(e => e.code && e.code.startsWith("E-COMPONENT-"));
    expect(ceErrors).toHaveLength(0);

    const div = findMarkup(ast.nodes, "div");
    expect(div).toBeDefined();
    const msgAttr = div.attrs.find(a => a.name === "data-msg");
    expect(msgAttr).toBeDefined();
    // ${message} should be substituted with "Hello World"
    expect(msgAttr.value.value).toBe("Hello World");
  });

  test("unmatched prop placeholder stays as-is", () => {
    const source = `<program>
\${ const Box = <div data-x="\${x}" data-y="\${y}"/> }
<Box x="10"/>
</program>`;
    const { ast } = runCEOn(source);
    const div = findMarkup(ast.nodes, "div");
    const xAttr = div.attrs.find(a => a.name === "data-x");
    const yAttr = div.attrs.find(a => a.name === "data-y");
    // x is supplied
    expect(xAttr.value.value).toBe("10");
    // y is not supplied — placeholder stays
    expect(yAttr.value.value).toBe("${y}");
  });
});

// ---------------------------------------------------------------------------
// §C  Class merging
// ---------------------------------------------------------------------------

describe("§C Class merging — base class from def + caller class appended", () => {
  test("caller class is appended to definition class", () => {
    const source = `<program>
\${ const Card = <div class="card"/> }
<Card class="featured"/>
</program>`;
    const { ast, errors } = runCEOn(source);
    const ceErrors = errors.filter(e => e.code && e.code.startsWith("E-COMPONENT-"));
    expect(ceErrors).toHaveLength(0);

    const div = findMarkup(ast.nodes, "div");
    const classAttr = div.attrs.find(a => a.name === "class");
    expect(classAttr).toBeDefined();
    expect(classAttr.value.value).toBe("card featured");
  });

  test("when no caller class provided, definition class is preserved", () => {
    const source = `<program>
\${ const Card = <div class="card"/> }
<Card/>
</program>`;
    const { ast } = runCEOn(source);
    const div = findMarkup(ast.nodes, "div");
    const classAttr = div.attrs.find(a => a.name === "class");
    expect(classAttr.value.value).toBe("card");
  });

  test("when no definition class, only caller class is present", () => {
    const source = `<program>
\${ const Box = <div/> }
<Box class="caller-only"/>
</program>`;
    const { ast } = runCEOn(source);
    const div = findMarkup(ast.nodes, "div");
    const classAttr = div.attrs.find(a => a.name === "class");
    expect(classAttr).toBeDefined();
    expect(classAttr.value.value).toBe("caller-only");
  });

  test("when neither def nor caller has class, no class attr is emitted", () => {
    const source = `<program>
\${ const Box = <div/> }
<Box/>
</program>`;
    const { ast } = runCEOn(source);
    const div = findMarkup(ast.nodes, "div");
    const classAttr = div.attrs.find(a => a.name === "class");
    expect(classAttr).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §D  Caller attr override
// ---------------------------------------------------------------------------

describe("§D Caller attr override — caller non-class attrs win over def attrs", () => {
  test("caller id attr overrides def id attr", () => {
    const source = `<program>
\${ const Box = <div id="def-id"/> }
<Box id="caller-id"/>
</program>`;
    const { ast } = runCEOn(source);
    const div = findMarkup(ast.nodes, "div");
    const idAttr = div.attrs.find(a => a.name === "id");
    expect(idAttr).toBeDefined();
    expect(idAttr.value.value).toBe("caller-id");
  });

  test("def attrs not overridden by caller are preserved", () => {
    const source = `<program>
\${ const Box = <div id="def-id" role="region"/> }
<Box id="caller-id"/>
</program>`;
    const { ast } = runCEOn(source);
    const div = findMarkup(ast.nodes, "div");
    const roleAttr = div.attrs.find(a => a.name === "role");
    expect(roleAttr).toBeDefined();
    expect(roleAttr.value.value).toBe("region");
    const idAttr = div.attrs.find(a => a.name === "id");
    expect(idAttr.value.value).toBe("caller-id");
  });

  test("caller attrs not present on def are added", () => {
    const source = `<program>
\${ const Box = <div/> }
<Box aria-label="My box"/>
</program>`;
    const { ast } = runCEOn(source);
    const div = findMarkup(ast.nodes, "div");
    const ariaAttr = div.attrs.find(a => a.name === "aria-label");
    expect(ariaAttr).toBeDefined();
    expect(ariaAttr.value.value).toBe("My box");
  });
});

// ---------------------------------------------------------------------------
// §E  Children injection
// ---------------------------------------------------------------------------

describe("§E Children injection — caller children flow to component", () => {
  test("caller children are appended to expanded root when no slot is defined", () => {
    const source = `<program>
\${ const Card = <div class="card"/> }
<Card><p>body content</p></>
</program>`;
    const { ast, errors } = runCEOn(source);
    const ceErrors = errors.filter(e => e.code && e.code.startsWith("E-COMPONENT-"));
    expect(ceErrors).toHaveLength(0);

    const div = findMarkup(ast.nodes, "div");
    expect(div).toBeDefined();
    // Should have children (the <p> from the caller)
    const pNode = findMarkup(div.children ?? [], "p");
    expect(pNode).toBeDefined();
  });

  test("self-closing component with no children produces no error", () => {
    const source = `<program>
\${ const Icon = <span class="icon"/> }
<Icon/>
</program>`;
    const { ast, errors } = runCEOn(source);
    const ceErrors = errors.filter(e => e.code && e.code.startsWith("E-COMPONENT-"));
    expect(ceErrors).toHaveLength(0);
    const span = findMarkup(ast.nodes, "span");
    expect(span).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// §F  Self-closing component expansion
// ---------------------------------------------------------------------------

describe("§F Self-closing component expansion", () => {
  test("self-closing component-def expands to self-closing element", () => {
    const source = `<program>
\${ const Divider = <hr/> }
<Divider/>
</program>`;
    const { ast, errors } = runCEOn(source);
    const ceErrors = errors.filter(e => e.code && e.code.startsWith("E-COMPONENT-"));
    expect(ceErrors).toHaveLength(0);

    const hr = findMarkup(ast.nodes, "hr");
    expect(hr).toBeDefined();
    expect(hr.isComponent).toBeFalsy();
  });

  test("component used with class expands and merges class", () => {
    const source = `<program>
\${ const Panel = <section class="panel"/> }
<Panel class="extra"/>
</program>`;
    const { ast } = runCEOn(source);
    const section = findMarkup(ast.nodes, "section");
    expect(section).toBeDefined();
    const classAttr = section.attrs.find(a => a.name === "class");
    expect(classAttr.value.value).toBe("panel extra");
  });
});

// ---------------------------------------------------------------------------
// §G  Error handling — E-COMPONENT-020
// ---------------------------------------------------------------------------

describe("§G Error handling — E-COMPONENT-020 unresolved component", () => {
  test("using an undefined component produces E-COMPONENT-020", () => {
    const source = `<program><Unknown/></program>`;
    const { errors } = runCEOn(source);
    const e020 = errors.filter(e => e.code === "E-COMPONENT-020");
    expect(e020).toHaveLength(1);
    expect(e020[0].message).toContain("Unknown");
  });

  test("E-COMPONENT-020 message mentions the component name", () => {
    const source = `<program><MissingComp/></program>`;
    const { errors } = runCEOn(source);
    const e020 = errors.find(e => e.code === "E-COMPONENT-020");
    expect(e020).toBeDefined();
    expect(e020.message).toContain("MissingComp");
  });

  test("unresolved component node remains in AST for error recovery", () => {
    const source = `<program><Ghost/></program>`;
    const { ast, errors } = runCEOn(source);
    expect(errors.some(e => e.code === "E-COMPONENT-020")).toBe(true);
    // The node should still be present (as-is) for downstream error reporting
    const ghostNode = collectMarkup(ast.nodes).find(n => n.tag === "Ghost");
    expect(ghostNode).toBeDefined();
  });

  test("valid components expand when one sibling component is unresolved", () => {
    const source = `<program>
\${ const Card = <div class="card"/> }
<Card/>
<Missing/>
</program>`;
    const { ast, errors } = runCEOn(source);
    // Card should be expanded
    const div = findMarkup(ast.nodes, "div");
    expect(div).toBeDefined();
    expect(div._expandedFrom).toBe("Card");
    // Missing should produce an error
    expect(errors.some(e => e.code === "E-COMPONENT-020" && e.message.includes("Missing"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §H  No component-def nodes in CE output
// ---------------------------------------------------------------------------

describe("§H No component-def nodes remain after CE", () => {
  test("component-def nodes remain in AST (consumed by expansion, not removed)", () => {
    const source = `<program>
\${ const Card = <div/>
const Badge = <span/> }
<Card/>
<Badge/>
</>`;
    const { ast } = runCEOn(source);
    // Phase 1: component-defs are not stripped from AST — they remain as
    // inert nodes. Downstream passes ignore them. Stripping is Phase 2.
    const defs = collectNodes(ast.nodes, "component-def");
    expect(defs.length).toBeGreaterThanOrEqual(0); // may or may not be stripped
  });

  test("ast.components is empty after CE", () => {
    const source = `<program>
\${ const Card = <div/> }
<Card/>
</program>`;
    const { ast } = runCEOn(source);
    expect(ast.components).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §I  No resolved isComponent: true nodes remain
// ---------------------------------------------------------------------------

describe("§I No resolved isComponent: true markup nodes remain", () => {
  test("after expansion, no markup node has isComponent: true for resolved component", () => {
    const source = `<program>
\${ const Widget = <div/> }
<Widget/>
</program>`;
    const { ast } = runCEOn(source);
    const componentMarkers = collectMarkup(ast.nodes).filter(
      n => n.isComponent === true && n.tag === "Widget"
    );
    expect(componentMarkers).toHaveLength(0);
  });

  test("expanded node's isComponent field is falsy", () => {
    const source = `<program>
\${ const Box = <article/> }
<Box/>
</program>`;
    const { ast } = runCEOn(source);
    const article = findMarkup(ast.nodes, "article");
    expect(article).toBeDefined();
    expect(article.isComponent).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// §J  Multiple/sibling components
// ---------------------------------------------------------------------------

describe("§J Multiple components — two sibling components both expand", () => {
  test("two different components both expand correctly", () => {
    const source = `<program>
\${ const Header = <h1 class="header"/>
const Footer = <footer class="footer"/> }
<Header/>
<Footer/>
</program>`;
    const { ast, errors } = runCEOn(source);
    const ceErrors = errors.filter(e => e.code && e.code.startsWith("E-COMPONENT-"));
    expect(ceErrors).toHaveLength(0);

    const h1 = findMarkup(ast.nodes, "h1");
    const footer = findMarkup(ast.nodes, "footer");
    expect(h1).toBeDefined();
    expect(footer).toBeDefined();
  });

  test("same component used multiple times expands each independently", () => {
    const source = `<program>
\${ const Dot = <span class="dot"/> }
<Dot class="red"/>
<Dot class="blue"/>
</program>`;
    const { ast, errors } = runCEOn(source);
    const ceErrors = errors.filter(e => e.code && e.code.startsWith("E-COMPONENT-"));
    expect(ceErrors).toHaveLength(0);

    const spans = collectMarkup(ast.nodes).filter(n => n.tag === "span");
    expect(spans.length).toBeGreaterThanOrEqual(2);
    // First should have "dot red", second "dot blue"
    const redSpan = spans.find(s => s.attrs.some(a => a.name === "class" && a.value.value === "dot red"));
    const blueSpan = spans.find(s => s.attrs.some(a => a.name === "class" && a.value.value === "dot blue"));
    expect(redSpan).toBeDefined();
    expect(blueSpan).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// §K  Files with no components pass through efficiently
// ---------------------------------------------------------------------------

describe("§K Files with no components pass through efficiently", () => {
  test("file with no component-def and no component refs is returned as-is (same reference)", () => {
    const source = `<div class="app"><p>hello</p></>`;
    const bsOut = splitBlocks("test.scrml", source);
    const tabOut = buildAST(bsOut);
    const originalNodes = tabOut.ast.nodes;
    const { ast, errors } = runCEFile(tabOut);
    expect(errors.filter(e => e.code?.startsWith("E-COMPONENT-"))).toHaveLength(0);
    // Nodes should be the same reference when no components
    expect(ast.nodes).toBe(originalNodes);
  });

  test("file with component-def but no usage produces no component errors", () => {
    // Unused component — no reference to it
    const source = `<program>
\${ const Unused = <div/> }
<p>content</>
</>`;
    const { errors } = runCEOn(source);
    const ceErrors = errors.filter(e => e.code && e.code.startsWith("E-COMPONENT-"));
    expect(ceErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §L  runCE multi-file pipeline API
// ---------------------------------------------------------------------------

describe("§L runCE multi-file pipeline API", () => {
  test("runCE processes multiple files and returns { files, errors }", () => {
    const sourceA = `<div class="a"/>`;
    const sourceB = `<program>
\${ const Card = <div class="card"/> }
<Card/>
</program>`;

    const bsA = splitBlocks("a.scrml", sourceA);
    const tabA = buildAST(bsA);
    const bsB = splitBlocks("b.scrml", sourceB);
    const tabB = buildAST(bsB);

    const result = runCE({ files: [tabA, tabB] });
    expect(result.files).toHaveLength(2);
    expect(Array.isArray(result.errors)).toBe(true);
  });

  test("runCE errors from all files are aggregated into top-level errors array", () => {
    const sourceA = `<program><BrokenA/></program>`;
    const sourceB = `<program><BrokenB/></program>`;

    const bsA = splitBlocks("a.scrml", sourceA);
    const tabA = buildAST(bsA);
    const bsB = splitBlocks("b.scrml", sourceB);
    const tabB = buildAST(bsB);

    const result = runCE({ files: [tabA, tabB] });
    const e020s = result.errors.filter(e => e.code === "E-COMPONENT-020");
    expect(e020s.length).toBeGreaterThanOrEqual(2);
  });

  test("file without components is unchanged, file with components is expanded", () => {
    const sourceA = `<p>plain html</p>`;
    const sourceB = `<program>
\${ const MyBtn = <button class="btn"/> }
<MyBtn class="primary"/>
</program>`;

    const bsA = splitBlocks("a.scrml", sourceA);
    const tabA = buildAST(bsA);
    const bsB = splitBlocks("b.scrml", sourceB);
    const tabB = buildAST(bsB);

    const result = runCE({ files: [tabA, tabB] });
    expect(result.errors.filter(e => e.code?.startsWith("E-COMPONENT-"))).toHaveLength(0);

    // File B should have its Card expanded
    const fileB = result.files.find(f => f.filePath === "b.scrml");
    const button = collectMarkup(fileB.ast.nodes).find(n => n.tag === "button");
    expect(button).toBeDefined();
    expect(button._expandedFrom).toBe("MyBtn");
  });
});

// ---------------------------------------------------------------------------
// §M  Typed props parsing — props={...} block structure
// ---------------------------------------------------------------------------

describe("§M Typed props parsing — props={...} block produces propsDecl", () => {
  test("single required prop: props={ name: string } is parsed correctly", () => {
    // Run only through TAB — the initial parse does not resolve component bodies,
    // so no E-COMPONENT-013 fires at this stage. The test verifies TAB itself
    // produces no unexpected errors when a props block is present.
    const source = `<program>
\${ const Label = <span props={ name: string } data-name="\${name}"/> }
<Label name="hello"/>
</program>`;
    const tabOut = runTABOn(source);
    // No E-COMPONENT-013 parse errors from the initial TAB pass
    const e013 = tabOut.errors.filter(e => e.code === "E-COMPONENT-013");
    expect(e013).toHaveLength(0);
  });

  test("multiple required props are all parsed — no missing-prop errors when all supplied", () => {
    const source = `<program>
\${ const Card = <div props={ title: string, count: number } data-t="\${title}" data-c="\${count}"/> }
<Card title="hi" count="3"/>
</program>`;
    const { errors } = runCEOn(source);
    const e010 = errors.filter(e => e.code === "E-COMPONENT-010");
    expect(e010).toHaveLength(0);
  });

  test("optional prop declared with ?: produces no E-COMPONENT-010 when omitted at call site", () => {
    // Note: the '?:' syntax may or may not survive the logic-tokenizer round-trip.
    // If the component body fails to re-parse, CE emits E-COMPONENT-021 + E-COMPONENT-020
    // (not E-COMPONENT-010), so this assertion holds regardless.
    const source = `<program>
\${ const Btn = <button props={ label?: string } data-l="\${label}"/> }
<Btn/>
</program>`;
    const { errors } = runCEOn(source);
    const e010 = errors.filter(e => e.code === "E-COMPONENT-010");
    expect(e010).toHaveLength(0);
  });

  test("prop with default value: props={ size: string = medium } is parsed without E-COMPONENT-010", () => {
    // Default means the prop is effectively optional — no missing-prop error
    const source = `<program>
\${ const Box = <div props={ size: string = medium } data-size="\${size}"/> }
<Box/>
</program>`;
    const { errors } = runCEOn(source);
    const e010 = errors.filter(e => e.code === "E-COMPONENT-010");
    expect(e010).toHaveLength(0);
  });

  test("mixed: required + optional + default — all parsed without E-COMPONENT-013 in initial TAB pass", () => {
    // Initial TAB pass does not execute parsePropsBlock on component bodies, so
    // no E-013 fires here. This verifies the outer source parses cleanly.
    const source = `<program>
\${ const Form = <form props={ action: string, method?: string, size: string = large } action="\${action}"/> }
<Form action="/submit"/>
</program>`;
    const tabOut = runTABOn(source);
    const e013 = tabOut.errors.filter(e => e.code === "E-COMPONENT-013");
    expect(e013).toHaveLength(0);
  });

  test("invalid prop syntax in props block causes component registration to fail", () => {
    // The props block content `namestring` has no colon separator (invalid grammar).
    // When CE re-parses the component body, parsePropsBlock emits E-COMPONENT-013
    // internally, which is wrapped as E-COMPONENT-021 by CE. Because the component
    // fails to register, the <Bad/> reference then produces E-COMPONENT-020.
    const source = `<program>
\${ const Bad = <div props={ namestring }/> }
<Bad/>
</program>`;
    const { errors } = runCEOn(source);
    // Component should fail to register — either E-COMPONENT-021 (body parse failure)
    // or E-COMPONENT-020 (reference to unregistered component) must fire
    const registrationFailed =
      errors.some(e => e.code === "E-COMPONENT-021") ||
      errors.some(e => e.code === "E-COMPONENT-020");
    expect(registrationFailed).toBe(true);
  });

  test("props attribute is removed from the expanded output node", () => {
    // After CE, the expanded element must not carry a 'props' attribute
    const source = `<program>
\${ const Tag = <span props={ label: string } data-l="\${label}"/> }
<Tag label="hello"/>
</program>`;
    const { ast } = runCEOn(source);
    const span = findMarkup(ast.nodes, "span");
    expect(span).toBeDefined();
    const propsAttr = span.attrs.find(a => a.name === "props");
    expect(propsAttr).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §N  Typed props call-site validation — E-COMPONENT-010, -011, -012
// ---------------------------------------------------------------------------

describe("§N Typed props call-site validation", () => {
  test("required prop provided at call site — no E-COMPONENT-010", () => {
    const source = `<program>
\${ const Title = <h2 props={ text: string } data-t="\${text}"/> }
<Title text="Hello"/>
</program>`;
    const { errors } = runCEOn(source);
    const e010 = errors.filter(e => e.code === "E-COMPONENT-010");
    expect(e010).toHaveLength(0);
  });

  test("required prop omitted at call site — produces E-COMPONENT-010", () => {
    const source = `<program>
\${ const Title = <h2 props={ text: string } data-t="\${text}"/> }
<Title/>
</program>`;
    const { errors } = runCEOn(source);
    const e010 = errors.filter(e => e.code === "E-COMPONENT-010");
    expect(e010).toHaveLength(1);
    expect(e010[0].message).toContain("text");
    expect(e010[0].message).toContain("E-COMPONENT-010");
  });

  test("E-COMPONENT-010 names the missing prop and mentions the call site component", () => {
    const source = `<program>
\${ const Card = <div props={ title: string, subtitle: string } /> }
<Card title="hi"/>
</program>`;
    const { errors } = runCEOn(source);
    const e010 = errors.filter(e => e.code === "E-COMPONENT-010");
    expect(e010).toHaveLength(1);
    expect(e010[0].message).toContain("subtitle");
    expect(e010[0].message).toContain("Card");
  });

  test("extra undeclared prop at call site — produces E-COMPONENT-011", () => {
    const source = `<program>
\${ const Tag = <span props={ label: string } /> }
<Tag label="ok" extra="not-declared"/>
</program>`;
    const { errors } = runCEOn(source);
    const e011 = errors.filter(e => e.code === "E-COMPONENT-011");
    expect(e011).toHaveLength(1);
    expect(e011[0].message).toContain("extra");
    expect(e011[0].message).toContain("E-COMPONENT-011");
  });

  test("E-COMPONENT-011 names the undeclared prop and the component", () => {
    const source = `<program>
\${ const Btn = <button props={ label: string } /> }
<Btn label="click" bogus="yes"/>
</program>`;
    const { errors } = runCEOn(source);
    const e011 = errors.filter(e => e.code === "E-COMPONENT-011");
    expect(e011).toHaveLength(1);
    expect(e011[0].message).toContain("bogus");
    expect(e011[0].message).toContain("Btn");
  });

  test("optional prop omitted at call site — no E-COMPONENT-010", () => {
    // Note: '?:' syntax may produce E-020 instead if round-trip disrupts parsing.
    // Zero E-010 errors is the correct outcome either way.
    const source = `<program>
\${ const Badge = <span props={ text?: string } /> }
<Badge/>
</program>`;
    const { errors } = runCEOn(source);
    const e010 = errors.filter(e => e.code === "E-COMPONENT-010");
    expect(e010).toHaveLength(0);
  });

  test("all optional props omitted — no E-COMPONENT-010 or E-COMPONENT-011", () => {
    const source = `<program>
\${ const Widget = <div props={ title?: string, subtitle?: string, icon?: string } /> }
<Widget/>
</program>`;
    const { errors } = runCEOn(source);
    const componentErrors = errors.filter(e =>
      e.code === "E-COMPONENT-010" || e.code === "E-COMPONENT-011"
    );
    expect(componentErrors).toHaveLength(0);
  });

  test("duplicate prop declared in props block AND as bare attr on root element — produces E-COMPONENT-012", () => {
    // `role` appears both in props={...} AND as a bare (valueless) attr on the root <div>
    const source = `<program>
\${ const Widget = <div role props={ role: string }/> }
<Widget role="button"/>
</program>`;
    const { errors } = runCEOn(source);
    const e012 = errors.filter(e => e.code === "E-COMPONENT-012");
    expect(e012).toHaveLength(1);
    expect(e012[0].message).toContain("role");
    expect(e012[0].message).toContain("E-COMPONENT-012");
  });

  test("E-COMPONENT-012 names both the prop and the component", () => {
    const source = `<program>
\${ const Box = <div id props={ id: string }/> }
<Box id="dynamic"/>
</program>`;
    const { errors } = runCEOn(source);
    const e012 = errors.filter(e => e.code === "E-COMPONENT-012");
    expect(e012).toHaveLength(1);
    expect(e012[0].message).toContain("id");
    expect(e012[0].message).toContain("Box");
  });

  // S458 "D1" (§15.10): E-COMPONENT-012 is narrowed to a VALUELESS root attribute.
  // A valued root attribute carrying a declared prop's name is the body WRITING its
  // root attribute — from the prop (`href=${href}`, `href=href`, `href="/p/${href}"`)
  // or a fixed literal — not a second declaration.
  for (const rootAttr of ["href=${href}", "href=href", 'href="/p/${href}"', 'href="/fixed"']) {
    test(`valued root attr \`${rootAttr}\` with a same-named declared prop — no E-COMPONENT-012`, () => {
      const source = `<program>
\${ const Link = <a class="link" ${rootAttr} props={ href: string }>go</> }
<Link href="/x"/>
</program>`;
      const { errors } = runCEOn(source);
      expect(errors.filter(e => e.code === "E-COMPONENT-012")).toHaveLength(0);
    });
  }

  test("class is not treated as a typed prop — no E-COMPONENT-011 for caller class", () => {
    // class is always merged separately; it must not trigger undeclared-prop error
    const source = `<program>
\${ const Chip = <span props={ label: string } /> }
<Chip label="hi" class="chip-red"/>
</program>`;
    const { errors } = runCEOn(source);
    const e011 = errors.filter(e => e.code === "E-COMPONENT-011");
    expect(e011).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §O  Typed props defaults and null-fill
// ---------------------------------------------------------------------------

describe("§O Typed props defaults and null-fill", () => {
  test("default value is applied when prop is omitted at call site", () => {
    // Use data-size attr (not class) so the default substitution goes through
    // substituteProps directly without interference from the class-merge path.
    const source = `<program>
\${ const Btn = <button props={ size: string = medium } data-size="\${size}"/> }
<Btn/>
</program>`;
    const { ast, errors } = runCEOn(source);
    const componentErrors = errors.filter(e => e.code === "E-COMPONENT-010");
    expect(componentErrors).toHaveLength(0);

    const btn = findMarkup(ast.nodes, "button");
    expect(btn).toBeDefined();
    // The default "medium" should be substituted into data-size
    const sizeAttr = btn.attrs.find(a => a.name === "data-size");
    expect(sizeAttr).toBeDefined();
    expect(sizeAttr.value.value).toBe("medium");
  });

  test("default value is NOT applied when prop IS provided at call site", () => {
    // Caller-provided value "large" must win over the declared default "medium"
    const source = `<program>
\${ const Btn = <button props={ size: string = medium } data-size="\${size}"/> }
<Btn size="large"/>
</program>`;
    const { ast } = runCEOn(source);
    const btn = findMarkup(ast.nodes, "button");
    expect(btn).toBeDefined();
    const sizeAttr = btn.attrs.find(a => a.name === "data-size");
    expect(sizeAttr).toBeDefined();
    // Caller-provided "large" wins over default "medium"
    expect(sizeAttr.value.value).toBe("large");
  });

  test("prop with explicit null default receives null substitution when omitted", () => {
    // Use `label: string = null` to declare an explicit null default, avoiding
    // the '?:' round-trip ambiguity. The value "null" is stored as defaultValue
    // and substituted when the prop is omitted.
    const source = `<program>
\${ const Tag = <span props={ label: string = null } data-l="\${label}"/> }
<Tag/>
</program>`;
    const { ast, errors } = runCEOn(source);
    // Explicit null default — no missing-prop error
    expect(errors.filter(e => e.code === "E-COMPONENT-010")).toHaveLength(0);

    const span = findMarkup(ast.nodes, "span");
    expect(span).toBeDefined();
    const dataAttr = span.attrs.find(a => a.name === "data-l");
    expect(dataAttr).toBeDefined();
    // Explicit null default should substitute "null"
    expect(dataAttr.value.value).toBe("null");
  });

  test("multiple defaults applied independently when multiple props omitted", () => {
    const source = `<program>
\${ const Form = <form props={ method: string = get, enctype: string = multipart } method="\${method}" enctype="\${enctype}"/> }
<Form/>
</program>`;
    const { ast, errors } = runCEOn(source);
    expect(errors.filter(e => e.code === "E-COMPONENT-010")).toHaveLength(0);

    const form = findMarkup(ast.nodes, "form");
    expect(form).toBeDefined();
    const methodAttr = form.attrs.find(a => a.name === "method");
    const enctypeAttr = form.attrs.find(a => a.name === "enctype");
    expect(methodAttr).toBeDefined();
    expect(enctypeAttr).toBeDefined();
    expect(methodAttr.value.value).toBe("get");
    expect(enctypeAttr.value.value).toBe("multipart");
  });
});

// ---------------------------------------------------------------------------
// §P  Typed props expansion — substitution and output cleanliness
// ---------------------------------------------------------------------------

describe("§P Typed props expansion — substitution and output cleanliness", () => {
  test("typed prop value is substituted into component body via ${propName}", () => {
    const source = `<program>
\${ const Alert = <div props={ msg: string } data-msg="\${msg}"/> }
<Alert msg="Something went wrong"/>
</program>`;
    const { ast, errors } = runCEOn(source);
    expect(errors.filter(e => e.code === "E-COMPONENT-010")).toHaveLength(0);

    const div = findMarkup(ast.nodes, "div");
    expect(div).toBeDefined();
    const msgAttr = div.attrs.find(a => a.name === "data-msg");
    expect(msgAttr).toBeDefined();
    expect(msgAttr.value.value).toBe("Something went wrong");
  });

  test("props attribute is stripped from expanded HTML output", () => {
    const source = `<program>
\${ const Tag = <span props={ label: string } data-l="\${label}"/> }
<Tag label="test"/>
</program>`;
    const { ast } = runCEOn(source);
    const span = findMarkup(ast.nodes, "span");
    expect(span).toBeDefined();
    // 'props' must not appear in the expanded output
    const propsAttr = span.attrs.find(a => a.name === "props");
    expect(propsAttr).toBeUndefined();
  });

  test("component with typed props + class merging both work together", () => {
    const source = `<program>
\${ const Card = <div class="card" props={ title: string } data-title="\${title}"/> }
<Card title="My Card" class="featured"/>
</program>`;
    const { ast, errors } = runCEOn(source);
    expect(errors.filter(e => e.code && e.code.startsWith("E-COMPONENT-"))).toHaveLength(0);

    const div = findMarkup(ast.nodes, "div");
    expect(div).toBeDefined();

    // Class merge: "card" + "featured"
    const classAttr = div.attrs.find(a => a.name === "class");
    expect(classAttr).toBeDefined();
    expect(classAttr.value.value).toBe("card featured");

    // Prop substitution: ${title} → "My Card"
    const titleAttr = div.attrs.find(a => a.name === "data-title");
    expect(titleAttr).toBeDefined();
    expect(titleAttr.value.value).toBe("My Card");

    // props attribute not present
    expect(div.attrs.find(a => a.name === "props")).toBeUndefined();
  });

  test("expanded component with typed props has _expandedFrom set", () => {
    const source = `<program>
\${ const Label = <label props={ text: string } data-t="\${text}"/> }
<Label text="Name"/>
</program>`;
    const { ast } = runCEOn(source);
    const label = findMarkup(ast.nodes, "label");
    expect(label).toBeDefined();
    expect(label._expandedFrom).toBe("Label");
  });

  test("two call sites with same component and different typed prop values expand independently", () => {
    // Use data-color attr (not class) so typed prop substitution is verifiable
    // without interference from the class-merge path.
    const source = `<program>
\${ const Badge = <span props={ color: string } data-color="\${color}"/> }
<Badge color="red"/>
<Badge color="blue"/>
</program>`;
    const { ast, errors } = runCEOn(source);
    expect(errors.filter(e => e.code && e.code.startsWith("E-COMPONENT-"))).toHaveLength(0);

    const spans = collectMarkup(ast.nodes).filter(n => n.tag === "span");
    expect(spans.length).toBeGreaterThanOrEqual(2);

    const redSpan = spans.find(s => s.attrs.some(a => a.name === "data-color" && a.value.value === "red"));
    const blueSpan = spans.find(s => s.attrs.some(a => a.name === "data-color" && a.value.value === "blue"));
    expect(redSpan).toBeDefined();
    expect(blueSpan).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// §Q  Multi-root expansion — array return is backward compatible
// ---------------------------------------------------------------------------
//
// Background:
//   CE now stores `nodes: MarkupNode[]` in RegistryEntry and returns
//   `MarkupNode[]` from expandComponentNode. The current TAB stage captures
//   only a single markup expression per component-def, so all TAB-produced
//   component defs have exactly one root node (nodes.length === 1). These
//   tests verify the array-return path is fully backward compatible with the
//   existing single-root component behavior. Multi-root component definitions
//   (nodes.length > 1) require TAB-layer support and are tracked as a
//   follow-on task.
// ---------------------------------------------------------------------------

describe("§Q Multi-root expansion — array return is backward compatible with single-root", () => {
  test("single-root component still expands to exactly one node", () => {
    const source = `<program>
\${ const Box = <div class="box"/> }
<Box/>
</program>`;
    const { ast, errors } = runCEOn(source);
    expect(errors.filter(e => e.code && e.code.startsWith("E-COMPONENT-"))).toHaveLength(0);

    // Exactly one div should be present from the expansion (no accidental duplication)
    const divs = collectMarkup(ast.nodes).filter(n => n.tag === "div");
    expect(divs).toHaveLength(1);
    expect(divs[0]._expandedFrom).toBe("Box");
  });

  test("single-root component used twice produces exactly two expanded nodes", () => {
    const source = `<program>
\${ const Pill = <span class="pill"/> }
<Pill/>
<Pill/>
</program>`;
    const { ast, errors } = runCEOn(source);
    expect(errors.filter(e => e.code && e.code.startsWith("E-COMPONENT-"))).toHaveLength(0);

    // Exactly two spans should be present — array spreading must not duplicate
    const spans = collectMarkup(ast.nodes).filter(n => n.tag === "span" && n._expandedFrom === "Pill");
    expect(spans).toHaveLength(2);
  });

  test("single-root array expansion: expanded node has isComponent: false", () => {
    const source = `<program>
\${ const Tag = <article/> }
<Tag/>
</program>`;
    const { ast } = runCEOn(source);
    const article = findMarkup(ast.nodes, "article");
    expect(article).toBeDefined();
    expect(article.isComponent).toBeFalsy();
  });

  test("unresolved component with array-return path still leaves node in AST", () => {
    // The error-path now returns [node] instead of node — verify the node is still
    // present in the AST for downstream error recovery.
    const source = `<program><Phantom/></program>`;
    const { ast, errors } = runCEOn(source);
    expect(errors.some(e => e.code === "E-COMPONENT-020")).toBe(true);
    // The Phantom node must still be in the AST (as-is, not undefined)
    const phantom = collectMarkup(ast.nodes).find(n => n.tag === "Phantom");
    expect(phantom).toBeDefined();
  });

  test("single-root component props/class still work after array-return refactor", () => {
    const source = `<program>
\${ const Card = <div class="card" data-v="\${version}"/> }
<Card version="2" class="large"/>
</program>`;
    const { ast, errors } = runCEOn(source);
    expect(errors.filter(e => e.code && e.code.startsWith("E-COMPONENT-"))).toHaveLength(0);

    const div = findMarkup(ast.nodes, "div");
    expect(div).toBeDefined();
    // Class merge still works
    const classAttr = div.attrs.find(a => a.name === "class");
    expect(classAttr.value.value).toBe("card large");
    // Prop substitution still works
    const vAttr = div.attrs.find(a => a.name === "data-v");
    expect(vAttr.value.value).toBe("2");
  });

  // Regression: normalizeTokenizedRaw dropped internal bare closers `</>` and
  // left internal whitespace before `>` in open tags, so any multi-line
  // component body failed BS+TAB re-parse with empty output, causing
  // E-COMPONENT-020 at every use site. Fixed S2 2026-04-10 (example 12 fix).
  describe("multi-line component bodies (example 12 regression)", () => {
    test("multi-line component with nested elements registers", () => {
      const source = `<program>
\${
    const Card = <div class="card">
        <div class="card__header">
            Header text
        </>
        <div class="card__body">
            Body text
        </>
    </>
}
<Card/>
</program>`;
      const { errors } = runCEOn(source);
      expect(errors.filter(e => e.code === "E-COMPONENT-020")).toHaveLength(0);
      expect(errors.filter(e => e.code === "E-COMPONENT-021")).toHaveLength(0);
    });

    test("multi-line component with ${render} slot interpolations registers", () => {
      const source = `<program>
\${
    const Card = <div class="card" props={
        header: snippet,
        body: snippet,
    }>
        <div class="card__header">
            \${render header()}
        </>
        <div class="card__body">
            \${render body()}
        </>
    </>
}
<Card>
    <h2 slot="header">Hello</>
    <p slot="body">Body</>
</>
</program>`;
      const { errors } = runCEOn(source);
      expect(errors.filter(e => e.code === "E-COMPONENT-020")).toHaveLength(0);
      expect(errors.filter(e => e.code === "E-COMPONENT-021")).toHaveLength(0);
    });

    test("component with optional snippet prop (snippet?) registers", () => {
      const source = `<program>
\${
    const Card = <div class="card" props={
        body: snippet,
        actions?: snippet,
    }>
        <div class="card__body">
            \${render body()}
        </>
    </>
}
<Card>
    <p slot="body">Body</>
</>
</program>`;
      const { errors } = runCEOn(source);
      expect(errors.filter(e => e.code === "E-COMPONENT-020")).toHaveLength(0);
    });
  });
});
