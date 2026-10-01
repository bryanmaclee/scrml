/**
 * defer-text-body-completeness.test.js — S432 review A-1: the rule-4 check
 * (E-DEFER-OUTSIDE-FUNCTION, SPEC §19.16.3) must reach EVERY body the front-ends
 * carry as TEXT. The A1 fix enumerated those bodies by hand and missed one
 * (`component-def.raw`), so this test makes the enumeration CHECKED:
 *
 *   1. Parse the whole conformance / samples / examples corpus with BOTH
 *      front-ends and collect every `(node kind, field)` whose value is a
 *      string (or string[]) under a text-body-like field name. Add the fields
 *      the AST type declarations (compiler/src/types/ast.ts) name the same way,
 *      so a kind the corpus happens not to exercise is still seen.
 *   2. Every such pair MUST be classified below — either COVERED (and by which
 *      mechanism, verified where it can be) or EXCLUDED with the reason. A new
 *      text-carrying kind or field fails this test until someone decides.
 *
 * Categories:
 *   lowered      — `textLoweredBodiesOf` (defer-structure.ts) returns the text:
 *                  verified by building a node of that kind and asking it.
 *   armText      — `textBodiesOf` returns the text (arm / handler / bare block
 *                  bodies): verified the same way.
 *   reparsed     — the checker re-parses the markup text and walks it
 *                  (lint-defer.ts: component-def.raw, native match-block.armsRaw).
 *   sibling:F    — a structured sibling field F carries the same content and is
 *                  walked by the checker (verified on every observed node).
 *   notStatement — expression / declaration-header / pattern / name / type /
 *                  path text: a `defer` there is an identifier (§19.16.1), or the
 *                  text is not scrml logic at all.
 *   opaque       — foreign / SQL / meta text, not scrml statements (§19.16.3 has
 *                  no meaning there).
 */

import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { nativeParseFile } from "../../native-parser/parse-file.js";
import { textLoweredBodiesOf, textBodiesOf } from "../../src/validators/defer-structure.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const FIELD_RE = /raw|Raw|body|Body|handler|Handler|callback|expr|Expr|result|content|source|Source|query|arms|Arms|text|Text|init|Init|header|Header/;

