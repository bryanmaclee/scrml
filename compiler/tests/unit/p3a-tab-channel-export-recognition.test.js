/**
 * P3.A — TAB recognition of `export <channel name="X" attrs>{body}</>`.
 *
 * Per P3 deep-dive §4.1 + §6.2.
 *
 * Verifies that liftBareDeclarations + buildBlock together produce:
 *   - An `export-decl` AST node with exportKind: "channel" and
 *     exportedName: <channel name="..."> attribute value.
 *   - A `markup` AST node with tag: "channel", _p3aIsExport: true,
 *     _p3aExportName: <channel name="..."> attribute value.
 *   - The channel markup node appears in `ast.channelDecls`.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

function build(source, filePath = "test.scrml") {
  const bs = splitBlocks(filePath, source);
  const tab = buildAST(bs);
  return { ast: tab.ast, errors: tab.errors };
}

describe("P3.A TAB — export <channel> recognition", () => {
  test("name only — produces paired export-decl + channelDecls entry", () => {
    const { ast, errors } = build(`export <channel name="ticker">
  ${"$"}{ @shared count:number = 0 }
</>
`);
    // No hard errors (W-PROGRAM-001 is allowed).
    const hardErrors = errors.filter(e => !e.code.startsWith("W-"));
    expect(hardErrors).toEqual([]);

    // export-decl with exportKind: "channel"
    const exp = (ast.exports || []).find(e => e.exportKind === "channel");
    expect(exp).toBeDefined();
    expect(exp.exportedName).toBe("ticker");

    // channelDecls populated
    expect(ast.channelDecls).toBeDefined();
    expect(ast.channelDecls.length).toBe(1);
    const ch = ast.channelDecls[0];
    expect(ch.kind).toBe("markup");
    expect(ch.tag).toBe("channel");
    expect(ch._p3aIsExport).toBe(true);
    expect(ch._p3aExportName).toBe("ticker");
  });

  test("name + topic (string literal) — both attributes parsed", () => {
    const { ast, errors } = build(`export <channel name="chat" topic="lobby">
  ${"$"}{ @shared messages = [] }
</>
`);
    expect(errors.filter(e => !e.code.startsWith("W-"))).toEqual([]);
    const exp = (ast.exports || []).find(e => e.exportKind === "channel");
    expect(exp.exportedName).toBe("chat");
    const ch = (ast.channelDecls || [])[0];
    expect(ch._p3aExportName).toBe("chat");
    const topicAttr = (ch.attrs || []).find(a => a.name === "topic");
    expect(topicAttr).toBeDefined();
    expect(topicAttr.value.value).toBe("lobby");
  });

  test("name + topic (variable ref) — channel decl preserves attrs", () => {
    const { ast, errors } = build(`${"$"}{ @let room = "general" }
export <channel name="chat" topic=@room>
  ${"$"}{ @shared messages = [] }
</>
`);
    expect(errors.filter(e => !e.code.startsWith("W-"))).toEqual([]);
    const ch = (ast.channelDecls || [])[0];
    expect(ch._p3aExportName).toBe("chat");
    const topicAttr = (ch.attrs || []).find(a => a.name === "topic");
    expect(topicAttr).toBeDefined();
  });

  test("name + onserver:* handlers — handlers preserved on the channel markup", () => {
    const { ast, errors } = build(`${"$"}{ function onConnect() {} function onMsg(m) {} }
export <channel name="hub" onserver:open=onConnect() onserver:message=onMsg(m)>
  ${"$"}{ @shared count:number = 0 }
</>
`);
    expect(errors.filter(e => !e.code.startsWith("W-"))).toEqual([]);
    const ch = (ast.channelDecls || [])[0];
    expect(ch._p3aExportName).toBe("hub");
    const onOpen = (ch.attrs || []).find(a => a.name === "onserver:open");
    expect(onOpen).toBeDefined();
    const onMsg = (ch.attrs || []).find(a => a.name === "onserver:message");
    expect(onMsg).toBeDefined();
  });

  test("name + auth — auth attr preserved (S80 — replaces legacy protect=)", () => {
    const { ast, errors } = build(`export <channel name="private" auth="required">
  ${"$"}{ @shared messages = [] }
</>
`);
    expect(errors.filter(e => !e.code.startsWith("W-"))).toEqual([]);
    const ch = (ast.channelDecls || [])[0];
    const authAttr = (ch.attrs || []).find(a => a.name === "auth");
    expect(authAttr).toBeDefined();
  });

  test("missing name= attribute on exported channel — E-CHANNEL-EXPORT-001", () => {
    const { errors } = build(`export <channel topic="lobby">
  ${"$"}{ @shared messages = [] }
</>
`);
    const e = errors.find(err => err.code === "E-CHANNEL-EXPORT-001");
    expect(e).toBeDefined();
  });
});

/**
 * g-export-channel-body-text (Option 2b, S-ss5 item 2): an `export <channel>`
 * body with BARE V5-strict state-decls (the SPEC §38.12.4 / §38.4 canonical
 * shape — `<messages> = []` directly in the channel body, NO `${...}` wrapper)
 * MUST parse STRUCTURALLY at TAB exactly like a non-export `<channel>` body.
 *
 * Pre-fix, the export path bypassed the channel-root structural lift that
 * non-export channels reach via the `block.type==="markup"` branch, so the
 * exported body collapsed to a single RAW TEXT child — no `state-decl` nodes,
 * no auto-sync cells (the downstream wire-layer never emitted the cell mirror).
 * These tests lock the structural parse so it cannot regress.
 */
