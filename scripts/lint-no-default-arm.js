#!/usr/bin/env bun
// lint-no-default-arm — fail if a `match` over an ENUM in the bootstrap's own source has a
// default (wildcard) arm.
//
// WHY (dpa-051 §3.4 + §10). The bootstrap's traversals are total `match`es over the IR enums with
// NO default arm, so that adding a variant fails every pass at compile time instead of being
// silently skipped (defect family F1/F3 of the TS compiler: ~19 of S428's 37 plumbing defects).
// That is a discipline, and dpa-051 §10 names the weakness: "it becomes [a mechanism] only if the
// bootstrap lints its own source for it … it should land before the first pass does." This is that
// lint. impl#1 enforces exhaustiveness (E-TYPE-020, verified cross-file S437), so a match with no
// default arm genuinely fails to compile when a variant is added; a `_ :>` / `else :>` arm is the
// one spelling that switches that off.
//
// ALSO FLAGGED (review F8, until impl#1 is fixed): an ALTERNATION arm (`.A | .B :>`) that is not
// the first arm of its match, in ANY match — impl#1 glues it onto the previous arm's body and drops
// it silently (slice-m1/progress.md F12), which also defeats E-TYPE-020; and a wildcard INSIDE an
// alternation (`_ | .A :>`) in an enum match — a default arm by another spelling.
//
// WHAT IS FLAGGED. In every `.scrml` file under the root (default `compiler/self-host-v2`), a
// `match` is an ENUM match when any arm pattern names a variant (`.X`, `.X(…)`, `T.X`, or a tuple
// containing one). In an enum match, an arm is a DEFAULT arm when its pattern is `_`, `else`, a
// bare catch-all binder, or a tuple whose every position is `_`. Matches over string / number
// literals (lookup tables — an open domain) are not enum matches and may keep a wildcard. A tuple
// with SOME wildcard positions (`(.InCode, _)`) is not flagged: it is total over the named axis.
//
// SCOPE CHOICE — ALL enums, fail-closed. §3.4 says "a pass over an IR enum". Deciding which enums
// are "IR" by a hand-kept list is itself the F3 family (a stale enumeration beside the grammar), so
// the lint covers every enum match in the bootstrap tree. A site that genuinely needs a default arm
// carries a co-located opt-out WITH A REASON on the arm's line or the line above:
//     // no-default-arm: <reason>
// An opt-out with no reason text is itself a violation.
//
// WHY A JS SCRIPT (not a scrml tool). The lint must run over the bootstrap source BEFORE the
// bootstrap has a parser (that is M2's job), and it must not read impl#1's AST (S337 forbids impl#1
// AST shape as an oracle, and impl#1 carries match arms as text). It needs only TOKENS, so it uses
// impl#1's lexer `compiler/native-parser/lex.js` — token-identical to the bootstrap's own lexer on
// 337/337 oracle cases — which also makes it immune to `match`/`_` inside strings and comments.
// When the bootstrap parser exists this can become a scrml pass over FileAst.
//
// USAGE:  bun scripts/lint-no-default-arm.js [--root <dir>] [--json]
//         exit 0 = clean, 1 = violations, 2 = usage error.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { lex } from "../compiler/native-parser/lex.js";

const OPT_OUT = /\/\/\s*no-default-arm:(.*)$/;

function isArmArrow(toks, k) {
  const t = toks[k];
  if (t.kind === "Arrow") return 1;
  if (t.kind === "Colon" && toks[k + 1] && toks[k + 1].kind === "GreaterThan" && toks[k + 1].span.start === t.span.end) return 2;
  return 0;
}

const OPEN = { LParen: "RParen", LBracket: "RBracket", LBrace: "RBrace" };
const CLOSE = new Set(["RParen", "RBracket", "RBrace"]);

