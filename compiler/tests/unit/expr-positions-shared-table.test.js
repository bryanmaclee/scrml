/**
 * expr-positions.ts — the SHARED position table both `dependency-graph.ts` and
 * `codegen/client-read-seed.ts` consume.
 *
 * WHAT THESE TESTS ARE FOR. The convergence's whole claim is "two passes, one
 * enumeration". Two properties carry that claim and neither is visible from
 * either consumer's own tests:
 *
 *   §1 ALTERNATE-GROUP RESOLUTION — where the same source is available in several
 *      representations, a consumer must get exactly ONE of them or it
 *      double-counts, and the one it gets must be the one it can actually read.
 *      The `@`-sigil consumer wants the pre-extracted `refs` list; the identifier
 *      consumer, which does not support that kind at all, must fall through to a
 *      representation it CAN parse rather than getting nothing.
 *
 *   §2 THE POSITIONS THEMSELVES — a table is only a convergence if the positions
 *      are IN it. These assert the shapes that were missing when the hand-rolled
 *      walker was retired, at the level where the enumeration happens, so a
 *      regression is attributable here rather than three stages downstream.
 *
 * The end-to-end behaviour is pinned by
 * `compiler/tests/conformance/conf-CG-263-seed-position-convergence.test.js`.
 */

import { describe, test, expect } from "bun:test";
import {
  forEachExprPosition,
  EXPR_NODE_FIELDS,
} from "../../src/expr-positions.ts";

/** Every kind — what `dependency-graph.ts` supports. */
const ALL = new Set([
  "expr-node", "expr-source", "block-source", "template-text",
  "literal-text", "cell-name", "cell-name-list", "callee-name",
]);
/** The confidentiality consumer's strict subset — see client-read-seed.ts. */
const IDENT_ONLY = new Set([
  "expr-node", "expr-source", "block-source", "template-text", "callee-name",
]);

function positions(node, supports) {
  const out = [];
  forEachExprPosition(node, supports, (p) => out.push(p));
  return out;
}
const originsOf = (ps) => ps.map((p) => p.origin);
const kindsOf = (ps) => ps.map((p) => p.kind);

describe("expr-positions §1 — alternate groups resolve per consumer, exactly once", () => {
  // `if=(@a && @b)` arrives as {kind:"expr", raw, refs, exprNode}. All three
  // describe the SAME source.
  const exprAttrNode = {
    kind: "markup",
    span: { file: "f", start: 0, end: 1, line: 1, col: 1 },
    attrs: [{
      name: "if",
      value: {
        kind: "expr",
        raw: "(@a && LIMIT)",
        refs: ["a"],
        exprNode: { kind: "ident", name: "@a" },
      },
    }],
  };

  test("the @-sigil consumer takes the pre-extracted refs list and NOTHING else from the group", () => {
    const ps = positions(exprAttrNode, ALL);
    expect(kindsOf(ps)).toEqual(["cell-name-list"]);
    expect(ps[0].value).toEqual(["a"]);
  });

  test("the identifier consumer, which cannot read a refs list, falls through to the PARSE", () => {
    const ps = positions(exprAttrNode, IDENT_ONLY);
    expect(kindsOf(ps)).toEqual(["expr-node"]);
    expect(ps[0].origin).toBe("attr.value.exprNode");
  });

  test("with no parse available it falls further, to the raw source — never to nothing", () => {
    const noParse = structuredClone(exprAttrNode);
    delete noParse.attrs[0].value.exprNode;
    const ps = positions(noParse, IDENT_ONLY);
    expect(kindsOf(ps)).toEqual(["expr-source"]);
    expect(ps[0].value).toBe("(@a && LIMIT)");
  });

  test("a `@`-prefixed variable-ref yields a BARE cell name — no consumer re-derives the sigil", () => {
    const node = {
      kind: "markup",
      attrs: [{ name: "bind:value", value: { kind: "variable-ref", name: "@country" } }],
    };
    const ps = positions(node, ALL);
    expect(kindsOf(ps)).toEqual(["cell-name"]);
    expect(ps[0].value).toBe("country");
  });

  test("a NON-`@` variable-ref yields no cell-name at all (it does not name a cell)", () => {
    const node = {
      kind: "markup",
      attrs: [{ name: "onclick", value: { kind: "variable-ref", name: "handler" } }],
    };
    expect(kindsOf(positions(node, ALL))).not.toContain("cell-name");
    // The identifier consumer still sees it, as source it can parse.
    expect(kindsOf(positions(node, IDENT_ONLY))).toEqual(["expr-source"]);
  });
});

