/**
 * corpus-emitted-specifier-resolution.test.js — S302.
 *
 * DOES EVERY SPECIFIER THE COMPILER EMITS ACTUALLY RESOLVE ON DISK?
 *
 * This is the check that keeps not being run. A missing FILE is not a syntax
 * error, so `node --check` passes, `acorn.parse` passes, and the suite never
 * executes emitted server/tool bundles — which is precisely why this class has
 * survived a green suite three separate times:
 *
 *   - S296 (D-4): 23 of 24 server import specifiers in THIS app dangled on
 *     `main`, with a clean compile. `W-SERVER-IMPORT-UNEMITTED` existed to
 *     catch exactly that and was structurally blind to it, because it worked in
 *     SOURCE-path space — the one space where the path is always
 *     self-consistent. (The oracle inherited the implementation's assumption:
 *     the S276 shape.)
 *   - S296 deferred two siblings of the same class, both still live.
 *   - S302: four `<script src>` refs in this app's channel shells dangle today.
 *
 * `d4-server-import-dist-space.test.js` (S296) built the right oracle but
 * scoped it to `.server.js` artifacts in its own synthetic fixtures. The blind
 * spot MOVED rather than closed. This test generalizes that predicate along the
 * two axes it did not cover — ALL emitted `.js` (tool / library / client, not
 * just `.server.js`) and HTML `<script src>` — and runs it over a REAL corpus
 * app rather than a fixture.
 *
 * ── ON THE ALLOWLIST (read before adding to it) ──────────────────────────────
 * §2 asserts the HTML danglers equal a DOCUMENTED set, not zero. `pa-base` §8
 * forbids retrofitting a hard gate onto an existing non-compliant backlog: a
 * gate that is instantly red for reasons no change caused is the cry-wolf shape
 * that gets bypassed and then deleted. So the known-broken set is pinned with
 * its gap id and this test guards against REGRESSION — a new dangler fails, and
 * FIXING one also fails (the set shrinks), which is what forces the allowlist to
 * be maintained rather than to rot. Shrink it when the gap closes; do not grow
 * it without a gap id.
 *
 * SPEC anchors: §47.9.5 (leading `pages/` strip), §47.9.2, §40.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  readdirSync, statSync, readFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync,
} from "fs";
import { join, dirname, resolve as pathResolve } from "path";
import { tmpdir } from "os";

const REPO_ROOT = pathResolve(import.meta.dir, "../../..");
const CLI = join(REPO_ROOT, "compiler/bin/scrml.js");
const APP = join(REPO_ROOT, "examples/23-trucking-dispatch");

/** Every file under `root`, recursively. */
function allFiles(root, out = []) {
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    if (statSync(p).isDirectory()) allFiles(p, out);
    else out.push(p);
  }
  return out;
}

/**
 * Relative ESM import specifiers in EVERY emitted `.js` — deliberately NOT
 * filtered to `.server.js` (that filter is the S296 oracle's blind spot).
 */
function jsImportSpecifiers(root) {
  const out = [];
  for (const f of allFiles(root)) {
    if (!f.endsWith(".js")) continue;
    const re = /^\s*import\s+[^;]*?\s*from\s*["'](\.\.?\/[^"']+)["']/gm;
    let m;
    const src = readFileSync(f, "utf8");
    while ((m = re.exec(src))) out.push({ file: f, spec: m[1] });
  }
  return out;
}

