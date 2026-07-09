// tokenize.js — dev-only TextMate tokenization harness for the scrml grammar.
//
// Loads editors/vscode/syntaxes/scrml.tmLanguage.json via vscode-textmate +
// vscode-oniguruma and tokenizes representative sources, then asserts scopes on
// the current-surface constructs (§65 CSS-native, §38.13 realtime, §52 authority,
// component/snippet). No VS Code install needed.
//
//   Usage:  node test/tokenize.js            # run the assertion suite
//           node test/tokenize.js --dump FILE # dump every token of a source file
//
// Not shipped with the extension — a verification tool only.

const fs = require("fs");
const path = require("path");
const vsctm = require("vscode-textmate");
const oniguruma = require("vscode-oniguruma");

// GRAMMAR_PATH defaults to the shipped grammar; --grammar <path> overrides it
// (used to diff the pre-change grammar in --dump mode for before/after output).
const _gIdx = process.argv.indexOf("--grammar");
const GRAMMAR_PATH =
  _gIdx !== -1
    ? path.resolve(process.argv[_gIdx + 1])
    : path.join(__dirname, "..", "syntaxes", "scrml.tmLanguage.json");
const SCOPE_NAME = "source.scrml";

function loadOniguruma() {
  const wasmPath = path.join(
    __dirname,
    "..",
    "node_modules",
    "vscode-oniguruma",
    "release",
    "onig.wasm"
  );
  const wasmBin = fs.readFileSync(wasmPath).buffer;
  return oniguruma.loadWASM(wasmBin).then(() => ({
    createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
    createOnigString: (s) => new oniguruma.OnigString(s),
  }));
}

async function makeRegistry() {
  const onigLib = loadOniguruma();
  return new vsctm.Registry({
    onigLib,
    loadGrammar: async (scopeName) => {
      if (scopeName !== SCOPE_NAME) return null;
      const raw = fs.readFileSync(GRAMMAR_PATH, "utf8");
      return vsctm.parseRawGrammar(raw, GRAMMAR_PATH);
    },
  });
}

// Tokenize `src` → array of { line, text, scopes: [...] } for every token.
function tokenizeSource(grammar, src) {
  const lines = src.split(/\r?\n/);
  let ruleStack = vsctm.INITIAL;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const r = grammar.tokenizeLine(line, ruleStack);
    for (const t of r.tokens) {
      const text = line.substring(t.startIndex, t.endIndex);
      if (text.trim() === "") continue; // skip whitespace-only tokens
      out.push({ line: i + 1, text, scopes: t.scopes });
    }
    ruleStack = r.ruleStack;
  }
  return out;
}

// ---- assertion helpers ---------------------------------------------------

let PASS = 0;
let FAIL = 0;
const FAILURES = [];

// Find the first token whose text exactly equals `text` (optionally on line N)
// and assert one of its scopes contains `scopeSubstr`.
function expectScope(tokens, text, scopeSubstr, opts = {}) {
  const cands = tokens.filter(
    (t) => t.text === text && (opts.line == null || t.line === opts.line)
  );
  const label = `token "${text}"${opts.line ? " @L" + opts.line : ""} has scope ~ "${scopeSubstr}"`;
  if (cands.length === 0) {
    FAIL++;
    FAILURES.push(`${label}  — NO TOKEN with that exact text`);
    return;
  }
  const hit = cands.find((t) => t.scopes.some((s) => s.includes(scopeSubstr)));
  if (hit) {
    PASS++;
  } else {
    FAIL++;
    FAILURES.push(
      `${label}\n     got: [${cands[0].scopes.join(", ")}]`
    );
  }
}

// Assert that NO token equal to `text` carries `scopeSubstr` (negative check).
function expectNotScope(tokens, text, scopeSubstr) {
  const bad = tokens.filter(
    (t) => t.text === text && t.scopes.some((s) => s.includes(scopeSubstr))
  );
  const label = `token "${text}" must NOT have scope ~ "${scopeSubstr}"`;
  if (bad.length === 0) {
    PASS++;
  } else {
    FAIL++;
    FAILURES.push(`${label}  — but ${bad.length} did`);
  }
}

