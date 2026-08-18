// ---------------------------------------------------------------------------
// COMMENT-token CONSUMER sweep — SPEC §27.1, end-to-end through compileScrml.
//
// THE RULE THIS FILE ENFORCES
// ===========================
// SPEC §27.1: "`//` is a single-line comment. **It is valid in all scrml
// contexts.**" §27.2 additionally grants `//` and `/* */` in Logic and states
// that the `//` form "works in all contexts". Read operationally, that is a
// two-sided obligation on the compiler:
//
//   1. a comment must never break compilation, and
//   2. a comment must never CHANGE the program.
//
// A comment is whitespace to a JS lexer. So the test is a differential: compile
// the source as written, then compile it again with every comment replaced by
// SPACES OF IDENTICAL LENGTH, and require the two builds to be indistinguishable.
// Same byte length and same line structure means the two sources agree on every
// span, so any difference in the emitted artifacts is the compiler treating a
// comment as content.
//
// WHY THIS SHAPE, AND NOT A TOKENIZER-LEVEL ASSERTION
// ===================================================
// `comment-token-faithfulness.test.js` asserts the PRODUCER invariant
// (`tok.text === source.slice(span.start, span.end)`). That invariant held
// BEFORE the faithfulness fix too — the old tokenizer was self-consistently
// wrong (span two characters late AND text missing its opener) — so it does not
// discriminate on its own. The defect that shipped was in the CONSUMERS:
// `ast-builder.js` has ~20 collectors that rebuild a JavaScript-to-be string out
// of `tok.text`, and a comment re-emitted into one of those strings is then
// rewritten by codegen surgery that is string-aware but COMMENT-NAIVE. This file
// measures the thing that actually broke.
//
// THE MEASURED FAILURE (S349, gate: this file)
// ============================================
// `when @count changes { … }` with two ordinary English comments in its body
// failed to compile at all — `E-CODEGEN-INVALID-LOGIC`, zero artifacts, on the
// shipped corpus file `samples/compilation-tests/gauntlet-r10-svelte-dashboard.scrml`.
// Two ingredients compose: a bare ` is ` inside the comment defeats
// `rewriteReactiveRefsAST`, and an apostrophe (`Can't`) then opens a string span
// in the comment-naive fallback scanner that never closes, so every following
// `@ref` is emitted RAW into JavaScript. Either comment alone compiles clean.
// That is why S1 below carries both, verbatim.
//
// `write: true` IS REQUIRED
// =========================
// With `write: false` the codegen acorn validity gate does not run, so
// `E-CODEGEN-INVALID-LOGIC` never surfaces and a program that does not compile
// reports clean. An earlier revision of this probe used `write: false` and
// reported 14/14 PASS against the KNOWN-BROKEN tree.
// ---------------------------------------------------------------------------

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";

const MARK = "ZQXMARKER";

/** Replace every `//…EOL` and block comment with spaces of the same length. */
function blankComments(src) {
  const spaces = (s) => s.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, spaces)
    .replace(/\/\/[^\n]*/g, spaces);
}

/**
 * Compile `src` and its comment-blanked twin at the SAME path in the SAME
 * directory. Same path matters: the chunk-scope namespace is path-derived, so
 * two different temp dirs produce two different (and meaninglessly different)
 * client bundles.
 */