describe("P3.A TAB — export <channel> BARE body parses structurally (Option 2b)", () => {
  // Collect every state-decl name reachable under a channel markup node,
  // descending through synthetic `${...}` logic blocks (kind:"logic"/body).
  function channelStateDeclNames(channelNode) {
    const names = [];
    (function walk(list) {
      for (const n of list ?? []) {
        if (!n || typeof n !== "object") continue;
        if (n.kind === "state-decl" && typeof n.name === "string") names.push(n.name);
        if (Array.isArray(n.children)) walk(n.children);
        if (n.kind === "logic" && Array.isArray(n.body)) walk(n.body);
      }
    })(channelNode.children ?? []);
    return names;
  }

  function childKinds(channelNode) {
    return (channelNode.children ?? []).map(c => c && c.kind);
  }

  test("bare `<messages> = []` body — structural state-decl, no raw-text child", () => {
    const { ast, errors } = build(`export <channel name="chat" topic="lobby">
  <messages> = []
</>
`);
    expect(errors.filter(e => !e.code.startsWith("W-"))).toEqual([]);
    const ch = (ast.channelDecls || [])[0];
    expect(ch._p3aIsExport).toBe(true);
    // Body lifts into a structural logic block (synthetic ${...}), NOT raw text.
    expect(childKinds(ch)).toEqual(["logic"]);
    expect((ch.children ?? []).some(c => c && c.kind === "text")).toBe(false);
    // The V5-strict cell is registered structurally.
    expect(channelStateDeclNames(ch)).toContain("messages");
  });

  test("multiple bare cells + a function — all parse structurally", () => {
    const { ast, errors } = build(`export <channel name="chat">
  <messages> = []
  <count> = 0
  function postMessage(author, body) {
    @messages = [...@messages, { author, body }]
    @count = @count + 1
  }
</>
`);
    expect(errors.filter(e => !e.code.startsWith("W-"))).toEqual([]);
    const ch = (ast.channelDecls || [])[0];
    const cells = channelStateDeclNames(ch);
    expect(cells).toContain("messages");
    expect(cells).toContain("count");
    // No raw-text collapse of the body.
    expect((ch.children ?? []).some(c => c && c.kind === "text")).toBe(false);
  });

  test("export bare body matches the NON-export channel body shape exactly", () => {
    const EXPORT = `export <channel name="chat">
  <messages> = []
</>
`;
    const NON_EXPORT = `<program>
<channel name="chat">
  <messages> = []
</>
</program>
`;
    const expAst = build(EXPORT).ast;
    const nonAst = build(NON_EXPORT).ast;
    const expCh = (expAst.channelDecls || [])[0];
    const nonCh = (nonAst.channelDecls || [])[0];
    // Same child-kind sequence and the same structural cell set.
    expect(childKinds(expCh)).toEqual(childKinds(nonCh));
    expect(channelStateDeclNames(expCh)).toEqual(channelStateDeclNames(nonCh));
  });
});