describe("expr-positions §2 — the positions the retired walker was missing", () => {
  test("a call-ref's CALLEE is a position, dotted base included", () => {
    const node = {
      kind: "markup",
      attrs: [{
        name: "onclick",
        value: { kind: "call-ref", name: "utils.handleClick", args: ["id"], argExprNodes: [{ kind: "ident", name: "id" }] },
      }],
    };
    const ps = positions(node, ALL);
    const callee = ps.find((p) => p.kind === "callee-name");
    expect(callee).toBeDefined();
    // The FULL dotted name is carried — the dependency graph keys its
    // transitive-read lookup on it; the identifier consumer takes the base.
    expect(callee.value).toBe("utils.handleClick");
  });

  test("call-ref ARGS are enumerated from the raw strings even when argExprNodes is gone", () => {
    // One empty argument makes `safeParseExprToNodeGlobal` return undefined,
    // which drops `argExprNodes` for the WHOLE call — every other argument
    // included. The raw strings are then the only representation there is.
    const node = {
      kind: "markup",
      attrs: [{
        name: "onclick",
        value: { kind: "call-ref", name: "handle", args: ["NEEDED", "", "2"], argExprNodes: undefined },
      }],
    };
    const ps = positions(node, IDENT_ONLY);
    const argSources = ps.filter((p) => p.origin === "attr.value.args[]").map((p) => p.value);
    expect(argSources).toEqual(["NEEDED", "2"]);
  });

  test("`<match>` armsRaw and `<each>` bodyRaw are block-source positions", () => {
    expect(originsOf(positions({ kind: "match-block", onExprRaw: "@phase", armsRaw: "<Idle>x</>" }, ALL)))
      .toEqual(["onExprRaw", "match.armsRaw"]);
    expect(originsOf(positions({ kind: "each-block", inExprRaw: "@rows", bodyRaw: "<li>${@x}</li>" }, ALL)))
      .toEqual(["inExprRaw", "each.bodyRaw"]);
  });

  test("engine state-child bodies and transition guards come off `_record` — an OBJECT", () => {
    // This is the shape a child recursion that descends only ARRAY-valued fields
    // can never reach, and that is exactly how it stayed invisible.
    const node = {
      kind: "engine-decl",
      rulesRaw: "<Title rule=.Playing : @hits = NEEDED>",
      _record: {
        engineMeta: {
          varName: "game",
          stateChildren: [{
            tag: "Title",
            bodyRaw: "@hits = NEEDED",
            onTransitionElements: [{ bodyRaw: "@n = 1", ifExprRaw: "${(GUARD == 1)}" }],
            onTimeoutElements: [{ after: "${@delay}ms" }],
          }],
          idleWatchdog: { after: "${@idle}s" },
        },
      },
    };
    const ps = positions(node, ALL);
    expect(originsOf(ps)).toEqual([
      "engine.stateChild.bodyRaw",
      "engine.stateChild.onTransition.bodyRaw",
      "engine.stateChild.onTransition.ifExprRaw",
      "engine.stateChild.onTimeout.after",
      "engine.idleWatchdog.after",
    ]);
    // The guard is UNWRAPPED from its `${…}` capture so it parses as an expression.
    expect(ps.find((p) => p.origin.endsWith("ifExprRaw")).value).toBe("(GUARD == 1)");
  });

  test("`rulesRaw` is a FALLBACK only — never scanned alongside the parsed state-children", () => {
    // Scanning both would double-visit every state-child body.
    const withParse = positions({
      kind: "engine-decl",
      rulesRaw: "<Title rule=.Playing : @hits = 1>",
      _record: { engineMeta: { stateChildren: [{ tag: "Title", bodyRaw: "@hits = 1" }] } },
    }, ALL);
    expect(originsOf(withParse)).toEqual(["engine.stateChild.bodyRaw"]);

    const withoutParse = positions({
      kind: "engine-decl",
      rulesRaw: "<Title rule=.Playing : @hits = 1>",
      _record: { engineMeta: { stateChildren: [] } },
    }, ALL);
    expect(originsOf(withoutParse)).toEqual(["engine.rulesRaw"]);
  });

  test("`derived=` offers the parsed node and the raw text as alternates", () => {
    const node = {
      kind: "engine-decl",
      derivedExprText: "(NEEDED == 1 ? .X : .Y)",
      derivedExprNode: { kind: "ident", name: "NEEDED" },
      _record: { engineMeta: {} },
    };
    const ps = positions(node, ALL);
    expect(ps).toHaveLength(1);
    expect(ps[0].origin).toBe("engine.derivedExprNode");
    // Strip the parse and the raw text carries the position instead.
    delete node.derivedExprNode;
    expect(originsOf(positions(node, ALL))).toEqual(["engine.derivedExprText"]);
  });

  test("the structural `if=` gate anchors at the NODE span, not at `ifCond.span`", () => {
    // The structural caller synthesizes an attr with no span of its own, so this
    // position has always anchored at the node — and a dependency-graph node id is
    // derived from that span, so moving the anchor would move the graph.
    const nodeSpan = { file: "f", start: 10, end: 20, line: 1, col: 1 };
    const node = {
      kind: "each-block",
      span: nodeSpan,
      ifCond: { kind: "expr", raw: "@ready", refs: ["ready"], span: { file: "f", start: 99, end: 100, line: 9, col: 9 } },
    };
    const ps = positions(node, ALL);
    expect(ps).toHaveLength(1);
    expect(ps[0].span).toBe(nodeSpan);
  });
});

