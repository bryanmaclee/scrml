/**
 * §12.2 Trigger 7 (D2, server-keyword-eliminate-2026-06-10) — channel-cell-write
 * / broadcast() / disconnect() escalation.
 *
 * A standalone `function` DECLARATION lexically inside a `<channel>` body
 * escalates to the server boundary WITHOUT the deprecated `server` keyword when
 * its body either (a) WRITES a channel-declared cell, or (b) calls
 * `broadcast(...)` / `disconnect()`. This breaks the keyword's last hold on
 * channel publishers (the §12.2 Trigger-4 note's "every case the keyword
 * previously communicated" claim is now complete with Triggers 7+8).
 *
 * Over-fire guards (LOAD-BEARING — §38.4 allows client-originated writes too;
 * channel bodies hold onclient:/onserver: ATTRIBUTE handlers):
 *   §1  POSITIVE — keyword-less channel publisher writing a channel cell escalates server.
 *   §2  POSITIVE — keyword-less channel publisher calling broadcast() escalates server.
 *   §3  GUARD    — a channel-scope READ-ONLY function does NOT escalate via Trigger 7.
 *   §4  GUARD    — a non-channel function (outside any <channel> scope) is unaffected.
 *   §5  PARITY   — a channel publisher WITH the `server` keyword still escalates.
 */

import { describe, test, expect } from "bun:test";
import { runRI } from "../../src/route-inference.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

function parseFileAST(source, filePath = "/test/chan.scrml") {
  const bs = splitBlocks(filePath, source);
  const tab = buildAST(bs);
  const ast = tab.ast;
  return {
    filePath,
    nodes: ast.nodes ?? [],
    ast,
    imports: ast.imports ?? [],
    exports: ast.exports ?? [],
    components: ast.components ?? [],
    typeDecls: ast.typeDecls ?? [],
    spans: ast.spans ?? new Map(),
  };
}

function runRIClean(fileAST) {
  return runRI({ files: [fileAST], protectAnalysis: { views: new Map() } });
}

