/**
 * §4.12.2 / §4.12.8 — the nested-vs-root discriminator is ROOT-NODES MEMBERSHIP,
 * not `<program>`-ancestor DEPTH.
 *
 * ## The defect these tests pin
 *
 * `extractWorkerPrograms` (and five sibling passes) gated the nested case on a
 * `programDepth >= 1` counter that increments only when descending THROUGH a
 * `<program>`. In a file whose root element is NOT a `<program>` — a
 * `<page>`-rooted route file, the documented multi-page shape — a nested
 * `<program name="w">` sits at depth 0 and falls through EVERY branch: no
 * extraction, no bundle, no `new Worker(...)`, and no diagnostic. `emit-client`
 * still emits the `<#w>.send()` call site, so the build exits 0 with zero
 * diagnostics and ships `_scrml_worker_w.send(...)` against a binding nothing
 * declares.
 *
 * `node --check` PASSES on that file — a dangling free identifier is legal JS
 * until it is evaluated — so `--validate-emit` cannot see it either. The proof
 * has to EXECUTE the bundle and reach the call site, which is what
 * `clickAndCatch` below does.
 *
 * Trajectory of this one shape across the arc, worth keeping in the record
 * because each round moved it sideways rather than closing it:
 *
 *   pre-arc  binding DECLARED, bundle file MISSING   -> 404, `.onerror` fires
 *   round 1  bundle WRITTEN but inert                -> silent hang
 *   round 2  binding NOT DECLARED AT ALL             -> ReferenceError
 *   round 3  extracted, declared, bundle real        -> works
 *
 * ## Why membership and not a seeded depth
 *
 * See `compiler/src/program-root.ts`. In short: depth-seeding is not TOTAL — a
 * second top-level `<program name=>` sibling stays at depth 0 in a file that DOES
 * have a root `<program>`, so it stays unclassified — and depth is walk-relative,
 * so six consumers can re-derive it six ways. Membership is walk-invariant.
 *
 * ## Corpus blast radius: ZERO today
 *
 * All 13 nested `<program>` tags across the 2372 tracked `.scrml` files sit under
 * a `<program>` ROOT, so no corpus file exercised the `<page>`-rooted path. That
 * is why nothing caught it — NOT evidence the shape is unimportant. §40.8 route
 * files are `<page>`-rooted by construction, so the first adopter to colocate a
 * worker with a route would have hit it on their first click.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;
let registeredHere = false;

beforeAll(async () => {
  TMP = mkdtempSync(join(tmpdir(), "program-root-"));
  if (!GlobalRegistrator.isRegistered) {
    GlobalRegistrator.register();
    registeredHere = true;
  }
});
afterAll(async () => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  // Only tear down what THIS file stood up — happy-dom's registrator is a
  // process-global, and unregistering a window a sibling suite installed is how
  // whole-suite state leaks start.
  if (registeredHere && GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

/** Compile one source string into its own dist dir and report what landed. */
function build(dir, src) {
  const root = join(TMP, dir);
  mkdirSync(root, { recursive: true });
  const file = join(root, "app.scrml");
  writeFileSync(file, src);
  const outDir = join(root, "dist");
  const result = compileScrml({
    inputFiles: [file],
    outputDir: outDir,
    write: true,
    log: () => {},
  });
  const listed = existsSync(outDir) ? readdirSync(outDir) : [];
  const read = (name) => (existsSync(join(outDir, name)) ? readFileSync(join(outDir, name), "utf8") : null);
  return {
    outDir,
    files: listed,
    workerFilesOnDisk: listed.filter((f) => f.endsWith(".worker.js")).sort(),
    cssFilesOnDisk: listed.filter((f) => f.endsWith(".css")).sort(),
    errors: result.errors ?? [],
    warnings: result.warnings ?? [],
    clientJs: read("app.client.js"),
    html: read("app.html"),
    runtimeJs: (() => {
      const rt = listed.find((f) => f.startsWith("scrml-runtime"));
      return rt ? read(rt) : null;
    })(),
  };
}

/**
 * Diagnostics live on TWO streams — `errors` carries fatals, `warnings` carries
 * the `W-` / `I-` non-fatals — so any assertion about a warning code has to read
 * across both or it silently passes on an empty list.
 */
const codesOf = (o) => [...o.errors, ...o.warnings].map((e) => e.code);

const hardErrors = (o) => o.errors.filter((e) => e.severity !== "warning" && e.severity !== "info");

/**
 * THE INVARIANT, checked on the emitted bytes: every `_scrml_worker_<name>`
 * identifier the client bundle USES is also one it DECLARES.
 *
 * Returns `{ used, declared, dangling }` so a caller can assert on the whole
 * shape rather than a boolean — a failure then names the offending binding.
 */
function workerBindings(clientJs) {
  const src = clientJs ?? "";
  const declared = new Set(
    [...src.matchAll(/(?:const|let|var)\s+(_scrml_worker_[A-Za-z0-9_$]+)\s*=/g)].map((m) => m[1]),
  );
  const used = new Set([...src.matchAll(/(_scrml_worker_[A-Za-z0-9_$]+)/g)].map((m) => m[1]));
  const dangling = [...used].filter((u) => !declared.has(u)).sort();
  return { used: [...used].sort(), declared: [...declared].sort(), dangling };
}

