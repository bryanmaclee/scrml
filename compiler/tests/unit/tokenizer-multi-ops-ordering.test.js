/* SPDX-License-Identifier: MIT
 *
 * Unit — THE MULTI_OPS MAXIMAL-MUNCH PIN, BEHAVIOURAL (S417, rebuilt S419).
 *
 * WHAT THIS PINS
 * ==============
 * `tokenizeLogic` in `compiler/src/tokenizer.ts` lexes multi-character operators from a
 * function-local `MULTI_OPS` array with a FIRST-MATCH-WINS loop. Whether a given member can ever be
 * emitted therefore depends on the matcher AND the array together. This file pins the one thing
 * that matters to the language — WHICH MEMBERS DO NOT LEX AS THEMSELVES — by RUNNING THE REAL
 * TOKENIZER on every member, not by reading the array's order.
 *
 * Today that set is exactly `[">>>"]`: `a >>> b` lexes as `>>` then a separate `>`. That is the
 * filed bug `g-multi-ops-first-match-shadows-the-longer-operator` (MED, open), root of
 * `g-unsigned-right-shift-does-not-lower`.
 *
 * ⛔ THIS PIN RECORDS CURRENT BEHAVIOUR; IT DOES NOT DECIDE IT.
 * Whether `>>>` SHOULD lex as one token is an open LANGUAGE RULING (making it lex newly ACCEPTS
 * `n >>> 2`, and SPEC.md carries no shift-operator grammar — see the gap entry for the search).
 * If this pin goes red because the set changed, that is either a ruling that landed (update the pin
 * AND resolve the gap in the same change) or an unruled change in what the lexer accepts (revert it).
 * It is never a test to "just update".
 *
 * WHY THE PREVIOUS SHAPE WAS REPLACED — `g-multi-ops-ordering-pin-reads-array-text-not-tokenizer-behaviour`
 * The #965 pin regex-parsed the array's SOURCE TEXT and checked prefix ordering. It never ran the
 * tokenizer, so changing the matcher to iterate a length-sorted copy (array untouched) made `>>>`
 * reachable while every check stayed green; and `] as const;` or a quoted operator in a comment
 * inside the array broke or fooled the parse.
 *
 * HOW THE LIVE OPERATOR SET IS OBTAINED (no compiler-source edit)
 * ==============================================================
 * `MULTI_OPS` is a function-local `const` — not exported, not importable. It is read from the LIVE
 * function object: `tokenizeLogic.toString()` returns the code the runtime actually loaded (Bun's
 * transpiled output — TypeScript syntax such as `as const` and all comments already gone). The array
 * literal is cut out with a string/comment-aware bracket scanner and EVALUATED by the JS engine
 * (`new Function`) — no regex over quoted text, no JSON parse.
 *
 * That extraction is then CHECKED behaviourally: an exhaustive probe of every 2–4 character string
 * over the operator alphabet collects each multi-char OPERATOR token the tokenizer really emits, and
 * every one of them must be a member of the extracted array. A stale, partial or wrong extraction
 * cannot survive that — the extraction navigates, the tokenizer gates.
 */
import { describe, test, expect } from "bun:test";
import { tokenizeLogic } from "../../src/tokenizer.ts";

const GAP_PIN = "g-multi-ops-ordering-pin-reads-array-text-not-tokenizer-behaviour";
const GAP_BUG = "g-multi-ops-first-match-shadows-the-longer-operator";

/**
 * The members that currently do NOT lex as one token of their own text. Exact-equality pinned.
 * Changing this list is a LANGUAGE RULING (see the header), not test maintenance.
 */
const KNOWN_NOT_SELF_LEXING = [">>>"];

/** Cut the `MULTI_OPS = [ ... ]` literal out of the live function source and evaluate it. */
function liveMultiOps() {
  const src = tokenizeLogic.toString();
  const decl = /\bMULTI_OPS\s*=\s*\[/.exec(src);
  if (!decl) {
    throw new Error(
      "could not locate `MULTI_OPS = [` in the live tokenizeLogic function — the extraction is " +
        "broken, NOT the tokenizer clean. Re-point this harness before trusting any result.",
    );
  }
  const open = decl.index + decl[0].length - 1;
  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]" && --depth === 0) break;
  }
  if (depth !== 0) throw new Error("unterminated MULTI_OPS literal in the live tokenizeLogic source");
  const ops = new Function(`return (${src.slice(open, i + 1)});`)();
  if (!Array.isArray(ops) || !ops.every((o) => typeof o === "string")) {
    throw new Error("the live MULTI_OPS literal did not evaluate to an array of strings");
  }
  return ops;
}

/** Tokenize `a <op> b` with the real tokenizer and return the tokens between `a` and `b`. */
function lexBetween(op) {
  const toks = tokenizeLogic(`a ${op} b`, 0, 1, 1, []);
  if (!Array.isArray(toks) || toks.length === 0) {
    throw new Error(`tokenizeLogic returned NO tokens for \`a ${op} b\` — the harness is broken, not the lexer`);
  }
  const first = toks[0];
  const bIdx = toks.findIndex((t, k) => k > 0 && t.kind === "IDENT" && t.text === "b");
  if (!first || first.kind !== "IDENT" || first.text !== "a" || bIdx < 0) {
    throw new Error(
      `\`a ${op} b\` did not lex with \`a\` and \`b\` as identifiers: ` +
        JSON.stringify(toks.map((t) => `${t.kind}:${t.text}`)),
    );
  }
  return toks.slice(1, bIdx);
}