/** Find the route-map entry for a function by NAME (matches functionNodeId suffix). */
function routeForFn(routeMap, fnName, fileAST) {
  for (const [, route] of routeMap.functions) {
    // functionNodeId = "{filePath}::{span.start}". Resolve by scanning the AST
    // for the function-decl with this name and matching its span.start.
    let target = null;
    function visit(nodes) {
      for (const n of nodes ?? []) {
        if (!n || typeof n !== "object") continue;
        if (n.kind === "function-decl" && n.name === fnName) { target = n; return; }
        if (Array.isArray(n.children)) visit(n.children);
        if (n.kind === "logic" && Array.isArray(n.body)) visit(n.body);
      }
    }
    visit(fileAST.nodes);
    if (target) {
      const id = `${fileAST.filePath}::${target.span.start}`;
      return routeMap.functions.get(id);
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// §1 — POSITIVE: keyword-less channel publisher writing a channel cell escalates
// ---------------------------------------------------------------------------

describe("Trigger 7 §1 — keyword-less channel-cell write escalates server", () => {
  test("function (no `server`) writing a channel cell gets boundary:server", () => {
    const source = `<program>
  <channel name="chat" topic="lobby">
    <count> = 0

    \${ function bump() {
      @count = @count + 1
    } }
  </>
</program>`;
    const fileAST = parseFileAST(source);
    const { routeMap } = runRIClean(fileAST);
    const route = routeForFn(routeMap, "bump", fileAST);
    expect(route).toBeDefined();
    expect(route.boundary).toBe("server");
    expect(route.escalationReasons.some(r => r.kind === "channel-broadcast")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2 — POSITIVE: keyword-less channel publisher calling broadcast() escalates
// ---------------------------------------------------------------------------

describe("Trigger 7 §2 — keyword-less broadcast() call escalates server", () => {
  test("function (no `server`) calling broadcast() gets boundary:server", () => {
    const source = `<program>
  <channel name="chat" topic="lobby">
    <count> = 0

    \${ function announce(text) {
      broadcast({ type: "msg", body: text })
    } }
  </>
</program>`;
    const fileAST = parseFileAST(source);
    const { routeMap } = runRIClean(fileAST);
    const route = routeForFn(routeMap, "announce", fileAST);
    expect(route).toBeDefined();
    expect(route.boundary).toBe("server");
    expect(route.escalationReasons.some(r => r.kind === "channel-broadcast")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §3 — GUARD: a channel-scope READ-ONLY function does NOT escalate via Trigger 7
// ---------------------------------------------------------------------------

describe("Trigger 7 §3 — channel-scope read-only function does NOT escalate", () => {
  test("function reading (not writing) a channel cell stays client", () => {
    const source = `<program>
  <channel name="chat" topic="lobby">
    <count> = 0

    \${ function readCount() {
      const c = @count
      return c
    } }
  </>
</program>`;
    const fileAST = parseFileAST(source);
    const { routeMap } = runRIClean(fileAST);
    const route = routeForFn(routeMap, "readCount", fileAST);
    expect(route).toBeDefined();
    // No write, no broadcast/disconnect → Trigger 7 must NOT fire.
    expect(route.escalationReasons.some(r => r.kind === "channel-broadcast")).toBe(false);
    // With no other trigger, the read-only fn stays client (a bare @-read is
    // not itself a server trigger).
    expect(route.boundary).not.toBe("server");
  });
});

// ---------------------------------------------------------------------------
// §4 — GUARD: a non-channel function is unaffected by Trigger 7
// ---------------------------------------------------------------------------

describe("Trigger 7 §4 — non-channel function unaffected", () => {
  test("function outside any <channel> scope writing a plain cell does not escalate via Trigger 7", () => {
    const source = `<program>
  <count> = 0

  \${ function bumpOutside() {
    @count = @count + 1
  } }
</program>`;
    const fileAST = parseFileAST(source);
    const { routeMap } = runRIClean(fileAST);
    const route = routeForFn(routeMap, "bumpOutside", fileAST);
    expect(route).toBeDefined();
    expect(route.escalationReasons.some(r => r.kind === "channel-broadcast")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §5 — PARITY: a channel publisher WITH the `server` keyword still escalates
// ---------------------------------------------------------------------------

describe("Trigger 7 §5 — keyword-bearing channel publisher still escalates", () => {
  test("server function writing a channel cell still gets boundary:server", () => {
    const source = `<program>
  <channel name="chat" topic="lobby">
    <count> = 0

    \${ server function bumpServer() {
      @count = @count + 1
    } }
  </>
</program>`;
    const fileAST = parseFileAST(source);
    const { routeMap } = runRIClean(fileAST);
    const route = routeForFn(routeMap, "bumpServer", fileAST);
    expect(route).toBeDefined();
    expect(route.boundary).toBe("server");
    // It now carries BOTH the explicit-annotation (keyword) AND the
    // channel-broadcast (Trigger 7) reasons — so the keyword is redundant.
    expect(route.escalationReasons.some(r => r.kind === "channel-broadcast")).toBe(true);
    expect(route.escalationReasons.some(r => r.kind === "explicit-annotation")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §6 — GUARD: an onclient: attribute handler is unaffected by Trigger 7
// ---------------------------------------------------------------------------

describe("Trigger 7 §6 — onclient: attribute handler unaffected", () => {
  test("an onclient: handler function that only reads a channel cell stays client", () => {
    // The onclient:open attribute references `onOpen`; `onOpen` reads (does not
    // write) the channel cell, so Trigger 7 must NOT escalate it. The attribute
    // itself is a string, not a function-decl — collectChannelFunctionMap only
    // walks function-decl nodes, so the attribute path is never an escalation site.
    const source = `<program>
  <channel name="chat" topic="lobby" onclient:open="onOpen()">
    <count> = 0

    \${ function onOpen() {
      const c = @count
      return c
    } }
  </>
</program>`;
    const fileAST = parseFileAST(source);
    const { routeMap } = runRIClean(fileAST);
    const route = routeForFn(routeMap, "onOpen", fileAST);
    expect(route).toBeDefined();
    expect(route.escalationReasons.some(r => r.kind === "channel-broadcast")).toBe(false);
    expect(route.boundary).not.toBe("server");
  });
});
