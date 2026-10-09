/**
 * E-CHANNEL-005 — a channel handler call binds at most ONE name (SPEC §38.6.1,
 * §38.10.2; S458 ruling "your recs on all four" item 1).
 *
 * `onserver:message=h(msg)` binds the parsed payload to `msg`; `onclient:open=h(e)`
 * binds the WS event object to `e`. A second argument has nothing to bind to:
 * before this check `onserver:message=h(msg, extra)` compiled at exit 0 and the
 * server emitted `await h(msg, extra)` with `extra` a free identifier (a
 * ReferenceError at the first message), and `onclient:open=onOpen(x, 1)` compiled
 * to `(x) => { onOpen(x, 1) }`. §38.6.1 already stated the `onserver:message`
 * rule (SHALL) — it had no emit site; the S458 ruling extends it to `onclient:*`.
 *
 * Check site: type-system.ts `checkChannelHandlerBindings` (the markup case of the
 * TS walk), over the parsed `call-ref` argument list.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "channel-handler-arity-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function compile(src) {
  const fp = join(TMP, `f-${Math.random().toString(36).slice(2)}.scrml`);
  writeFileSync(fp, src);
  return compileScrml({ inputFiles: [fp], outputDir: join(TMP, "dist"), write: false, log: () => {} });
}

// Cross-stream: E-CHANNEL-005 is an E- code (result.errors); assert over both
// streams so a partition regression is caught.
function ch005(res) {
  return [...(res.errors || []), ...(res.warnings || [])].filter((d) => d.code === "E-CHANNEL-005");
}

function channelProgram(attrs) {
  return `<program>
  <channel name="chat" ${attrs}>
    <count> = 0
    function onOpen(e) { @count = 1 }
    function onClose(e) { @count = 2 }
    function onError(err) { @count = 3 }
    function handleMessage(msg) { broadcast({ body: msg }) }
  </>
  <p>\${@count}</p>
</program>`;
}

describe("E-CHANNEL-005 — onclient:* arity (S458)", () => {
  for (const [attr, call] of [
    ["onclient:open", "onOpen(e, 1)"],
    ["onclient:close", "onClose(e, @count)"],
    ["onclient:error", "onError(err, extra, more)"],
  ]) {
    test(`${attr}=${call} fires E-CHANNEL-005`, () => {
      const res = compile(channelProgram(`${attr}=${call}`));
      const d = ch005(res);
      expect(d.length).toBe(1);
      expect(d[0].message).toContain(attr);
      expect(d[0].message).toContain("§38.10.1");
      expect((res.errors || []).some((e) => e.code === "E-CHANNEL-005")).toBe(true);
    });
  }

  test("the S458 origin shape `onclient:open=onOpen(x, 1)` is refused", () => {
    const res = compile(`<program>
  <x> = 5
  <channel name="chat" onclient:open=onOpen(x, 1)>
    <count> = 0
    function onOpen(e, n) { @count = n }
  </>
  <p>\${@count} \${@x}</p>
</program>`);
    expect(ch005(res).length).toBe(1);
  });

  test("zero and one argument compile clean on every onclient:* attribute", () => {
    const res = compile(channelProgram(`onclient:open=onOpen(e) onclient:close=onClose() onclient:error=onError(err)`));
    expect(ch005(res)).toEqual([]);
    expect(res.errors || []).toEqual([]);
  });
});

describe("E-CHANNEL-005 — cross-file channel (§38.12)", () => {
  test("an exported channel's arity error is reported once, at the declaration, not again at the CHX-inlined copy", () => {
    const dir = mkdtempSync(join(TMP, "xfile-"));
    writeFileSync(join(dir, "channels.scrml"), `export <channel name="chat" onclient:open=onOpen(e, 1)>
  <count> = 0
  function onOpen(e, n) { @count = n }
</>
`);
    const app = join(dir, "app.scrml");
    writeFileSync(app, `<program>
\${
  import { chat } from './channels.scrml'
}
<chat/>
<p>\${@count}</p>
</program>
`);
    const res = compileScrml({ inputFiles: [app], outputDir: join(dir, "dist"), write: false, log: () => {} });
    const d = ch005(res);
    expect(d.length).toBe(1);
    expect(String(d[0].span?.file ?? d[0].filePath ?? "")).toContain("channels.scrml");
  });
});

describe("E-CHANNEL-005 — onserver:message arity (§38.6.1, now emitted)", () => {
  test("onserver:message=handleMessage(msg, extra) fires E-CHANNEL-005", () => {
    const res = compile(channelProgram(`onserver:message=handleMessage(msg, extra)`));
    const d = ch005(res);
    expect(d.length).toBe(1);
    expect(d[0].message).toContain("onserver:message");
    expect(d[0].message).toContain("§38.6.1");
  });

  test("onserver:message with one or zero parameters compiles clean", () => {
    expect(ch005(compile(channelProgram(`onserver:message=handleMessage(msg)`)))).toEqual([]);
    expect(ch005(compile(channelProgram(`onserver:message=handleMessage()`)))).toEqual([]);
  });

  test("onserver:open / onserver:close are not in the rule's scope", () => {
    const res = compile(channelProgram(`onserver:open=onOpen(a, b)`));
    expect(ch005(res)).toEqual([]);
  });
});