/** Local `<script src>` refs in every emitted `.html` (absolute/protocol URLs skipped). */
function scriptSrcSpecifiers(root) {
  const out = [];
  for (const f of allFiles(root)) {
    if (!f.endsWith(".html")) continue;
    const re = /<script[^>]+src=["']([^"']+)["']/g;
    let m;
    const src = readFileSync(f, "utf8");
    while ((m = re.exec(src))) {
      const spec = m[1];
      if (/^(https?:)?\/\//.test(spec) || spec.startsWith("data:")) continue;
      out.push({ file: f, spec });
    }
  }
  return out;
}

const dangling = (specs) =>
  specs
    .filter(({ file, spec }) => !existsSync(pathResolve(dirname(file), spec)))
    .map(({ file, spec }) => `${file.slice(OUT.length + 1)} -> ${spec}`)
    .sort();

/**
 * KNOWN-BROKEN, pinned to a gap. Every entry here is a real runtime failure.
 *
 * [[g-nested-flatpage-runtime-bare-ref]] — a `<channel>` shell emits a BARE
 * runtime ref (`scrml-runtime.<hash>.js`) while living at dist depth 1, so it
 * 404s. The contrast is the proof it is emitter-specific rather than
 * depth-specific: `dispatch/board.html` — a PAGE at the same depth — correctly
 * emits `../scrml-runtime.<hash>.js`. With the runtime 404'd these shells are
 * dead, and their chunk calls `_scrml_reactive_set` / `_scrml_init_set`.
 *
 * NB the gap entry's scoping claim is WRONG and is corrected in known-gaps: it
 * argues single-segment `pages/` routes are safe because the strip lands them at
 * dist root. Channels are NOT under `pages/`, are never stripped, and therefore
 * break at depth 1.
 */
const KNOWN_DANGLING_SCRIPT_SRC = [
  "channels/customer-events.html -> scrml-runtime",
  "channels/dispatch-board.html -> scrml-runtime",
  "channels/driver-events.html -> scrml-runtime",
  "channels/load-events.html -> scrml-runtime",
];

/** Hashes are content-addressed (§47) and move with any source edit — compare hash-free. */
const stripHash = (s) => s.replace(/scrml-runtime\.[a-z0-9]+\.js/g, "scrml-runtime");

let OUT;

beforeAll(async () => {
  OUT = mkdtempSync(join(tmpdir(), "scrml-specifier-sweep-"));
  const proc = Bun.spawn(["bun", CLI, "compile", APP, "--output-dir", OUT], {
    stdout: "pipe", stderr: "pipe", cwd: REPO_ROOT,
  });
  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  // The app compiles clean today; if that changes, fail LOUDLY here rather than
  // sweeping a half-emitted tree and reporting a misleading dangler count.
  expect({ exitCode, stderr: stderr.slice(0, 800) }).toEqual({ exitCode: 0, stderr: stderr.slice(0, 800) });
});

afterAll(() => { if (OUT) rmSync(OUT, { recursive: true, force: true }); });

describe("corpus emitted-specifier resolution — examples/23-trucking-dispatch", () => {
  test("§1 every relative import specifier in EVERY emitted .js resolves on disk", () => {
    const specs = jsImportSpecifiers(OUT);
    // Guard the guard: if the sweep finds nothing it proves nothing.
    expect(specs.length).toBeGreaterThan(20);
    expect(dangling(specs)).toEqual([]);
  });

  test("§2 <script src> refs resolve, except the pinned known-broken set", () => {
    const specs = scriptSrcSpecifiers(OUT);
    expect(specs.length).toBeGreaterThan(100);
    expect(dangling(specs).map(stripHash)).toEqual(KNOWN_DANGLING_SCRIPT_SRC);
  });

  test("§3 the predicate BITES — a deliberately broken specifier is detected", () => {
    // pa-base §8: a gate that has never failed is indistinguishable from one that
    // CANNOT fail. Prove the bite in-place rather than trusting the green above.
    const probe = mkdtempSync(join(tmpdir(), "scrml-specifier-bite-"));
    try {
      mkdirSync(join(probe, "sub"), { recursive: true });
      writeFileSync(join(probe, "sub", "a.js"), `import { x } from "../nope/missing.js";\n`);
      writeFileSync(join(probe, "ok.js"), `import { y } from "./sub/a.js";\n`);
      writeFileSync(join(probe, "p.html"), `<script src="./sub/a.js"></script><script src="./gone.js"></script>`);

      const js = jsImportSpecifiers(probe);
      const bad = js.filter(({ file, spec }) => !existsSync(pathResolve(dirname(file), spec)));
      expect(bad.map((b) => b.spec)).toEqual(["../nope/missing.js"]); // the resolving one is NOT flagged

      const html = scriptSrcSpecifiers(probe);
      const badSrc = html.filter(({ file, spec }) => !existsSync(pathResolve(dirname(file), spec)));
      expect(badSrc.map((b) => b.spec)).toEqual(["./gone.js"]);
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
  });
});
