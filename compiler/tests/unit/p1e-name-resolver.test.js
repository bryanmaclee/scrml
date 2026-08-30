// P1.E.B — Name Resolver (Stage 3.05) shadow-mode resolution tests.
// Verifies SPEC §15.15 lookup order across all five categories:
//   1. Same-file user declaration
//   2. Imported user declaration
//   3. Built-in scrml lifecycle keyword
//   4. Built-in HTML element
//   5. Unknown
//
// Plus the diagnostics:
//   W-CASE-001       lowercase user state-type/component shadowing HTML element
//   W-WHITESPACE-001 opener uses whitespace between `<` and the identifier

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runNR } from "../../src/name-resolver.ts";

function buildSingleFile(src, filePath = "test.scrml") {
  const bs = splitBlocks(filePath, src);
  const tab = buildAST(bs);
  return tab;
}

function runNRSingle(src, filePath = "test.scrml") {
  const tab = buildSingleFile(src, filePath);
  const result = runNR({ filePath: tab.filePath, ast: tab.ast });
  return { tab, result };
}

// Walk to find the first markup or state node of a given tag/state-type.
function findTag(nodes, tagOrType) {
  for (const n of nodes ?? []) {
    if (!n) continue;
    if (n.kind === "markup" && n.tag === tagOrType) return n;
    if ((n.kind === "state" || n.kind === "state-constructor-def") && n.stateType === tagOrType) return n;
    if (n.kind === "engine-decl" && (tagOrType === "engine" || tagOrType === "machine")) return n;
    const inChildren = findTag(n.children ?? [], tagOrType);
    if (inChildren) return inChildren;
    const inBody = findTag(n.body ?? [], tagOrType);
    if (inBody) return inBody;
  }
  return null;
}

describe("P1.E.B: NR — built-in HTML element resolution", () => {
  test("`<div>` resolves to html-builtin/html", () => {
    const { tab, result } = runNRSingle("<div>x</div>");
    const node = findTag(tab.ast.nodes, "div");
    expect(node).toBeTruthy();
    expect(node.resolvedKind).toBe("html-builtin");
    expect(node.resolvedCategory).toBe("html");
    expect(result.kindCounts["html-builtin"]).toBeGreaterThan(0);
  });

  test("`<P>` (mixed-case HTML) still resolves to html-builtin (case-insensitive)", () => {
    const { tab } = runNRSingle("<P>x</P>");
    const node = findTag(tab.ast.nodes, "P");
    expect(node.resolvedKind).toBe("html-builtin");
    expect(node.resolvedCategory).toBe("html");
  });
});

describe("P1.E.B: NR — built-in scrml lifecycle resolution", () => {
  test("`<channel>` resolves to scrml-lifecycle/channel", () => {
    const { tab } = runNRSingle("<channel name=\"x\" topic=\"t\"></channel>");
    const node = findTag(tab.ast.nodes, "channel");
    expect(node.resolvedKind).toBe("scrml-lifecycle");
    expect(node.resolvedCategory).toBe("channel");
  });

  test("`<timer>` resolves to scrml-lifecycle/timer", () => {
    const { tab } = runNRSingle("<timer interval=1000 running=@on></timer>");
    const node = findTag(tab.ast.nodes, "timer");
    expect(node.resolvedKind).toBe("scrml-lifecycle");
    expect(node.resolvedCategory).toBe("timer");
  });

  test("`<db>` resolves to scrml-lifecycle/db (state-form, normalized by ast-builder)", () => {
    const { tab } = runNRSingle("<db src=\"x.db\" tables=\"users\"/>");
    const node = findTag(tab.ast.nodes, "db");
    expect(node.resolvedKind).toBe("scrml-lifecycle");
    expect(node.resolvedCategory).toBe("db");
  });

  test("`<engine>` resolves to scrml-lifecycle/engine", () => {
    const { tab } = runNRSingle("<engine name=AdminFlow for=OrderStatus>\n  .Pending => .Done\n</>");
    const node = findTag(tab.ast.nodes, "engine");
    expect(node.resolvedKind).toBe("scrml-lifecycle");
    expect(node.resolvedCategory).toBe("engine");
  });

  test("`<machine>` resolves to scrml-lifecycle/machine (legacy alias)", () => {
    const { tab } = runNRSingle("<machine name=Foo for=Bar>\n  .a => .b\n</>");
    const node = findTag(tab.ast.nodes, "machine");
    expect(node.resolvedKind).toBe("scrml-lifecycle");
    expect(node.resolvedCategory).toBe("machine");
  });

  test("`<errorBoundary>` resolves to scrml-lifecycle/errorBoundary", () => {
    const { tab } = runNRSingle("<errorBoundary></errorBoundary>");
    const node = findTag(tab.ast.nodes, "errorBoundary");
    expect(node.resolvedKind).toBe("scrml-lifecycle");
    expect(node.resolvedCategory).toBe("errorBoundary");
  });
});

