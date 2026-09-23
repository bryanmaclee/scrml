/**
 * §6.7.4 `when <dep-list> changes { body }` — RUNTIME drive (happy-dom).
 *
 * The effect used to lower to `_scrml_effect(function(){ body })`, which broke
 * the three core clauses of §6.7.4 at once, silently (exit 0, no diagnostic):
 *
 *   (a) "The body does NOT execute on initial mount."          — it ran at boot.
 *   (b) "The body executes whenever any listed dependency
 *        changes value."                                        — writing a listed
 *        dep the body does not READ fired nothing.
 *   (c) "The compiler does NOT auto-track `@variable` reads
 *        inside the body."                                      — every read in
 *        the body became a trigger.
 *
 * Each program is compiled to disk and run on the TREE-SHAKEN runtime file the
 * compiler wrote for it (not the whole SCRML_RUNTIME), so a chunk-gating miss for
 * the `_scrml_when_changes` helper fails here as a ReferenceError at boot.
 * Changes are driven by real clicks through the delegated handler wiring.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

beforeEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  await GlobalRegistrator.register();
});

afterEach(() => {
  delete globalThis.fetch;
});

function mount(src, { fetchReply } = {}) {
  const TMP = mkdtempSync(join(tmpdir(), "when-deplist-"));
  try {
    const abs = join(TMP, "w.scrml");
    writeFileSync(abs, src);
    const out = join(TMP, "dist");
    const result = compileScrml({ inputFiles: [abs], outputDir: out, write: true, log: () => {} });
    const realErrors = (result.errors || []).filter((e) => e && (e.severity ?? "error") === "error");
    expect(realErrors.map((e) => e.code + " " + e.message)).toEqual([]);
    const html = readFileSync(join(out, "w.html"), "utf8");
    const clientJs = readFileSync(join(out, "w.client.js"), "utf8");
    const rtName = readdirSync(out).find((n) => /^scrml-runtime.*\.js$/.test(n));
    const runtimeJs = readFileSync(join(out, rtName), "utf8");

    if (fetchReply !== undefined) {
      globalThis.fetch = () =>
        Promise.resolve().then(() => ({
          ok: true,
          status: 200,
          json: () => Promise.resolve(fetchReply),
          text: () => Promise.resolve(JSON.stringify(fetchReply)),
          headers: { get: () => "application/json" },
        }));
    }

    const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] || html;
    document.body.innerHTML = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
    const errs = [];
    const oe = console.error;
    console.error = (...a) => { errs.push(a.map(String).join(" ")); };
    const code = `(function() {\n${runtimeJs}\n` + captureInsideChunkScope(clientJs,
      `window.__wg = _scrml_reactive_get; window.__ws = _scrml_reactive_set;\n`) + `\n})();`;
    try {
      eval(code);
      document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
    } finally {
      console.error = oe;
    }
    return {
      clientJs,
      errs,
      get: (n) => window.__wg(n),
      set: (n, v) => window.__ws(n, v),
      text: (id) => document.getElementById(id)?.textContent,
      click: (id) => {
        const prev = console.error;
        console.error = (...a) => { errs.push(a.map(String).join(" ")); };
        try { document.getElementById(id).dispatchEvent(new Event("click", { bubbles: true })); }
        finally { console.error = prev; }
      },
    };
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

// The PA's repro: the body reads @m (unlisted) and not @n (listed).
const CORE = `<program>
  <n> = 0
  <m> = 0
  <log> = ""
  when @n changes { @log = @log + "n:" + @m + ";" }
  <p id="log">\${@log}</p>
  <button id="n" onclick=\${@n = @n + 1}>n</button>
  <button id="m" onclick=\${@m = @m + 1}>m</button>
</program>
`;

describe("§6.7.4 core clauses (a)(b)(c)", () => {
  test("(a) the body does NOT run at mount", () => {
    const app = mount(CORE);
    expect(app.errs).toEqual([]);
    expect(app.get("log")).toBe("");
    expect(app.text("log")).toBe("");
  });

  test("(b) writing a listed dep the body does not read fires the body", () => {
    const app = mount(CORE);
    app.click("n");
    expect(app.get("log")).toBe("n:0;");
    app.click("n");
    expect(app.get("log")).toBe("n:0;n:0;");
    expect(app.text("log")).toBe("n:0;n:0;");
  });

  test("(c) writing an UNLISTED @var the body reads does NOT fire it; the body reads its current value", () => {
    const app = mount(CORE);
    app.click("m");
    app.click("m");
    expect(app.get("log")).toBe("");
    app.click("n");
    expect(app.get("log")).toBe("n:2;");
  });

  test("the same holds inside a ${ } logic block", () => {
    const app = mount(CORE.replace(
      `  when @n changes { @log = @log + "n:" + @m + ";" }\n`,
      `  \${\n    when @n changes { @log = @log + "n:" + @m + ";" }\n  }\n`,
    ));
    expect(app.get("log")).toBe("");
    app.click("m");
    expect(app.get("log")).toBe("");
    app.click("n");
    expect(app.get("log")).toBe("n:1;");
  });
});

describe("§6.7.4 semantics", () => {
  test("multi-dep: fires exactly once per write to ANY listed dep", () => {
    const app = mount(`<program>
  <a> = 0
  <b> = 0
  <other> = 0
  <count> = 0
  when (@a, @b) changes { @count = @count + 1 }
  <button id="a" onclick=\${@a = @a + 1}>a</button>
  <button id="b" onclick=\${@b = @b + 1}>b</button>
  <button id="o" onclick=\${@other = @other + 1}>o</button>
</program>
`);
    expect(app.get("count")).toBe(0);
    app.click("a");
    expect(app.get("count")).toBe(1);
    app.click("b");
    expect(app.get("count")).toBe(2);
    app.click("o");
    expect(app.get("count")).toBe(2);
  });

  test("change detection is a write, not deep equality: writing the same value fires", () => {
    const app = mount(`<program>
  <n> = 0
  <count> = 0
  when @n changes { @count = @count + 1 }
  <button id="z" onclick=\${@n = 0}>z</button>
</program>
`);
    app.click("z");
    app.click("z");
    expect(app.get("count")).toBe(2);
  });

  test("derived flush: the body reads the POST-change value of a derived cell", () => {
    const app = mount(`<program>
  <price> = 2
  <qty> = 3
  <seen> = ""
  const <total> = @price * @qty
  when @price changes { @seen = @seen + @total + ";" }
  <p id="t">\${@total}</p>
  <button id="p" onclick=\${@price = @price + 1}>p</button>
  <button id="q" onclick=\${@qty = @qty + 1}>q</button>
</program>
`);
    expect(app.text("t")).toBe("6"); // the derived is clean (read) before the write
    app.click("p");
    expect(app.get("seen")).toBe("9;");
    app.click("q"); // unlisted — no fire, but dirties @total
    expect(app.get("seen")).toBe("9;");
    app.click("p");
    expect(app.get("seen")).toBe("9;16;");
  });

  test("§6.5 array writes fire it: full replacement, and an intercepted mutation in a function body", () => {
    const app = mount(`<program>
  <items> = []
  <log> = ""
  when @items changes { @log = @log + @items.length + ";" }
  function add() {
    @items.push(7)
  }
  <button id="re" onclick=\${@items = [...@items, 1]}>re</button>
  <button id="add" onclick=\${add()}>add</button>
</program>
`);
    expect(app.get("log")).toBe("");
    app.click("re");
    expect(app.get("log")).toBe("1;");
    app.click("add");
    expect(app.get("log")).toBe("1;2;");
  });

  test("a body writing one of its own deps does not recurse (dropped re-entry, no stack overflow)", () => {
    // E-LIFECYCLE-006 at compile time per SPEC; the runtime must not blow the stack
    // while that check is absent.
    const app = mount(`<program>
  <n> = 0
  when @n changes { @n = @n + 1 }
  <button id="n" onclick=\${@n = @n + 1}>n</button>
</program>
`);
    app.click("n");
    expect(app.get("n")).toBe(2);
    expect(app.errs.filter((e) => /Maximum call stack|RangeError/.test(e))).toEqual([]);
  });

  test("a server-fn call in the body is awaited (§6.7.4 'Interaction with Server Functions', §13.2)", async () => {
    const app = mount(`<program>
  <n> = 0
  <log> = ""
  server function double(x) {
    return x * 2
  }
  when @n changes {
    const r = double(@n)
    @log = @log + "r" + r + ";"
    @log = @log + "e" + double(@n) + ";"
  }
  <button id="n" onclick=\${@n = @n + 1}>n</button>
</program>
`, { fetchReply: 42 });
    expect(app.clientJs).toMatch(/_scrml_when_changes\([\s\S]*?async function\(\)/);
    await settle();
    expect(app.get("log")).toBe(""); // no boot fetch-and-write
    app.click("n");
    await settle();
    expect(app.get("log")).toBe("r42;e42;");
    expect(app.errs).toEqual([]);
  });
});

describe("§6.7.4 runtime helper contract (_scrml_when_changes)", () => {
  // The whole runtime, so the helper can be driven directly.
  function rt() {
    const g = {};
    // eslint-disable-next-line no-eval
    eval(`(function(){\n${SCRML_RUNTIME}\n` +
      `g.set = _scrml_reactive_set; g.get = _scrml_reactive_get; g.sub = _scrml_reactive_subscribe;` +
      `g.when = _scrml_when_changes; g.effect = _scrml_effect; g.destroy = _scrml_destroy_scope;` +
      `g.setScope = function (s) { _scrml_active_mount_scope = s; };\n})();`);
    return g;
  }

  test("the body's reads are untracked even when the triggering write happens inside a running effect", () => {
    const g = rt();
    g.set("n", 0); g.set("m", 0);
    let bodyRuns = 0;
    g.when((h) => [g.sub("n", h)], () => { bodyRuns++; g.get("m"); });
    let effectRuns = 0;
    // An effect that WRITES @n. If the when-body's read of @m leaked into this
    // effect's tracking context, a later @m write would re-run the effect.
    g.effect(() => { effectRuns++; g.set("n", g.get("n") === undefined ? 0 : 1); });
    const afterBoot = effectRuns;
    expect(bodyRuns).toBe(1);
    g.set("m", 5);
    expect(effectRuns).toBe(afterBoot);
  });

  test("registered inside an if= mount pass, it is torn down with that scope (§6.7.2 step 1)", () => {
    const g = rt();
    g.set("n", 0);
    let runs = 0;
    g.setScope("if_test_1");
    g.when((h) => [g.sub("n", h)], () => { runs++; });
    g.setScope(null);
    g.set("n", 1);
    expect(runs).toBe(1);
    g.destroy("if_test_1");
    g.set("n", 2);
    expect(runs).toBe(1);
  });

  test("the returned disposer unsubscribes every dep, and is idempotent", () => {
    const g = rt();
    g.set("a", 0); g.set("b", 0);
    let runs = 0;
    const dispose = g.when((h) => [g.sub("a", h), g.sub("b", h)], () => { runs++; });
    g.set("a", 1); g.set("b", 1);
    expect(runs).toBe(2);
    dispose(); dispose();
    g.set("a", 2); g.set("b", 2);
    expect(runs).toBe(2);
  });

  test("an async body's rejection is reported, not thrown at the writer", async () => {
    const g = rt();
    g.set("n", 0);
    const errs = [];
    const oe = console.error;
    console.error = (...a) => { errs.push(a.map(String).join(" ")); };
    try {
      g.when((h) => [g.sub("n", h)], async () => { await null; throw new Error("boom"); });
      expect(() => g.set("n", 1)).not.toThrow();
      await settle();
    } finally {
      console.error = oe;
    }
    expect(errs.some((e) => /when-effect error/.test(e) && /boom/.test(e))).toBe(true);
  });
});

// §6.7.4: "A `when` statement is associated with the enclosing element scope. When
// that scope destroys, the effect is automatically unregistered." The runtime half
// is proven above. The COMPILER half does not exist in any host yet, and each host
// needs a file this change does not own (see the S429 report):
//   - if=: the `when` is hoisted to file scope and registered once at boot, so it
//     keeps firing while the region is unmounted (and is not re-registered on
//     remount — it simply never stopped). Needs emit-html/emit-event-wiring to
//     register it in the mount wiring pass instead of at file scope.
//   - component: a `when` in a component body fails to compile (E-COMPONENT-021).
//   - match arm: a `${ when … }` in an arm body is lowered as markup
//     interpolation — `ReferenceError: when is not defined` at runtime.
describe("§6.7.4 teardown with the enclosing scope — compiler hosts", () => {
  test.todo("if= region: the body stops firing after the region unmounts and resumes on remount");
  test.todo("component: a `when` in a component body compiles and stops firing when the instance unmounts");
  test.todo("match arm: a `when` in an arm body compiles and stops firing when the arm is swapped out");
});