const CLASSIFIED = {
  // --- covered: lowered as text, checked by textLoweredBodiesOf ---
  "when-effect.bodyRaw": "lowered",
  "when-message.bodyRaw": "lowered",
  "when-worker-message.bodyRaw": "lowered",
  "when-worker-error.bodyRaw": "lowered",
  // (`test.testGroup.tests[].body` is a string[] inside an untyped object — checked in its own test below)
  // --- covered: arm / bare-block text, checked by textBodiesOf ---
  "match-expr.rawArms": "armText",
  "match-arm-inline.result": "armText",
  "guarded-expr.arms[].handler": "armText",
  "error-effect.arms[].handler": "armText", // statement `!{ … } catch T as e { … }` / legacy `| ::T e -> …` (S446)
  // --- covered: lowered as text, keyed under a KIND-LESS sub-object (S446) ---
  "onchange-decl.arms[].bodyRaw": "loweredArm",
  "test.testGroup.tests[].body": "loweredTest", // checked in its own test below
  // --- kind-less sub-object fields that are not statement text (S446) ---
  "onchange-decl.arms[].bodyForm": "notStatement", // a form tag ("shorthand" / "block")
  "onchange-decl.arms[].payloadBindingsRaw": "notStatement", // a binder pattern (in the E-DEFER-AMBIGUOUS-LEAD binder table)
  "endpoint-decl.arms[].bodyForm": "notStatement",
  "endpoint-decl.arms[].payloadBindingsRaw": "notStatement",
  "endpoint-decl.arms[].bodyRaw": "notStatement", // the RESPONSE VALUE expression of an endpoint arm; a multi-statement block arm is E-ENDPOINT-MULTI-STATEMENT-ARM
  "state-constructor-def.typedAttrs[].typeExpr": "notStatement",
  "test.testGroup.tests[].asserts[].raw": "notStatement", // an assert EXPRESSION
  "try-stmt.catchNode.header": "notStatement", // `catch (e)` header — the binder is in the binder table
  // --- covered: re-parsed markup, walked by the checker ---
  "component-def.raw": "reparsed",
  "match-block.armsRaw": "reparsed", // live also carries it structurally (armBodyChildren); native only as text
  // --- covered: a structured sibling carries the same content ---
  "bare-expr.expr": "sibling:exprNode", // a bare `{ }` block's text is also armText (textBodiesOf)
  "cleanup-registration.callback": "sibling:callbackExpr",
  "expr.raw": "notStatement", // an attribute / interpolation EXPRESSION (defer there is an identifier, §19.16.1); an on*=${} handler value is lowered via its markup owner (tested below)
  "expr.expr": "sibling:exprNode",
  "escape-hatch.raw": "notStatement", // an EXPRESSION the parser could not structure; lambdas in it: textLambdaContainsDefer
  "function-decl.raw": "sibling:body",
  "export-decl.raw": "reparsed", // `export const Name = <markup>`: lint-defer.ts recovers the markup the way the component expander does and walks it (S446); otherwise declaration header text — an exported function's body is a re-parsed function-decl
  "each-block.bodyRaw": "sibling:bodyChildren",
  "markup._reparseEachArmBodyRaw": "sibling:children",
  "engine-decl.rulesRaw": "notStatement", // state-child rule markup; bodies reach the AST as children / logic blocks
  "engine-decl._source": "notStatement", // provenance copy of the engine source for diagnostics
  "const-decl.init": "sibling:initExpr",
  "let-decl.init": "sibling:initExpr",
  "lin-decl.init": "sibling:initExpr",
  "tilde-decl.init": "sibling:initExpr",
  "state-decl.init": "sibling:initExpr",
  "return-stmt.expr": "sibling:exprNode",
  "throw-stmt.expr": "sibling:exprNode",
  "yield-stmt.expr": "sibling:exprNode",
  "propagate-expr.expr": "sibling:exprNode",
  // --- not statement text ---
  "call-ref.sourceText": "notStatement",
  "dotted-ident.sourceText": "notStatement",
  "dotted-ident.text": "notStatement",
  "variable-ref.sourceText": "notStatement",
  "string-literal.sourceText": "notStatement",
  "expr.sourceText": "notStatement",
  "lit.raw": "notStatement",
  "each-block.ifRaw": "notStatement",
  "each-block.inExprRaw": "notStatement",
  "each-block.keyExprRaw": "notStatement",
  "match-block.ifRaw": "notStatement",
  "match-block.onExprRaw": "notStatement",
  "engine-decl.ifRaw": "notStatement",
  "engine-decl.derivedExprText": "notStatement",
  "engine-decl.inlineMatchBody": "notStatement", // derived-engine `.X :> .Y` value arms — expressions, no statements
  "engine-decl.initialCell": "notStatement",
  "engine-decl.initialVariant": "notStatement",
  "engine-decl.serverSource": "notStatement",
  "engine-decl.sourceVar": "notStatement",
  "endpoint-decl.acceptsRaw": "notStatement",
  "export-decl.reExportSource": "notStatement",
  "export-decl.valueInit": "notStatement",
  "import-decl.raw": "notStatement",
  "import-decl.source": "notStatement",
  "use-decl.raw": "notStatement",
  "use-decl.source": "notStatement",
  "type-decl.raw": "notStatement",
  "transition-decl.paramsRaw": "notStatement",
  "match-expr.header": "notStatement",
  "match-stmt.header": "notStatement",
  "switch-stmt.header": "notStatement",
  "try-stmt.header": "notStatement",
  "markup.shorthandBodyRaw": "notStatement", // `<li : expr>` — a code-default EXPRESSION body (§4.14), not statements
  "markup._matchArmBodyForm": "notStatement", // a form tag ("block" / "inline")
  "html-fragment.content": "notStatement", // markup text a statement position could not structure; a `${}` in it is not a statement body
  "meta.parentContext": "notStatement",
  // --- opaque ---
  "foreign.body": "opaque",
  "foreign.raw": "opaque",
  "sql.query": "opaque",
};

function walkFiles(dir, out) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, out);
    else if (p.endsWith(".scrml")) out.push(p);
  }
  return out;
}

