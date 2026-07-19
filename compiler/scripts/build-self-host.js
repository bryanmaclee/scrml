#!/usr/bin/env bun
/**
 * @script build-self-host
 * Compile scrml self-hosted compiler modules to ES module JS.
 *
 * Compiles stdlib/compiler/*.scrml in library mode and writes output to
 * compiler/dist/self-host/. These compiled modules can then be loaded by
 * the compiler CLI's --self-host flag to replace the JS originals.
 *
 * After compilation, copies any runtime dependencies that the compiled
 * modules require (e.g. expression-parser.js imported by meta-checker).
 *
 * Usage:
 *   bun run compiler/scripts/build-self-host.js
 *   bun compiler/scripts/build-self-host.js [--verbose]
 *
 * Output:
 *   compiler/dist/self-host/module-resolver.js
 *   compiler/dist/self-host/meta-checker.js
 *   compiler/dist/self-host/expression-parser.js  (dependency of meta-checker)
 */

import { mkdirSync, existsSync, copyFileSync, readFileSync } from "fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "path";
import { compileScrml } from "../src/api.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const scriptDir = dirname(fileURLToPath(new URL(import.meta.url)));
const compilerRoot = resolve(scriptDir, "..");           // compiler/
const projectRoot = resolve(compilerRoot, "..");          // scrml8/
const stdlibCompilerDir = resolve(projectRoot, "stdlib", "compiler");
const srcDir = resolve(compilerRoot, "src");
const outputDir = resolve(compilerRoot, "dist", "self-host");

// ---------------------------------------------------------------------------
// Modules to compile
// Each entry: { name, scrmlFile, outputBase }
// ---------------------------------------------------------------------------

const modules = [
  {
    name: "module-resolver",
    scrmlFile: resolve(stdlibCompilerDir, "module-resolver.scrml"),
    outputBase: "module-resolver",
  },
  {
    name: "meta-checker",
    scrmlFile: resolve(stdlibCompilerDir, "meta-checker.scrml"),
    outputBase: "meta-checker",
  },
  {
    name: "block-splitter",
    scrmlFile: resolve(projectRoot, "compiler", "self-host", "bs.scrml"),
    outputBase: "block-splitter",
  },
  {
    name: "body-pre-parser",
    scrmlFile: resolve(projectRoot, "compiler", "self-host", "bpp.scrml"),
    outputBase: "body-pre-parser",
  },
  {
    name: "tokenizer",
    scrmlFile: resolve(projectRoot, "compiler", "self-host", "tab.scrml"),
    outputBase: "tokenizer",
  },
  {
    name: "ast-builder",
    scrmlFile: resolve(projectRoot, "compiler", "self-host", "ast.scrml"),
    outputBase: "ast-builder",
  },
  {
    name: "protect-analyzer",
    scrmlFile: resolve(projectRoot, "compiler", "self-host", "pa.scrml"),
    outputBase: "pa",
  },
  {
    name: "route-inference",
    scrmlFile: resolve(projectRoot, "compiler", "self-host", "ri.scrml"),
    outputBase: "ri",
  },
  {
    name: "type-system",
    scrmlFile: resolve(projectRoot, "compiler", "self-host", "ts.scrml"),
    outputBase: "ts",
  },
  {
    name: "dependency-graph",
    scrmlFile: resolve(projectRoot, "compiler", "self-host", "dg.scrml"),
    outputBase: "dg",
  },
];

// ---------------------------------------------------------------------------
// Runtime dependencies to copy into dist/self-host/
//
// Compiled modules may reference relative JS files via ^{} imports.
// For example, meta-checker.scrml has:
//   ^{ const { extractIdentifiersFromAST } = await import("./expression-parser.js"); }
//
// The library-mode codegen emits this as a static ES import using the same
// relative path. When loaded from dist/self-host/, the file must be present
// in the same directory.
// ---------------------------------------------------------------------------

const runtimeDeps = [
  {
    name: "expression-parser.js",
    src: resolve(srcDir, "expression-parser.ts"),
    // Required by: meta-checker.js (from ^{} import)
  },
];

// ---------------------------------------------------------------------------
// Post-compilation aliases
//
// Some compiled modules import each other by names that differ from the
// scrml input filename. Create symlinks/copies to satisfy these imports.
// ---------------------------------------------------------------------------

const aliases = [
  {
    // ast.js imports "./tokenizer.js" but the file is compiled as "tab.js"
    src: "tab.js",
    alias: "tokenizer.js",
  },
];

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("scrml build-self-host: compiling self-hosted compiler modules");
console.log(`  output: ${outputDir}`);
console.log("");

// Ensure output directory exists
mkdirSync(outputDir, { recursive: true });

let allPassed = true;