describe("expr-positions §3 — the shared ExprNode field list", () => {
  test("carries the UNION of what the two passes used to look at, independently", () => {
    // The dependency graph had six; the client-read walker had eleven. Nothing
    // type-checked one against the other, so neither knew it was short.
    for (const f of ["exprNode", "initExpr", "condExpr", "valueExpr", "iterExpr", "headerExpr"]) {
      expect(EXPR_NODE_FIELDS).toContain(f);
    }
    for (const f of ["testExpr", "defaultExpr", "subjectExpr", "targetExpr", "returnExpr"]) {
      expect(EXPR_NODE_FIELDS).toContain(f);
    }
  });

  test("is NOT enumerated by forEachExprPosition — the consumers iterate the list themselves", () => {
    // Deliberate: each consumer needs its own per-field traversal (a lambda
    // descent for reader-credit, an identifier bag for the seed). Sharing the
    // LIST closes the drift; sharing the traversal would not be sharing at all.
    const node = { kind: "bare-expr", exprNode: { kind: "ident", name: "@x" } };
    expect(positions(node, ALL)).toEqual([]);
  });
});

describe("expr-positions §4 — literal attribute text is not code", () => {
  test("a plain-string attribute value is `literal-text`, and the identifier consumer never sees it", () => {
    const node = { kind: "markup", attrs: [{ name: "title", value: "mail @theme now" }] };
    expect(kindsOf(positions(node, ALL))).toEqual(["literal-text"]);
    // Scanning literal text for bare identifiers is the string-blind leak the
    // AST-precise gate replaced — so the kind is not in that consumer's set.
    expect(positions(node, IDENT_ONLY)).toEqual([]);
  });

  test("a `${}`-bearing attribute value is `template-text`, and carries NO render edge", () => {
    const node = { kind: "markup", attrs: [{ name: "class", value: { kind: "string-literal", value: "box ${@theme}" } }] };
    const ps = positions(node, ALL);
    expect(kindsOf(ps)).toEqual(["template-text"]);
    // Credited for reader-accounting only — this position has never emitted a
    // markup-read DG node, and other DG consumers must not see one appear.
    expect(ps[0].render).toBe(false);
  });
});