// Index of the token that closes the bracket opened at `i`, or -1.
function matchClose(toks, i) {
  let depth = 0;
  for (let j = i; j < toks.length; j++) {
    if (OPEN[toks[j].kind]) depth++;
    else if (CLOSE.has(toks[j].kind)) {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

// Index of the opener matching the closer at `i` (walking backwards), or -1.
function matchOpen(toks, i) {
  let depth = 0;
  for (let j = i; j >= 0; j--) {
    if (CLOSE.has(toks[j].kind)) depth++;
    else if (OPEN[toks[j].kind]) {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

const isUnderscore = (t) => t.kind === "Ident" && t.text === "_";

// Classify the pattern that ends at token index `end` (inclusive). Returns
// { kind: "wild" | "variant" | "tuple-wild" | "tuple" | "literal" | "other", start }.
function classifyPattern(toks, end, floor) {
  const t = toks[end];
  if (isUnderscore(t)) return { kind: "wild", start: end };
  if (t.kind === "KwElse") return { kind: "wild", start: end };
  if (t.kind === "BareVariant") return { kind: "variant", start: end };
  if (t.kind === "Ident") {
    // `.Variant` (lexed as Dot + Ident when it follows the previous arm's VALUE — the lexer's
    // BareVariant production is value-position only) or `Type.Variant`; else a bare catch-all
    // binder.
    if (end - 1 > floor && toks[end - 1].kind === "Dot") return { kind: "variant", start: end - 1 };
    return { kind: "wild", start: end };
  }
  if (t.kind === "RParen") {
    const open = matchOpen(toks, end);
    if (open <= floor) return { kind: "other", start: end };
    const before = toks[open - 1];
    if (before && before.kind === "BareVariant") return { kind: "variant", start: open - 1 };
    if (before && before.kind === "Ident" && toks[open - 2] && toks[open - 2].kind === "Dot") return { kind: "variant", start: open - 3 };
    // A tuple: split positions at top-level commas.
    const positions = [];
    let cur = [];
    let depth = 0;
    for (let j = open + 1; j < end; j++) {
      const k = toks[j].kind;
      if (OPEN[k]) depth++;
      if (CLOSE.has(k)) depth--;
      if (depth === 0 && k === "Comma") { positions.push(cur); cur = []; continue; }
      cur.push(toks[j]);
    }
    positions.push(cur);
    const anyVariant = toks.slice(open, end).some((x) => x.kind === "BareVariant");
    const allWild = positions.every((p) => p.length === 1 && isUnderscore(p[0]));
    if (allWild) return { kind: "tuple-wild", start: open, anyVariant };
    return { kind: "tuple", start: open, anyVariant };
  }
  if (t.kind === "StringLit" || t.kind === "NumberLit" || t.kind === "KwTrue" || t.kind === "KwFalse") return { kind: "literal", start: end };
  return { kind: "other", start: end };
}

/**
 * Lint one scrml source text. Returns { violations: [{line, col, message}], allowed: [{line, reason}] }.
 */
export function lintText(src) {
  const toks = lex(src).filter((t) => t.kind !== "EOF");
  const lines = src.split("\n");
  const violations = [];
  const allowed = [];

  for (let i = 0; i < toks.length; i++) {
    if (toks[i].kind !== "KwMatch") continue;
    const prev = toks[i - 1];
    if (prev && (prev.kind === "LessThan" || prev.kind === "Slash")) continue; // markup <match>
    // The body brace: the first `{` at bracket depth 0 after the subject.
    let bodyOpen = -1;
    let depth = 0;
    for (let j = i + 1; j < toks.length; j++) {
      const k = toks[j].kind;
      if (depth === 0 && k === "LBrace") { bodyOpen = j; break; }
      if (OPEN[k]) depth++;
      if (CLOSE.has(k)) depth--;
    }
    if (bodyOpen === -1) continue;
    const bodyClose = matchClose(toks, bodyOpen);
    if (bodyClose === -1) continue;

    const arms = [];
    depth = 0;
    let floor = bodyOpen; // a pattern cannot start before the previous arm's arrow
    for (let k = bodyOpen + 1; k < bodyClose; k++) {
      const kind = toks[k].kind;
      if (OPEN[kind]) { depth++; continue; }
      if (CLOSE.has(kind)) { depth--; continue; }
      if (depth !== 0) continue;
      const w = isArmArrow(toks, k);
      if (!w) continue;
      // The pattern may be an ALTERNATION `p1 | p2 | …`: walk back over `|`.
      const alts = [classifyPattern(toks, k - 1, floor)];
      let start = alts[0].start;
      while (start - 2 > floor && toks[start - 1].kind === "BitOr") {
        const prevAlt = classifyPattern(toks, start - 2, floor);
        alts.unshift(prevAlt);
        start = prevAlt.start;
      }
      arms.push({ alts, start, tok: toks[k - 1], arrowTok: toks[k] });
      floor = k + w - 1;
      k += w - 1;
    }

    const altIsVariant = (p) => p.kind === "variant" || ((p.kind === "tuple" || p.kind === "tuple-wild") && p.anyVariant);
    const altIsWild = (p) => p.kind === "wild" || p.kind === "tuple-wild";
    const isEnumMatch = arms.some((a) => a.alts.some(altIsVariant));

    const report = (a, message) => {
      const line = a.tok.span.line;
      const firstLine = toks[a.start].span.line;
      const here = OPT_OUT.exec(lines[line - 1] ?? "") ?? OPT_OUT.exec(lines[firstLine - 2] ?? "") ?? OPT_OUT.exec(lines[line - 2] ?? "");
      if (here) {
        const reason = here[1].trim();
        if (reason.length > 0) { allowed.push({ line, reason }); return; }
        violations.push({ line, col: a.tok.span.col, message: "`no-default-arm:` opt-out has no reason" });
        return;
      }
      violations.push({ line: firstLine, col: toks[a.start].span.col, message });
    };

    arms.forEach((a, armIndex) => {
      const patText = src.slice(toks[a.start].span.start, a.tok.span.end);
      // F12 (impl#1): an alternation arm that is not the FIRST arm is glued onto the previous
      // arm's body and silently dropped — which also defeats E-TYPE-020 exhaustiveness. Flag it
      // in ANY match until impl#1 is fixed.
      if (a.alts.length > 1 && armIndex > 0) {
        report(a, `alternation arm \`${patText}\` is not the first arm — impl#1 drops it silently (slice-m1 F12); make it the first arm or split it`);
        return;
      }
      if (!isEnumMatch) return;
      if (a.alts.length > 1 && a.alts.some(altIsWild)) {
        report(a, `wildcard inside the alternation \`${patText}\` in a match over an enum — a default arm by another spelling (dpa-051 §3.4)`);
        return;
      }
      if (a.alts.length === 1 && altIsWild(a.alts[0])) {
        report(a, `default arm \`${patText}\` in a match over an enum — list every variant (dpa-051 §3.4), or add \`// no-default-arm: <reason>\``);
      }
    });
  }
  return { violations, allowed };
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".scrml")) out.push(p);
  }
  return out;
}

/** Lint every `.scrml` under `root`. Returns { files, violations: [{file,line,col,message}], allowed }. */
export function lintTree(root) {
  const files = walk(root, []).sort();
  const violations = [];
  const allowed = [];
  for (const f of files) {
    const r = lintText(readFileSync(f, "utf8"));
    for (const v of r.violations) violations.push({ file: f, ...v });
    for (const a of r.allowed) allowed.push({ file: f, ...a });
  }
  return { files, violations, allowed };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let root = resolve(import.meta.dir, "..", "compiler", "self-host-v2");
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = resolve(args[++i] ?? "");
    else if (args[i] === "--json") json = true;
    else { console.error(`unknown argument: ${args[i]}`); process.exit(2); }
  }
  const r = lintTree(root);
  if (json) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    for (const v of r.violations) console.log(`${relative(process.cwd(), v.file)}:${v.line}:${v.col}: ${v.message}`);
    console.log(`lint-no-default-arm: ${r.files.length} file(s), ${r.violations.length} violation(s), ${r.allowed.length} opt-out(s)`);
  }
  process.exit(r.violations.length > 0 ? 1 : 0);
}