/** Every `new Worker("…")` specifier in the written client bundle. */
const workerRefs = (o) =>
  [...(o.clientJs ?? "").matchAll(/new Worker\("([^"]+)"\)/g)].map((m) => m[1]).sort();

/**
 * EXECUTE, don't grep. Load the emitted HTML body + runtime + client bundle into
 * the happy-dom window, boot it, click the first `<button>`, and return whatever
 * the handler threw.
 *
 * A dangling worker binding is invisible to every static check the pipeline runs
 * — it is syntactically valid JS, so `node --check` and `--validate-emit` both
 * pass — and it only throws when the handler actually runs. Reaching the call
 * site is the whole point of this helper.
 */
function clickAndCatch(o) {
  const { document } = globalThis;
  const bodyMatch = (o.html ?? "").match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = (bodyMatch ? bodyMatch[1] : "").replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  document.body.innerHTML = bodyHtml;

  const workerRequests = [];
  globalThis.Worker = class TestWorker {
    constructor(url) { workerRequests.push(String(url)); }
    postMessage() {}
    addEventListener() {}
    terminate() {}
  };

  const thrown = [];
  // Runtime and client MUST share one scope: the runtime's `const` declarations
  // are function-local, so evaluating the two separately leaves the client
  // unable to see them and manufactures a false ReferenceError.
  new Function("window", "document", `${o.runtimeJs}\n${o.clientJs}`)(globalThis.window, document);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));

  const btn = document.querySelector("button");
  const origError = console.error;
  console.error = (...args) => { thrown.push(args.map(String).join(" ")); };
  try {
    if (btn) btn.click();
  } catch (err) {
    thrown.push(`${err.name}: ${err.message}`);
  } finally {
    console.error = origError;
  }
  return { thrown, workerRequests, buttonFound: Boolean(btn) };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** HIGH-1 verbatim: a `<page>`-rooted file whose nested worker IS referenced. */
const PAGE_ROOTED_WORKER = `<page>
  <program name="w">
    \${ when message(data) { send({ v: data.v * 2 }) } }
  </program>
  \${
    <v> = 1
    function go() { <#w>.send({ v: @v }) }
  }
  <button onclick=go()>go</button>
</page>
`;

/** The same shape with NO `.send()` — the worker body must still leave the DOM. */
const PAGE_ROOTED_WORKER_NO_SEND = `<page>
  <program name="w">
    <span>worker body markup</span>
    \${ when message(data) { send({ v: data.v * 2 }) } }
  </program>
  <button>go</button>
</page>
`;

/** A SECOND top-level `<program name=>`, sibling of the document root. */
const SECOND_TOP_LEVEL = `<program>
  \${
    <v> = 1
    function go() { <#w>.send({ v: @v }) }
  }
  <button onclick=go()>go</button>
</program>
<program name="w">
  \${ when message(data) { send({ v: data.v * 2 }) } }
</program>
`;

/** A `<page>`-rooted file holding a §4.12.6 scoped-DB context (NOT extracted). */
const PAGE_ROOTED_SCOPED_DB = `<page>
  <program db="sqlite://./analytics.db">
    <span>scoped</span>
  </program>
  <button>go</button>
</page>
`;

/** The control: the same `<page>` with no nested `<program>` at all. */
const PAGE_ROOTED_PLAIN = `<page>
  <span>scoped</span>
  <button>go</button>
</page>
`;

/** A `<page>`-rooted file whose nested worker carries a documentary attribute. */
const PAGE_ROOTED_DOC_ATTR = `<page>
  <program name="w" title="not a document">
    \${ when message(data) { send({ v: data.v }) } }
  </program>
  <button>go</button>
</page>
`;

/** A `<page>`-rooted file whose nested worker holds a `<channel>`. */
const PAGE_ROOTED_CHANNEL = `<page>
  <program name="w">
    <channel name="feed"/>
    \${ when message(data) { send({ v: data.v }) } }
  </program>
  <button>go</button>
</page>
`;

// ---------------------------------------------------------------------------
// HIGH-1 — the dangling worker binding
// ---------------------------------------------------------------------------