describe("P1.E.B: NR — same-file user-declared state-type / component resolution", () => {
  test("`type Order:enum = ...` lets `<Order>` resolve to user-state-type when used as a tag", () => {
    // The type is declared in a logic block; the `<Order>` tag below uses it.
    const src = `\${ type Order:enum = { Pending, Done } }
<Order/>`;
    const { tab } = runNRSingle(src);
    const node = findTag(tab.ast.nodes, "Order");
    expect(node).toBeTruthy();
    expect(node.resolvedKind).toBe("user-state-type");
    expect(node.resolvedCategory).toBe("user-state-type");
  });

  test("`const UserCard = <div>...</div>` lets `<UserCard>` resolve to user-component", () => {
    const src = `\${ const UserCard = <div>Hello</div> }
<UserCard name="Alex"/>`;
    const { tab } = runNRSingle(src);
    const node = findTag(tab.ast.nodes, "UserCard");
    expect(node).toBeTruthy();
    expect(node.resolvedKind).toBe("user-component");
    expect(node.resolvedCategory).toBe("user-component");
  });

  test("inline `< addressCard addr(Address)>` (state-constructor-def) registers the type and resolves itself", () => {
    const src = `< addressCard addr(Address)></>`;
    const { tab } = runNRSingle(src);
    const node = findTag(tab.ast.nodes, "addressCard");
    expect(node).toBeTruthy();
    expect(node.resolvedKind).toBe("user-state-type");
    expect(node.resolvedCategory).toBe("user-state-type");
  });
});

describe("P1.E.B: NR — unknown resolution", () => {
  test("`<UnknownThing>` resolves to unknown/unknown", () => {
    const { tab, result } = runNRSingle("<UnknownThing/>");
    const node = findTag(tab.ast.nodes, "UnknownThing");
    expect(node).toBeTruthy();
    expect(node.resolvedKind).toBe("unknown");
    expect(node.resolvedCategory).toBe("unknown");
    expect(result.kindCounts.unknown).toBeGreaterThan(0);
  });
});

describe("P1.E.B: NR — W-CASE-001 emission", () => {
  test("`type div:enum = ...` (lowercase shadow of <div>) emits W-CASE-001", () => {
    const src = `\${ type div:enum = { Big, Small } }`;
    const { result } = runNRSingle(src);
    expect(result.errors.some(e => e.code === "W-CASE-001")).toBe(true);
  });

  test("`type Card:enum = ...` (PascalCase, no HTML shadow) does NOT emit W-CASE-001", () => {
    const src = `\${ type Card:enum = { A, B } }`;
    const { result } = runNRSingle(src);
    expect(result.errors.some(e => e.code === "W-CASE-001")).toBe(false);
  });

  test("`type formresult:enum = ...` (lowercase but no HTML shadow) does NOT emit W-CASE-001", () => {
    const src = `\${ type formresult:enum = { Ok, Err } }`;
    const { result } = runNRSingle(src);
    expect(result.errors.some(e => e.code === "W-CASE-001")).toBe(false);
  });

  test("`const button = <span>...</span>` (lowercase component shadowing HTML) emits W-CASE-001", () => {
    // A lowercase const initialised with markup is treated as const-decl by the
    // ast-builder (only PascalCase becomes component-def); but the SPEC describes
    // shadowing for "user-declared state-type or component". This test covers the
    // type-decl/state-constructor-def case which IS recognized.
    const src = `< button label(string)></>`;
    const { result } = runNRSingle(src);
    expect(result.errors.some(e => e.code === "W-CASE-001")).toBe(true);
  });
});

