// regression-scan.js — dev-only. Tokenizes a batch of real .scrml samples and
// flags any file whose FINAL token is still inside an embedded block scope
// (meta.embedded.block.css / .javascript / .sql) — a signal of a runaway
// unterminated block (e.g. the pre-S246 #{} mangling). Also flags a tokenizer
// throw. This is a coarse "did I break parsing" gate, not a scope-correctness
// assertion (that is tokenize.js).

const fs = require("fs");
const path = require("path");
const vsctm = require("vscode-textmate");
const oniguruma = require("vscode-oniguruma");

// GRAMMAR_PATH may be overridden with --grammar <path> to compare an alternate
// (e.g. the pre-change committed) grammar. --json emits per-file EOF depth.
const gIdx = process.argv.indexOf("--grammar");
const GRAMMAR_PATH =
  gIdx !== -1
    ? path.resolve(process.argv[gIdx + 1])
    : path.join(__dirname, "..", "syntaxes", "scrml.tmLanguage.json");
const SAMPLES_DIR = path.join(__dirname, "..", "..", "..", "samples", "compilation-tests");
const SCOPE_NAME = "source.scrml";
const EMIT_JSON = process.argv.includes("--json");

function loadOniguruma() {
  const wasmPath = path.join(__dirname, "..", "node_modules", "vscode-oniguruma", "release", "onig.wasm");
  const wasmBin = fs.readFileSync(wasmPath).buffer;
  return oniguruma.loadWASM(wasmBin).then(() => ({
    createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
    createOnigString: (s) => new oniguruma.OnigString(s),
  }));
}

async function main() {
  const registry = new vsctm.Registry({
    onigLib: loadOniguruma(),
    loadGrammar: async (s) =>
      s === SCOPE_NAME ? vsctm.parseRawGrammar(fs.readFileSync(GRAMMAR_PATH, "utf8"), GRAMMAR_PATH) : null,
  });
  const grammar = await registry.loadGrammar(SCOPE_NAME);

  // walk samples dir recursively for .scrml
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".scrml")) files.push(p);
    }
  })(SAMPLES_DIR);

  let scanned = 0;
  let threw = 0;
  const depths = {}; // relPath -> EOF ruleStack depth
  const flagged = [];

  for (const f of files) {
    const rel = path.relative(SAMPLES_DIR, f);
    const src = fs.readFileSync(f, "utf8");
    const lines = src.split(/\r?\n/);
    let ruleStack = vsctm.INITIAL;
    try {
      for (const line of lines) {
        const r = grammar.tokenizeLine(line, ruleStack);
        ruleStack = r.ruleStack;
      }
    } catch (e) {
      threw++;
      flagged.push(`THREW  ${rel}: ${e.message}`);
      continue;
    }
    scanned++;
    // The base ruleStack at EOF has depth 1 (source.scrml). depth > 1 means a
    // begin/end block never closed — the true runaway signature.
    const depth = ruleStack.depth;
    depths[rel] = depth;
    if (depth > 1) flagged.push(`UNTERMINATED depth=${depth}  ${rel}`);
  }

  if (EMIT_JSON) {
    console.log(JSON.stringify(depths));
    return;
  }

  const unterminated = flagged.filter((x) => x.startsWith("UNTERMINATED")).length;
  console.log(`grammar: ${path.relative(process.cwd(), GRAMMAR_PATH)}`);
  console.log(`scanned ${scanned} files; ${unterminated} unterminated (depth>1); ${threw} threw`);
  if (flagged.length) {
    console.log("\nflagged:");
    for (const x of flagged.slice(0, 40)) console.log("  " + x);
    if (flagged.length > 40) console.log(`  ... and ${flagged.length - 40} more`);
  } else {
    console.log("clean — every file closes its blocks, no tokenizer throws.");
  }
}

main();