// Step 1: Compile scrml modules
for (const mod of modules) {
  if (!existsSync(mod.scrmlFile)) {
    console.error(`  SKIP  ${mod.name} — source not found: ${mod.scrmlFile}`);
    continue;
  }

  const start = performance.now();

  try {
    const result = compileScrml({
      inputFiles: [mod.scrmlFile],
      outputDir,
      mode: "library",
      write: true,
      verbose,
      log: verbose ? console.log : () => {},
    });

    const ms = (performance.now() - start).toFixed(1);

    // E-ROUTE-001 warnings are non-fatal — self-hosted code has no protected fields
    const fatalErrors = result.errors.filter(e => e.code !== "E-ROUTE-001");
    const routeWarnings = result.errors.filter(e => e.code === "E-ROUTE-001");

    if (fatalErrors.length > 0) {
      console.error(`  FAIL  ${mod.name} (${ms}ms) — ${fatalErrors.length} error(s):`);
      for (const err of fatalErrors) {
        console.error(`         [${err.code || "?"}] ${err.message}`);
        if (err.line) console.error(`         at line ${err.line}`);
      }
      allPassed = false;
    } else {
      const outputFile = join(outputDir, `${mod.outputBase}.js`);
      console.log(`  PASS  ${mod.name} (${ms}ms) → ${outputFile}`);
      if (routeWarnings.length > 0) {
        console.log(`         (${routeWarnings.length} non-fatal E-ROUTE-001 warnings suppressed)`);
      }
      if (result.warnings.length > 0) {
        for (const w of result.warnings) {
          console.log(`         warn: [${w.code || "?"}] ${w.message}`);
        }
      }
    }
  } catch (err) {
    const ms = (performance.now() - start).toFixed(1);
    console.error(`  CRASH ${mod.name} (${ms}ms): ${err.message}`);
    if (verbose && err.stack) {
      console.error(err.stack);
    }
    allPassed = false;
  }
}

// Step 2: Copy runtime dependencies
console.log("");
console.log("Copying runtime dependencies:");
for (const dep of runtimeDeps) {
  if (!existsSync(dep.src)) {
    console.error(`  SKIP  ${dep.name} — source not found: ${dep.src}`);
    continue;
  }
  const destPath = join(outputDir, dep.name);
  try {
    if (dep.src.endsWith(".ts")) {
      // Transpile TS → JS using Bun's transpiler (strips type annotations)
      const transpiler = new Bun.Transpiler({ loader: "ts" });
      const source = readFileSync(dep.src, "utf8");
      const js = transpiler.transformSync(source);
      const { writeFileSync } = await import("fs");
      writeFileSync(destPath, js);
      console.log(`  TRANSPILE  ${dep.name} (ts→js) → ${destPath}`);
    } else {
      copyFileSync(dep.src, destPath);
      console.log(`  COPY  ${dep.name} → ${destPath}`);
    }
  } catch (err) {
    console.error(`  FAIL  ${dep.name}: ${err.message}`);
    allPassed = false;
  }
}

// Step 2.4: Normalize sibling-dep import specifiers.
//
// compileScrml (write: true) runs rewriteRelativeImportPaths, which relocates a
// module's relative imports from its SOURCE dir to outputDir. For self-host that
// mis-fires on the runtime deps copied in above as dist SIBLINGS: e.g.
// meta-checker's `./expression-parser.js` is rewritten to
// `../../../stdlib/compiler/expression-parser.js` (a path that does not exist),
// breaking the emitted module and self-compilation.test.js. Since every
// runtimeDep is copied as a sibling of the compiled modules, any import of one
// must resolve as `./<dep>`. Rewrite them back here.
console.log("");
console.log("Normalizing sibling-dep imports:");
for (const mod of modules) {
  const modPath = join(outputDir, `${mod.outputBase}.js`);
  if (!existsSync(modPath)) continue;
  let src = readFileSync(modPath, "utf8");
  let changed = false;
  for (const dep of runtimeDeps) {
    const escaped = dep.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(["'])(?:[^"']*\\/)?${escaped}\\1`, "g");
    const next = src.replace(re, (_m, q) => `${q}./${dep.name}${q}`);
    if (next !== src) { src = next; changed = true; }
  }
  if (changed) {
    const { writeFileSync } = await import("fs");
    writeFileSync(modPath, src);
    console.log(`  FIX    ${mod.outputBase}.js — sibling-dep import → ./`);
  }
}

// Step 2.5: Create aliases for cross-module imports
console.log("");
console.log("Creating module aliases:");
for (const { src, alias } of aliases) {
  const srcPath = join(outputDir, src);
  const aliasPath = join(outputDir, alias);
  if (existsSync(srcPath)) {
    copyFileSync(srcPath, aliasPath);
    console.log(`  ALIAS  ${src} → ${alias}`);
  }
}

// Step 3: Assemble CG (codegen) from pre-ported JS sections
//
// The CG stage is 32 files / ~13K lines of code-generating JavaScript.
// These files emit JS code strings containing braces that confuse the
// block splitter's brace-depth tracking. Rather than fighting the BS,
// we concatenate the ported JS sections directly into an ES module.
console.log("");
console.log("Assembling CG (codegen) from sections:");
const cgSections = [
  "section-core.js",
  "section-rewrite.js",
  "section-emit-core.js",
  "section-emit-wiring.js",
  "section-assembly.js",
];
const cgPartsDir = resolve(projectRoot, "compiler", "self-host", "cg-parts");
const cgOutputPath = join(outputDir, "cg.js");
try {
  let cgContent = "// Self-hosted CG — assembled from ported JS sections\n";
  for (const section of cgSections) {
    const sectionPath = join(cgPartsDir, section);
    if (!existsSync(sectionPath)) {
      console.error(`  SKIP  ${section} — not found`);
      allPassed = false;
      continue;
    }
    cgContent += `\n// --- ${section} ---\n`;
    cgContent += readFileSync(sectionPath, "utf8");
    console.log(`  INCLUDE  ${section}`);
  }
  const { writeFileSync: _writeSync } = await import("fs");
  _writeSync(cgOutputPath, cgContent);
  console.log(`  ASSEMBLED  cg.js → ${cgOutputPath}`);
} catch (err) {
  console.error(`  FAIL  cg.js: ${err.message}`);
  allPassed = false;
}

console.log("");
if (allPassed) {
  console.log("All self-hosted modules compiled successfully.");
  process.exit(0);
} else {
  console.error("One or more modules failed to compile.");
  process.exit(1);
}
