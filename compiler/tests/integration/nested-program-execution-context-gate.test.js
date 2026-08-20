/**
 * §4.12.3 — worker registration is gated to the TRUE §4.12.4 shape.
 * (Operator ruling S354, delta-log [1606]; implemented S356.)
 *
 * THE BUG. `extractWorkerPrograms` (`compiler/src/codegen/index.ts`) claimed
 * ANY `name=`d nested `<program>` as a §4.12.4 inline web worker. §4.12.3 says
 * `name=` selects the inline-worker context only in the ABSENCE of the other
 * context-bearing attributes:
 *
 *   | Inline web worker        | name=, no lang=              | new Worker() + postMessage |
 *   | Foreign language sidecar | name=, lang= (non-WASM)      | subprocess over HTTP/socket |
 *   | WASM compute module      | name=, lang=, mode="wasm"    | WebAssembly.instantiate()   |
 *   | Scoped DB context        | name= (OPTIONAL), db=        | new ?{} driver scope        |
 *
 * MEASURED pre-fix, four misclassified shapes (not the three first reported —
 * the `lang=` sidecar WITHOUT `port=` was claimed too, because the §23.4
 * carve-out keyed on `port=` alone):
 *
 *   name= + mode="wasm"       ->  app.calc.worker.js       25 bytes
 *   name= + route=            ->  app.api.worker.js        71 bytes
 *   name= + db=               ->  app.analytics.worker.js  68 bytes
 *   name= + lang= (no port=)  ->  app.ml2.worker.js        24 bytes
 *
 * Every one of them also emitted `new Worker("…")` in the client. THIS IS WORSE
 * THAN A 404. A 404 fires the client's `.onerror` path — loud. A 25-byte bundle
 * containing one comment line returns 200, LOADS, and never assigns
 * `self.onmessage`, so `<#calc>.send()` returns a Promise that never resolves:
 * a silent hang.
 *
 * THE FIX follows the precedent that was already in the same function. The
 * §23.4 sidecar carve-out spliced a `port=` nested program WITHOUT registering
 * a worker, and its own comment stated the rule — a reference to a
 * never-emitted bundle "is the misleading client stub the fail-closed build
 * must NOT produce". The other shapes were simply missed by that carve-out;
 * `compiler/src/nested-program-kind.ts` generalizes it from `port=` to the
 * whole §4.12.3 table, and is shared with `symbol-table.ts` so the extraction
 * decision and the E-CHANNEL-INSIDE-NESTED-PROGRAM refusal cannot drift.
 *
 * THE CENTRAL INVARIANT here is stated over the ARTIFACT SET, not over
 * filenames, so it keeps biting through any future rename:
 *
 *   for every shape: (a) every `new Worker("…")` in the written client bundle
 *   names a file that exists on disk, AND (b) no `.worker.js` file exists on
 *   disk that nothing references.
 *
 * Both halves are needed. Round 1 satisfied (a) by WRITING the bogus bundles —
 * which is exactly how the loud 404 became the silent hang.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "np-ctx-gate-"));
});
afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

/** Compile one source string into its own dist dir and report what landed. */
function build(dir, src, opts = {}) {
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
    ...opts,
  });
  const listed = existsSync(outDir) ? readdirSync(outDir) : [];
  const read = (name) => (existsSync(join(outDir, name)) ? readFileSync(join(outDir, name), "utf8") : null);
  return {
    outDir,
    files: listed,
    workerFilesOnDisk: listed.filter((f) => f.endsWith(".worker.js")).sort(),
    errors: result.errors ?? [],
    warnings: result.warnings ?? [],
    clientJs: read("app.client.js"),
    serverJs: read("app.server.js"),
    html: read("app.html"),
  };
}

const codesOf = (o) => [...o.errors, ...o.warnings].map((e) => e.code);