function section(name) {
  console.log("\n=== " + name + " ===");
}

// ---- the fixtures --------------------------------------------------------

const FIX_CSS_TYPOGRAPHY = `<div>
    #{
        font-family: system-ui, sans-serif;
        font-weight: 600;
        line-height: 1.5;
        letter-spacing: 0.02em;
    }
    <h1>Styled Heading</>
</div>`;

// selector-based #{} (the "mangled" case: nested braces must not close the block)
const FIX_CSS_SELECTOR = `const Badge = <span props={ label: string }>
    #{
        .badge {
            display: inline-flex;
            border-radius: 9999px;
            background: #e2e8f0;
        }
        .card-title {
            font-size: 1.25rem;
            font-weight: 600;
        }
    }
    <span class="badge">Active</>
</>`;

const FIX_THEME = `<theme for=@mode>
    brand   = #2563eb;
    danger  = #dc2626;
    space-4 = 1rem;
    .Dark {
        ink   = #e2e8f0;
        paper = #0f172a;
    }
    @media (prefers-color-scheme: dark) {
        ink = #e2e8f0;
    }
</theme>`;

const FIX_DEFAULTS = `<defaults>
    body  { color: ink; background: paper; }
    a     { color: brand; }
    label { font-weight: 600; }
</defaults>`;

const FIX_STYLE_VALUE = `const field = #{
    display: block;
    padding: space-4;
    &:focus { border-color: brand; }
}
<input type="email" style=field style:invalid=@emailBad />
<button style=[field, primaryButton]>Sign up</button>
<div style="padding: 16px"></div>`;

const FIX_CHANNEL = `<channel name="orders-feed" watches=orders key=id>
    <onchange>
        <Inserted(row) : { @orders = [...@orders, row] }>
        <Updated(row) : { @orders = @orders.map(r => r.id == row.id ? row : r) }>
        <Deleted(key) : { @orders = @orders.filter(r => r.id != key) }>
    </onchange>
</channel>`;

const FIX_AUTHORITY = `\${
    <Order authority="server" table="orders">
        id: int
        status: string
    </>
    <cards server> = []
}`;

const FIX_COMPONENT_SNIPPET = `const Panel = <div class="panel" props={
    title:    snippet,
    content:  snippet,
}>
    <div class="panel__title">\${render title()}</>
</>`;

const FIX_PRESERVE = `\${
    const x = a === b
    const y = foo != null
    const z = bar is not
}`;

// ---- run -----------------------------------------------------------------

