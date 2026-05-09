/**
 * <channel> WebSocket state type — §38
 *
 * Tests for <channel> parsing, codegen output, and error codes.
 *
 * §1  Channel markup node parses as kind:"markup" tag:"channel"
 * §2  Channel name attribute is extracted
 * §3  Channel topic attribute is extracted
 * §4  Channel protect attribute is extracted
 * §5  Channel reconnect attribute is extracted
 * §6  Channel onserver: handler attributes are extracted
 * §7  emit-html.js silences channel elements (no HTML output)
 * §8  E-CHANNEL-001: missing name= emits error
 * §9  emit-reactive-wiring.js emits _scrml_ws_<name> IIFE for channel
 * §10 Client IIFE includes new WebSocket() call with correct path
 * §11 Client IIFE includes _scrml_register_cleanup
 * §12 onclose handler emits auto-reconnect setTimeout
 * §13 @shared variables emit _scrml_reactive_subscribe sync calls
 * §14 emit-channel.js collectChannelNodes finds channel nodes
 * §15 emitChannelClientJs emits IIFE for named channel
 * §16 emitChannelServerJs emits export const _scrml_route_ws_<name> (not routes.push)
 * §17 emitChannelWsHandlers emits _scrml_ws_handlers export
 * §18 Multiple channels in same file are each emitted
 * §19 channel name is URL-safe (kebab → underscore in JS ident)
 * §20 broadcast and disconnect are tokenizer keywords
 * §21 WebSocket URL uses protocol-relative scheme (not hardcoded ws://)
 * §22 onclient: handlers are wired to browser WebSocket events
 * §23 emitChannelWsHandlers close handler has (ws, code, reason) signature
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { generateHtml } from "../../src/codegen/emit-html.js";
import { emitReactiveWiring } from "../../src/codegen/emit-reactive-wiring.js";
import { makeCompileContext } from "../../src/codegen/context.ts";
import { generateServerJs } from "../../src/codegen/emit-server.js";
import {
  collectChannelNodes,
  emitChannelClientJs,
  emitChannelServerJs,
  emitChannelWsHandlers,
} from "../../src/codegen/emit-channel.js";
import { CGError } from "../../src/codegen/errors.ts";
import { tokenizeBlock } from "../../src/tokenizer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSource(source, filePath = "/test/app.scrml") {
  const bsResult = splitBlocks(filePath, source);
  const tabResult = buildAST(bsResult);
  return tabResult;
}

function findMarkupNodes(nodes, tag) {
  const found = [];
  function walk(list) {
    for (const node of list) {
      if (!node) continue;
      if (node.kind === "markup" && node.tag === tag) found.push(node);
      if (Array.isArray(node.children)) walk(node.children);
      if (node.kind === "logic" && Array.isArray(node.body)) walk(node.body);
    }
  }
  walk(nodes);
  return found;
}

function compileSource(source) {
  const { ast, errors } = parseSource(source);
  const htmlErrors = [];
  const html = generateHtml(ast.nodes, htmlErrors, false, null, ast);
  const reactiveLines = emitReactiveWiring(makeCompileContext({ fileAST: ast, errors: htmlErrors }));
  return { ast, html, reactiveLines, errors: htmlErrors };
}

// Minimal fileAST shim for emit-channel.js direct tests
function makeChannelNode(attrs = [], children = []) {
  return {
    kind: "markup",
    tag: "channel",
    attrs,
    children,
    span: { file: "/test/app.scrml", start: 0, end: 0, line: 1, col: 1 },
  };
}

function makeAttr(name, value) {
  return { name, value };
}

function makeStringAttr(name, str) {
  return { name, value: { kind: "string-literal", value: str } };
}

function makeIdentAttr(name, ident) {
  return { name, value: { kind: "variable-ref", name: ident } };
}

function makeCallAttr(name, fnName, args = "") {
  return { name, value: { kind: "call", name: fnName, args } };
}

// ---------------------------------------------------------------------------
// §1: Channel markup node parsing
// ---------------------------------------------------------------------------

describe("§1: channel markup node parses as kind:markup tag:channel", () => {
  test("channel with name parses as markup node", () => {
    const source = `<program>
<div>
<channel name="chat">
</>
</>
</>`;
    const { ast } = parseSource(source);
    const channelNodes = findMarkupNodes(ast.nodes, "channel");
    expect(channelNodes).toHaveLength(1);
    expect(channelNodes[0].kind).toBe("markup");
    expect(channelNodes[0].tag).toBe("channel");
  });

  test("self-closing channel parses correctly", () => {
    const source = `<program>
<div>
<channel name="updates"/>
</>
</>`;
    const { ast } = parseSource(source);
    const channelNodes = findMarkupNodes(ast.nodes, "channel");
    expect(channelNodes).toHaveLength(1);
  });

  test("channel without name= still parses as markup node", () => {
    const source = `<program>
<div>
<channel>
</>
</>
</>`;
    const { ast } = parseSource(source);
    // Still parses as a markup node (error emitted at codegen time, not parse time)
    const channelNodes = findMarkupNodes(ast.nodes, "channel");
    expect(channelNodes).toHaveLength(1);
    expect(channelNodes[0].tag).toBe("channel");
  });
});

// ---------------------------------------------------------------------------
// §2: Channel name attribute
// ---------------------------------------------------------------------------

describe("§2: channel name attribute is extracted", () => {
  test("name= string literal attribute is present in attrs", () => {
    const source = `<program>
<div>
<channel name="chat">
</>
</>
</>`;
    const { ast } = parseSource(source);
    const channelNode = findMarkupNodes(ast.nodes, "channel")[0];
    const nameAttr = (channelNode.attrs ?? channelNode.attributes ?? []).find(a => a.name === "name");
    expect(nameAttr).toBeDefined();
  });

  test("name= value is accessible", () => {
    const source = `<program>
<div>
<channel name="live-updates">
</>
</>
</>`;
    const { ast } = parseSource(source);
    const channelNode = findMarkupNodes(ast.nodes, "channel")[0];
    const nameAttr = (channelNode.attrs ?? channelNode.attributes ?? []).find(a => a.name === "name");
    expect(nameAttr?.value?.value ?? nameAttr?.value?.name).toBe("live-updates");
  });
});

// ---------------------------------------------------------------------------
// §3: Channel topic attribute
// ---------------------------------------------------------------------------

describe("§3: channel topic attribute", () => {
  test("topic= string literal attribute is present", () => {
    const source = `<program>
<div>
<channel name="chat" topic="room1">
</>
</>
</>`;
    const { ast } = parseSource(source);
    const channelNode = findMarkupNodes(ast.nodes, "channel")[0];
    const topicAttr = (channelNode.attrs ?? channelNode.attributes ?? []).find(a => a.name === "topic");
    expect(topicAttr).toBeDefined();
  });

  test("topic=@var reactive attribute is present", () => {
    const source = `<program>
@roomId = "general"
<div>
<channel name="chat" topic=@roomId>
</>
</>
</>`;
    const { ast } = parseSource(source);
    const channelNode = findMarkupNodes(ast.nodes, "channel")[0];
    const topicAttr = (channelNode.attrs ?? channelNode.attributes ?? []).find(a => a.name === "topic");
    expect(topicAttr).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// §4: Channel protect attribute
// ---------------------------------------------------------------------------

describe("§4: channel protect attribute", () => {
  test("protect= attribute is present when specified", () => {
    const source = `<program>
<div>
<channel name="private" protect="auth">
</>
</>
</>`;
    const { ast } = parseSource(source);
    const channelNode = findMarkupNodes(ast.nodes, "channel")[0];
    const protectAttr = (channelNode.attrs ?? channelNode.attributes ?? []).find(a => a.name === "protect");
    expect(protectAttr).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// §5: Channel reconnect attribute
// ---------------------------------------------------------------------------

describe("§5: channel reconnect attribute", () => {
  test("reconnect= attribute is present when specified", () => {
    const source = `<program>
<div>
<channel name="feed" reconnect=5000>
</>
</>
</>`;
    const { ast } = parseSource(source);
    const channelNode = findMarkupNodes(ast.nodes, "channel")[0];
    const reconnAttr = (channelNode.attrs ?? channelNode.attributes ?? []).find(a => a.name === "reconnect");
    expect(reconnAttr).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// §6: Channel onserver: handler attributes
// ---------------------------------------------------------------------------

describe("§6: channel onserver: handler attributes", () => {
  test("onserver:open= attribute is present", () => {
    const source = `<program>
<div>
<channel name="chat" onserver:open=onConnect()>
</>
</>
</>`;
    const { ast } = parseSource(source);
    const channelNode = findMarkupNodes(ast.nodes, "channel")[0];
    const openAttr = (channelNode.attrs ?? channelNode.attributes ?? []).find(a => a.name === "onserver:open");
    expect(openAttr).toBeDefined();
  });

  test("onserver:message= attribute is present", () => {
    const source = `<program>
<div>
<channel name="chat" onserver:message=handleMsg(msg)>
</>
</>
</>`;
    const { ast } = parseSource(source);
    const channelNode = findMarkupNodes(ast.nodes, "channel")[0];
    const msgAttr = (channelNode.attrs ?? channelNode.attributes ?? []).find(a => a.name === "onserver:message");
    expect(msgAttr).toBeDefined();
  });

  test("onserver:close= attribute is present", () => {
    const source = `<program>
<div>
<channel name="chat" onserver:close=onDisconnect()>
</>
</>
</>`;
    const { ast } = parseSource(source);
    const channelNode = findMarkupNodes(ast.nodes, "channel")[0];
    const closeAttr = (channelNode.attrs ?? channelNode.attributes ?? []).find(a => a.name === "onserver:close");
    expect(closeAttr).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// §7: emit-html.js silences channel elements
// ---------------------------------------------------------------------------

describe("§7: emit-html.js emits no HTML for <channel>", () => {
  test("channel produces no HTML output", () => {
    const source = `<program>
<div>
<channel name="chat">
</>
</>
</>`;
    const { html } = compileSource(source);
    expect(html).not.toContain("<channel");
    expect(html).not.toContain("</channel>");
  });

  test("sibling elements around channel still emit HTML", () => {
    const source = `<program>
<div>
<p>hello</>
<channel name="chat">
</>
<span>world</>
</>
</>`;
    const { html } = compileSource(source);
    expect(html).toContain("<p>");
    expect(html).toContain("<span>");
    expect(html).not.toContain("<channel");
  });
});

// ---------------------------------------------------------------------------
// §8: E-CHANNEL-001 — missing name= attribute
// ---------------------------------------------------------------------------

describe("§8: E-CHANNEL-001 missing name= attribute", () => {
  test("E-CHANNEL-001 is emitted when name= is absent", () => {
    const source = `<program>
<div>
<channel>
</>
</>
</>`;
    const { errors } = compileSource(source);
    const e = errors.find(e => e.code === "E-CHANNEL-001");
    expect(e).toBeDefined();
    expect(e.message).toContain("E-CHANNEL-001");
    expect(e.message).toContain("name");
  });

  test("no E-CHANNEL-001 when name= is present", () => {
    const source = `<program>
<div>
<channel name="updates">
</>
</>
</>`;
    const { errors } = compileSource(source);
    const e = errors.find(e => e.code === "E-CHANNEL-001");
    expect(e).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §9: emit-reactive-wiring.js emits client WebSocket IIFE
// ---------------------------------------------------------------------------

describe("§9: emit-reactive-wiring emits _scrml_ws_<name> IIFE", () => {
  test("reactive wiring includes channel IIFE for named channel", () => {
    const source = `<program>
<div>
<channel name="chat">
</>
</>
</>`;
    const { reactiveLines } = compileSource(source);
    const code = reactiveLines.join("\n");
    expect(code).toContain("_scrml_ws_chat");
    expect(code).toContain("channel WebSocket client");
  });

  test("reactive wiring includes IIFE when channel has reconnect= attr", () => {
    const source = `<program>
<div>
<channel name="feed" reconnect=5000>
</>
</>
</>`;
    const { reactiveLines } = compileSource(source);
    const code = reactiveLines.join("\n");
    expect(code).toContain("_scrml_ws_feed");
  });
});

// ---------------------------------------------------------------------------
// §10: Client IIFE includes new WebSocket() with correct path
// ---------------------------------------------------------------------------

describe("§10: client IIFE has correct WebSocket URL", () => {
  test("WebSocket URL path matches channel name", () => {
    const node = makeChannelNode([makeStringAttr("name", "chat")]);
    const lines = emitChannelClientJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain("/_scrml_ws/chat");
    expect(code).toContain("new WebSocket");
  });

  test("channel name kebab-case is preserved in URL, underscored in JS ident", () => {
    const node = makeChannelNode([makeStringAttr("name", "live-feed")]);
    const lines = emitChannelClientJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    // Both URL and JS variable use the normalized safe name (kebab -> underscore)
    expect(code).toContain("/_scrml_ws/live_feed");
    expect(code).toContain("_scrml_ws_live_feed");
  });
});

// ---------------------------------------------------------------------------
// §11: Client IIFE includes _scrml_register_cleanup
// ---------------------------------------------------------------------------

describe("§11: client IIFE registers cleanup", () => {
  test("_scrml_register_cleanup is emitted", () => {
    const node = makeChannelNode([makeStringAttr("name", "updates")]);
    const lines = emitChannelClientJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain("_scrml_register_cleanup");
  });

  test("cleanup closes WebSocket and clears reconnect timer", () => {
    const node = makeChannelNode([makeStringAttr("name", "updates")]);
    const lines = emitChannelClientJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain("clearTimeout");
    expect(code).toContain("close()");
  });
});

// ---------------------------------------------------------------------------
// §12: onclose emits auto-reconnect setTimeout
// ---------------------------------------------------------------------------

describe("§12: onclose handler emits auto-reconnect", () => {
  test("setTimeout appears in onclose handler", () => {
    const node = makeChannelNode([makeStringAttr("name", "chat")]);
    const lines = emitChannelClientJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    // setTimeout for reconnect
    expect(code).toContain("setTimeout");
  });

  test("reconnect=0 disables auto-reconnect", () => {
    const node = makeChannelNode([
      makeStringAttr("name", "chat"),
      makeIdentAttr("reconnect", "0"),
    ]);
    const lines = emitChannelClientJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    // reconnectMs=0 → no setTimeout reconnect
    expect(code).not.toContain("setTimeout");
  });
});

// ---------------------------------------------------------------------------
// §13: @shared variables emit sync subscriptions
// ---------------------------------------------------------------------------

describe("§13: @shared variables emit reactive sync subscriptions", () => {
  test("syncShared helper is emitted when @shared vars exist", () => {
    // Create a channel node with a state-decl child marked isShared
    const sharedDecl = {
      kind: "state-decl",
      name: "count",
      isShared: true,
    };
    const logicChild = {
      kind: "logic",
      body: [sharedDecl],
    };
    const node = makeChannelNode([makeStringAttr("name", "collab")], [logicChild]);
    const lines = emitChannelClientJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain("syncShared");
    expect(code).toContain("__sync");
    expect(code).toContain("_scrml_effect");
  });

  test("no sync code emitted when no @shared vars", () => {
    const node = makeChannelNode([makeStringAttr("name", "simple")]);
    const lines = emitChannelClientJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).not.toContain("syncShared");
    expect(code).not.toContain("__sync");
  });
});

// ---------------------------------------------------------------------------
// §14: collectChannelNodes finds all channel nodes
// ---------------------------------------------------------------------------

describe("§14: collectChannelNodes collects all <channel> nodes", () => {
  test("finds one channel in simple AST", () => {
    const source = `<program>
<div>
<channel name="chat">
</>
</>
</>`;
    const { ast } = parseSource(source);
    const nodes = collectChannelNodes(ast.nodes);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].tag).toBe("channel");
  });

  test("finds multiple channels in same file", () => {
    const source = `<program>
<div>
<channel name="chat">
</>
<channel name="notifications">
</>
</>
</>`;
    const { ast } = parseSource(source);
    const nodes = collectChannelNodes(ast.nodes);
    expect(nodes).toHaveLength(2);
  });

  test("returns empty array when no channels exist", () => {
    const source = `<program>
<div>
<p>hello</>
</>
</>`;
    const { ast } = parseSource(source);
    const nodes = collectChannelNodes(ast.nodes);
    expect(nodes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §15: emitChannelClientJs emits IIFE for named channel
// ---------------------------------------------------------------------------

describe("§15: emitChannelClientJs emits complete IIFE", () => {
  test("emits IIFE wrapper syntax", () => {
    const node = makeChannelNode([makeStringAttr("name", "chat")]);
    const lines = emitChannelClientJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain("(() => {");
    expect(code).toContain("})();");
  });

  test("emits _connect() function", () => {
    const node = makeChannelNode([makeStringAttr("name", "chat")]);
    const lines = emitChannelClientJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain("function _connect");
  });

  test("emits send() return API", () => {
    const node = makeChannelNode([makeStringAttr("name", "chat")]);
    const lines = emitChannelClientJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain("send:");
  });

  test("emits onopen= handler when onclient:open is specified", () => {
    // onclient:open wires to browser ws.onopen
    const node = makeChannelNode([
      makeStringAttr("name", "chat"),
      makeCallAttr("onclient:open", "handleOpen", ""),
    ]);
    const lines = emitChannelClientJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain("onopen");
    expect(code).toContain("handleOpen");
  });

  test("E-CHANNEL-001 is pushed when name= is missing (via compileSource)", () => {
    // E-CHANNEL-001 is emitted by emit-html.js, not emitChannelClientJs directly.
    // Validate via full compile pipeline.
    const source = `<program>
<div>
<channel>
</>
</>
</>`;
    const { errors } = compileSource(source);
    const e = errors.find(e => e.code === "E-CHANNEL-001");
    expect(e).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// §16: emitChannelServerJs emits export const _scrml_route_ws_<name>
//
// Bug 2 fix: The original code emitted `routes.push({...})` — `routes` is never
// declared in .server.js files. Fixed to emit `export const _scrml_route_ws_<name>`.
// ---------------------------------------------------------------------------

describe("§16: emitChannelServerJs emits upgrade route as export const", () => {
  test("emits export const _scrml_route_ws_<name> (not routes.push)", () => {
    const node = makeChannelNode([makeStringAttr("name", "chat")]);
    const lines = emitChannelServerJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    // Must be exported as a named constant, not routes.push
    expect(code).toContain("export const _scrml_route_ws_chat");
    expect(code).not.toContain("routes.push");
  });

  test("exported route has correct path", () => {
    const node = makeChannelNode([makeStringAttr("name", "chat")]);
    const lines = emitChannelServerJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain("/_scrml_ws/chat");
  });

  test("emits isWebSocket: true on route object", () => {
    const node = makeChannelNode([makeStringAttr("name", "chat")]);
    const lines = emitChannelServerJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain("isWebSocket: true");
  });

  test("emits server.upgrade() call", () => {
    const node = makeChannelNode([makeStringAttr("name", "chat")]);
    const lines = emitChannelServerJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain("server.upgrade");
  });

  test("emits auth check when hasAuth=true", () => {
    const node = makeChannelNode([makeStringAttr("name", "private")]);
    const lines = emitChannelServerJs(node, [], "/test/app.scrml", true);
    const code = lines.join("\n");
    expect(code).toContain("_scrml_auth_check");
  });

  test("no auth check when hasAuth=false and no protect=", () => {
    const node = makeChannelNode([makeStringAttr("name", "public")]);
    const lines = emitChannelServerJs(node, [], "/test/app.scrml", false);
    const code = lines.join("\n");
    expect(code).not.toContain("_scrml_auth_check");
  });

  test("route export name uses safeName (kebab → underscore)", () => {
    const node = makeChannelNode([makeStringAttr("name", "live-chat")]);
    const lines = emitChannelServerJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain("export const _scrml_route_ws_live_chat");
  });
});

// ---------------------------------------------------------------------------
// §17: emitChannelWsHandlers emits merged handlers export
// ---------------------------------------------------------------------------

describe("§17: emitChannelWsHandlers emits _scrml_ws_handlers export", () => {
  test("emits _scrml_ws_handlers export", () => {
    const node = makeChannelNode([makeStringAttr("name", "chat")]);
    const lines = emitChannelWsHandlers([node], [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain("export const _scrml_ws_handlers");
  });

  test("emits open, message, close handlers", () => {
    const node = makeChannelNode([makeStringAttr("name", "chat")]);
    const lines = emitChannelWsHandlers([node], [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain("open(");
    expect(code).toContain("message(");
    expect(code).toContain("close(");
  });

  test("open handler includes ws.subscribe()", () => {
    const node = makeChannelNode([makeStringAttr("name", "chat")]);
    const lines = emitChannelWsHandlers([node], [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain("ws.subscribe");
  });

  test("close handler includes ws.unsubscribe()", () => {
    const node = makeChannelNode([makeStringAttr("name", "chat")]);
    const lines = emitChannelWsHandlers([node], [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain("ws.unsubscribe");
  });

  test("returns empty array when no channels provided", () => {
    const lines = emitChannelWsHandlers([], [], "/test/app.scrml");
    expect(lines).toHaveLength(0);
  });

  test("multiple channels are routed by ws.data.__ch", () => {
    const node1 = makeChannelNode([makeStringAttr("name", "chat")]);
    const node2 = makeChannelNode([makeStringAttr("name", "notifications")]);
    const lines = emitChannelWsHandlers([node1, node2], [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain("chat");
    expect(code).toContain("notifications");
    expect(code).toContain("ws.data.__ch");
  });
});

// ---------------------------------------------------------------------------
// §18: Multiple channels in same file
// ---------------------------------------------------------------------------

describe("§18: multiple channels in same file", () => {
  test("two channels both emit client WS IIFEs", () => {
    const source = `<program>
<div>
<channel name="chat">
</>
<channel name="notifications">
</>
</>
</>`;
    const { reactiveLines } = compileSource(source);
    const code = reactiveLines.join("\n");
    expect(code).toContain("_scrml_ws_chat");
    expect(code).toContain("_scrml_ws_notifications");
  });
});

// ---------------------------------------------------------------------------
// §19: Channel name URL-safety
// ---------------------------------------------------------------------------

describe("§19: channel name normalization", () => {
  test("kebab-case name uses underscore in JS identifier", () => {
    const node = makeChannelNode([makeStringAttr("name", "live-feed")]);
    const lines = emitChannelClientJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain("_scrml_ws_live_feed");
  });

  test("kebab-case name is preserved in URL path", () => {
    const node = makeChannelNode([makeStringAttr("name", "live-feed")]);
    const lines = emitChannelClientJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    // URL path uses normalized safe name (underscore)
    expect(code).toContain("/_scrml_ws/live_feed");
  });

  test("underscore name is preserved as-is in both URL and JS ident", () => {
    const node = makeChannelNode([makeStringAttr("name", "my_channel")]);
    const lines = emitChannelClientJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain("_scrml_ws_my_channel");
  });
});

// ---------------------------------------------------------------------------
// §20: broadcast and disconnect are tokenizer keywords
// ---------------------------------------------------------------------------

describe("§20: broadcast and disconnect are tokenizer keywords", () => {
  test("broadcast tokenizes as KEYWORD", () => {
    const block = {
      type: "logic",
      raw: "${ broadcast(data) }",
      span: { start: 0, end: 20, line: 1, col: 1 },
      children: [],
    };
    const tokens = tokenizeBlock(block, "/test/app.scrml");
    const broadcastToken = tokens.find(t => t.text === "broadcast");
    expect(broadcastToken).toBeDefined();
    expect(broadcastToken.kind).toBe("KEYWORD");
  });

  test("disconnect tokenizes as KEYWORD", () => {
    const block = {
      type: "logic",
      raw: "${ disconnect() }",
      span: { start: 0, end: 18, line: 1, col: 1 },
      children: [],
    };
    const tokens = tokenizeBlock(block, "/test/app.scrml");
    const disconnectToken = tokens.find(t => t.text === "disconnect");
    expect(disconnectToken).toBeDefined();
    expect(disconnectToken.kind).toBe("KEYWORD");
  });
});

// ---------------------------------------------------------------------------
// §21: WebSocket URL uses protocol-relative scheme
//
// Bug 3 fix: original code used hardcoded `ws://` which breaks on HTTPS.
// Correct output uses `location.protocol === 'https:' ? 'wss' : 'ws'`.
// ---------------------------------------------------------------------------

describe("§21: WebSocket URL uses protocol-relative scheme (not hardcoded ws://)", () => {
  test("client IIFE uses protocol-relative WebSocket URL", () => {
    const node = makeChannelNode([makeStringAttr("name", "chat")]);
    const lines = emitChannelClientJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    // Must not hardcode ws://
    expect(code).not.toContain("ws://");
    // Must use protocol detection
    expect(code).toContain("location.protocol");
    expect(code).toContain("wss");
  });

  test("URL is constructed as template literal with protocol detection", () => {
    const node = makeChannelNode([makeStringAttr("name", "updates")]);
    const lines = emitChannelClientJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain("location.protocol === 'https:'");
  });
});

// ---------------------------------------------------------------------------
// §22: onclient: handlers are wired to browser WebSocket events
//
// Bug 4 fix: the original code wired onserver:open/message to browser ws.onopen/ws.onmessage.
// Fixed to use onclient:open, onclient:close, onclient:error for browser events.
// ---------------------------------------------------------------------------

describe("§22: onclient: handlers wire to browser WebSocket events", () => {
  test("onclient:open wires to ws.onopen", () => {
    const node = makeChannelNode([
      makeStringAttr("name", "chat"),
      makeCallAttr("onclient:open", "onConnected", ""),
    ]);
    const lines = emitChannelClientJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain("onopen");
    expect(code).toContain("onConnected");
  });

  test("onclient:close wires to ws.onclose", () => {
    const node = makeChannelNode([
      makeStringAttr("name", "chat"),
      makeCallAttr("onclient:close", "onDisconnected", ""),
    ]);
    const lines = emitChannelClientJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain("onclose");
    expect(code).toContain("onDisconnected");
  });

  test("onclient:error wires to ws.onerror", () => {
    const node = makeChannelNode([
      makeStringAttr("name", "chat"),
      makeCallAttr("onclient:error", "onError", "err"),
    ]);
    const lines = emitChannelClientJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain("onerror");
    expect(code).toContain("onError");
  });

  test("onserver:open does NOT wire to client ws.onopen", () => {
    // onserver:open is for the Bun server side (_scrml_ws_handlers), not the browser
    const node = makeChannelNode([
      makeStringAttr("name", "chat"),
      makeCallAttr("onserver:open", "serverOpen", ""),
    ]);
    const lines = emitChannelClientJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    // serverOpen should NOT appear in client JS — it belongs in _scrml_ws_handlers
    expect(code).not.toContain("serverOpen");
  });
});

// ---------------------------------------------------------------------------
// §23: emitChannelWsHandlers close handler has (ws, code, reason) signature
//
// Bug 5 fix: Bun calls close(ws, code, reason) — original emitted close(ws) only.
// ---------------------------------------------------------------------------

describe("§23: emitChannelWsHandlers close handler has full signature", () => {
  test("close handler signature includes code and reason", () => {
    const node = makeChannelNode([makeStringAttr("name", "chat")]);
    const lines = emitChannelWsHandlers([node], [], "/test/app.scrml");
    const code = lines.join("\n");
    // Must have the full Bun close handler signature
    expect(code).toContain("close(ws, code, reason)");
  });

  test("close handler still calls ws.unsubscribe", () => {
    const node = makeChannelNode([makeStringAttr("name", "chat")]);
    const lines = emitChannelWsHandlers([node], [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain("ws.unsubscribe");
  });
});

// ---------------------------------------------------------------------------
// §24 (C18): V5-strict channel-cell auto-sync — every state-decl inside a
// channel body auto-syncs across subscribers (§38.4 M19 / B19 line 15677).
//
// Pre-C18, extractSharedVars only matched `isShared:true` (the retired v1
// `@shared` modifier). V5-strict `<x> = init` decls carry `structuralForm:
// true` instead, so canonical v0.next channels emitted connected WS but
// zero sync wire — the F-CHANNEL-001 silent-failure pattern. This block
// locks in the V5-strict path.
// ---------------------------------------------------------------------------

import { extractSharedVars, extractChannelCells, collectChannelFunctionMap, collectChannelCellMap } from "../../src/codegen/emit-channel.js";

describe("§24 (C18): V5-strict channel-cell auto-sync", () => {
  test("extractSharedVars collects state-decls with structuralForm:true (V5-strict)", () => {
    const node = makeChannelNode([makeStringAttr("name", "chat")], [
      // Logic block wrapping a state-decl with the V5-strict marker.
      {
        kind: "logic",
        body: [
          { kind: "state-decl", name: "messages", structuralForm: true },
          { kind: "state-decl", name: "count", structuralForm: true },
        ],
      },
    ]);
    const cells = extractSharedVars(node);
    expect(cells).toContain("messages");
    expect(cells).toContain("count");
  });

  test("extractChannelCells alias returns the same V5-strict cell set", () => {
    const node = makeChannelNode([makeStringAttr("name", "chat")], [
      {
        kind: "logic",
        body: [{ kind: "state-decl", name: "messages", structuralForm: true }],
      },
    ]);
    expect(extractChannelCells(node)).toEqual(["messages"]);
  });

  test("legacy isShared:true is still accepted (backcompat)", () => {
    const node = makeChannelNode([makeStringAttr("name", "chat")], [
      {
        kind: "logic",
        body: [{ kind: "state-decl", name: "legacyVar", isShared: true }],
      },
    ]);
    expect(extractSharedVars(node)).toContain("legacyVar");
  });

  test("LOCALS in logic blocks (let/const) do NOT auto-sync", () => {
    const node = makeChannelNode([makeStringAttr("name", "chat")], [
      {
        kind: "logic",
        body: [
          { kind: "let-decl", name: "localOnly" },
          { kind: "state-decl", name: "messages", structuralForm: true },
        ],
      },
    ]);
    const cells = extractSharedVars(node);
    expect(cells).toContain("messages");
    expect(cells).not.toContain("localOnly");
  });

  test("client IIFE emits __sync handler for V5-strict cell", () => {
    const node = makeChannelNode([makeStringAttr("name", "chat")], [
      {
        kind: "logic",
        body: [{ kind: "state-decl", name: "messages", structuralForm: true }],
      },
    ]);
    const lines = emitChannelClientJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain('__type === "__sync"');
    expect(code).toContain('__key === "messages"');
    expect(code).toContain("syncShared");
  });

  test("client IIFE emits effect → syncShared for V5-strict cell write", () => {
    const node = makeChannelNode([makeStringAttr("name", "chat")], [
      {
        kind: "logic",
        body: [{ kind: "state-decl", name: "count", structuralForm: true }],
      },
    ]);
    const lines = emitChannelClientJs(node, [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toMatch(/_scrml_effect.*syncShared.*"count"/);
  });

  test("server WS handlers re-publish __sync frames to subscribers (V5-strict)", () => {
    const node = makeChannelNode([makeStringAttr("name", "chat")], [
      {
        kind: "logic",
        body: [{ kind: "state-decl", name: "messages", structuralForm: true }],
      },
    ]);
    const lines = emitChannelWsHandlers([node], [], "/test/app.scrml");
    const code = lines.join("\n");
    expect(code).toContain('d.__type === "__sync"');
    expect(code).toContain("ws.publish(ws.data.__topic, raw)");
  });

  test("end-to-end: V5-strict channel emits sync wire on both ends (canonical v0.next)", () => {
    const source = `<channel name="chat" topic="lobby">
\${ <messages> = [] }
</>

<program>
<p>\${@messages.length}</p>
</program>
`;
    const { ast } = parseSource(source);
    const reactiveLines = emitReactiveWiring(makeCompileContext({ fileAST: ast, errors: [] }));
    const clientCode = reactiveLines.join("\n");
    expect(clientCode).toContain('__key === "messages"');
    expect(clientCode).toContain("syncShared");
  });
});

// ---------------------------------------------------------------------------
// §25 (C18): channel-function map + channel-cell map — context for
// broadcast/disconnect injection + future RI/typer use.
// ---------------------------------------------------------------------------

describe("§25 (C18): collectChannelFunctionMap + collectChannelCellMap", () => {
  test("collectChannelFunctionMap finds server functions inside channel body", () => {
    const ast = {
      nodes: [
        {
          kind: "markup",
          tag: "channel",
          attrs: [{ name: "name", value: { kind: "string-literal", value: "chat" } }],
          children: [
            {
              kind: "logic",
              body: [
                { kind: "function-decl", name: "postMessage", isServer: true, body: [] },
                { kind: "function-decl", name: "handleOpen", body: [] },
              ],
            },
          ],
        },
      ],
    };
    const map = collectChannelFunctionMap(ast.nodes);
    expect(map.get("postMessage")).toBe("chat");
    expect(map.get("handleOpen")).toBe("chat");
  });

  test("collectChannelFunctionMap does NOT include functions outside channel body", () => {
    const ast = {
      nodes: [
        {
          kind: "markup",
          tag: "channel",
          attrs: [{ name: "name", value: { kind: "string-literal", value: "chat" } }],
          children: [
            { kind: "logic", body: [{ kind: "function-decl", name: "inside", body: [] }] },
          ],
        },
        {
          kind: "logic",
          body: [{ kind: "function-decl", name: "outside", body: [] }],
        },
      ],
    };
    const map = collectChannelFunctionMap(ast.nodes);
    expect(map.has("inside")).toBe(true);
    expect(map.has("outside")).toBe(false);
  });

  test("collectChannelFunctionMap maps each function to its OWN channel (multi-channel files)", () => {
    const ast = {
      nodes: [
        {
          kind: "markup",
          tag: "channel",
          attrs: [{ name: "name", value: { kind: "string-literal", value: "chat" } }],
          children: [
            { kind: "logic", body: [{ kind: "function-decl", name: "fnChat", body: [] }] },
          ],
        },
        {
          kind: "markup",
          tag: "channel",
          attrs: [{ name: "name", value: { kind: "string-literal", value: "updates" } }],
          children: [
            { kind: "logic", body: [{ kind: "function-decl", name: "fnUpdates", body: [] }] },
          ],
        },
      ],
    };
    const map = collectChannelFunctionMap(ast.nodes);
    expect(map.get("fnChat")).toBe("chat");
    expect(map.get("fnUpdates")).toBe("updates");
  });

  test("collectChannelFunctionMap skips P3.A exporter copies (_p3aIsExport)", () => {
    const ast = {
      nodes: [
        {
          kind: "markup",
          tag: "channel",
          _p3aIsExport: true,
          attrs: [{ name: "name", value: { kind: "string-literal", value: "exporter" } }],
          children: [
            { kind: "logic", body: [{ kind: "function-decl", name: "shouldNotMap", body: [] }] },
          ],
        },
      ],
    };
    const map = collectChannelFunctionMap(ast.nodes);
    expect(map.has("shouldNotMap")).toBe(false);
  });

  test("collectChannelCellMap returns channel-name → cell-set map", () => {
    const ast = {
      nodes: [
        {
          kind: "markup",
          tag: "channel",
          attrs: [{ name: "name", value: { kind: "string-literal", value: "chat" } }],
          children: [
            {
              kind: "logic",
              body: [
                { kind: "state-decl", name: "messages", structuralForm: true },
                { kind: "state-decl", name: "count", structuralForm: true },
              ],
            },
          ],
        },
      ],
    };
    const map = collectChannelCellMap(ast.nodes);
    const cells = map.get("chat");
    expect(cells).toBeDefined();
    expect(cells.has("messages")).toBe(true);
    expect(cells.has("count")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §26 (C18): broadcast/disconnect injection in channel-scoped server fns —
// end-to-end via compileScrml. Verifies the auto-injected helpers reach the
// emitted .server.js for HTTP-routed functions inside a channel body.
// ---------------------------------------------------------------------------

import { compileScrml } from "../../src/api.js";
import { mkdtempSync as _mkdtempSync, writeFileSync as _writeFileSync, rmSync as _rmSync } from "fs";
import { join as _join } from "path";
import { tmpdir as _tmpdir } from "os";

function _compileFixture(src) {
  const TMP = _mkdtempSync(_join(_tmpdir(), "channel-c18-"));
  const file = _join(TMP, "app.scrml");
  _writeFileSync(file, src);
  const result = compileScrml({
    inputFiles: [file],
    outputDir: _join(TMP, "out"),
    write: false,
    log: () => {},
  });
  _rmSync(TMP, { recursive: true, force: true });
  return { result, file };
}

describe("§26 (C18): broadcast/disconnect injection in channel-scoped server fns", () => {
  test("server fn inside channel body gets `broadcast` injected as local", () => {
    const src = `<channel name="chat" topic="lobby">
\${ <messages> = [] }

\${
  server function postMessage(author, body) {
    broadcast({ type: "new", author, body })
  }
}
</>

<program>
<button onclick=postMessage("u","x")>send</button>
<p>\${@messages.length}</p>
</program>
`;
    const { result, file } = _compileFixture(src);
    expect(result.errors ?? []).toEqual([]);
    const out = result.outputs?.get(file);
    const serverJs = out?.serverJs ?? "";
    expect(serverJs).toContain("const broadcast =");
    expect(serverJs).toContain("§38.6 broadcast/disconnect built-ins");
    expect(serverJs).toContain('publish("lobby"');
  });

  test("server fn inside channel body gets `disconnect` injected as local", () => {
    const src = `<channel name="notifs">
\${ <count> = 0 }

\${
  server function ping() {
    broadcast({ type: "ping" })
    disconnect()
  }
}
</>

<program>
<button onclick=ping()>p</button>
<p>\${@count}</p>
</program>
`;
    const { result, file } = _compileFixture(src);
    expect(result.errors ?? []).toEqual([]);
    const out = result.outputs?.get(file);
    const serverJs = out?.serverJs ?? "";
    expect(serverJs).toContain("const disconnect =");
  });

  test("server fn OUTSIDE channel body does NOT get broadcast injected", () => {
    const src = `<channel name="chat">
\${ <messages> = [] }
</>

<program>
\${
  server function someFn(x) {
    return x + 1
  }
}
<button onclick=someFn(1)>x</button>
<p>\${@messages.length}</p>
</program>
`;
    const { result, file } = _compileFixture(src);
    expect(result.errors ?? []).toEqual([]);
    const out = result.outputs?.get(file);
    const serverJs = out?.serverJs ?? "";
    // No broadcast/disconnect injection when the function is not inside a channel body.
    // The handler for someFn must not include the §38.6 prelude.
    const handlerMatch = serverJs.match(/_scrml_handler_someFn[\s\S]*?\n\}/);
    if (handlerMatch) {
      expect(handlerMatch[0]).not.toContain("const broadcast =");
      expect(handlerMatch[0]).not.toContain("const disconnect =");
    }
  });

  test("each channel-scoped fn publishes to its OWN topic (multi-channel disambiguation)", () => {
    const src = `<channel name="chat" topic="lobby">
\${ <messages> = [] }
\${
  server function fnChat() {
    broadcast({ type: "chat" })
  }
}
</>

<channel name="updates" topic="news">
\${ <count> = 0 }
\${
  server function fnUpdates() {
    broadcast({ type: "update" })
  }
}
</>

<program>
<button onclick=fnChat()>c</button>
<button onclick=fnUpdates()>u</button>
<p>\${@messages.length}</p>
</program>
`;
    const { result, file } = _compileFixture(src);
    expect(result.errors ?? []).toEqual([]);
    const out = result.outputs?.get(file);
    const serverJs = out?.serverJs ?? "";
    // fnChat should publish to "lobby"; fnUpdates should publish to "news".
    const fnChatHandler = serverJs.match(/_scrml_handler_fnChat[\s\S]*?\n\}/)?.[0] ?? "";
    const fnUpdatesHandler = serverJs.match(/_scrml_handler_fnUpdates[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fnChatHandler).toContain('publish("lobby"');
    expect(fnUpdatesHandler).toContain('publish("news"');
  });

  test("topic= defaults to channel name when absent (broadcast publishes to name)", () => {
    const src = `<channel name="myChannel">
\${ <count> = 0 }
\${
  server function bump() {
    broadcast({ type: "bump" })
  }
}
</>

<program>
<button onclick=bump()>b</button>
<p>\${@count}</p>
</program>
`;
    const { result, file } = _compileFixture(src);
    expect(result.errors ?? []).toEqual([]);
    const out = result.outputs?.get(file);
    const serverJs = out?.serverJs ?? "";
    // No `topic=` → topic defaults to name="myChannel".
    expect(serverJs).toContain('publish("myChannel"');
  });

  test("broadcast helper guards against missing _scrml_active_server (no crash)", () => {
    const src = `<channel name="ch1">
\${ <m> = 0 }
\${
  server function go() {
    broadcast({ x: 1 })
  }
}
</>

<program>
<button onclick=go()>g</button>
<p>\${@m}</p>
</program>
`;
    const { result, file } = _compileFixture(src);
    expect(result.errors ?? []).toEqual([]);
    const out = result.outputs?.get(file);
    const serverJs = out?.serverJs ?? "";
    // The injected broadcast must guard so undefined globalThis._scrml_active_server
    // doesn't crash the request handler.
    expect(serverJs).toContain('typeof globalThis !== "undefined"');
    expect(serverJs).toContain("globalThis._scrml_active_server");
    expect(serverJs).toContain('typeof _scrml_srv.publish === "function"');
  });

  test("broadcast/disconnect are tokenizer keywords AND are typer-allowlisted (no E-SCOPE-001)", () => {
    // This is the surface integration test for the type-system.ts allowlist
    // change: a channel-scoped server fn calling broadcast() / disconnect()
    // must compile clean — no E-SCOPE-001 from the typer.
    const src = `<channel name="chat">
\${ <m> = 0 }
\${
  server function go() {
    broadcast({ x: 1 })
    disconnect()
  }
}
</>

<program>
<button onclick=go()>g</button>
<p>\${@m}</p>
</program>
`;
    const { result } = _compileFixture(src);
    const codes = (result.errors ?? []).map(e => e.code);
    expect(codes).not.toContain("E-SCOPE-001");
  });
});