describe("§4.12.8 — a `<page>`-rooted file's nested <program> IS extracted", () => {
  test("the worker binding the client USES is one the client DECLARES", () => {
    const o = build("page-worker", PAGE_ROOTED_WORKER);
    expect(hardErrors(o)).toEqual([]);

    // The bug, stated as the invariant it violated. Pre-fix this read
    // `{ declared: [], dangling: ["_scrml_worker_w"] }`.
    const b = workerBindings(o.clientJs);
    expect(b.dangling).toEqual([]);
    expect(b.declared).toContain("_scrml_worker_w");
  });

  test("the bundle it names is on disk and carries a real onmessage handler", () => {
    const o = build("page-worker-disk", PAGE_ROOTED_WORKER);
    const refs = workerRefs(o);
    expect(refs.length).toBe(1);

    for (const spec of refs) {
      expect({ spec, exists: existsSync(join(o.outDir, spec)) }).toEqual({ spec, exists: true });
    }
    const workerJs = readFileSync(join(o.outDir, refs[0]), "utf8");
    expect(workerJs).toContain("self.onmessage");
    expect(workerJs).toContain("self.postMessage(");
  });

  test("EXECUTED: clicking the button reaches the worker instead of throwing", () => {
    const o = build("page-worker-exec", PAGE_ROOTED_WORKER);
    const run = clickAndCatch(o);

    expect(run.buttonFound).toBe(true);
    // Pre-fix: ["ReferenceError: _scrml_worker_w is not defined"].
    expect(run.thrown).toEqual([]);
    // And the click actually reached a Worker construction, so the assertion
    // above is not passing merely because the handler never ran.
    expect(run.workerRequests.length).toBe(1);
    expect(run.workerRequests[0]).toMatch(/\.w\.worker\.js$/);
  });

  test("a nested worker with NO .send() still leaves the parent DOM", () => {
    const o = build("page-worker-nosend", PAGE_ROOTED_WORKER_NO_SEND);
    expect(hardErrors(o)).toEqual([]);

    // The bundle is produced (the declaration is meaningful even unreferenced)…
    expect(o.workerFilesOnDisk).toEqual(["app.w.worker.js"]);
    // …and its markup does NOT render into the parent document. Pre-fix the
    // whole subtree stayed in the tree and `<span>worker body markup</span>`
    // was emitted into the page.
    expect(o.html).not.toContain("worker body markup");
    expect(o.html).toContain("<button>go</button>");
  });
});

// ---------------------------------------------------------------------------
// HIGH-1 instance 3 — the second top-level `<program name=>`
// ---------------------------------------------------------------------------

describe("§4.12.2 — EVERY top-level <program name=> is diagnosed, not just the first", () => {
  test("a second top-level <program name=> fires W-PROGRAM-TOP-LEVEL-NAME", () => {
    const o = build("second-top", SECOND_TOP_LEVEL);
    // Pre-fix `detectTopLevelProgramName` returned after inspecting the FIRST
    // top-level `<program>`, so a named SECOND one was silent — and, being
    // top-level, it was never extracted either. Neither half fired.
    expect(codesOf(o)).toContain("W-PROGRAM-TOP-LEVEL-NAME");
  });

  test("it is NOT extracted as a worker — §4.12.2 reserves extraction for nested elements", () => {
    const o = build("second-top-noextract", SECOND_TOP_LEVEL);
    // SPEC §4.12.2: "The compiler SHALL NOT treat a top-level `<program name=>`
    // as a nested execution context: the extraction pre-pass of §4.12.8 applies
    // to nested `<program>` elements only."
    expect(o.workerFilesOnDisk).toEqual([]);
    expect(workerRefs(o)).toEqual([]);
  });

  test("the document root keeps its own diagnostic-free status", () => {
    const o = build("root-unnamed", PAGE_ROOTED_PLAIN);
    expect(codesOf(o)).not.toContain("W-PROGRAM-TOP-LEVEL-NAME");
  });
});

// ---------------------------------------------------------------------------
// The sibling passes the same counter had broken
// ---------------------------------------------------------------------------

describe("the five sibling passes agree with the extractor", () => {
  test("W-PROGRAM-TITLE-NESTED fires on a `<page>`-rooted nested <program title=>", () => {
    const o = build("page-doc-attr", PAGE_ROOTED_DOC_ATTR);
    // `detectNestedDocAttrs` carried the identical depth counter, so this was
    // silent: the nested program read as the document root and its `title=`
    // looked like legitimate head metadata.
    expect(codesOf(o)).toContain("W-PROGRAM-TITLE-NESTED");
  });

  test("E-CHANNEL-INSIDE-NESTED-PROGRAM fires on a `<page>`-rooted nested worker", () => {
    const o = build("page-channel", PAGE_ROOTED_CHANNEL);
    // `walkChannelPlacement` carried the counter too, so a `<channel>` in an
    // EXTRACTED subtree of a `<page>`-rooted file was accepted — the exact
    // shape whose server route is never mounted.
    expect(codesOf(o)).toContain("E-CHANNEL-INSIDE-NESTED-PROGRAM");
  });

  test("a nested <program db=> does not stand in for a document root in the CSS reset", () => {
    const withNested = build("theme-nested", PAGE_ROOTED_SCOPED_DB);
    const control = build("theme-control", PAGE_ROOTED_PLAIN);

    // §65.3.4's reset `@layer` is emitted "only when the file declares a
    // <program>" — meaning the DOCUMENT ROOT. `collectThemeContext` took the
    // first `<program>` in a full-tree walk, so adding a §4.12.6 scoped-DB
    // context to a `<page>`-rooted file materialised a whole `.css` artifact
    // the identical file without it does not emit.
    expect(withNested.cssFilesOnDisk).toEqual(control.cssFilesOnDisk);
  });
});