function compileBoth(src) {
  const dir = mkdtempSync(join(tmpdir(), "comment-sweep-"));
  const p = join(dir, "app.scrml");
  const outDir = join(dir, "out");
  const run = (text) => {
    writeFileSync(p, text);
    const r = compileScrml({ inputFiles: [p], write: true, outputDir: outDir });
    const outs = {};
    for (const [, v] of (r.outputs ?? new Map())) {
      for (const f of ["html", "clientJs", "serverJs", "css"]) {
        if (typeof v?.[f] === "string") outs[f] = v[f];
      }
    }
    return { errors: (r.errors ?? []).map((e) => e.code).sort(), outs };
  };
  try {
    return { withComment: run(src), blanked: run(blankComments(src)) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The whole contract, in one assertion pair. */
function expectCommentIsWhitespace(src) {
  const { withComment, blanked } = compileBoth(src);

  // (A) The comment must not appear in ANY emitted artifact. Generated code does
  //     not carry the author's prose; a leak here is a consumer re-emitting
  //     `tok.text` into JavaScript-to-be.
  for (const [name, body] of Object.entries(withComment.outs)) {
    expect(`${name}:${body.includes(MARK)}`).toBe(`${name}:false`);
  }

  // (B) The build must be indistinguishable from the blanked twin — same
  //     diagnostics, same artifact set, byte-identical bodies.
  expect(withComment.errors).toEqual(blanked.errors);
  expect(Object.keys(withComment.outs).sort()).toEqual(Object.keys(blanked.outs).sort());
  for (const name of Object.keys(blanked.outs)) {
    expect(`${name}\n${withComment.outs[name]}`).toBe(`${name}\n${blanked.outs[name]}`);
  }
}

describe("§27.1 — a comment is valid in all scrml contexts, and changes nothing", () => {
  // S1/S2/S10 are the three that FAILED against the pre-fix tree; the rest are
  // the collectors swept alongside them, held so they cannot regress into the
  // same class. (Measured: 12/15 clean pre-fix, 15/15 post-fix.)

  test("S1 — `when @x changes { }` body (the regression that broke compilation)", () => {
    expectCommentIsWhitespace(
`<count> = 0
\${
    when @count changes {
        // ZQXMARKER: No DOM refs, so "scroll to bottom" is impossible here.
        // scrml has no bind:this / ref system. Can't access DOM nodes.
        let _ = @count
    }
}
<div>{@count}</div>`);
  });

  test("S2 — `when message from <#w>` body", () => {
    expectCommentIsWhitespace(
`\${
    <#w> = worker("w.js")
    when message from <#w> (data) {
        // ZQXMARKER: this note is impossible to misread. Can't hurt, right?
        log(data)
    }
}
<div>hi</div>`);
  });

  test("S3 — `lift` markup body (a comment is not a text node)", () => {
    expectCommentIsWhitespace(
`\${
    lift Card() {
        <div>
            // ZQXMARKER
            <p>hello</p>
        </div>
    }
}
<Card/>`);
  });

  test("S4 — parameter type annotation", () => {
    expectCommentIsWhitespace(
`\${
    function greet(msg: /* ZQXMARKER */ string): string {
        return msg
    }
    log(greet("x"))
}
<div>hi</div>`);
  });

  test("S5 — return type annotation", () => {
    expectCommentIsWhitespace(
`\${
    function greet(msg: string): /* ZQXMARKER */ string {
        return msg
    }
    log(greet("x"))
}
<div>hi</div>`);
  });

  test("S6 — reactive array mutation arguments", () => {
    expectCommentIsWhitespace(
`<items> = []
\${
    function go() {
        @items.push(/* ZQXMARKER */ 1)
    }
    log(go)
}
<div>{@items.length}</div>`);
  });

  test("S7 — `@set(...)` arguments", () => {
    expectCommentIsWhitespace(
`<obj> = { a: 1 }
\${
    function go() {
        @set(@obj, "a", /* ZQXMARKER */ 2)
    }
    log(go)
}
<div>{@obj.a}</div>`);
  });

  test("S8 — C-style `for` header", () => {
    expectCommentIsWhitespace(
`\${
    function go() {
        let n = 0
        for (let i = 0; /* ZQXMARKER */ i < 3; i = i + 1) {
            n = n + i
        }
        return n
    }
    log(go())
}
<div>hi</div>`);
  });

  test("S9 — bracket index on an `@` path", () => {
    expectCommentIsWhitespace(
`<items> = [1, 2, 3]
\${
    function go() {
        return @items[/* ZQXMARKER */ 0]
    }
    log(go())
}
<div>hi</div>`);
  });

  test("S10 — destructured-parameter default (leaked the comment into emitted JS)", () => {
    expectCommentIsWhitespace(
`\${
    function go({ a = /* ZQXMARKER */ 1 }) {
        return a
    }
    log(go({}))
}
<div>hi</div>`);
  });

  test("S11 — parameter list", () => {
    expectCommentIsWhitespace(
`\${
    function greet(/* ZQXMARKER */ msg) {
        return msg
    }
    log(greet("x"))
}
<div>hi</div>`);
  });

  test("S12 — struct-field braced body", () => {
    expectCommentIsWhitespace(
`\${
    type User = {
        name: string   // ZQXMARKER
    }
    function go(u: User): string { return u.name }
    log(go({ name: "x" }))
}
<div>hi</div>`);
  });

  test("S13 — `cleanup(() => { … })` callback body", () => {
    expectCommentIsWhitespace(
`<count> = 0
\${
    cleanup(() => {
        // ZQXMARKER: teardown note. It's fine.
        log(@count)
    })
}
<div>{@count}</div>`);
  });

  test("S14 — match-arm payload binding list", () => {
    expectCommentIsWhitespace(
`\${
    type Res = Ok(row: string) | Err(msg: string)
    function go(r: Res): string {
        match r {
            <Ok(/* ZQXMARKER */ row) :> { return row }
            <Err(m) :> { return m }
        }
    }
    log(go(Ok("x")))
}
<div>hi</div>`);
  });

  // S16/S17 are the `lift <tag>` markup path (`parseLiftTag`), which is a
  // DIFFERENT collector from S3's `lift Name() { … }` block form. Pre-fix a
  // comment among a lift tag's children fell through to the text-content
  // accumulator and became a visible DOM text node — measured on three shipped
  // corpus sources (nested-comments, gauntlet-r10-bun-admin,
  // gauntlet-r10-odin-filebrowser). §27.2 gives markup its own `<!-- -->` form
  // and states the `//` form "works in all contexts", so a `//` line here is a
  // comment, not page copy.
  test("S16 — comment among `lift <tag>` children", () => {
    expectCommentIsWhitespace(
`<items> = [1]
\${
    for (const it of @items) {
        lift <div class="row">
            <span>a</>
            // ZQXMARKER note
            <span>b</>
        </>
    }
}
<div>hi</div>`);
  });

  test("S17 — comment immediately before `lift <tag>` text content", () => {
    expectCommentIsWhitespace(
`<items> = [1]
\${
    for (const it of @items) {
        lift <p>
            // ZQXMARKER note
            hello
        </>
    }
}
<div>hi</div>`);
  });

  test("S15 — `upload(...)` arguments", () => {
    expectCommentIsWhitespace(
`<f> = <input type="file"/>
\${
    function go() {
        upload(@f, /* ZQXMARKER */ "/u")
    }
    log(go)
}
<div>hi</div>`);
  });
});
