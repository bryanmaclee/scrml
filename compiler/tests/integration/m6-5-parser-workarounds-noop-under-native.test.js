/**
 * M6.5 — parser-workarounds helpers are no-ops when the native parser is upstream.
 *
 * Path (a) verification per /home/bryan/scrmlMaster/scrml-support/docs/deep-dives/
 *   m6-joint-retirement-cutover-plan-2026-05-23.md §M6.5.
 *
 * The four helpers in compiler/src/codegen/compat/parser-workarounds.js exist to
 * recover from BPP-era boundary loss in the live BS+TAB pipeline:
 *
 *   - splitBareExprStatements — scan a bare-expr string for merged statements.
 *   - splitMergedStatements   — split a merged let/const/reactive init string.
 *   - stripLeakedComments     — drop natural-language fragments leaked into expr text.
 *   - isLeakedComment         — heuristic for the above.
 *
 * The native parser (compiler/native-parser/parse-file.js + translate-stmt.js)
 * always populates `node.exprNode` (BareExprNode) and `node.initExpr`
 * (LetDeclNode / ConstDeclNode) — never round-trips through a string. emit-logic.ts
 * has explicit Phase 3 "fast path" branches that bypass all four helpers when
 * those structured nodes are present:
 *
 *   - emit-logic.ts:1174  (bare-expr fast path returns at :1276 — skips helpers)
 *   - emit-logic.ts:1391  (let-decl fast path returns at :1405 — skips splitMergedStatements)
 *   - emit-logic.ts:1492  (const-decl fast path returns at :1493 — skips splitMergedStatements)
 *
 * This test empirically verifies the structural claim: compile a representative
 * sample of examples through `parser: "scrml-native"`, observe invocations of
 * the four helpers via the `setBPPOverrides` interception hook, and assert
 * either (a) the helper is never invoked OR (b) the helper returns its input
 * bit-identically (functional no-op).
 *
 * STOP-condition (per dispatch §6.5): if any helper actually modifies its input
 * when the native parser is upstream, the native walker is producing dirty
 * boundaries and path (a) does not hold — escalate to path (b).
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { resolve } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { compileScrml } from "../../src/api.js";
import {
  setBPPOverrides,
  splitBareExprStatements,
  splitMergedStatements,
  stripLeakedComments,
  isLeakedComment,
} from "../../src/codegen/compat/parser-workarounds.js";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const EXAMPLES_DIR = resolve(REPO_ROOT, "examples");

// Representative example set — breadth-first selection covering hello-world,
// reactive counters, list mutation, channel-server, machines, and modern
// lin-token semantics. Six files keep the test wall-clock low (<5s) while
// exercising every BareExprNode / let-decl / const-decl shape the native
// parser emits in practice.
const REPRESENTATIVE_EXAMPLES = [
  "01-hello.scrml",
  "02-counter.scrml",
  "03-contact-book.scrml",
  "08-chat.scrml",
  "14-mario-state-machine.scrml",
  "19-lin-token.scrml",
];

let TMP;
beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "m6-5-noop-"));
});
afterAll(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
  // Restore — defense in depth in case a test crashed without clearing.
  setBPPOverrides(null);
});

/**
 * Install spies on all four helpers via the `_overrides` interception hook.
 * Each spy:
 *   - records (args, return) tuples into `invocations[name]`
 *   - computes the original implementation's answer (by clearing the override
 *     reentrantly while invoking — the override stays in place AFTER the spy
 *     returns, so subsequent calls still hit the spy; the pristine call only
 *     hits the original).
 *
 * Returns the invocations record + a cleanup function.
 */
function installInvocationSpies() {
  const invocations = {
    splitBareExprStatements: [],
    splitMergedStatements: [],
    stripLeakedComments: [],
    isLeakedComment: [],
  };

  // To compute the "original" (no-override) answer, we momentarily clear the
  // overrides and call the export directly — the export will short-circuit on
  // `_overrides?.X` and run its pristine body.
  function pristine(fn, args) {
    setBPPOverrides(null);
    try { return fn(...args); }
    finally { setBPPOverrides(spies); }
  }

  const spies = {
    splitBareExprStatements: (...args) => {
      const out = pristine(splitBareExprStatements, args);
      invocations.splitBareExprStatements.push({ args, out });
      return out;
    },
    splitMergedStatements: (...args) => {
      const out = pristine(splitMergedStatements, args);
      invocations.splitMergedStatements.push({ args, out });
      return out;
    },
    stripLeakedComments: (...args) => {
      const out = pristine(stripLeakedComments, args);
      invocations.stripLeakedComments.push({ args, out });
      return out;
    },
    isLeakedComment: (...args) => {
      const out = pristine(isLeakedComment, args);
      invocations.isLeakedComment.push({ args, out });
      return out;
    },
  };

  setBPPOverrides(spies);
  return {
    invocations,
    cleanup: () => setBPPOverrides(null),
  };
}