(async () => {
  const registry = await makeRegistry();
  const grammar = await registry.loadGrammar(SCOPE_NAME);
  if (!grammar) throw new Error("failed to load grammar " + SCOPE_NAME);

  // --dump mode: print every token of a file, for eyeballing.
  const dumpIdx = process.argv.indexOf("--dump");
  if (dumpIdx !== -1) {
    const file = process.argv[dumpIdx + 1];
    const src = fs.readFileSync(file, "utf8");
    const toks = tokenizeSource(grammar, src);
    for (const t of toks) {
      console.log(`L${t.line}  ${JSON.stringify(t.text).padEnd(22)} ${t.scopes.join(" ")}`);
    }
    return;
  }

  // 1. §65 flat CSS body — properties/values scoped, block not mangled
  section("§65  #{} flat CSS body (css-005-typography shape)");
  {
    const t = tokenizeSource(grammar, FIX_CSS_TYPOGRAPHY);
    expectScope(t, "#{", "block.css.begin");
    expectScope(t, "font-family", "property-name.css");
    expectScope(t, "font-weight", "property-name.css");
    expectScope(t, "letter-spacing", "property-name.css");
    // the CSS block must have CLOSED so the <h1> after it is markup, not CSS
    expectScope(t, "h1", "entity.name.tag");
    expectNotScope(t, "h1", "block.css");
  }

  // 2. §65 selector-based #{} — nested braces must not close the block early
  section("§65  #{} selector CSS body — nested braces (the mangled case)");
  {
    const t = tokenizeSource(grammar, FIX_CSS_SELECTOR);
    expectScope(t, "#{", "block.css.begin");
    expectScope(t, "display", "property-name.css"); // inside .badge { }
    expectScope(t, "font-size", "property-name.css"); // inside .card-title { } — AFTER a nested }
    // the trailing markup after the whole #{} must be markup again
    expectScope(t, "span", "entity.name.tag");
    expectNotScope(t, "span", "block.css");
  }

  // 3. §65 <theme> / <defaults>
  section("§65  <theme> structural element + for=@mode + variant + @media");
  {
    const t = tokenizeSource(grammar, FIX_THEME);
    expectScope(t, "theme", "structural");
    expectScope(t, "for", "property-name");
    expectScope(t, "@mode", "variable.other.reactive");
    expectScope(t, "brand", "theme.token");
    expectScope(t, "@media", "keyword.control.at-rule.css");
  }
  section("§65  <defaults> structural element + bare-element rules");
  {
    const t = tokenizeSource(grammar, FIX_DEFAULTS);
    expectScope(t, "defaults", "structural");
    expectScope(t, "color", "property-name.css");
    expectScope(t, "font-weight", "property-name.css");
  }

  // 4. §65 style-as-value
  section("§65  style-as-value: style=name / style=[a,b] / style:cond= / const #{}");
  {
    const t = tokenizeSource(grammar, FIX_STYLE_VALUE);
    expectScope(t, "field", "style-value"); // style=field binding
    expectScope(t, "style:invalid", "conditional-style"); // style:invalid=@cond
    expectScope(t, "@emailBad", "variable.other.reactive");
    expectScope(t, "style", "attribute-name.style-list"); // style=[a,b]
    expectScope(t, "padding", "property-name.css"); // inside const field = #{}
  }

  // 5. §38.13 realtime
  section("§38.13  <channel watches=> + <onchange> + RowChange variants");
  {
    const t = tokenizeSource(grammar, FIX_CHANNEL);
    expectScope(t, "channel", "tag.structural"); // structural-element tag scope
    expectScope(t, "watches", "property-name.realtime");
    expectScope(t, "key", "property-name");
    expectScope(t, "onchange", "structural");
    expectScope(t, "Inserted", "rowchange.variant");
    expectScope(t, "Updated", "rowchange.variant");
    expectScope(t, "Deleted", "rowchange.variant");
  }

  // 6. §52 authority
  section("§52  authority= / table= / <var server>");
  {
    const t = tokenizeSource(grammar, FIX_AUTHORITY);
    expectScope(t, "authority", "property-name.authority");
    expectScope(t, "table", "property-name.authority");
    expectScope(t, "server", "authority.server"); // <cards server> bare flag
  }

  // 7. component / snippet
  section("component / snippet type keywords");
  {
    const t = tokenizeSource(grammar, FIX_COMPONENT_SNIPPET);
    expectScope(t, "snippet", "keyword"); // title: snippet, content: snippet
    expectScope(t, "render", "keyword"); // render title()
  }

  // 8. PRESERVE — illegal forms still flagged
  section("PRESERVE  invalid-equality + invalid-null-undefined");
  {
    const t = tokenizeSource(grammar, FIX_PRESERVE);
    expectScope(t, "===", "invalid.illegal.equality");
    expectScope(t, "null", "invalid.illegal.null-undefined");
    expectScope(t, "is not", "keyword.control.absence");
  }

  // ---- summary ----
  console.log("\n" + "=".repeat(60));
  console.log(`RESULT: ${PASS} passed, ${FAIL} failed`);
  if (FAILURES.length) {
    console.log("\nFAILURES:");
    for (const f of FAILURES) console.log("  ✗ " + f);
    process.exitCode = 1;
  } else {
    console.log("All assertions passed.");
  }
})();
