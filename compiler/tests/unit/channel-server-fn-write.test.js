/**
 * Bug 5 — channel-scoped `@cell` writes inside server functions
 *
 * S83 Wave 4A. Pairs with C18 (§38.4 — Bug 5 follow-on).
 *
 * Per SPEC §38.4 line 15998 (normative): "The compiler SHALL emit sync
 * wire-format messages on every write to a channel-declared cell.
 * The wire-format SHALL be `{ __type: "__sync", __key: <name>, __val:
 * <value> }`."
 *
 * Before this fix, RI fired E-RI-002 on every channel-scoped server-fn
 * that wrote to a channel cell because the server module would have
 * referenced the client-only `_scrml_reactive_set` helper and crashed
 * at request time. The fix is two-part:
 *   1. RI skips E-RI-002 when (a) the server-fn is declared inside a
 *      `<channel>` body AND (b) the LHS cell of the write is one of
 *      that channel's V5-strict cells (`<name> = init` decls).
 *   2. Codegen (emit-logic state-decl + bare-expr server arm) lowers
 *      the write to `broadcast({__type:"__sync",__key,__val})` — the
 *      canonical SPEC §38.4 wire frame. `broadcast(...)` is auto-
 *      injected as a local in channel-owned server-fn emit by
 *      emit-server.ts:emitBroadcastInjection.
 *
 * Coverage:
 *   §1  Positive — channel server-fn writes a channel cell:
 *       no E-RI-002; server JS contains the broadcast wire frame.
 *   §2  Negative — non-channel server-fn writes a state cell:
 *       E-RI-002 still fires (the legacy diagnostic is preserved
 *       for genuine client-only reactive state).
 *   §3  Negative — channel server-fn writes a NON-channel cell
 *       (e.g. a cell declared inside `<program>`): E-RI-002 still
 *       fires. The skip is narrow to channel-owned cells only —
 *       there is no broadcast path for `<program>`-scoped cells.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// OS-portable temp root (see note in s144 test): hardcoded "/tmp/…" is drive-less
// on Windows and mismatches the compiler's resolve()-to-absolute output key.
const TMP_ROOT = join(tmpdir(), "scrml-bug5-tests");

function setupDir(name) {
  const dir = join(TMP_ROOT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function teardownDir(name) {
  rmSync(join(TMP_ROOT, name), { recursive: true, force: true });
}

function compile(dir, fileName, source) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, source);
  return compileScrml({
    inputFiles: [filePath],
    outputDir: join(dir, "dist"),
    write: false,
  });
}

function errorsByCode(result, code) {
  return (result.errors ?? []).filter((e) => e.code === code);
}

function serverJsFor(result, dir, fileName) {
  const filePath = join(dir, fileName);
  const out = result.outputs?.get(filePath);
  return out?.serverJs ?? "";
}

// ---------------------------------------------------------------------------
// §1 — Positive: channel server-fn writes channel cell
// ---------------------------------------------------------------------------

describe("§1 channel-scoped server-fn writes a channel cell — broadcast wire", () => {
  const NAME = "positive-broadcast";
  let dir;
  beforeEach(() => { dir = setupDir(NAME); });
  afterEach(() => { teardownDir(NAME); });

  test("no E-RI-002 + server JS emits broadcast({__type:'__sync',__key,__val}) frame", () => {
    const source = `<channel name="chat" topic="lobby">
\${
  <messages> = []

  server function postMessage(author, body) {
    @messages = [...@messages, { author, body }]
  }
}
</>

<program>
\${
  <draft> = ""
  function send() {
    postMessage("u", @draft)
  }
}
<button onclick=send()>Send</button>
</program>`;

    const result = compile(dir, "app.scrml", source);

    // RI gate: no E-RI-002 for the channel-owned write.
    expect(errorsByCode(result, "E-RI-002")).toHaveLength(0);

    // Codegen: the server JS module emits the canonical broadcast wire
    // frame for the channel-cell write (SPEC §38.4 line 15998 normative).
    const serverJs = serverJsFor(result, dir, "app.scrml");
    expect(serverJs).toContain("broadcast({");
    expect(serverJs).toContain('__type: "__sync"');
    expect(serverJs).toContain('__key: "messages"');
    expect(serverJs).toContain("__val:");

    // The previous broken emission — `_scrml_reactive_set("messages", ...)` —
    // must no longer appear in the `postMessage` handler body. (The client
    // module still emits it inside the per-client reactive store, but the
    // server is broadcast-only for channel writes.)
    const handlerStart = serverJs.indexOf("_scrml_handler_postMessage");
    expect(handlerStart).toBeGreaterThan(-1);
    const handlerEnd = serverJs.indexOf("export const", handlerStart);
    const handlerSlice = serverJs.slice(
      handlerStart,
      handlerEnd === -1 ? serverJs.length : handlerEnd,
    );
    expect(handlerSlice).not.toContain("_scrml_reactive_set");
    expect(handlerSlice).toContain("broadcast({");
  });
});

// ---------------------------------------------------------------------------
// §2 — Negative: non-channel server-fn write still fires E-RI-002
// ---------------------------------------------------------------------------

describe("§2 non-channel server-fn writes a state cell — E-RI-002 preserved", () => {
  const NAME = "negative-non-channel";
  let dir;
  beforeEach(() => { dir = setupDir(NAME); });
  afterEach(() => { teardownDir(NAME); });

  test("explicit-server fn writes @state in <program> — E-RI-002 fires", () => {
    // Explicit `server` keyword + plain reactive write. The function has
    // no separate server stmt, so CPS cannot split (no `serverIndices`).
    // E-RI-002 must fire — this is the canonical legacy diagnostic for
    // client-only reactive state writes from a server-escalated function.
    const source = `<program>
\${
  <count> = 0

  server function bumpCount() {
    @count = @count + 1
  }

  function onClick() {
    bumpCount()
  }
}
<button onclick=onClick()>Bump</button>
</program>`;

    const result = compile(dir, "app.scrml", source);

    const riErrs = errorsByCode(result, "E-RI-002");
    expect(riErrs.length).toBeGreaterThanOrEqual(1);
    expect(riErrs[0].message).toContain("E-RI-002");
    expect(riErrs[0].message).toContain("bumpCount");
  });
});

// ---------------------------------------------------------------------------
// §3 — Negative: channel server-fn writes a NON-channel cell — E-RI-002 fires
// ---------------------------------------------------------------------------

describe("§3 channel server-fn writes a non-channel cell — E-RI-002 still fires", () => {
  const NAME = "negative-mixed-write";
  let dir;
  beforeEach(() => { dir = setupDir(NAME); });
  afterEach(() => { teardownDir(NAME); });

  test("server-fn inside <channel> writes a <program>-scoped @cell — E-RI-002", () => {
    // The skip is narrow: it applies only to writes whose LHS is one of the
    // V5-strict channel-cells declared in the function's owning channel
    // body. A write to a `<program>`-scoped cell from inside a channel-owned
    // server fn has no broadcast path — the cell isn't auto-synced and
    // there is no server-side replica to update. E-RI-002 fires.
    //
    // The fn is server-escalated by explicit `server` annotation and writes
    // to a non-channel cell `@counter`. The non-channel write must fire
    // E-RI-002.
    const source = `<channel name="chat">
\${
  <messages> = []

  server function postAndCount(text) {
    @counter = @counter + 1
  }
}
</>

<program>
\${
  <counter> = 0
  function onClick() {
    postAndCount("hi")
  }
}
<button onclick=onClick()>Post</button>
</program>`;

    const result = compile(dir, "app.scrml", source);

    // E-RI-002 must still fire for the non-channel-cell write.
    // (`@counter` is declared in `<program>`, not in the channel body.)
    const riErrs = errorsByCode(result, "E-RI-002");
    expect(riErrs.length).toBeGreaterThanOrEqual(1);
    expect(riErrs[0].message).toContain("E-RI-002");
    expect(riErrs[0].message).toContain("postAndCount");
  });
});