function collect() {
  const files = ["samples", "examples", "conformance/cases"].flatMap((d) => walkFiles(join(ROOT, d), []));
  const pairs = new Map(); // key -> { siblingMissing: number, seen: number, where }
  const visit = (root, file) => {
    const seen = new WeakSet();
    // `owner` names a KIND-LESS sub-object by its path from the nearest kinded
    // node (`onchange-decl.arms[]`), so text a kind carries inside an untyped
    // sub-object (arms[], attrs[] …) is censused too (S446: the `<onchange>`
    // arm body, `onchange-decl.arms[].bodyRaw`, was invisible to a census that
    // only read a kinded node's own fields).
    const walk = (n, owner) => {
      if (!n || typeof n !== "object" || seen.has(n)) return;
      seen.add(n);
      if (Array.isArray(n)) { for (const c of n) walk(c, owner && !owner.endsWith("[]") ? owner + "[]" : owner); return; }
      // Lowercase kinds are the live-shaped AST every later stage consumes; a
      // Capitalised kind is the native parser's own tree, retained for
      // provenance (bodyChildren etc.) and bridged into live-shaped fields.
      const kinded = typeof n.kind === "string";
      if (kinded && !/^[a-z]/.test(n.kind)) {
        for (const k of Object.keys(n)) if (k !== "span") walk(n[k], null);
        return;
      }
      const here = kinded ? n.kind : owner;
      if (here) {
        for (const k of Object.keys(n)) {
          const v = n[k];
          const isText = (typeof v === "string" && v.length > 0) ||
            (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string"));
          if (!isText || !FIELD_RE.test(k)) continue;
          const key = `${here}.${k}`;
          const rec = pairs.get(key) ?? { seen: 0, siblingMissing: 0, where: file };
          rec.seen++;
          const cls = CLASSIFIED[key];
          if (typeof cls === "string" && cls.startsWith("sibling:")) {
            const sib = cls.slice("sibling:".length);
            if (!(sib in n)) rec.siblingMissing++;
          }
          pairs.set(key, rec);
        }
      }
      for (const k of Object.keys(n)) if (k !== "span") walk(n[k], here ? `${here}.${k}` : null);
    };
    walk(root, null);
  };
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    try { visit(buildAST(splitBlocks(f, src)).ast, f); } catch { /* a file one front-end rejects outright */ }
    try { visit(nativeParseFile(f, src).ast, f); } catch { /* ditto */ }
  }
  // The AST type declarations, for kinds the corpus does not exercise.
  const ast = readFileSync(join(ROOT, "compiler/src/types/ast.ts"), "utf8");
  const re = /(?:interface\s+\w+[^{]*|type\s+\w+\s*=\s*)\{/g;
  let m;
  while ((m = re.exec(ast))) {
    let i = m.index + m[0].length, depth = 1, top = "";
    for (; i < ast.length && depth > 0; i++) {
      const ch = ast[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      if (depth === 1 && ch !== "}") top += ch;
    }
    const km = /\bkind\??:\s*"([a-z][\w-]*)"/.exec(top);
    if (!km) continue;
    for (const fm of top.matchAll(/^\s*(\w+)\??:\s*([^;\n]+)/gm)) {
      if (/\bstring\b/.test(fm[2]) && FIELD_RE.test(fm[1])) {
        const key = `${km[1]}.${fm[1]}`;
        if (!pairs.has(key)) pairs.set(key, { seen: 0, siblingMissing: 0, where: "compiler/src/types/ast.ts" });
      }
    }
  }
  return pairs;
}

describe("every text-carried body is classified for the §19.16.3 rule-4 check", () => {
  const pairs = collect();

  test("the census is not vacuous", () => {
    expect(pairs.size).toBeGreaterThan(40);
    expect(pairs.has("when-effect.bodyRaw")).toBe(true);
    expect(pairs.has("component-def.raw")).toBe(true);
  });

  test("no unclassified text-carrying (kind, field)", () => {
    const unclassified = [...pairs.keys()].filter((k) => !(k in CLASSIFIED)).sort();
    // A failure here means a node kind now carries a body as TEXT that nobody
    // has decided about: add it to textLoweredBodiesOf / the re-parse walk if a
    // `defer` statement could be written there, or to CLASSIFIED with the reason
    // it cannot (and keep the reason honest).
    expect(unclassified).toEqual([]);
  });

  test("`sibling:` claims hold on every observed node", () => {
    const broken = [...pairs].filter(([, r]) => r.siblingMissing > 0).map(([k, r]) => `${k} (${r.siblingMissing}/${r.seen}, e.g. ${r.where})`);
    expect(broken).toEqual([]);
  });

  test("`lowered` entries are returned by textLoweredBodiesOf", () => {
    for (const [key, cls] of Object.entries(CLASSIFIED)) {
      if (cls !== "lowered") continue;
      const [kind, field] = key.split(".");
      const got = textLoweredBodiesOf({ kind, [field]: "defer f()" });
      expect({ key, texts: got.map((b) => b.text) }).toEqual({ key, texts: ["defer f()"] });
    }
  });

  test("`armText` entries are returned by textBodiesOf", () => {
    const m = textBodiesOf({ kind: "match-expr", rawArms: [".A => { defer f() }"] });
    expect(m.map((b) => b.text)).toEqual(["{ defer f() }"]);
    const inl = textBodiesOf({ kind: "match-stmt", body: [{ kind: "match-arm-inline", result: "{ defer f() }" }] });
    expect(inl.map((b) => b.text)).toEqual(["{ defer f() }"]);
  });

  test("`loweredArm` / error-effect `armText` entries are returned (S446)", () => {
    const oc = textLoweredBodiesOf({ kind: "onchange-decl", arms: [{ bodyRaw: "defer f()" }, { bodyRaw: "g()" }] });
    expect(oc.map((b) => b.text)).toEqual(["defer f()", "g()"]);
    const ee = textBodiesOf({ kind: "error-effect", arms: [{ handler: "defer f()" }] });
    expect(ee.map((b) => b.text)).toEqual(["defer f()"]);
  });

  test("`~{}` test bodies (string[] in the untyped testGroup) are lowered", () => {
    const got = textLoweredBodiesOf({ kind: "test", testGroup: { tests: [{ body: ["defer f ( )", "assert 1 == 1"] }], before: ["defer g ( )"], after: null } });
    expect(got.length).toBe(2);
  });

  test("an on*=${} handler attribute (expr.raw on a markup owner) is lowered, a non-handler one is not", () => {
    const mk = (name) => ({ kind: "markup", attrs: [{ name, value: { kind: "expr", raw: "defer f()" } }] });
    expect(textLoweredBodiesOf(mk("onclick")).length).toBe(1);
    expect(textLoweredBodiesOf(mk("on:custom")).length).toBe(1);
    expect(textLoweredBodiesOf(mk("title")).length).toBe(0);
  });
});
