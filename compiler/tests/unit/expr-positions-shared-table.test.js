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
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  forEachExprPosition,
  EXPR_NODE_FIELDS,
} from "../../src/expr-positions.ts";

const REPO_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

/** Every kind — what `dependency-graph.ts` supports. */
const ALL = new Set([
  "expr-node", "expr-source", "statement-source", "markup-source", "template-text",
  "literal-text", "cell-name", "cell-name-list", "callee-name",
]);
/** The confidentiality consumer's strict subset — see client-read-seed.ts. */
const IDENT_ONLY = new Set([
  "expr-node", "expr-source", "statement-source", "markup-source", "template-text", "callee-name",
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

  test("`<match>` armsRaw and `<each>` bodyRaw are MARKUP-source positions", () => {
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
  test("carries the dependency graph's six, plus the one real field it was missing", () => {
    // The dependency graph had six. The client-read walker claimed eleven, and
    // five of those were the union's whole justification.
    for (const f of ["exprNode", "initExpr", "condExpr", "valueExpr", "iterExpr", "headerExpr"]) {
      expect(EXPR_NODE_FIELDS).toContain(f);
    }
    // `defaultExpr` is the only one of the five that exists: 3 declarations in
    // `types/ast.ts`, 9 construction sites in `ast-builder.js`.
    expect(EXPR_NODE_FIELDS).toContain("defaultExpr");
  });

  test("contains NO PHANTOM fields — every entry is a real AST node field", () => {
    // `testExpr` / `subjectExpr` / `targetExpr` / `returnExpr` were carried over
    // from the retired walker and NONE of them is an AST node field: a census of
    // `types/ast.ts` declarations and `ast-builder.js` construction sites finds
    // zero of each, and the only matches anywhere in `compiler/src` are
    // same-named LOCALS in emit code plus a local function in `meta-checker`.
    //
    // This is the file two passes are told to trust as the single source of
    // truth, so overstated coverage is worse here than anywhere else: it reads
    // exactly like real coverage and there is nothing to contradict it.
    //
    // HISTORICAL NAMES ONLY — §8 is the gate that catches a NEW one.
    for (const phantom of ["testExpr", "subjectExpr", "targetExpr", "returnExpr"]) {
      expect({ phantom, present: EXPR_NODE_FIELDS.includes(phantom) })
        .toEqual({ phantom, present: false });
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

describe("expr-positions §7 — every position declares whether it is a CLIENT BINDING", () => {
  // The table answers "where does user expression SOURCE appear?". The
  // confidentiality consumer asks "which identifiers must the emitted bundle
  // DECLARE?". `clientBinding` is the difference between those two questions, and
  // every gap between them was a §14.8 leak.
  //
  // THE FIELD ANSWERS ONE QUESTION, and its predecessor (`wired`) answered two.
  // `<p if=X>` DOES emit client-executed code — `_scrml_cs_reactive_get("X")` —
  // so "is it wired?" said yes and the seed shipped the const's value to the
  // browser. But that is a STRING KEY, not a binding: the bundle names `X`
  // nowhere as an identifier, so the declaration resolved nothing. The tests
  // below are the measured answer to the binding question, `if=` included.
  const bindingOf = (ps) => ps.map((p) => [p.origin, p.clientBinding]);

  test("a BARE attribute value is a binding ONLY on the bare-ref event route", () => {
    // MEASURED end-to-end (see the conformance file): the ONLY bare-value
    // lowering that names the source as an identifier is `emit-html.ts`'s
    // bare-ref event handler, which emits `"_scrml_attr_onclick_1": SECRET,`.
    const bare = (name) => positions(
      { kind: "markup", attrs: [{ name, value: { kind: "variable-ref", name: "SECRET", exprNode: { kind: "ident", name: "SECRET" } } }] },
      IDENT_ONLY,
    )[0];
    const notBinding = [
      // static HTML attribute strings
      "class", "id", "title", "style", "data-x", "aria-label", "src", "href",
      "show", "key", "value", "disabled",
      // `if=` lowers through the §17.1 mount gate to a reactive-STORE read
      "if",
    ];
    for (const attr of notBinding) {
      expect({ attr, clientBinding: bare(attr).clientBinding })
        .toEqual({ attr, clientBinding: "not-binding" });
    }
    for (const attr of ["onclick", "oninput", "onsubmit", "onchange", "onkeydown", "onmouseover"]) {
      expect({ attr, clientBinding: bare(attr).clientBinding })
        .toEqual({ attr, clientBinding: "binding" });
    }
  });

  test("the event-name predicate is codegen's OWN, so the four drift names agree", () => {
    // `expr-positions` carried `/^on[a-z]/`; codegen used `name.startsWith("on")`.
    // The gap is exactly these four, and each one MEASURED as an under-emit — a
    // live `ReferenceError` at exit 0. Both sides now call the same function
    // (`attr-lowering.ts`), so the gap cannot reopen.
    const bare = (name) => positions(
      { kind: "markup", attrs: [{ name, value: { kind: "variable-ref", name: "HANDLER" } }] },
      IDENT_ONLY,
    )[0];
    for (const attr of ["on", "on-tap", "on_tap", "on2"]) {
      expect({ attr, clientBinding: bare(attr).clientBinding })
        .toEqual({ attr, clientBinding: "binding" });
    }
    // And the names the OLD regex and codegen already agreed on stay agreed —
    // codegen routes ANY `on…` name to event wiring, `only=` included.
    for (const attr of ["only", "once", "onward"]) {
      expect({ attr, clientBinding: bare(attr).clientBinding })
        .toEqual({ attr, clientBinding: "binding" });
    }
  });

  test("a bare value that is not a plain identifier is NOT a binding, even on an event attr", () => {
    // MEASURED: `<button onclick=X.go>` lowers to the static HTML attribute
    // `onclick="X.go"`. Zero client JS references the binding, and the const
    // shipped anyway — the same leak as `if=`, on the other axis.
    const bare = (value) => positions(
      { kind: "markup", attrs: [{ name: "onclick", value: { kind: "variable-ref", name: value } }] },
      IDENT_ONLY,
    )[0];
    expect(bare("X.go").clientBinding).toBe("not-binding");
    expect(bare("X[0]").clientBinding).toBe("not-binding");
    expect(bare("@cell").clientBinding).toBe("not-binding");
    expect(bare("X").clientBinding).toBe("binding");
  });

  test("a call-ref, a parenthesized expr and a `${}` template are bindings on ANY attribute", () => {
    // MEASURED on `class=` / `title=` / `data-x=` / `<textarea>` as well as on
    // `onclick=`: all three shapes emit a real identifier reference regardless of
    // the attribute's name.
    const attr = (value) => positions({ kind: "markup", attrs: [{ name: "class", value }] }, IDENT_ONLY);
    expect(bindingOf(attr({ kind: "call-ref", name: "X.go", args: [] })))
      .toEqual([["attr.value.name(raw)", "binding"], ["attr.value.callee", "binding"]]);
    expect(bindingOf(attr({ kind: "expr", raw: "(X)", exprNode: { kind: "ident", name: "X" } })))
      .toEqual([["attr.value.exprNode", "binding"]]);
    expect(bindingOf(attr({ kind: "string-literal", value: "c-${X}" })))
      .toEqual([["attr.value.template", "binding"]]);
  });

  test("a CELL NAME is never a binding, whatever the emit site declares", () => {
    // A cell is addressed by STRING KEY in emitted client code
    // (`_scrml_cs_reactive_get("hits")`), so there is no identifier to declare on
    // any lowering, ever. That is a property of the KIND, decided once in the
    // enumerator, so an emit site cannot get it wrong for these two kinds.
    //
    // These three shapes DO emit client-executed code — `el.style.display = …`,
    // `addEventListener("input", …)`, `classList.toggle(…)`, each inside an
    // `_scrml_effect` — and none of them emits a binding.
    for (const name of ["show", "bind:value", "class:on", "disabled", "if"]) {
      const ps = positions(
        { kind: "markup", attrs: [{ name, value: { kind: "variable-ref", name: "@probecell" } }] },
        ALL,
      );
      expect({ name, got: ps.map((p) => [p.kind, p.clientBinding]) })
        .toEqual({ name, got: [["cell-name", "not-binding"]] });
    }
    // Same for a pre-extracted `refs` list on an expression attribute, which the
    // group's own declared class would otherwise mark a binding.
    const refsPs = positions(
      { kind: "markup", attrs: [{ name: "if", value: { kind: "expr", raw: "(@a && @b)", refs: ["a", "b"] } }] },
      ALL,
    );
    expect(refsPs.map((p) => [p.kind, p.clientBinding])).toEqual([["cell-name-list", "not-binding"]]);
  });

  test("literal attribute text is not a binding", () => {
    const ps = positions({ kind: "markup", attrs: [{ name: "title", value: "mail @theme now" }] }, ALL);
    expect(bindingOf(ps)).toEqual([["attr.value(text)", "not-binding"]]);
  });

  test("a rendered BODY is markup-source; only its `${}` interiors are code", () => {
    // `<each in=@rows as r>SECRET items</each>` — the body is prose the compiler
    // emits as a text node. Sending it to the expression parser turned rendered
    // WORDS into client "reads" and shipped a server-only const.
    const ps = positions({ kind: "each-block", bodyRaw: "SECRET items" }, ALL);
    expect(ps.map((p) => [p.kind, p.origin])).toEqual([["markup-source", "each.bodyRaw"]]);
  });

  test("an engine state-child is classified from the AST, not from the text", () => {
    // `isColonShorthand` already records which form the body took. Guessing from
    // the text (`/^\s*</`) called a bare-body prose child "statements" — and
    // wrapping the same prose in `<p>` made the leak disappear, which is the
    // signature of a heuristic rather than a rule.
    const mk = (isColonShorthand, bodyRaw) => positions({
      kind: "engine-decl",
      _record: { engineMeta: { stateChildren: [{ tag: "T", isColonShorthand, bodyRaw }] } },
    }, ALL)[0];
    expect(mk(true, "@hits = SECRET").kind).toBe("statement-source");
    expect(mk(false, "SECRET screen").kind).toBe("markup-source");
    // The `<onTransition>` body carries its own flag and is classified the same way.
    const ot = (isColonShorthand, bodyRaw) => positions({
      kind: "engine-decl",
      _record: { engineMeta: { stateChildren: [{ tag: "T", onTransitionElements: [{ isColonShorthand, bodyRaw }] }] } },
    }, ALL)[0];
    expect(ot(true, "@n = SECRET").kind).toBe("statement-source");
    expect(ot(false, "SECRET text").kind).toBe("markup-source");
  });

  test("an `on mount` raw body is statement-source and a binding position", () => {
    const ps = positions({ kind: "bare-expr", _onMountEffect: true, expr: "@a = 1\n@b = 2" }, ALL);
    expect(ps.map((p) => [p.kind, p.clientBinding])).toEqual([["statement-source", "binding"]]);
  });

  test("BOTH values of the type are LIVE — neither is a claim the code never makes", () => {
    // The predecessor type had a third value, `"unknown"`, with a docblock arguing
    // at length that an undetermined position fails CLOSED — and ZERO emit sites.
    // Every unmeasured position was forced the other way, into the leak direction.
    // A value nothing emits is a safety claim the code does not honour, so this
    // asserts each value is actually produced.
    const seen = new Set();
    const sample = [
      { kind: "markup", attrs: [{ name: "title", value: "plain text" }] },
      { kind: "markup", attrs: [{ name: "onclick", value: { kind: "variable-ref", name: "go" } }] },
      { kind: "markup", attrs: [{ name: "if", value: { kind: "variable-ref", name: "GATE" } }] },
      { kind: "each-block", inExprRaw: "@rows", bodyRaw: "x ${@r}" },
    ];
    for (const node of sample) for (const p of positions(node, ALL)) seen.add(p.clientBinding);
    expect([...seen].sort()).toEqual(["binding", "not-binding"]);
  });
});

// ---------------------------------------------------------------------------
// §8 — THE DUAL-DIRECTION GATE ON `EXPR_NODE_FIELDS`.
//
// §3 is ONE-DIRECTIONAL: it asserts seven names are present and four HISTORICAL
// phantom names are absent. Three brand-new phantoms pass it, and a real field
// missing from the list passes it too — which is exactly what happened.
// `resultExpr` is declared at `types/ast.ts:1150` with six construction sites in
// `ast-builder.js`, `route-inference.ts` carried its own copy of the same list
// and already included it, and its absence here was a live cross-file
// `ReferenceError` at exit 0:
//
//     on mount { @a = match @phase { .Idle :> NEEDED, .Ready :> "ready" } }
//     -> index.client.js:  if (_scrml_match_2 === "Idle") return NEEDED;
//     -> NEEDED declared nowhere, no diagnostic.
//
// So the gate ENUMERATES THE AST instead of restating a list, in both
// directions: every `ExprNode`-typed declaration must be IN the list or on the
// exclusion list below with a reason, and every list entry must be a real
// declaration.
// ---------------------------------------------------------------------------

/**
 * Every `X: ExprNode` / `X: ExprNode[]` field declared on an AST NODE, read out
 * of `types/ast.ts`.
 *
 * SCOPED TO THE REGION BEFORE THE `ExprNode` UNION. Everything after that
 * banner is ExprNode-INTERNAL structure (`left`, `right`, `callee`, `object`, …)
 * which no consumer reaches by iterating fields on an AST node — those are
 * walked by `forEachIdentInExprNode` / the collector's deep descent. Including
 * them would make the gate demand entries that would break both consumers.
 */
function declaredExprNodeFields() {
  const src = readFileSync(join(REPO_SRC, "types", "ast.ts"), "utf8");
  const banner = "// ExprNode — Structured Expression AST";
  const cut = src.indexOf(banner);
  expect({ banner, found: cut >= 0 }).toEqual({ banner, found: true });
  const single = new Map();
  const list = new Map();
  src.slice(0, cut).split("\n").forEach((line, i) => {
    const re = /(?:^|[{;])\s*(?:readonly\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\??\s*:\s*ExprNode(\[\])?\s*(?:\|\s*null\s*)?(?=[;,}\s])/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      const bag = m[2] ? list : single;
      if (!bag.has(m[1])) bag.set(m[1], []);
      bag.get(m[1]).push(i + 1);
    }
  });
  return { single, list };
}

/**
 * A declared `ExprNode` field DELIBERATELY not in `EXPR_NODE_FIELDS`, each with
 * the reason. Adding a name here is a decision someone has to write down; that
 * is the whole point of the list existing.
 */
const EXPR_NODE_FIELD_EXCLUSIONS = {
  index:
    "nested inside `path: (string | { index?: ExprNode; raw?: string })[]` — not a " +
    "direct field of any node, so `node[f]` never reaches it.",
  updateExpr:
    "nested inside `cStyleParts?: { initExpr; condExpr; updateExpr }` — same reason. " +
    "(`initExpr`/`condExpr` are in the list from their OWN top-level declarations.)",
  value:
    "`RelationalPredicateNode.value`, reached through `ValidatorEntry.args`, never as " +
    "a node field. The NAME is the hazard: `isExprNode` accepts any `{kind: string}`, " +
    "so listing it would make both consumers walk every attr/prop `value` object as " +
    "though it were an expression.",
  handlerExpr:
    "`ErrorArm` carries no `kind`, so neither consumer's kind-gated child recursion " +
    "reaches the arm object at all — listing the field would change nothing. Tracked " +
    "as the node-traversal half of the drift in `docs/known-gaps.md`.",
  argExprNodes:
    "`ExprNode[]`. Enumerated explicitly by the shared table at the call-ref site " +
    "(`attr.value.argExprNodes[]`), which is where the per-element walk belongs.",
  scrutineeExprs:
    "`ExprNode[]`; the list is single-valued by contract (`collectFromExprNode(node[f])`). " +
    "MEASURED not a live under-emit: a cross-file const in a multi-scrutinee " +
    "`match a, b { … }` header already reaches the client bundle through another position.",
};

describe("expr-positions §8 — EXPR_NODE_FIELDS is gated against the AST, both ways", () => {
  test("every ExprNode-typed AST field is IN the list or excluded WITH a reason", () => {
    const { single, list } = declaredExprNodeFields();
    // Guard the guard: a scan that finds nothing proves nothing.
    expect(single.size).toBeGreaterThan(10);
    const unaccounted = [];
    for (const [name, lines] of [...single, ...list]) {
      if (EXPR_NODE_FIELDS.includes(name)) continue;
      const reason = EXPR_NODE_FIELD_EXCLUSIONS[name];
      if (typeof reason === "string" && reason.length > 20) continue;
      unaccounted.push(`${name} (types/ast.ts:${lines.join(",")})`);
    }
    expect(unaccounted).toEqual([]);
  });

  test("every list entry is a REAL declaration — no new phantom can be added", () => {
    const { single } = declaredExprNodeFields();
    const phantoms = EXPR_NODE_FIELDS.filter((f) => !single.has(f));
    expect(phantoms).toEqual([]);
  });

  test("an exclusion cannot be a bare name — it must carry a reason", () => {
    for (const [name, reason] of Object.entries(EXPR_NODE_FIELD_EXCLUSIONS)) {
      expect({ name, hasReason: typeof reason === "string" && reason.length > 20 })
        .toEqual({ name, hasReason: true });
      // And an exclusion for a field that is ALSO in the list is a contradiction.
      expect({ name, alsoListed: EXPR_NODE_FIELDS.includes(name) })
        .toEqual({ name, alsoListed: false });
    }
  });

  test("the fields the gate ADDED are the ones the AST declares", () => {
    // Pinned by name so a silent removal is attributable here rather than three
    // stages downstream as a `ReferenceError` in someone's browser.
    for (const f of ["resultExpr", "bodyExpr", "callbackExpr", "fileExpr", "urlExpr"]) {
      expect({ field: f, present: EXPR_NODE_FIELDS.includes(f) })
        .toEqual({ field: f, present: true });
    }
  });
});