function compileExampleViaNative(name) {
  const src = resolve(EXAMPLES_DIR, name);
  const outDir = join(TMP, name.replace(/\.scrml$/, ".dist"));
  return compileScrml({
    inputFiles: [src],
    outputDir: outDir,
    write: false,
    log: () => {},
    parser: "scrml-native",
  });
}

describe("M6.5 — parser-workarounds helpers are no-ops under native parser", () => {
  beforeEach(() => {
    // Hygiene — defensive, every test installs its own spies.
    setBPPOverrides(null);
  });

  test("splitMergedStatements is NEVER invoked across the representative corpus", () => {
    const { invocations, cleanup } = installInvocationSpies();
    try {
      for (const name of REPRESENTATIVE_EXAMPLES) {
        compileExampleViaNative(name);
      }
      // splitMergedStatements has zero call sites in emit-logic.ts (dead import).
      // The dispatch §6.5 path (a) requires this to be true under native upstream.
      expect(invocations.splitMergedStatements.length).toBe(0);
    } finally {
      cleanup();
    }
  });

  test("splitBareExprStatements either is not invoked OR returns its input as a single-element array (no-op)", () => {
    const { invocations, cleanup } = installInvocationSpies();
    try {
      for (const name of REPRESENTATIVE_EXAMPLES) {
        compileExampleViaNative(name);
      }
      // The helper's no-op contract: when there is nothing to split, it returns
      // [trimmed-input]. Under native upstream the bare-expr fast path at
      // emit-logic.ts:1174 returns before line 1318 ever fires — invocations
      // should be empty. If a call DID slip through (e.g. via the destructure-
      // pattern arm at :1306), it must be a no-op: a single-element array
      // whose element is the trimmed input.
      for (const { args, out } of invocations.splitBareExprStatements) {
        const input = args[0];
        if (typeof input !== "string" || input.trim() === "") {
          // Edge: non-string / empty — helper short-circuits at :73-75 to
          // [input] / [trimmed-empty]. Trivially a no-op.
          continue;
        }
        const trimmed = input.trim();
        // No-op contract: the array has exactly one element AND that element
        // equals the trimmed input. ANY split is a sign that native is
        // producing dirty boundaries — STOP and escalate.
        expect(out.length).toBe(1);
        expect(out[0]).toBe(trimmed);
      }
    } finally {
      cleanup();
    }
  });

  test("stripLeakedComments either is not invoked OR returns its input unchanged (no-op)", () => {
    const { invocations, cleanup } = installInvocationSpies();
    try {
      for (const name of REPRESENTATIVE_EXAMPLES) {
        compileExampleViaNative(name);
      }
      for (const { args, out } of invocations.stripLeakedComments) {
        const input = args[0];
        // No-op contract: input bit-identical to output. Any deviation means
        // the native parser surfaced a "leaked comment"-shaped string the
        // helper actually scrubbed — STOP and escalate.
        expect(out).toBe(input);
      }
    } finally {
      cleanup();
    }
  });

  test("isLeakedComment either is not invoked OR returns false (no native-upstream string trips the heuristic)", () => {
    const { invocations, cleanup } = installInvocationSpies();
    try {
      for (const name of REPRESENTATIVE_EXAMPLES) {
        compileExampleViaNative(name);
      }
      // isLeakedComment is a predicate. The native-upstream no-op contract is:
      // the predicate must return false for every native-upstream input,
      // because the native parser never leaks comments into expression text
      // (the lexer's lex-in-line-comment.js / lex-in-block-comment.js partition
      // them out before they reach the Expr layer). A `true` return would mean
      // the helper found a "leaked comment" in native output — STOP and escalate.
      for (const { args, out } of invocations.isLeakedComment) {
        expect(out).toBe(false);
      }
    } finally {
      cleanup();
    }
  });

  test("path (a) verdict: all four helpers behave as no-ops on the representative corpus", () => {
    const { invocations, cleanup } = installInvocationSpies();
    try {
      for (const name of REPRESENTATIVE_EXAMPLES) {
        compileExampleViaNative(name);
      }
      // Roll-up assertion. If this passes, the dispatch's STOP condition is
      // NOT met; path (a) is confirmed and M6.8 may proceed with helper
      // deletion once the BPP/string-fallback path is retired everywhere.
      const offenders = {
        splitBareExprStatements: invocations.splitBareExprStatements.filter(({ args, out }) => {
          if (typeof args[0] !== "string" || args[0].trim() === "") return false;
          return !(out.length === 1 && out[0] === args[0].trim());
        }),
        splitMergedStatements: invocations.splitMergedStatements,
        stripLeakedComments: invocations.stripLeakedComments.filter(({ args, out }) => out !== args[0]),
        isLeakedComment: invocations.isLeakedComment.filter(({ out }) => out === true),
      };
      expect(offenders.splitBareExprStatements.length).toBe(0);
      expect(offenders.splitMergedStatements.length).toBe(0);
      expect(offenders.stripLeakedComments.length).toBe(0);
      expect(offenders.isLeakedComment.length).toBe(0);
    } finally {
      cleanup();
    }
  });
});