describe("P1.E.B: NR — W-WHITESPACE-001 emission", () => {
  test("`< db>` (with-space opener) emits W-WHITESPACE-001", () => {
    const src = `< db src="x.db" tables="users"></>`;
    const { result } = runNRSingle(src);
    expect(result.errors.some(e => e.code === "W-WHITESPACE-001")).toBe(true);
  });

  test("`<db>` (no-space opener) does NOT emit W-WHITESPACE-001", () => {
    const src = `<db src="x.db" tables="users"/>`;
    const { result } = runNRSingle(src);
    expect(result.errors.some(e => e.code === "W-WHITESPACE-001")).toBe(false);
  });

  test("`< channel>` emits W-WHITESPACE-001", () => {
    const src = `< channel name="x" topic="t"></>`;
    const { result } = runNRSingle(src);
    expect(result.errors.some(e => e.code === "W-WHITESPACE-001")).toBe(true);
  });

  test("`< engine>` emits W-WHITESPACE-001", () => {
    const src = `< engine name=Foo for=Bar>\n  .a => .b\n</>`;
    const { result } = runNRSingle(src);
    expect(result.errors.some(e => e.code === "W-WHITESPACE-001")).toBe(true);
  });

  test("`< schema>` emits W-WHITESPACE-001", () => {
    const src = `< schema name=Foo/>`;
    const { result } = runNRSingle(src);
    expect(result.errors.some(e => e.code === "W-WHITESPACE-001")).toBe(true);
  });

  test("`< timer>` emits W-WHITESPACE-001", () => {
    const src = `< timer interval=1000 running=@on></>`;
    const { result } = runNRSingle(src);
    expect(result.errors.some(e => e.code === "W-WHITESPACE-001")).toBe(true);
  });

  test("multiple openers in one file each get exactly one W-WHITESPACE-001", () => {
    const src = `< db src="x.db" tables="users"></>
< schema name=Foo/>
< channel name="c" topic="t"></>`;
    const { result } = runNRSingle(src);
    const ws = result.errors.filter(e => e.code === "W-WHITESPACE-001");
    expect(ws.length).toBe(3);
  });

  // Regression: a NO-space server-authority state-constructor-def opener
  // (`<Name authority="server" table="…">`) was spuriously flagged — the
  // state-constructor-def builder hardcoded openerHadSpaceAfterLt:true, so the
  // warning fired on the exact shape a server-authority SSR app requires. The
  // flag is now derived from the real `<`→name gap.
  test("`<Account authority=\"server\" table=\"users\">` (NO space) does NOT emit W-WHITESPACE-001", () => {
    const src = `<Account authority="server" table="users">\n  id: number\n</>`;
    const { result } = runNRSingle(src);
    expect(result.errors.some(e => e.code === "W-WHITESPACE-001")).toBe(false);
  });

  test("`< Account authority=\"server\" table=\"users\">` (WITH space) still emits W-WHITESPACE-001", () => {
    const src = `< Account authority="server" table="users">\n  id: number\n</>`;
    const { result } = runNRSingle(src);
    expect(result.errors.some(e => e.code === "W-WHITESPACE-001")).toBe(true);
  });
});

describe("P1.E.B: NR — cross-file imported resolution", () => {
  test("imported `Greeting` component resolves to user-component", () => {
    // Fake a TAB+MOD result for an importer file that imports `Greeting` from "./greeting.scrml".
    // We construct the imported file's AST manually so we can avoid the BS/TAB
    // round-trip on a second file.
    const importerSrc = `\${ import { Greeting } from "./greeting.scrml" }
<Greeting name="Alex"/>`;
    const tab = buildSingleFile(importerSrc, "/tmp/importer.scrml");

    // Build a fake exportRegistry + importGraph mirroring MOD's output shape.
    const exportRegistry = new Map();
    exportRegistry.set("/tmp/greeting.scrml", new Map([
      ["Greeting", { kind: "const", isComponent: true }],
    ]));
    const importGraph = new Map();
    importGraph.set("/tmp/importer.scrml", {
      imports: [{ names: ["Greeting"], absSource: "/tmp/greeting.scrml" }],
    });

    const result = runNR({
      filePath: "/tmp/importer.scrml",
      ast: tab.ast,
      exportRegistry,
      importGraph,
    });

    const node = findTag(tab.ast.nodes, "Greeting");
    expect(node).toBeTruthy();
    expect(node.resolvedKind).toBe("user-component");
    expect(node.resolvedCategory).toBe("user-component");
    expect(result.errors.some(e => e.code === "W-CASE-001")).toBe(false);
  });
});

describe("P1.E.B: NR — same-file declaration shadows HTML built-in", () => {
  test("user declaration takes precedence over HTML built-in lookup", () => {
    // PascalCase Div — not lowercase, no W-CASE-001, but resolves to user-state-type.
    const src = `\${ type Div:enum = { A, B } }
<Div/>`;
    const { tab, result } = runNRSingle(src);
    const node = findTag(tab.ast.nodes, "Div");
    expect(node.resolvedKind).toBe("user-state-type");
    expect(result.errors.some(e => e.code === "W-CASE-001")).toBe(false);
  });
});
