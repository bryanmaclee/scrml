/**
 * g-nested-program-emits-artifacts-it-never-produces (HIGH) — the client bundle
 * emitted `new Worker("<name>.worker.js")` for every §4.12.4 inline worker, but
 * NOTHING in the tree ever wrote that file. `runCG` produced the bundles
 * (`CgFileOutput.workerBundles`) and `api.js`'s write loop had zero mentions of
 * `worker`, so the reference 404'd at runtime on every build. Exit 0, no
 * diagnostic.
 *
 * The invariant these tests pin is deliberately stated as "every `new Worker(...)`
 * ref in a written client bundle names a file that EXISTS on disk" rather than a
 * literal filename, so it survives a future rename of the artifact convention.
 *
 * Naming: the artifact is `<sourceBase>.<workerName>.worker.js`, NOT a bare
 * `<workerName>.worker.js`. Two sibling pages each declaring a generically-named
 * worker (`doubler`, `parser`, …) would otherwise both compile to the same dist
 * path and hard-fail on E-CG-015 — a legal program refusing to build. The
 * source-base prefix is the same disambiguator every sibling artifact
 * (`.client.js`, `.server.js`, `.css`) already uses, and it rides `pathFor` /
 * `writeOutput` unchanged (so the `pages/` strip + nested dirs come for free).
 *
 * SPEC §4.12.4 specifies "The nested program is compiled as a separate worker
 * bundle" and does NOT normatively name the emitted file.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { fnv1aHash } from "../../src/codegen/fnv1a-hash.ts";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "worker-artifact-"));
});
afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

const WORKER_APP = `<program>

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

// §4.12.5 sidecar — `lang=` + `port=` and no `mode="wasm"`. The compiler
// deliberately splices this WITHOUT registering a worker (codegen/index.ts
// §23.4 carve-out) precisely so it never emits a reference to a bundle it does
// not produce. That carve-out must survive this fix.
const SIDECAR_APP = `<program>

<program name="ml" lang="go" build="go build -o ./bin/ml ./cmd/ml" port="9001" health="/health">
    \${ export function predict(req) -> number }
</>

\${
    <value> = 1
}

<div>
    <p>\${@value}</>
</>

</program>
`;

function writeApp(dir, files) {
  const root = join(TMP, dir);
  mkdirSync(root, { recursive: true });
  const out = {};
  for (const [name, src] of Object.entries(files)) {
    const p = join(root, name);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, src);
    out[name] = p;
  }
  return { root, files: out };
}

/**
 * The load-bearing invariant, checked against BYTES ON DISK: pull every
 * `new Worker("…")` specifier out of a written client bundle and assert each
 * one resolves to a file that exists in the same dist dir the bundle sits in.
 * Returns the specifiers so callers can make further assertions.
 */
