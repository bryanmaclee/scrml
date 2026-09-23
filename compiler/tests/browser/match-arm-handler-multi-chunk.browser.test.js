/**
 * g-match-inside-each-row-cannot-see-the-row-variable, round 3 (review of
 * e0c02544, HIGH) — an arm handler that reads an arm name (payload binding) is
 * stored on its element and run by the document-level delegation WALKER. Every
 * loaded client chunk registers its own walker; round 2 keyed the element
 * property only by event name (`__scrml_arm_onclick`), so with a shell and a
 * page both using the mechanism EVERY walker ran the handler: each click fired
 * once per loaded chunk.
 *
 * The property is now chunk- and binding-owned, and a walker only reads the
 * properties of the placeholder ids it emitted. Pinned here with a real
 * multi-file `pages/` app (shell + page, both walker-mode, click AND submit) and
 * with the single-file siblings (two match blocks, the same component used twice).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, mkdtempSync } from "fs";
import { compileScrml } from "../../src/api.js";

beforeEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  await GlobalRegistrator.register();
});
afterEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

const SHELL = `<program>
  type User:enum = { Anon, In(name: string) }
  <u> = User.In("bob")
  <slog> = ""
  function hi(n) { @slog = @slog + "hi:" + n + ";" }
  <p id="slog">\${@slog}</p>
  <match for=User on=@u>
    <Anon><p>anon</p></>
    <In(name)><button class="sh" onclick=hi(name)>hi</button><form class="sf" onsubmit=hi("s" + name)><button type="submit">s</button></form></>
  </match>
  <outlet/>
</program>
`;

const PAGE = `<page>
  type Doc:enum = { Empty, Note(note: string) }
  <cur> = Doc.Note("alpha")
  <plog> = ""
  function openN(n) { @plog = @plog + "open:" + n + ";" }
  <p id="plog">\${@plog}</p>
  <match for=Doc on=@cur>
    <Empty><p>none</p></>
    <Note(note)><button class="pg" onclick=openN(note)>o</button><form class="pf" onsubmit=openN("s" + note)><button type="submit">s</button></form></>
  </match>
</page>
`;

/** Build shell + page, load EVERY script the page's HTML references (all chunks), boot. */
function mountApp() {
  const dir = mkdtempSync(join(tmpdir(), "arm-multi-chunk-"));
  try {
    mkdirSync(join(dir, "pages"), { recursive: true });
    writeFileSync(join(dir, "index.scrml"), SHELL);
    writeFileSync(join(dir, "pages", "alpha.scrml"), PAGE);
    const out = join(dir, "out");
    const r = compileScrml({ inputFiles: [join(dir, "index.scrml"), join(dir, "pages", "alpha.scrml")], write: true, outputDir: out, log: () => {} });
    const errs = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
    const html = readFileSync(resolve(out, "alpha.html"), "utf8");
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1].replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
    const code = scripts.map((s) => readFileSync(resolve(out, s), "utf8")).join("\n;\n");
    const consoleErrors = [];
    const origErr = console.error;
    console.error = (...a) => { consoleErrors.push(a.map(String).join(" ")); };
    try {
      (0, eval)(code);
      document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
    } finally {
      console.error = origErr;
    }
    return { errs, scripts, consoleErrors, text: (sel) => document.querySelector(sel)?.textContent ?? null };
  } finally {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

const click = (sel) => document.querySelector(sel).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
function submit(sel) {
  const ev = new window.Event("submit", { bubbles: true, cancelable: true });
  document.querySelector(sel).dispatchEvent(ev);
  return ev.defaultPrevented;
}

describe("round 3 — an arm handler runs ONCE with several chunks loaded", () => {
  test("shell + page, both walker-mode: one fire per click and per submit", () => {
    const app = mountApp();
    expect(app.errs).toEqual([]);
    expect(app.scripts.filter((s) => s.endsWith(".client.js")).length).toBeGreaterThanOrEqual(2);
    click("button.pg");
    expect(app.text("#plog")).toBe("open:alpha;");
    click("button.sh");
    expect(app.text("#slog")).toBe("hi:bob;");
    expect(submit("form.pf")).toBe(true);
    expect(app.text("#plog")).toBe("open:alpha;open:salpha;");
    expect(submit("form.sf")).toBe(true);
    expect(app.text("#slog")).toBe("hi:bob;hi:sbob;");
    expect(app.consoleErrors).toEqual([]);
  });
});

describe("round 3 — single-file siblings: two match blocks, one component used twice", () => {
  test("each arm handler fires exactly once", () => {
    const dir = mkdtempSync(join(tmpdir(), "arm-one-file-"));
    try {
      writeFileSync(join(dir, "app.scrml"), `<program>
  type Doc:enum = { Empty, Note(note: string) }
  <cur> = Doc.Note("n1")
  <cur2> = Doc.Note("n2")
  <log> = ""
  function openN(n) { @log = @log + "open:" + n + ";" }
  \${
    const Box = <div props={ label: string }>
      <match for=Doc on=@cur>
        <Empty><p>none</p></>
        <Note(note)><button class="bx" onclick=openN(note)>o</button></>
      </match>
    </>
  }
  <p id="log">\${@log}</p>
  <Box label="a"/>
  <Box label="b"/>
  <match for=Doc on=@cur><Empty><p>none</p></><Note(note)><button class="m1" onclick=openN(note)>o</button></></match>
  <match for=Doc on=@cur2><Empty><p>none</p></><Note(note)><button class="m2" onclick=openN(note)>o</button></></match>
</program>
`);
      const out = join(dir, "out");
      const r = compileScrml({ inputFiles: [join(dir, "app.scrml")], write: true, outputDir: out, log: () => {} });
      expect((r.errors ?? []).filter((e) => (e.severity ?? "error") === "error")).toEqual([]);
      const html = readFileSync(resolve(out, "app.html"), "utf8");
      const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
      document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1].replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
      (0, eval)(scripts.map((s) => readFileSync(resolve(out, s), "utf8")).join("\n;\n"));
      document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
      const log = () => document.querySelector("#log").textContent;
      const boxes = [...document.querySelectorAll("button.bx")];
      expect(boxes.length).toBe(2);
      for (const b of boxes) b.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      expect(log()).toBe("open:n1;open:n1;");
      click("button.m1");
      click("button.m2");
      expect(log()).toBe("open:n1;open:n1;open:n1;open:n2;");
    } finally {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });
});