describe("expr-positions §5 — `render` is a property of the POSITION, not of having attrs", () => {
  // `render` means "the compiler wires this into RENDERED output", which is what
  // makes the dependency graph mint a markup-read node ANCHORED AT THE POSITION'S
  // SPAN. Getting it wrong does not change a diagnostic today; it puts a node of
  // the wrong kind, at a declaration span, into a graph that closure analysis and
  // `resolveSourceRenderNodeId` both consume.
  const attrValue = { kind: "expr", raw: "@x", refs: ["x"] };

  test("a markup element's attribute IS a render position", () => {
    const ps = positions({ kind: "markup", tag: "p", attrs: [{ name: "if", value: attrValue }] }, ALL);
    expect(ps.map((p) => p.render)).toEqual([true]);
  });

  test("a `state` instantiation's attribute is NOT — `attrs` is not markup-only", () => {
    // `<card name=...>` carries an `attrs` array of the same shape. The
    // pre-convergence dependency graph reached `attrs` only from inside its
    // `node.kind === "markup"` branch, so it never credited these; this keeps that
    // edge topology exactly.
    const ps = positions({ kind: "state", stateType: "card", attrs: [{ name: "label", value: attrValue }] }, ALL);
    expect(ps.map((p) => p.render)).toEqual([false]);
  });

  test("a `state-constructor-def`'s attribute is NOT either", () => {
    const ps = positions({ kind: "state-constructor-def", stateType: "card", attrs: [{ name: "label", value: attrValue }] }, ALL);
    expect(ps.map((p) => p.render)).toEqual([false]);
  });

  test("but the identifier consumer still SEES it — the position is enumerated, only `render` differs", () => {
    const node = {
      kind: "state",
      stateType: "card",
      attrs: [{ name: "label", value: { kind: "expr", raw: "LIMIT + 1", exprNode: { kind: "ident", name: "LIMIT" } } }],
    };
    const ps = positions(node, IDENT_ONLY);
    expect(ps).toHaveLength(1);
    expect(ps[0].origin).toBe("attr.value.exprNode");
  });

  test("the structural `if=` gate stays a render position on a NON-markup node", () => {
    // `<each>` / `<match>` / `<engine>` are not `kind: "markup"`, but `if=` governs
    // whether they RENDER — and the pre-convergence graph credited it, with edges,
    // from outside its markup branch for exactly that reason.
    const ps = positions({ kind: "each-block", ifCond: { kind: "expr", raw: "@ready", refs: ["ready"] } }, ALL);
    expect(ps.map((p) => p.render)).toEqual([true]);
  });
});

describe("expr-positions §6 — an engine guard's wrapper is stripped only when it IS the wrapper", () => {
  // `<onTransition if=...>` is captured VERBATIM, so the value may still carry a
  // `${...}` or quote wrapper. "Starts with X and ends with Y" is NOT the same
  // test as "the opening delimiter's match is the last character", and two
  // ADJACENT wrappers look exactly like one. Strip the wrong pair and the guard
  // becomes unparseable: the identifier consumer silently drops every read in it,
  // and the `@`-sigil consumer regex-scans corrupted text.
  const guard = (ifExprRaw) => {
    const ps = positions({
      kind: "engine-decl",
      _record: { engineMeta: { stateChildren: [{ tag: "T", onTransitionElements: [{ ifExprRaw }] }] } },
    }, ALL);
    const p = ps.find((x) => x.origin.endsWith("ifExprRaw"));
    return p ? p.value : undefined;
  };

  test("a genuine `${...}` wrapper is stripped", () => {
    expect(guard("${(GUARD == 1)}")).toBe("(GUARD == 1)");
  });

  test("a genuine quote wrapper is stripped", () => {
    expect(guard("'GUARD == 1'")).toBe("GUARD == 1");
  });

  test("TWO ADJACENT `${}` interpolations are left intact, not merged into one", () => {
    // Naive strip -> `@a} && ${@b`, which parses as nothing.
    expect(guard("${@a} && ${@b}")).toBe("${@a} && ${@b}");
  });

  test("TWO ADJACENT quoted strings are left intact", () => {
    // Naive strip -> `a' == 'b`.
    expect(guard("'a' == 'b'")).toBe("'a' == 'b'");
  });

  test("an escaped delimiter inside a genuine quote wrapper does not block the strip", () => {
    expect(guard("'a\\'b'")).toBe("a\\'b");
  });

  test("a `${}` that closes early is left intact", () => {
    expect(guard("${a}{b}")).toBe("${a}{b}");
  });
});
