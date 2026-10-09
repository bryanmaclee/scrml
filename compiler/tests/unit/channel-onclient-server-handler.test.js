/**
 * E-CHANNEL-006 — an `onclient:*` handler SHALL NOT be declared `server function`
 * (SPEC §38.10.3: "A function designated as the handler for an `onclient:*`
 * attribute SHALL NOT be declared `server function`. The compiler SHALL emit
 * E-CHANNEL-006 and reject the program."; §34 / §38.9 catalog row).
 *
 * Before S461 no compiler source emitted the code: `onclient:open=onOpen()` with
 * `server function onOpen()` compiled, and the browser listener called the fetch
 * stub `_scrml_fetch_onOpen_<n>()` — a POST round-trip on every socket open.
 *
 * Check site: type-system.ts `checkClientHandlerNotServer` (called from
 * `checkChannelHandlerBindings`). The handler name is resolved to its DECLARATION
 * (channel body, then file, then import) and judged by the declaration's `server`
 * keyword (`isServer`).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "channel-onclient-server-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

const CODE = "E-CHANNEL-006";

/** Compile `files` (name → source); the first entry is the entry file. */
function compileFiles(files) {
  const dir = join(TMP, `d-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const names = Object.keys(files);
  for (const n of names) writeFileSync(join(dir, n), files[n]);
  return compileScrml({ inputFiles: [join(dir, names[0])], outputDir: join(dir, "dist"), write: false, log: () => {} });
}

function compile(src) {
  return compileFiles({ "app.scrml": src });
}

function hits(res) {
  return [...(res.errors || []), ...(res.warnings || [])].filter((d) => d.code === CODE);
}

describe(`${CODE} — an onclient:* handler declared server function`, () => {
  test("`server function` declared in the channel body (onclient:open)", () => {
    const res = compile(`<program>
  <channel name="chat" onclient:open=onOpen()>
    <count> = 0
    server function onOpen() {
      @count = 1
    }
  </channel>
  <p>\${@count}</p>
</program>`);
    const d = hits(res);
    expect(d.length).toBe(1);
    expect(d[0].message).toContain("`onclient:open`");
    expect(d[0].message).toContain("`onOpen`");
    expect(d[0].message).toContain("declared `server function`");
    expect(d[0].message).toContain("Declare `onOpen` a plain `function`");
    expect((res.errors || []).some((e) => e.code === CODE)).toBe(true);
  });

  test("`server fn` declared at file top level (onclient:close)", () => {
    const res = compile(`<program>
  \${
    server fn onClose(e) {
      return 1
    }
  }
  <channel name="chat" onclient:close=onClose(e)>
    <count> = 0
  </channel>
  <p>\${@count}</p>
</program>`);
    const d = hits(res);
    expect(d.length).toBe(1);
    expect(d[0].message).toContain("`onclient:close`");
    expect(d[0].message).toContain("declared `server fn`");
    expect(d[0].message).toContain("a plain `fn`");
  });

  test("onclient:error with a server function handler", () => {
    const res = compile(`<program>
  <channel name="chat" onclient:error=onErr(err)>
    <count> = 0
    server function onErr(err) {
      @count = 2
    }
  </channel>
  <p>\${@count}</p>
</program>`);
    expect(hits(res).length).toBe(1);
    expect(hits(res)[0].message).toContain("`onclient:error`");
  });

  test("each onclient:* attribute naming a server function is reported", () => {
    const res = compile(`<program>
  <channel name="chat" onclient:open=onOpen() onclient:close=onClose(e)>
    <count> = 0
    server function onOpen() {
      @count = 1
    }
    server function onClose(e) {
      @count = 0
    }
  </channel>
  <p>\${@count}</p>
</program>`);
    expect(hits(res).length).toBe(2);
  });

  test("an IMPORTED `export server function` (resolved to the exporter's declaration)", () => {
    const res = compileFiles({
      "app.scrml": `<program>
  \${ import { onErr } from './helpers.scrml' }
  <channel name="chat" onclient:error=onErr(e)>
    <count> = 0
  </channel>
  <p>\${@count}</p>
</program>`,
      "helpers.scrml": `\${
  export server function onErr(e) {
    return 1
  }
}`,
    });
    const d = hits(res);
    expect(d.length).toBe(1);
    expect(d[0].message).toContain("imported from `helpers.scrml`");
  });

  test("an import reached through a re-export", () => {
    const res = compileFiles({
      "app.scrml": `<program>
  \${ import { onErr } from './reexp.scrml' }
  <channel name="chat" onclient:error=onErr(e)>
    <count> = 0
  </channel>
  <p>\${@count}</p>
</program>`,
      "reexp.scrml": `\${
  export { onErr } from './helpers.scrml'
}`,
      "helpers.scrml": `\${
  export server function onErr(e) {
    return 1
  }
}`,
    });
    expect(hits(res).length).toBe(1);
  });

  test("an exported channel in a module is judged in the exporter, once", () => {
    const res = compileFiles({
      "app.scrml": `<program>
  \${ import { chat as Chat } from './chan.scrml' }
  <Chat/>
  <p>hi</p>
</program>`,
      "chan.scrml": `export <channel name="chat" onclient:open=onOpen()>
  \${
    <count> = 0
    server function onOpen() {
      @count = 1
    }
  }
</>`,
    });
    const d = hits(res);
    expect(d.length).toBe(1);
    expect(String(d[0].span?.file ?? "")).toContain("chan.scrml");
  });
});

describe(`${CODE} — clean negatives`, () => {
  test("a plain `function` handler compiles clean", () => {
    const res = compile(`<program>
  <channel name="chat" onclient:open=onOpen(e)>
    <count> = 0
    function onOpen(e) {
      @count = 1
    }
  </channel>
  <p>\${@count}</p>
</program>`);
    expect(hits(res).length).toBe(0);
    expect((res.errors || []).length).toBe(0);
  });

  test("a server function named by onserver:message stays legal", () => {
    const res = compile(`<program>
  <channel name="chat" onclient:open=onOpen(e) onserver:message=onMsg(msg)>
    <count> = 0
    function onOpen(e) {
      @count = 1
    }
    server function onMsg(msg) {
      broadcast(msg)
    }
  </channel>
  <p>\${@count}</p>
</program>`);
    expect(hits(res).length).toBe(0);
    expect((res.errors || []).length).toBe(0);
  });

  test("a local plain function shadows an imported server function of the same name", () => {
    const res = compileFiles({
      "app.scrml": `<program>
  <channel name="chat" onclient:error=onErr(e)>
    <count> = 0
    function onErr(e) {
      @count = 1
    }
  </channel>
  <p>\${@count}</p>
</program>`,
      "helpers.scrml": `\${
  export server function onErr(e) {
    return 1
  }
}`,
    });
    expect(hits(res).length).toBe(0);
  });

  test("a server function that is NOT the handler does not fire", () => {
    const res = compile(`<program>
  <channel name="chat" onclient:open=onOpen(e)>
    <count> = 0
    function onOpen(e) {
      @count = 1
    }
    server function unrelated() {
      return 1
    }
  </channel>
  <p>\${@count}</p>
</program>`);
    expect(hits(res).length).toBe(0);
  });
});
