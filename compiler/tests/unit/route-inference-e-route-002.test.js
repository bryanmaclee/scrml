/**
 * §12.4 E-ROUTE-002 / E-ROUTE-005 — the client-pin classification + rejects.
 *
 * E-ROUTE-002: a server-classified function SHALL NOT call a function route
 * analysis places EXCLUSIVELY on the client (accesses a DOM-only global). Before
 * the S263 fix the compiler had server-escalation machinery but no client-only
 * concept, so a server fn calling a DOM fn silently escalated it server-side and
 * shipped `document.*` into the SERVER bundle.
 *
 * E-ROUTE-005: a SINGLE function that accesses BOTH a server-only resource
 * (`?{}` SQL, …) AND a DOM global is UNPLACEABLE (distinct from the E-ROUTE-002
 * call shape) — it must error, not silently ship its DOM to the server.
 *
 * This suite also pins the S263 adversarial-review corrections:
 *   #1 narrowed roots — `document`/`window` ONLY (navigator/localStorage/
 *      sessionStorage dropped: Bun provides navigator; the storage globals may
 *      appear in a future Bun — a false-positive hard error is worse).
 *   #2 scope/shadowing — a local/param/import named `document`/`window` is a
 *      domain object, not the DOM global.
 *   #3 function boundaries — a DOM access inside a lambda/closure belongs to the
 *      callback's own placement, not the enclosing fn.
 *   #4 file-scoped callee resolution — a same-name fn in ANOTHER file is not a
 *      spurious reach target.
 *   #5 generators pinned — a CLIENT generator touching the DOM stays pinned.
 *   #6 both-triggers → E-ROUTE-005 (not silent).
 *   #7 per-(server-root, callee) dedup — every leaking server fn is diagnosed.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

function compile(src) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-eroute002-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  const result = compileScrml({ inputFiles: [file], write: false, log: () => {} });
  const out = result.outputs ? [...result.outputs.values()][0] : null;
  return { result, out };
}
// Multi-file compile (for cross-file callee-resolution tests). `files` is a map
// of filename -> source; all compiled in ONE unit.
function compileFiles(files) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-eroute002-mf-"));
  const paths = [];
  for (const [name, src] of Object.entries(files)) {
    const p = join(dir, name);
    writeFileSync(p, src);
    paths.push(p);
  }
  const result = compileScrml({ inputFiles: paths, write: false, log: () => {} });
  return { result };
}
const errCodes = (r) => (r.errors ?? []).map((e) => e.code);
const allCodes = (r) => [
  ...(r.errors ?? []).map((e) => e.code),
  ...(r.warnings ?? []).map((e) => e.code),
];
const countCode = (r, code) => errCodes(r).filter((c) => c === code).length;

// ---------------------------------------------------------------------------
// §A — the E-ROUTE-002 reject fires
// ---------------------------------------------------------------------------

describe("§12.4 E-ROUTE-002 — server fn reaching a client-only fn is a hard error", () => {
  test("direct: server(?{}) -> DOM fn fires E-ROUTE-002 (error severity)", () => {
    const { result } = compile(`\${
      function auditAndFlash(name: string) {
        ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
        flashTitle(name)
      }
      function flashTitle(name: string) {
        document.title = name
      }
    }
    <button id="go" onclick=auditAndFlash("hi")>Go</button>`);
    expect(errCodes(result)).toContain("E-ROUTE-002");
    const e = (result.errors ?? []).find((x) => x.code === "E-ROUTE-002");
    expect(e.message).toContain("auditAndFlash");
    expect(e.message).toContain("flashTitle");
    expect(e.message).toContain("document.title");
    expect(e.severity === "error" || e.severity === undefined).toBe(true);
  });

  test("transitive: server(?{}) -> plain mid -> DOM fn fires E-ROUTE-002", () => {
    const { result } = compile(`\${
      function saveThenPaint(name: string) {
        ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
        mid(name)
      }
      function mid(name: string) {
        paint(name)
      }
      function paint(name: string) {
        document.title = name
      }
    }
    <button id="go" onclick=saveThenPaint("hi")>Go</button>`);
    expect(errCodes(result)).toContain("E-ROUTE-002");
    const e = (result.errors ?? []).find((x) => x.code === "E-ROUTE-002");
    expect(e.message).toContain("saveThenPaint -> mid -> paint");
  });

  test("explicit-annotation server fn -> DOM fn also fires E-ROUTE-002", () => {
    const { result } = compile(`\${
      server function persist(name: string) -> string {
        flash(name)
        return "ok"
      }
      function flash(name: string) {
        window.location.href = "/x/" + name
      }
    }
    <button id="go" onclick=persist("hi")>Go</button>`);
    expect(errCodes(result)).toContain("E-ROUTE-002");
  });

  test("both DOM roots (document / window) pin the callee", () => {
    for (const domLine of [
      `document.title = name`,
      `window.location.href = "/x"`,
    ]) {
      const { result } = compile(`\${
        function serverRoot(name: string) {
          ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
          clientLeaf(name)
        }
        function clientLeaf(name: string) {
          ${domLine}
        }
      }
      <button id="go" onclick=serverRoot("hi")>Go</button>`);
      expect(errCodes(result)).toContain("E-ROUTE-002");
    }
  });
});

// ---------------------------------------------------------------------------
// §B — the placement fix: DOM code leaves the server bundle
// ---------------------------------------------------------------------------

describe("§12.4 — the client-pinned callee stays on the client (soundness)", () => {
  test("the DOM function body is NOT emitted into the server bundle", () => {
    const { out } = compile(`\${
      function auditAndFlash(name: string) {
        ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
        flashTitle(name)
      }
      function flashTitle(name: string) {
        document.title = name
      }
    }
    <button id="go" onclick=auditAndFlash("hi")>Go</button>`);
    expect(out?.serverJs ?? "").not.toContain("document.title");
  });
});

// ---------------------------------------------------------------------------
// §C — no false positives (the R26 gate + S263 review #1-#4)
// ---------------------------------------------------------------------------

describe("§12.4 E-ROUTE-002 — valid shapes do NOT fire (conservative)", () => {
  test("client DOM handler CALLING a server fn (client -> server) is allowed", () => {
    const { result } = compile(`\${
      function refresh(name: string) {
        document.title = name
        auditName(name)
      }
      function auditName(name: string) {
        ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
      }
    }
    <button id="go" onclick=refresh("hi")>Go</button>`);
    expect(allCodes(result)).not.toContain("E-ROUTE-002");
  });

  test("server fn calling a plain (non-DOM) helper does NOT fire", () => {
    const { result } = compile(`\${
      function loadName(name: string) {
        ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
        return normalize(name)
      }
      function normalize(name: string) {
        return name
      }
    }
    <button id="go" onclick=loadName("hi")>Go</button>`);
    expect(allCodes(result)).not.toContain("E-ROUTE-002");
  });

  test("`window.process` in a server-fn callee is a SERVER alias, not client-pin", () => {
    const { result } = compile(`\${
      function root(name: string) {
        ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
        readEnv()
      }
      function readEnv() {
        const dir = window.process.cwd()
        return dir
      }
    }
    <button id="go" onclick=root("hi")>Go</button>`);
    expect(allCodes(result)).not.toContain("E-ROUTE-002");
  });

  test("`document` mentioned in a STRING LITERAL does not pin (ExprNode-safe)", () => {
    const { result } = compile(`\${
      function root(name: string) {
        ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
        note(name)
      }
      function note(name: string) {
        const msg = "set document.title to " + name
        return msg
      }
    }
    <button id="go" onclick=root("hi")>Go</button>`);
    expect(allCodes(result)).not.toContain("E-ROUTE-002");
  });

  test("a fully client app (no server fn) with DOM access does NOT fire", () => {
    const { result } = compile(`\${
      @msg = ""
      function paint() {
        document.title = "x"
        @msg = "done"
      }
    }
    <button id="go" onclick=paint()>Go</button> \${@msg}`);
    expect(allCodes(result)).not.toContain("E-ROUTE-002");
  });

  // -- #1: narrowed root set --------------------------------------------------
  test("#1 `navigator` is NOT client-only (Bun provides it)", () => {
    const { result } = compile(`\${
      function logUA(name: string) {
        ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
        readAgent()
      }
      function readAgent() {
        const ua = navigator.userAgent
        return ua
      }
    }
    <button id="go" onclick=logUA("hi")>Go</button>`);
    expect(allCodes(result)).not.toContain("E-ROUTE-002");
  });

  test("#1 `localStorage`/`sessionStorage` are NOT in the root set", () => {
    for (const domLine of [
      `localStorage.setItem("k", name)`,
      `sessionStorage.setItem("k", name)`,
    ]) {
      const { result } = compile(`\${
        function root(name: string) {
          ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
          leaf(name)
        }
        function leaf(name: string) {
          ${domLine}
        }
      }
      <button id="go" onclick=root("hi")>Go</button>`);
      expect(allCodes(result)).not.toContain("E-ROUTE-002");
    }
  });

  // -- #2: scope / shadowing --------------------------------------------------
  test("#2 a PARAM named `document` is a domain object, not the DOM global", () => {
    const { result } = compile(`\${
      function save(name: string) {
        ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
        formatDoc(name)
      }
      function formatDoc(document: string) {
        return document.length
      }
    }
    <button id="go" onclick=save("hi")>Go</button>`);
    expect(allCodes(result)).not.toContain("E-ROUTE-002");
  });

  test("#2 a LOCAL `const document` shadows the DOM global", () => {
    const { result } = compile(`\${
      function save(name: string) {
        ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
        renderDoc(name)
      }
      function renderDoc(name: string) {
        const document = { title: name }
        return document.title
      }
    }
    <button id="go" onclick=save("hi")>Go</button>`);
    expect(allCodes(result)).not.toContain("E-ROUTE-002");
  });

  // -- #3: function boundaries ------------------------------------------------
  test("#3 DOM access inside a LAMBDA is not misattributed to the enclosing server fn", () => {
    const { result } = compile(`\${
      function serverWork(name: string) {
        ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
        const later = () => document.title = name
        register(later)
      }
      function register(cb: fn()) {
        return cb
      }
    }
    <button id="go" onclick=serverWork("hi")>Go</button>`);
    // The lambda's DOM belongs to the callback's own placement — the server fn
    // must not be pinned/rejected by it (no E-ROUTE-002 and no E-ROUTE-005).
    expect(allCodes(result)).not.toContain("E-ROUTE-002");
    expect(allCodes(result)).not.toContain("E-ROUTE-005");
  });

  // -- #4: file-scoped callee resolution --------------------------------------
  test("#4 a same-name fn in ANOTHER file is not a spurious reach target", () => {
    const { result } = compileFiles({
      "a.scrml": `\${
        function serverCaller(name: string) {
          ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
          paint(name)
        }
        function paint(name: string) {
          ?{\`INSERT INTO logs (who) VALUES (\${name})\`}.run()
          return name
        }
      }
      <button id="go" onclick=serverCaller("hi")>Go</button>`,
      "b.scrml": `\${
        @msg = ""
        function paint(name: string) {
          document.title = name
          @msg = name
        }
      }
      <button id="p" onclick=paint("x")>P</button> \${@msg}`,
    });
    // serverCaller's `paint` binds to the SAME-FILE server paint, not b.scrml's
    // client-pinned paint — no false E-ROUTE-002.
    expect(allCodes(result)).not.toContain("E-ROUTE-002");
  });
});

// ---------------------------------------------------------------------------
// §D — the hole cases now DIAGNOSED (S263 review #5, #6, #7)
// ---------------------------------------------------------------------------

describe("§12.4 — closed soundness holes", () => {
  test("#5 a CLIENT generator touching the DOM, called from a server fn, fires E-ROUTE-002", () => {
    const { result } = compile(`\${
      function driver(name: string) {
        ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
        paintAll()
      }
      function* paintAll() {
        document.title = "x"
        yield 1
      }
    }
    <button id="go" onclick=driver("hi")>Go</button>`);
    expect(errCodes(result)).toContain("E-ROUTE-002");
  });

  test("#6 a single fn with BOTH `?{}` SQL AND `document` fires E-ROUTE-005 (unplaceable)", () => {
    const { result } = compile(`\${
      function saveAndPaint(name: string) {
        ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
        document.title = name
      }
    }
    <button id="go" onclick=saveAndPaint("hi")>Go</button>`);
    expect(errCodes(result)).toContain("E-ROUTE-005");
    const e = (result.errors ?? []).find((x) => x.code === "E-ROUTE-005");
    expect(e.message).toContain("saveAndPaint");
    expect(e.message).toContain("document.title");
    expect(e.message.toLowerCase()).toContain("either side");
    // It is NOT the E-ROUTE-002 call shape.
    expect(errCodes(result)).not.toContain("E-ROUTE-002");
  });

  test("#7 two server fns leaking to the SAME client fn each get their own E-ROUTE-002", () => {
    const { result } = compile(`\${
      function serverA(name: string) {
        ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
        flash(name)
      }
      function serverB(name: string) {
        ?{\`INSERT INTO logs (who) VALUES (\${name})\`}.run()
        flash(name)
      }
      function flash(name: string) {
        document.title = name
      }
    }
    <button id="a" onclick=serverA("x")>A</button>
    <button id="b" onclick=serverB("y")>B</button>`);
    expect(countCode(result, "E-ROUTE-002")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §E — S263 round-3 review (destructuring shadow, cross-file, IIFE)
// ---------------------------------------------------------------------------

describe("§12.4 — round-3 corrections", () => {
  // #1 destructured param shadow
  test("#1 a DESTRUCTURED param `{ document }` shadows the DOM global (clean)", () => {
    const { result } = compile(`\${
      function save(name: string) {
        ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
        fmt({ document: name })
      }
      function fmt({ document }) {
        return document.length
      }
    }
    <button id="go" onclick=save("hi")>Go</button>`);
    expect(allCodes(result)).not.toContain("E-ROUTE-002");
    expect(allCodes(result)).not.toContain("E-ROUTE-005");
  });

  test("#1 a rest / defaulted param named `window` shadows (clean)", () => {
    for (const param of [`...window`, `window = 0`]) {
      const { result } = compile(`\${
        function save(name: string) {
          ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
          leaf(name)
        }
        function leaf(${param}) {
          return window.length
        }
      }
      <button id="go" onclick=save("hi")>Go</button>`);
      expect(allCodes(result)).not.toContain("E-ROUTE-002");
    }
  });

  // #2 destructured local shadow
  test("#2 a DESTRUCTURED local `const { window }` shadows the DOM global (clean)", () => {
    const { result } = compile(`\${
      function save(name: string) {
        ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
        render(name)
      }
      function render(payload: string) {
        const { window } = { window: payload }
        return window.length
      }
    }
    <button id="go" onclick=save("hi")>Go</button>`);
    expect(allCodes(result)).not.toContain("E-ROUTE-002");
  });

  // #3 cross-file same-name collision — NO global fallback
  test("#3 a same-name client-pinned fn in ANOTHER file is not a spurious target (clean)", () => {
    const { result } = compileFiles({
      "a.scrml": `\${
        function serverCaller(name: string) {
          ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
          helper(name)
        }
        function helper(name: string) {
          ?{\`INSERT INTO logs (who) VALUES (\${name})\`}.run()
          return name
        }
      }
      <button id="go" onclick=serverCaller("hi")>Go</button>`,
      "b.scrml": `\${
        @msg = ""
        function helper(name: string) {
          document.title = name
          @msg = name
        }
      }
      <button id="h" onclick=helper("x")>H</button> \${@msg}`,
    });
    expect(allCodes(result)).not.toContain("E-ROUTE-002");
  });

  test("#3 a bare cross-file name with NO same-file binding does not spuriously fire (clean)", () => {
    // serverCaller (file a) calls `helper` which is NOT declared in file a and is
    // NOT imported; the only `helper` is client-pinned in file b. Same-file-only
    // resolution finds none -> uncertain -> do NOT fire (documented #4 residual).
    const { result } = compileFiles({
      "a.scrml": `\${
        function serverCaller(name: string) {
          ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
          helper(name)
        }
      }
      <button id="go" onclick=serverCaller("hi")>Go</button>`,
      "b.scrml": `\${
        @msg = ""
        function helper(name: string) {
          document.title = name
          @msg = name
        }
      }
      <button id="h" onclick=helper("x")>H</button> \${@msg}`,
    });
    expect(allCodes(result)).not.toContain("E-ROUTE-002");
  });

  // #5 expr-body IIFE — DOM in an in-place-invoked lambda IS attributed
  test("#5 an EXPR-body IIFE with a DOM write in a SQL fn is caught (E-ROUTE-005)", () => {
    const { result } = compile(`\${
      function saveAndPaint(name: string) {
        ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
        (() => document.title = name)()
      }
    }
    <button id="go" onclick=saveAndPaint("hi")>Go</button>`);
    // The IIFE runs in-place, so its DOM lands in saveAndPaint — which also does
    // ?{} SQL -> unplaceable both-sides -> E-ROUTE-005 (not silently server-side).
    expect(errCodes(result)).toContain("E-ROUTE-005");
  });

  test("#5 a NON-invoked lambda (passed callback) is NOT scanned into (clean)", () => {
    const { result } = compile(`\${
      function serverWork(name: string) {
        ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
        register(() => document.title = name)
      }
      function register(cb: fn()) {
        return cb
      }
    }
    <button id="go" onclick=serverWork("hi")>Go</button>`);
    expect(allCodes(result)).not.toContain("E-ROUTE-002");
    expect(allCodes(result)).not.toContain("E-ROUTE-005");
  });

  test("#5 an IIFE param named `document` shadows inside the IIFE (clean)", () => {
    const { result } = compile(`\${
      function saveAndPaint(name: string) {
        ?{\`INSERT INTO audit (who) VALUES (\${name})\`}.run()
        ((document) => document.length)(name)
      }
    }
    <button id="go" onclick=saveAndPaint("hi")>Go</button>`);
    // The IIFE's own param `document` shadows the global inside it — no fire.
    expect(allCodes(result)).not.toContain("E-ROUTE-005");
    expect(allCodes(result)).not.toContain("E-ROUTE-002");
  });
});