/** Every `new Worker("…")` specifier in the written client bundle. */
const workerRefs = (o) =>
  [...(o.clientJs ?? "").matchAll(/new Worker\("([^"]+)"\)/g)].map((m) => m[1]).sort();

const clientDials = (o) =>
  [...new Set([...(o.clientJs ?? "").matchAll(/_scrml_ws\/([a-z0-9_]+)/g)].map((m) => m[1]))].sort();
const serverRoutes = (o) =>
  [...new Set([...(o.serverJs ?? "").matchAll(/_scrml_route_ws_([a-z0-9_]+)/g)].map((m) => m[1]))].sort();

/**
 * The two-sided artifact invariant. (a) no reference without a file;
 * (b) no worker file without a reference.
 */
function assertWorkerArtifactsAreCoherent(o) {
  const refs = workerRefs(o);
  for (const spec of refs) {
    expect({ spec, exists: existsSync(join(o.outDir, spec)) }).toEqual({ spec, exists: true });
  }
  expect({ unreferencedWorkerFiles: o.workerFilesOnDisk.filter((f) => !refs.includes(f)) })
    .toEqual({ unreferencedWorkerFiles: [] });
}

// ---------------------------------------------------------------------------
// The CONTROL. The one shape that has a runtime must keep everything it had.
// ---------------------------------------------------------------------------

const INLINE_WORKER = `<program>

<program name="doubler">
    \${
        when message(data) {
            send({ result: data.value * 2 })
        }
    }
</>

\${
    <value>  = 21
    <result> = not

    function runDoubler() {
        <#doubler>.send({ value: @value })
    }

    when message from <#doubler> (data) {
        @result = data.result
    }
}

<div>
    <button onclick=runDoubler()>Double it</>
    <p if=(@result is some)>Result: \${@result}</>
</>

</program>
`;

describe("§4.12.4 inline worker — the one implemented context, unchanged", () => {
  test("registers a worker, writes the bundle, and references exactly it", () => {
    const o = build("control", INLINE_WORKER);
    expect(o.errors).toEqual([]);
    expect(workerRefs(o)).toEqual(["app.doubler.worker.js"]);
    expect(o.workerFilesOnDisk).toEqual(["app.doubler.worker.js"]);
    assertWorkerArtifactsAreCoherent(o);
    // and the bundle is a real worker, not a stub: it installs a message hook.
    const bundle = readFileSync(join(o.outDir, "app.doubler.worker.js"), "utf8");
    expect(bundle).toContain("self.onmessage");
    expect(bundle).toContain("self.postMessage");
  });
});

// ---------------------------------------------------------------------------
// The four misclassified shapes.
// ---------------------------------------------------------------------------

const WASM_MODULE = `<program>

<out> = not

<program name="calc" lang="rust" mode="wasm">
    \${ export function fib(n: number) -> number }
</>

<p>\${@out}</p>

</program>
`;

const ROUTE_ENDPOINT = `<program>

<out> = not

<program name="api" route="/api/v1">
    \${ function handler(req) { return { ok: true } } }
</>

<p>\${@out}</p>

</program>
`;

const SIDECAR_NO_PORT = `<program>

<out> = not

<program name="ml2" lang="go" build="go build -o ./bin/ml ./cmd/ml">
    \${ export function predict(n: number) -> number }
</>

<p>\${@out}</p>

</program>
`;

const SIDECAR_WITH_PORT = `<program>

<out> = not

<program name="ml" lang="go" build="go build -o ./bin/ml ./cmd/ml" port="9001" health="/health">
    \${ export function predict(n: number) -> number }
</>

<p>\${@out}</p>

</program>
`;

/**
 * The two sidecar spellings above, each CLAIMED by a `use foreign:` in the
 * parent. §23.4's carve-out is what these exercise: with a `use foreign:` present
 * there IS a site for `E-FOREIGN-SIDECAR-NOMINAL` to fire at, so the declaration
 * must stay quiet. Without one — the fixtures above — the declaration is the only
 * place a diagnostic can go.
 */
const SIDECAR_NO_PORT_CLAIMED = `<program>

<out> = not

<program name="ml2" lang="go" build="go build -o ./bin/ml ./cmd/ml">
    \${ export function predict(n: number) -> number }
</>

\${
    use foreign:ml2 { predict }
}

<p>\${@out}</p>

</program>
`;

const SIDECAR_WITH_PORT_CLAIMED = `<program>

<out> = not

<program name="ml" lang="go" build="go build -o ./bin/ml ./cmd/ml" port="9001" health="/health">
    \${ export function predict(n: number) -> number }
</>

\${
    use foreign:ml { predict }
}

<p>\${@out}</p>

</program>
`;

const NAMED_SCOPED_DB = `<program db="sqlite:./primary.db">

<program name="analytics" db="sqlite:./metrics.db">
    <channel name="metrics-feed">
        <items> = []
    </channel>
</>

<p>n: \${@items.length}</p>

</program>
`;

describe("§4.12.3 WASM compute module — no Worker ref, no bundle, a named refusal", () => {
  test("fails closed with E-NESTED-PROGRAM-CONTEXT-NOMINAL naming the context", () => {
    const o = build("wasm", WASM_MODULE);
    const hit = o.errors.find((e) => e.code === "E-NESTED-PROGRAM-CONTEXT-NOMINAL");
    expect(hit).toBeDefined();
    expect(hit.severity).toBe("error");
    // The message must name the SHAPE and the RUNTIME MODEL it does not build —
    // a diagnostic that does not name the root cause is itself a diagnostic bug.
    expect(hit.message).toContain('<program name="calc">');
    expect(hit.message).toContain("WASM COMPUTE MODULE");
    expect(hit.message).toContain("WebAssembly.instantiate()");
    expect(hit.message).toContain("Nominal/spec-ahead");
  });

  test("emits NEITHER a new Worker(...) reference NOR a bundle", () => {
    const o = build("wasm2", WASM_MODULE);
    expect(workerRefs(o)).toEqual([]);
    expect(o.workerFilesOnDisk).toEqual([]);
    assertWorkerArtifactsAreCoherent(o);
  });
});

describe("§4.12.2 route= server endpoint — no Worker ref, no bundle, a named refusal", () => {
  test("fails closed with E-NESTED-PROGRAM-CONTEXT-NOMINAL naming the context", () => {
    const o = build("route", ROUTE_ENDPOINT);
    const hit = o.errors.find((e) => e.code === "E-NESTED-PROGRAM-CONTEXT-NOMINAL");
    expect(hit).toBeDefined();
    expect(hit.message).toContain('<program name="api">');
    expect(hit.message).toContain("SERVER ENDPOINT");
  });

  test("emits NEITHER a new Worker(...) reference NOR a bundle", () => {
    const o = build("route2", ROUTE_ENDPOINT);
    expect(workerRefs(o)).toEqual([]);
    expect(o.workerFilesOnDisk).toEqual([]);
    assertWorkerArtifactsAreCoherent(o);
  });
});

describe("§4.12.5 foreign sidecar — §23.4 owns the diagnostic, both spellings", () => {
  test("lang= WITHOUT port= is a sidecar too: no Worker ref, no bundle", () => {
    // The shape the pre-existing §23.4 carve-out missed — it keyed on `port=`
    // alone, so `<program name="ml2" lang="go">` was compiled as a web worker
    // and shipped a 24-byte stub.
    const o = build("sidecar-noport", SIDECAR_NO_PORT);
    expect(workerRefs(o)).toEqual([]);
    expect(o.workerFilesOnDisk).toEqual([]);
    assertWorkerArtifactsAreCoherent(o);
  });

  test("a CLAIMED sidecar does NOT also fire E-NESTED-PROGRAM-CONTEXT-NOMINAL", () => {
    // Deliberate, and unchanged. §23.4 already fails the sidecar closed at the
    // `use foreign:name { … }` site with the ratified E-FOREIGN-SIDECAR-NOMINAL.
    // Firing a second code at the declaration would put two errors on one
    // unbuilt shape — two diagnostics for one mistake.
    //
    // CORRECTED S356 r3: this used to assert the absence on the two fixtures
    // above, which declare a sidecar and NEVER `use foreign:` it. That made the
    // carve-out UNCONDITIONAL, and an unconditional carve-out suppresses the ONLY
    // diagnostic when there is no `use foreign:` to fire at — the shape compiled
    // exit 0 with its body silently discarded. The rule is one-diagnostic-per-
    // mistake, so the fixtures here now actually claim their sidecar. See
    // `nested-program-sidecar-unclaimed.test.js` for the other half.
    for (const [dir, src] of [["sc-a", SIDECAR_NO_PORT_CLAIMED], ["sc-b", SIDECAR_WITH_PORT_CLAIMED]]) {
      const o = build(dir, src);
      expect(codesOf(o)).toContain("E-FOREIGN-SIDECAR-NOMINAL");
      expect(codesOf(o)).not.toContain("E-NESTED-PROGRAM-CONTEXT-NOMINAL");
    }
  });

  test("an UNCLAIMED sidecar IS refused at its declaration", () => {
    // The gap the unconditional carve-out left open. Both spellings, so the
    // `port=`-less one cannot regress back into silence.
    for (const [dir, src] of [["sc-u-a", SIDECAR_NO_PORT], ["sc-u-b", SIDECAR_WITH_PORT]]) {
      const o = build(dir, src);
      expect(codesOf(o)).toContain("E-NESTED-PROGRAM-CONTEXT-NOMINAL");
      // Still no worker artifacts either way — the round-2 guarantee holds.
      expect(workerRefs(o)).toEqual([]);
      expect(o.workerFilesOnDisk).toEqual([]);
    }
  });

  test("the §23.4 port= carve-out is preserved exactly", () => {
    const o = build("sidecar-port", SIDECAR_WITH_PORT);
    expect(workerRefs(o)).toEqual([]);
    expect(o.workerFilesOnDisk).toEqual([]);
    assertWorkerArtifactsAreCoherent(o);
  });
});

describe("§4.12.6 scoped DB context — implemented, so it is NOT refused and NOT extracted", () => {
  test("a NAMED scoped-DB program compiles clean and keeps its channel", () => {
    // §4.12.3: `Scoped DB context | name= (optional), db=`. The `name=`-keyed
    // extractor claimed this LEGAL shape as a worker, which cascaded into a
    // false-positive E-CHANNEL-INSIDE-NESTED-PROGRAM on the channel inside it.
    const o = build("scoped-db", NAMED_SCOPED_DB);
    expect(o.errors).toEqual([]);
    expect(codesOf(o)).not.toContain("E-CHANNEL-INSIDE-NESTED-PROGRAM");
    expect(codesOf(o)).not.toContain("E-NESTED-PROGRAM-CONTEXT-NOMINAL");
  });

  test("its subtree stays in the tree: client dial and server route pair up", () => {
    const o = build("scoped-db2", NAMED_SCOPED_DB);
    expect(clientDials(o)).toEqual(["metrics_feed"]);
    expect(serverRoutes(o)).toEqual(["metrics_feed"]);
    expect(clientDials(o)).toEqual(serverRoutes(o));
    expect(o.workerFilesOnDisk).toEqual([]);
    assertWorkerArtifactsAreCoherent(o);
  });
});

  test("its markup children RENDER — the name=/no-name= spellings agree", () => {
    // A second site carried the same over-claim: `emit-html.ts` short-circuited
    // on `if (nameAttr) return` ("named programs are worker bundles"), so the
    // markup inside a NAMED scoped-DB context was silently dropped while the
    // identical `name=`-less form rendered. Found by executing the top-level
    // case, not by reading.
    const named = build("scoped-db-html-named", `<program db="sqlite:./primary.db">
  <program name="analytics" db="sqlite:./metrics.db">
    <p>inner marker</p>
  </>
  <p>outer marker</p>
</program>
`);
    const unnamed = build("scoped-db-html-unnamed", `<program db="sqlite:./primary.db">
  <program db="sqlite:./metrics.db">
    <p>inner marker</p>
  </>
  <p>outer marker</p>
</program>
`);
    expect(named.html).toContain("inner marker");
    expect(named.html).toContain("outer marker");
    expect(unnamed.html).toContain("inner marker");
  });

// ---------------------------------------------------------------------------
// §4.12.2 — the top-level `<program>` MUST NOT carry `name=`.
// ---------------------------------------------------------------------------

const TOP_LEVEL_NAMED = `<program name="w">

<channel name="top-feed">
    <items> = []
</channel>

<div>n: \${@items.length}</>

</program>
`;

describe("§4.12.2 top-level <program name=> — the extraction pre-pass is depth-aware", () => {
  test("W-PROGRAM-TOP-LEVEL-NAME fires, quoting the SPEC sentence it enforces", () => {
    const o = build("toplevel", TOP_LEVEL_NAMED);
    const hit = [...o.errors, ...o.warnings].find((e) => e.code === "W-PROGRAM-TOP-LEVEL-NAME");
    expect(hit).toBeDefined();
    expect(hit.severity).toBe("warning");
    expect(hit.message).toContain("MUST NOT have a `name=` attribute");
  });

  test("the document is NOT annihilated: body, client bundle and channel survive", () => {
    // Pre-fix, the root `<program name="w">` was spliced out as an inline
    // worker: `<body>` emitted EMPTY, the client bundle was a shell, and the
    // channel vanished with zero diagnostics (errors=[], dials=[], routes=[]).
    const o = build("toplevel2", TOP_LEVEL_NAMED);
    expect(o.errors).toEqual([]);
    expect(workerRefs(o)).toEqual([]);
    expect(o.workerFilesOnDisk).toEqual([]);
    expect(o.html).toContain("n:");
    expect(clientDials(o)).toEqual(["top_feed"]);
    expect(serverRoutes(o)).toEqual(["top_feed"]);
    assertWorkerArtifactsAreCoherent(o);
  });

  test("a NESTED worker under a top-level named program still extracts normally", () => {
    // The depth guard must exclude the root ONLY. Regression pin against
    // "fixed the root by disabling extraction".
    const o = build("toplevel3", `<program name="w">

<program name="doubler">
    \${ when message(data) { send({ result: data.value * 2 }) } }
</>

\${
    <out> = not
    function go() { <#doubler>.send({ value: 1 }) }
    when message from <#doubler> (d) { @out = d.result }
}

<div><button onclick=go()>Go</></>

</program>
`);
    expect(codesOf(o)).toContain("W-PROGRAM-TOP-LEVEL-NAME");
    expect(workerRefs(o)).toEqual(["app.doubler.worker.js"]);
    expect(o.workerFilesOnDisk).toEqual(["app.doubler.worker.js"]);
    assertWorkerArtifactsAreCoherent(o);
  });

  test("an UNNAMED top-level <program> stays silent", () => {
    const o = build("toplevel4", INLINE_WORKER);
    expect(codesOf(o)).not.toContain("W-PROGRAM-TOP-LEVEL-NAME");
  });
});

// ---------------------------------------------------------------------------
// Cross-shape sweep — the invariant over the whole §4.12.3 table at once.
// ---------------------------------------------------------------------------

describe("§4.12.3 — the artifact invariant holds for EVERY execution context", () => {
  const SHAPES = {
    "inline-worker": INLINE_WORKER,
    "wasm-module": WASM_MODULE,
    "route-endpoint": ROUTE_ENDPOINT,
    "sidecar-no-port": SIDECAR_NO_PORT,
    "sidecar-with-port": SIDECAR_WITH_PORT,
    "named-scoped-db": NAMED_SCOPED_DB,
    "top-level-named": TOP_LEVEL_NAMED,
  };

  test("no reference without a file, and no worker file without a reference", () => {
    for (const [name, src] of Object.entries(SHAPES)) {
      const o = build(`sweep-${name}`, src);
      assertWorkerArtifactsAreCoherent(o);
    }
  });

  test("exactly one shape produces a worker artifact at all", () => {
    const producing = [];
    for (const [name, src] of Object.entries(SHAPES)) {
      const o = build(`sweep2-${name}`, src);
      if (o.workerFilesOnDisk.length > 0 || workerRefs(o).length > 0) producing.push(name);
    }
    expect(producing).toEqual(["inline-worker"]);
  });

  test("every client WS dial has a matching server route, in every shape", () => {
    for (const [name, src] of Object.entries(SHAPES)) {
      const o = build(`sweep3-${name}`, src);
      expect({ shape: name, dials: clientDials(o) })
        .toEqual({ shape: name, dials: serverRoutes(o) });
    }
  });
});
