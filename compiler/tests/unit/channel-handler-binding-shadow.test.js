/**
 * E-CHANNEL-HANDLER-SHADOW (code PA-named S460, veto window) — an `onclient:*` call's binding
 * name SHALL NOT name a declaration in scope at the `<channel>` (SPEC §38.10.2;
 * S458 ruling "your recs on all four" item 1: "a first-argument name that collides
 * with a declaration in scope is an ERROR (no silent shadowing)").
 *
 * `onclient:open=onOpen(x)` with `<x>` declared compiled to
 * `_ws.onopen = (x) => { onOpen(x) }` — the author reads it as "pass my x"; the
 * handler receives the WS event. Judged against the type stage's scope chain,
 * captured at the channel and evaluated after the file walk (so a declaration that
 * follows the channel in source order counts).
 *
 * Check site: type-system.ts `checkChannelHandlerBindings` + the deferred judge
 * after the annotateNodes main walk.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "channel-handler-shadow-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

const CODE = "E-CHANNEL-HANDLER-SHADOW";

function compile(src) {
  const fp = join(TMP, `f-${Math.random().toString(36).slice(2)}.scrml`);
  writeFileSync(fp, src);
  return compileScrml({ inputFiles: [fp], outputDir: join(TMP, "dist"), write: false, log: () => {} });
}

function shadow(res) {
  return [...(res.errors || []), ...(res.warnings || [])].filter((d) => d.code === CODE);
}

describe(`${CODE} — the binding name collides with a declaration in scope`, () => {
  test("a program-level state cell (the S458 origin shape)", () => {
    const res = compile(`<program>
  <x> = 5
  <channel name="chat" onclient:open=onOpen(x)>
    <count> = 0
    function onOpen(e) { @count = 1 }
  </>
  <p>\${@count} \${@x}</p>
</program>`);
    const d = shadow(res);
    expect(d.length).toBe(1);
    expect(d[0].message).toContain("state cell `<x>`");
    // The advice reads a cell with its sigil.
    expect(d[0].message).toContain("write `@x` inside `onOpen`");
    expect((res.errors || []).some((e) => e.code === CODE)).toBe(true);
  });

  test("a state cell declared LATER in the file (cells hoist, §6.9)", () => {
    const res = compile(`<program>
  <channel name="chat" onclient:open=onOpen(later)>
    <count> = 0
    function onOpen(e) { @count = @later }
  </channel>
  <p>\${@count}</p>
  <later> = 1
</program>`);
    expect(shadow(res).length).toBe(1);
  });

  test("a function declared later inside a <page> (functions hoist)", () => {
    const res = compile(`<program>
  <channel name="chat" onclient:open=onOpen(helper)>
    <count> = 0
    function onOpen(ev) { @count = helper() }
  </channel>
  <page>
    \${ function helper() { return 1 } }
    <p>\${helper()} \${@count}</p>
  </page>
</program>`);
    expect(shadow(res).length).toBe(1);
  });

  test("a cell declared in the channel's own body", () => {
    const res = compile(`<program>
  <channel name="chat" onclient:open=onOpen(count)>
    <count> = 0
    function onOpen(e) { @count = 1 }
  </>
  <p>\${@count}</p>
</program>`);
    expect(shadow(res).length).toBe(1);
  });

  test("a function declared AFTER the channel (source order does not matter)", () => {
    const res = compile(`<program>
  <channel name="chat" onclient:close=onClose(helper)>
    <count> = 0
    function onClose(e) { @count = 1 }
  </>
  function helper() { return 1 }
  <p>\${@count} \${helper()}</p>
</program>`);
    const d = shadow(res);
    expect(d.length).toBe(1);
    expect(d[0].message).toContain("function `helper`");
  });

  test("the handler's own name", () => {
    const res = compile(`<program>
  <channel name="chat" onclient:error=onError(onError)>
    <count> = 0
    function onError(e) { @count = 1 }
  </>
  <p>\${@count}</p>
</program>`);
    expect(shadow(res).length).toBe(1);
  });

  test("a program-body const", () => {
    const res = compile(`<program>
  const limit = 3
  <channel name="chat" onclient:open=onOpen(limit)>
    <count> = 0
    function onOpen(e) { @count = limit }
  </>
  <p>\${@count}</p>
</program>`);
    expect(shadow(res).length).toBe(1);
  });

  test("an import", () => {
    const res = compile(`<program>
  import { formatDate } from "scrml:time"
  <channel name="chat" onclient:open=onOpen(formatDate)>
    <count> = 0
    function onOpen(e) { @count = 1 }
  </>
  <p>\${@count} \${formatDate(1)}</p>
</program>`);
    const d = shadow(res);
    expect(d.length).toBe(1);
    expect(d[0].message).toContain("import `formatDate`");
  });
});

describe(`${CODE} — clean`, () => {
  test("fresh binding names on every onclient:* attribute", () => {
    const res = compile(`<program>
  <channel name="chat" onclient:open=onOpen(e) onclient:close=onClose() onclient:error=onError(err)>
    <count> = 0
    function onOpen(e) { @count = 1 }
    function onClose() { @count = 2 }
    function onError(err) { @count = 3 }
  </>
  <p>\${@count}</p>
</program>`);
    expect(shadow(res)).toEqual([]);
    expect(res.errors || []).toEqual([]);
  });

  test("a name used only as ANOTHER function's parameter is not in scope at the channel", () => {
    const res = compile(`<program>
  function other(e) { return e }
  <channel name="chat" onclient:open=onOpen(e)>
    <count> = 0
    function onOpen(ev) { @count = other(ev) }
  </>
  <p>\${@count}</p>
</program>`);
    expect(shadow(res)).toEqual([]);
  });

  // S460 review F2 — only a declaration VISIBLE at the channel collides. A
  // const / let declared later in the file is not (reading it there is E-SCOPE-001).
  for (const [label, decl] of [
    ["a later program-level `${ const K }`", "${ const K = 3 }"],
    ["a later `${ let K }`", "${ let K = 3 }"],
    ["a later const inside a <div>", "<div>${ const K = 1 }</div>"],
  ]) {
    test(`${label} is not visible at the channel`, () => {
      const res = compile(`<program>
  <channel name="chat" onclient:open=onOpen(K)>
    <count> = 0
    function onOpen(e) { @count = 1 }
  </channel>
  ${decl}
  <p>\${@count}</p>
</program>`);
      expect(shadow(res)).toEqual([]);
    });
  }

  test("a binding inside a string-with-comma argument is not a binding", () => {
    const res = compile(`<program>
  <x> = 1
  <channel name="chat" onclient:open=onOpen('x,y')>
    <count> = 0
    function onOpen(v) { @count = @x }
  </channel>
  <p>\${@count}</p>
</program>`);
    expect(shadow(res)).toEqual([]);
  });

  test("a type name is a separate namespace", () => {
    const res = compile(`<program>
  type Mode:enum = { A, B }
  <channel name="chat" onclient:open=onOpen(Mode)>
    <count> = 0
    function onOpen(v) { @count = 1 }
  </>
  <p>\${@count}</p>
</program>`);
    expect(shadow(res)).toEqual([]);
  });

  test("onserver:message is outside the ruling — a colliding payload name is not this code", () => {
    const res = compile(`<program>
  <channel name="chat" onserver:message=handleMessage(count)>
    <count> = 0
    function handleMessage(msg) { broadcast({ body: msg }) }
  </>
  <p>\${@count}</p>
</program>`);
    expect(shadow(res)).toEqual([]);
  });
});