function lexesAsItself(op) {
  const mid = lexBetween(op);
  return mid.length === 1 && mid[0].kind === "OPERATOR" && mid[0].text === op;
}

const OPS = liveMultiOps();
const RESULTS = OPS.map((op) => ({ op, self: lexesAsItself(op), split: lexBetween(op).map((t) => t.text) }));

describe("tokenizer MULTI_OPS — which members lex as themselves (behavioural, S419)", () => {
  test("the live operator set is non-empty and every member was tokenized", () => {
    // Vacuity guard: a failed extraction must never render as "no member is shadowed".
    expect(OPS.length).toBeGreaterThan(20);
    expect(RESULTS.length).toBe(OPS.length);
    expect(OPS).toContain(">>");
  });

  test("the extraction IS the live set: every multi-char OPERATOR the tokenizer emits is a member", () => {
    // Exhaustive over 2–4 char strings of the operator alphabet (~54k lexes, a few hundred ms).
    const alphabet = ".:-+*/%^&|!=<>?".split("");
    const emitted = new Set();
    let frontier = [""];
    for (let len = 1; len <= 4; len++) {
      const next = [];
      for (const p of frontier) for (const c of alphabet) next.push(p + c);
      if (len >= 2) {
        for (const probe of next) {
          const toks = tokenizeLogic(`a ${probe} b`, 0, 1, 1, []);
          if (toks.length === 0) throw new Error(`tokenizeLogic returned NO tokens for \`a ${probe} b\``);
          for (const t of toks) if (t.kind === "OPERATOR" && t.text.length > 1) emitted.add(t.text);
        }
      }
      frontier = next;
    }
    const strangers = [...emitted].filter((t) => !OPS.includes(t)).sort();
    if (strangers.length) {
      throw new Error(
        `the tokenizer emits OPERATOR tokens absent from the extracted MULTI_OPS: ${JSON.stringify(strangers)} ` +
          `— the extraction is not the live array (or operators now come from elsewhere). Fix the harness first.`,
      );
    }
    // Every self-lexing member must have been seen by the probe (members within the probe alphabet).
    const inAlphabet = (op) => [...op].every((c) => alphabet.includes(c));
    const missed = RESULTS.filter((r) => r.self && inAlphabet(r.op) && !emitted.has(r.op)).map((r) => r.op);
    expect(missed).toEqual([]);
    expect(emitted.size).toBeGreaterThan(0);
  });

  test(`the set of members that do NOT lex as themselves is exactly ${JSON.stringify(KNOWN_NOT_SELF_LEXING)}`, () => {
    const notSelf = RESULTS.filter((r) => !r.self);
    const actual = notSelf.map((r) => r.op).sort();
    const expected = [...KNOWN_NOT_SELF_LEXING].sort();
    const newlyBroken = actual.filter((op) => !expected.includes(op));
    const nowLexing = expected.filter((op) => !actual.includes(op));
    if (newlyBroken.length || nowLexing.length) {
      const describeSplit = (op) => {
        const r = RESULTS.find((x) => x.op === op);
        return r ? `${JSON.stringify(op)} -> ${JSON.stringify(r.split)}` : JSON.stringify(op);
      };
      throw new Error(
        [
          "MULTI_OPS lexing behaviour changed.",
          newlyBroken.length
            ? `  NO LONGER lex as one token of their own text: ${newlyBroken.map(describeSplit).join(", ")}`
            : null,
          nowLexing.length
            ? `  NOW lex correctly as one token (previously did not): ${nowLexing.map(describeSplit).join(", ")}`
            : null,
          `Changing this set changes what the language ACCEPTS — it is a LANGUAGE RULING, not a test to update ` +
            `casually. See ${GAP_BUG} and ${GAP_PIN} in docs/known-gaps.md. If the ruling landed, update ` +
            `KNOWN_NOT_SELF_LEXING and resolve the gap in the same change; otherwise revert the lexer change.`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
    expect(actual).toEqual(expected);
  });

  test("DIAGNOSTIC (behaviour-derived) — each member that fails to lex is cut short by a shorter live member", () => {
    // For every non-self-lexing member, the token the lexer actually produced first must be a
    // strictly shorter MULTI_OPS member that prefixes it — i.e. the failure is first-match
    // shadowing, not some other lexing path. Read from the tokens, not from the array's order.
    for (const r of RESULTS.filter((x) => !x.self)) {
      const head = r.split[0];
      const cause = OPS.includes(head) && head.length < r.op.length && r.op.startsWith(head);
      if (!cause) {
        throw new Error(
          `${JSON.stringify(r.op)} fails to lex as itself but is not cut short by a shorter member: ` +
            `lexed as ${JSON.stringify(r.split)}. See ${GAP_BUG}.`,
        );
      }
      expect(r.split.join("")).toBe(r.op);
    }
  });
});