function assertNoDanglingWorkerRefs(clientJsPath) {
  const js = readFileSync(clientJsPath, "utf8");
  const dir = join(clientJsPath, "..");
  const specs = [...js.matchAll(/new Worker\("([^"]+)"\)/g)].map((m) => m[1]);
  for (const spec of specs) {
    expect({ spec, exists: existsSync(join(dir, spec)) }).toEqual({ spec, exists: true });
  }
  return specs;
}

describe("§4.12.4 worker bundles are WRITTEN, not just generated", () => {
  test("a nested <program name> emits a worker file on disk with real content", () => {
    const app = writeApp("basic", { "app.scrml": WORKER_APP });
    const outDir = join(app.root, "dist");
    const result = compileScrml({
      inputFiles: [app.files["app.scrml"]],
      outputDir: outDir,
      write: true,
      log: () => {},
    });
    expect(result.errors.filter((e) => e.severity !== "warning" && e.severity !== "info")).toEqual([]);

    const workerPath = join(outDir, "app.doubler.worker.js");
    expect(existsSync(workerPath)).toBe(true);

    // "Execute, don't grep" precondition — the file is the real generated
    // bundle, not an empty/placeholder write.
    const workerJs = readFileSync(workerPath, "utf8");
    expect(workerJs.length).toBeGreaterThan(0);
    expect(workerJs).toContain("self.onmessage");
    expect(workerJs).toContain("self.postMessage(");
  });

  test("every new Worker() ref in the written client bundle resolves to a file on disk", () => {
    const app = writeApp("dangling", { "app.scrml": WORKER_APP });
    const outDir = join(app.root, "dist");
    compileScrml({
      inputFiles: [app.files["app.scrml"]],
      outputDir: outDir,
      write: true,
      log: () => {},
    });
    const specs = assertNoDanglingWorkerRefs(join(outDir, "app.client.js"));
    expect(specs).toEqual(["app.doubler.worker.js"]);
  });

  test("the written worker bundle EXECUTES: postMessage in, doubled value out", async () => {
    const app = writeApp("execute", { "app.scrml": WORKER_APP });
    const outDir = join(app.root, "dist");
    compileScrml({
      inputFiles: [app.files["app.scrml"]],
      outputDir: outDir,
      write: true,
      log: () => {},
    });
    const workerJs = readFileSync(join(outDir, "app.doubler.worker.js"), "utf8");

    // Run the emitted bundle against a minimal `self` shim and drive one
    // message through it. This is the actual runtime contract (§4.12.4:
    // `when message(data)` fires on postMessage; `send(v)` replies), not a
    // text match on the emitted source.
    const posted = [];
    const shim = { onmessage: null, postMessage: (v) => posted.push(v) };
    const run = new Function("self", `${workerJs}\nreturn self;`);
    run(shim);

    expect(typeof shim.onmessage).toBe("function");
    shim.onmessage({ data: { value: 21 } });
    expect(posted).toEqual([{ result: 42 }]);
  });

  test("two workers in one file emit two distinct bundles, both on disk", () => {
    const src = `<program>

<program name="adder">
    \${ when message(data) { send({ sum: data.a + data.b }) } }
</>

<program name="multiplier">
    \${ when message(data) { send({ product: data.a * data.b }) } }
</>

\${
    <out> = not
    function go() { <#adder>.send({ a: 1, b: 2 }) }
    when message from <#adder> (d) { @out = d.sum }
}

<div><button onclick=go()>Go</></>

</program>
`;
    const app = writeApp("two-workers", { "app.scrml": src });
    const outDir = join(app.root, "dist");
    compileScrml({
      inputFiles: [app.files["app.scrml"]],
      outputDir: outDir,
      write: true,
      log: () => {},
    });
    expect(existsSync(join(outDir, "app.adder.worker.js"))).toBe(true);
    expect(existsSync(join(outDir, "app.multiplier.worker.js"))).toBe(true);
    const specs = assertNoDanglingWorkerRefs(join(outDir, "app.client.js")).sort();
    expect(specs).toEqual(["app.adder.worker.js", "app.multiplier.worker.js"]);
  });

  test("two SIBLING pages each with a same-named worker do not collide (E-CG-015)", () => {
    const mk = (name) => `<program>

<program name="doubler">
    \${ when message(data) { send({ result: data.value * 2 }) } }
</>

\${
    <out> = not
    function go() { <#doubler>.send({ value: 1 }) }
    when message from <#doubler> (d) { @out = d.result }
}

<div><button onclick=go()>${name}</></>

</program>
`;
    const app = writeApp("siblings", { "one.scrml": mk("one"), "two.scrml": mk("two") });
    const outDir = join(app.root, "dist");
    const result = compileScrml({
      inputFiles: [app.files["one.scrml"], app.files["two.scrml"]],
      outputDir: outDir,
      write: true,
      log: () => {},
    });
    // No E-CG-015 conflicting-output-path error: the source-base prefix keeps
    // the two `doubler` bundles apart.
    expect(result.errors.filter((e) => e.code === "E-CG-015")).toEqual([]);
    expect(existsSync(join(outDir, "one.doubler.worker.js"))).toBe(true);
    expect(existsSync(join(outDir, "two.doubler.worker.js"))).toBe(true);
    assertNoDanglingWorkerRefs(join(outDir, "one.client.js"));
    assertNoDanglingWorkerRefs(join(outDir, "two.client.js"));
  });

  test("§23.4 sidecar carve-out survives: no worker ref AND no worker file", () => {
    const app = writeApp("sidecar", { "app.scrml": SIDECAR_APP });
    const outDir = join(app.root, "dist");
    compileScrml({
      inputFiles: [app.files["app.scrml"]],
      outputDir: outDir,
      write: true,
      log: () => {},
    });
    const clientJs = readFileSync(join(outDir, "app.client.js"), "utf8");
    expect(clientJs).not.toContain("new Worker(");
    expect(readdirSync(outDir).filter((f) => f.includes(".worker."))).toEqual([]);
  });
});

describe("§4.12.4 worker bundles under --content-hash-assets", () => {
  test("worker file is content-hashed and the client ref is rewritten to match", () => {
    const app = writeApp("hashed", { "app.scrml": WORKER_APP });
    const outDir = join(app.root, "dist");
    compileScrml({
      inputFiles: [app.files["app.scrml"]],
      outputDir: outDir,
      write: true,
      contentHashAssets: true,
      log: () => {},
    });

    const hashedWorker = readdirSync(outDir).find((f) => /^app\.doubler\.worker\.[0-9a-z]{8}\.js$/.test(f));
    expect(hashedWorker).toBeDefined();
    // The unhashed name must NOT also be emitted.
    expect(existsSync(join(outDir, "app.doubler.worker.js"))).toBe(false);

    const hashedClient = readdirSync(outDir).find((f) => /^app\.client\.[0-9a-z]{8}\.js$/.test(f));
    expect(hashedClient).toBeDefined();
    const specs = assertNoDanglingWorkerRefs(join(outDir, hashedClient));
    expect(specs).toEqual([hashedWorker]);
  });

  test("hashed build: the client bundle's on-disk hash still matches its own bytes", () => {
    const app = writeApp("hash-integrity", { "app.scrml": WORKER_APP });
    const outDir = join(app.root, "dist");
    compileScrml({
      inputFiles: [app.files["app.scrml"]],
      outputDir: outDir,
      write: true,
      contentHashAssets: true,
      log: () => {},
    });
    const hashedClient = readdirSync(outDir).find((f) => /^app\.client\.[0-9a-z]{8}\.js$/.test(f));
    const claimed = hashedClient.match(/^app\.client\.([0-9a-z]{8})\.js$/)[1];
    const bytes = readFileSync(join(outDir, hashedClient), "utf8");
    // The worker-ref rewrite runs BEFORE the client hash is computed, so
    // hash-covers-the-exact-bytes-written (adopter-#82 CRITICAL #3) is preserved.
    expect(fnv1aHash(bytes)).toBe(claimed);
  });
});
