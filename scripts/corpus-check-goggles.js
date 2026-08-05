#!/usr/bin/env node
/**
 * corpus-check-goggles — batch syntax checker for `corpus-emit-differential.ts`.
 *
 * WHY THIS FILE EXISTS (three separate reasons, each one measured, not assumed)
 * ===========================================================================
 *
 * 1. `node --check` IS BLIND TO A TOP-LEVEL STRANDED `await`, WHICH IS THE EXACT
 *    FAILURE MODE THE AUTO-AWAIT WORK CAN INTRODUCE.
 *
 *       $ printf 'const x = 1;\nawait fetch("/y");\n' > tla.js
 *       $ node --check tla.js                  ; echo $?    ->  0    (PASSES)
 *       $ node -e 'new (require("vm").Script)(readFileSync("tla.js","utf8"))'
 *                                                           ->  SyntaxError:
 *                          await is only valid in async functions and the top
 *                          level bodies of modules
 *
 *    Node resolves a bare `.js` by module-syntax auto-detection and happily parses
 *    it as a module, where top-level await is legal. But the compiler emits
 *
 *       <script src="scrml-runtime.01ouojs1.js">
 *       <script src="02-counter.client.js">
 *
 *    — no `type="module"`. Client bundles and the shared runtime are loaded as
 *    CLASSIC SCRIPTS, where top-level await is a SyntaxError and the whole bundle
 *    is dead on arrival. A gate built on `node --check` alone certifies bundles
 *    that cannot load.
 *
 * 2. THE GOGGLE MUST BE EXPLICIT, NOT AMBIENT. `node --check`'s verdict is a
 *    function of (content, extension, nearest `package.json` `"type"` field) — an
 *    input that lives OUTSIDE the artifact. Dropping a `package.json` above the
 *    output tree swings the same bytes between pass and fail. `vm.Script` and
 *    `vm.SourceTextModule` take the source text and nothing else, so the verdict
 *    depends only on inputs the manifest actually records.
 *
 * 3. IT MUST RUN UNDER NODE, NOT BUN. Measured:
 *
 *       bun  -e 'new (require("node:vm").Script)("await f();")'   ->  no throw
 *       node -e 'new (require("vm").Script)("await f();")'        ->  SyntaxError
 *
 *    Bun's `vm.Script` does not reject a top-level await. Running the goggles
 *    in-process under Bun would have produced a guard that cannot fail — the very
 *    defect this tool set exists to eliminate. The parent is a Bun script; this
 *    worker is deliberately a separate NODE process.
 *
 * Batched (one process, many files) so the correctness above does not cost a
 * process spawn per artifact.
 *
 * USAGE (invoked by the parent; not intended to be run by hand)
 *   node --experimental-vm-modules corpus-check-goggles.js <jobs.json> <results.json>
 *
 *   jobs.json    : [{ "id": "<opaque>", "path": "<abs>", "goggles": ["script","module"] }]
 *   results.json : { "<id>": { "script": {ok,message}, "module": {ok,message} } }
 */

// ESM, not CommonJS: the repository's root `package.json` declares `"type": "module"`, so a `.js`
// file here IS a module. (Discovered the honest way — the first version used `require` and the
// worker died with a loud non-zero exit, which the parent correctly refused to read as "checks
// passed".)
import vm from "node:vm";
import fs from "node:fs";

const [, , jobsPath, resultsPath] = process.argv;
if (!jobsPath || !resultsPath) {
  console.error("usage: corpus-check-goggles.js <jobs.json> <results.json>");
  process.exit(2);
}

/** Parse `src` as a CLASSIC SCRIPT — the goggle a `<script src=...>` tag uses. */
function checkScript(src, filename) {
  try {
    new vm.Script(src, { filename });
    return { ok: true, message: "" };
  } catch (e) {
    return { ok: false, message: String(e && e.message ? e.message : e) };
  }
}

/**
 * Parse `src` as an ES MODULE — the goggle an `import`ed / `type="module"`
 * artifact uses (server bundles, dynamically-imported route chunks).
 *
 * `SourceTextModule` requires `--experimental-vm-modules`. If it is unavailable
 * we FAIL LOUD rather than silently degrading to "ok" — a check that cannot run
 * must never look like a check that passed.
 */
function checkModule(src, filename) {
  if (typeof vm.SourceTextModule !== "function") {
    return { ok: false, message: "HARNESS ERROR: vm.SourceTextModule unavailable (need --experimental-vm-modules)" };
  }
  try {
    new vm.SourceTextModule(src, { identifier: filename });
    return { ok: true, message: "" };
  } catch (e) {
    return { ok: false, message: String(e && e.message ? e.message : e) };
  }
}

const jobs = JSON.parse(fs.readFileSync(jobsPath, "utf8"));
const results = {};

for (const job of jobs) {
  let src;
  try {
    src = fs.readFileSync(job.path, "utf8");
  } catch (e) {
    // Never silently skip. An unreadable artifact is a FINDING on every goggle.
    const msg = `HARNESS ERROR: unreadable (${e.code || e.message})`;
    results[job.id] = { script: { ok: false, message: msg }, module: { ok: false, message: msg } };
    continue;
  }
  const out = {};
  for (const g of job.goggles) {
    out[g] = g === "script" ? checkScript(src, job.path) : checkModule(src, job.path);
  }
  results[job.id] = out;
}

fs.writeFileSync(resultsPath, JSON.stringify(results));
