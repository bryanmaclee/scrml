/**
 * S97 — Brute-force syntax-stress harness (v0.3.x dispatch candidate;
 * initial fixture pass).
 *
 * Surfaces three things by throwing non-scrml syntaxes at the compiler:
 *   (a) GHOST-PATTERN LINT COVERAGE GAPS — adopter-mistake shapes that
 *       SHOULD fire a `W-LINT-*` (or other adopter-helpful diagnostic)
 *       but don't.
 *   (b) SILENT-COMPILE BUGS — input compiles cleanly to broken JS (the
 *       Bug 14 shape from S96). Detected by `new Function(client)`
 *       throwing SyntaxError, OR by `result.errors` being empty when the
 *       input is clearly non-scrml.
 *   (c) DIAGNOSTIC QUALITY — when errors fire, do they name the root
 *       cause? (Tracked manually via the `expect.diagnosticQuality`
 *       field; the test asserts only that the EXPECTED code fires, not
 *       that the message is good. Manual review of the report
 *       categorizes quality.)
 *
 * EXPECTED-vs-ACTUAL classification (the test assertion):
 *
 *   Each fixture declares an `expect` block:
 *     { category: "ghost-caught", code: "W-LINT-XXX" }
 *       → assert: lintDiagnostics contains an entry with that code
 *     { category: "compile-error", codePrefix: "E-..." }
 *       → assert: errors contains an entry whose code matches the prefix
 *     { category: "silent-bad-js" }
 *       → assert: errors is empty AND `new Function(client)` throws
 *         (this is a KNOWN BUG; the test passes only as long as the bug
 *         still exists; CLOSING the bug requires updating expect →
 *         "compile-error" with the appropriate diagnostic)
 *     { category: "clean-pass" }
 *       → assert: errors is empty AND client JS is parseable
 *         (used for scrml-shaped inputs that LOOK like a ghost pattern
 *         but are actually legitimate — regression guards)
 *     { category: "uncovered-gap" }
 *       → assert: NO ghost-lint diagnostic fires AND no error fires
 *         (this means the shape silently passes through with no
 *         adopter warning — surfaces as a coverage gap to file as a
 *         future W-LINT-* addition)
 *     { category: "generic-error", codePrefix: "E-..." }
 *       → assert: errors contains entry with the prefix BUT the diagnostic
 *         is NOT pattern-specific (e.g. `E-SCOPE-001` "undefined
 *         identifier" fires on a React `useState` call). Distinct from
 *         "compile-error" because the message doesn't name the ghost
 *         pattern — adopter has to figure out the React→scrml mapping
 *         on their own. Goal (c) (diagnostic quality) gap.
 *
 * Closing a fixture's bug = update the fixture's expect block. The fixture
 * stays in the harness as a regression guard.
 *
 * INTENT: this harness is a LIVING SCORECARD, not a pass/fail gate. The
 * pass/fail asserts encode "current truth"; what matters is the gap
 * count and the trajectory. Each session can chip at gaps surfaced here.
 *
 * SPEC authority: §1.5 north-star tier ladder; §11 anti-patterns table;
 *                  §34 W-LINT-* catalog; pa.md Rule 2 (full-production fidelity).
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import fs from "fs";
import path from "path";
import os from "os";

function compileSrcToTmp(src, basename = "stress-test") {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stress-"));
  const srcPath = path.join(tmpDir, `${basename}.scrml`);
  fs.writeFileSync(srcPath, src);
  try {
    const result = compileScrml({
      inputFiles: [srcPath],
      write: true,
      outputDir: tmpDir,
    });
    const clientPath = path.join(tmpDir, `${basename}.client.js`);
    const client = fs.existsSync(clientPath) ? fs.readFileSync(clientPath, "utf-8") : null;
    return {
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
      lintDiagnostics: result.lintDiagnostics ?? [],
      client,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function isClientParseable(client) {
  if (!client || typeof client !== "string") return false;
  try { new Function(client); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------
// Fixture corpus
// ---------------------------------------------------------------------------
//
// Each fixture is `{ name, src, expect }`. The fixture name doubles as the
// test name; `src` is the scrml source under test; `expect` declares the
// asserted outcome category (see file-header comment for category semantics).

const REACT_FIXTURES = [
  {
    name: "React className= attribute",
    src: `<program><div className="foo">x</div></program>`,
    expect: { category: "ghost-caught", code: "W-LINT-003" },
  },
  {
    name: "React onCamelCase event (onClick)",
    src: `<program><button onClick={fn}>x</button></program>`,
    expect: { category: "ghost-caught", code: "W-LINT-004" },
  },
  {
    name: "React JSX brace on value=",
    src: `<program><input value={state} /></program>`,
    expect: { category: "ghost-caught", code: "W-LINT-005" },
  },
  {
    name: "React conditional rendering {cond && <El>}",
    src: `<program><div>{flag && <span>shown</span>}</div></program>`,
    expect: { category: "ghost-caught", code: "W-LINT-008" },
  },
  {
    name: "React useState hook call in logic",
    src: `<program>\${ const [count, setCount] = useState(0) }<div>\${count}</div></program>`,
    // S97 commit: W-LINT-016 added — pattern-specific React-hook diagnostic
    // (was generic E-SCOPE-001 "undefined identifier" pre-fix).
    expect: { category: "ghost-caught", code: "W-LINT-016" },
  },
  {
    name: "React useEffect hook call in logic",
    src: `<program>\${ useEffect(() => { console.log("mount") }, []) }<div>x</div></program>`,
    expect: { category: "ghost-caught", code: "W-LINT-016" },
  },
  {
    name: "React Fragment <>",
    src: `<program><><div>a</div><div>b</div></></program>`,
    expect: { category: "ghost-caught", code: "W-LINT-023" },
  },
];

const VUE_FIXTURES = [
  {
    name: "Vue :attr= colon-prefix binding",
    src: `<program><div :class="active">x</div></program>`,
    expect: { category: "ghost-caught", code: "W-LINT-011" },
  },
  {
    name: "Vue v-if= directive",
    src: `<program><div v-if="flag">x</div></program>`,
    expect: { category: "ghost-caught", code: "W-LINT-012" },
  },
  {
    name: "Vue v-for= directive",
    src: `<program><li v-for="item in items">x</li></program>`,
    expect: { category: "ghost-caught", code: "W-LINT-012" },
  },
  {
    name: "Vue @event= shorthand",
    src: `<program><button @click="handle">x</button></program>`,
    expect: { category: "ghost-caught", code: "W-LINT-013" },
  },
  {
    name: "Vue ref() composition API",
    src: `<program>\${ const count = ref(0) }<div>\${count}</div></program>`,
    expect: { category: "ghost-caught", code: "W-LINT-017" },
  },
  {
    name: "Vue reactive() composition API",
    src: `<program>\${ const state = reactive({ count: 0 }) }<div>\${state.count}</div></program>`,
    expect: { category: "ghost-caught", code: "W-LINT-017" },
  },
  {
    name: "Vue {{interpolation}} double-brace",
    src: `<program><div>{{ user.name }}</div></program>`,
    expect: { category: "ghost-caught", code: "W-LINT-020" },
  },
];

const SVELTE_FIXTURES = [
  {
    name: "Svelte {#if} block",
    src: `<program><div>{#if flag}<span>shown</span>{/if}</div></program>`,
    expect: { category: "ghost-caught", code: "W-LINT-014" },
  },
  {
    name: "Svelte {#each} block",
    src: `<program><ul>{#each items as item}<li>{item}</li>{/each}</ul></program>`,
    expect: { category: "ghost-caught", code: "W-LINT-014" },
  },
  {
    name: "Svelte {@html expr} raw HTML",
    src: `<program><div>{@html rawString}</div></program>`,
    expect: { category: "ghost-caught", code: "W-LINT-015" },
  },
  {
    name: "Svelte $store auto-subscribe",
    src: `<program><div>\${$count}</div></program>`,
    // S98 (combined-lint-additions-s98 Item 2): W-LINT-024 — `$ident` inside
    // `${...}` markup-interp slot now produces a specific lint instead of
    // falling through to the generic E-SCOPE-001 fallback. Approach (a) per
    // S97 hand-off: narrowest false-positive surface; catches the
    // load-bearing case (markup-interpolated `$store`).
    expect: { category: "ghost-caught", code: "W-LINT-024" },
  },
  {
    name: "Svelte writable() store",
    src: `<program>\${ const count = writable(0) }<div>\${count}</div></program>`,
    expect: { category: "ghost-caught", code: "W-LINT-018" },
  },
];

const SOLID_FIXTURES = [
  {
    name: "Solid createSignal hook",
    src: `<program>\${ const [count, setCount] = createSignal(0) }<div>\${count}</div></program>`,
    expect: { category: "ghost-caught", code: "W-LINT-019" },
  },
  {
    name: "Solid createEffect hook",
    src: `<program>\${ createEffect(() => { console.log("mount") }) }<div>x</div></program>`,
    expect: { category: "ghost-caught", code: "W-LINT-019" },
  },
];

const ANGULAR_FIXTURES = [
  {
    name: "Angular *ngIf structural directive",
    src: `<program><div *ngIf="flag">x</div></program>`,
    expect: { category: "ghost-caught", code: "W-LINT-021" },
  },
  {
    name: "Angular (click)= event",
    src: `<program><button (click)="fn()">x</button></program>`,
    expect: { category: "ghost-caught", code: "W-LINT-021" },
  },
  {
    name: "Angular [(ngModel)]= two-way",
    src: `<program><input [(ngModel)]="name" /></program>`,
    expect: { category: "ghost-caught", code: "W-LINT-021" },
  },
];

const JS_PARADIGM_FIXTURES = [
  {
    name: "try/catch in scrml source",
    src: `<program>\${ try { doIt() } catch (e) { console.log(e) } }<div>x</div></program>`,
    expect: { category: "ghost-caught", code: "W-TRY-CATCH-IN-SCRML-SOURCE" },
  },
  {
    name: "throw new Error()",
    // Fork-D drain-path-1 (2026-07): the DEFAULT parse path now fires the same
    // parse-layer rejection the native parser fires — E-THROW-NOT-IN-SCRML —
    // instead of squatting on E-ERROR-006 (which §19.2.3 reserves for the
    // renders-clause undefined-variable check).
    src: `<program>\${ function bad() { throw new Error("nope") } }<div>x</div></program>`,
    expect: { category: "compile-error", codePrefix: "E-THROW-NOT-IN-SCRML" },
  },
  {
    name: "=== strict equality (scrml is == only per §45)",
    src: `<program><x> = 1<div>\${@x === 1 ? "yes" : "no"}</div></program>`,
    expect: { category: "compile-error", codePrefix: "E-EQ-004" },
  },
  {
    name: "null literal in scrml source",
    src: `<program><x> = null<div>\${@x}</div></program>`,
    expect: { category: "compile-error", codePrefix: "E-SYNTAX-042" },
  },
];

const TYPESCRIPT_FIXTURES = [
  {
    name: "TypeScript interface declaration (not scrml)",
    src: `<program>\${ interface User { name: string } }<div>x</div></program>`,
    expect: { category: "ghost-caught", code: "W-LINT-022" },
  },
  {
    name: "TS untagged type alias `type X = { ... }`",
    src: `<program>\${ type User = { name: string } }<div>x</div></program>`,
    expect: { category: "ghost-caught", code: "W-LINT-022" },
  },
];

const REGRESSION_GUARDS = [
  // Inputs that LOOK like ghost patterns but are valid scrml — must NOT trip
  // the lint. Locks current behavior; future lint refinements must keep
  // these clean.
  {
    name: "scrml class:name= directive (looks Vue-ish but is canonical)",
    src: `<program><x> = true<div class:active=@x>x</div></program>`,
    expect: { category: "clean-pass" },
  },
  {
    name: "scrml bind:value= directive (Svelte-shaped but canonical)",
    src: `<program><name> = ""<input bind:value=@name /></program>`,
    expect: { category: "clean-pass" },
  },
  {
    name: "scrml type X:struct = { ... } (NOT TS-untagged)",
    src: `<program>\${ type User:struct = { name: string } }<div>x</div></program>`,
    expect: { category: "clean-pass" },
  },
  {
    name: "scrml props={...} on component def (NOT JSX braces)",
    src: `<program>\${ const Btn = <button props={ label: string }>\${label}</> }<Btn label="x"/></program>`,
    expect: { category: "clean-pass" },
  },
];

const ALL_FIXTURES = [
  ...REACT_FIXTURES,
  ...VUE_FIXTURES,
  ...SVELTE_FIXTURES,
  ...SOLID_FIXTURES,
  ...ANGULAR_FIXTURES,
  ...JS_PARADIGM_FIXTURES,
  ...TYPESCRIPT_FIXTURES,
  ...REGRESSION_GUARDS,
];

// ---------------------------------------------------------------------------
// Per-fixture assertions
// ---------------------------------------------------------------------------

function classify(fixture, outcome) {
  const { errors, warnings, lintDiagnostics, client } = outcome;
  const lintCodes = lintDiagnostics.map((d) => d.code);
  const errorCodes = errors.map((e) => e.code);
  const warnCodes = warnings.map((w) => w.code);

  switch (fixture.expect.category) {
    case "ghost-caught": {
      const wanted = fixture.expect.code;
      const allDiagCodes = [...lintCodes, ...errorCodes, ...warnCodes];
      return {
        pass: allDiagCodes.includes(wanted),
        actual: `lintCodes=[${lintCodes.join(",")}] errorCodes=[${errorCodes.join(",")}] warnCodes=[${warnCodes.join(",")}]`,
      };
    }
    case "compile-error":
    case "generic-error": {
      // "generic-error" is structurally identical to "compile-error" for
      // the assertion (the prefix must fire). Distinction lives in the
      // scorecard: generic-error counts toward goal (c) diagnostic-quality
      // gap so the lint catalog can be extended with pattern-specific
      // diagnostics over time.
      const prefix = fixture.expect.codePrefix;
      const matched = errorCodes.some((c) => c.startsWith(prefix));
      return {
        pass: matched,
        actual: `errorCodes=[${errorCodes.join(",")}]`,
      };
    }
    case "silent-bad-js": {
      const noErrors = errors.length === 0;
      const brokenJs = client && !isClientParseable(client);
      return {
        pass: noErrors && brokenJs,
        actual: `errors=${errors.length} client-parseable=${isClientParseable(client)}`,
      };
    }
    case "clean-pass": {
      const noErrors = errors.length === 0;
      const validJs = client && isClientParseable(client);
      return {
        pass: noErrors && validJs,
        actual: `errors=${errors.length} client-parseable=${isClientParseable(client)} errorCodes=[${errorCodes.join(",")}]`,
      };
    }
    case "uncovered-gap": {
      // Bug-shape today: no lint fires AND no error fires (silent acceptance
      // of a non-scrml shape). Closing this fixture's gap = move to either
      // "ghost-caught" with the new W-LINT-* code, or "compile-error" with
      // an appropriate E-* code.
      const noLint = lintCodes.length === 0;
      const noErrors = errors.length === 0;
      return {
        pass: noLint && noErrors,
        actual: `lintCodes=[${lintCodes.join(",")}] errorCodes=[${errorCodes.join(",")}]`,
      };
    }
    default:
      return { pass: false, actual: `unknown category ${fixture.expect.category}` };
  }
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe("stress: ghost-pattern coverage harness", () => {
  for (const fixture of ALL_FIXTURES) {
    test(fixture.name, () => {
      const outcome = compileSrcToTmp(fixture.src);
      const result = classify(fixture, outcome);
      if (!result.pass) {
        throw new Error(
          `[${fixture.expect.category}] expected ${JSON.stringify(fixture.expect)} but got ${result.actual}`,
        );
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Aggregate scorecard
// ---------------------------------------------------------------------------

describe("stress: scorecard summary", () => {
  test("report by category", () => {
    const buckets = {
      "ghost-caught": [],
      "compile-error": [],
      "generic-error": [],
      "silent-bad-js": [],
      "clean-pass": [],
      "uncovered-gap": [],
    };
    for (const fixture of ALL_FIXTURES) {
      const arr = buckets[fixture.expect.category];
      if (arr) arr.push(fixture.name);
    }
    // Print scorecard to stderr so it shows in `bun test` output
    const lines = [
      "=== ghost-pattern stress scorecard ===",
      `total fixtures: ${ALL_FIXTURES.length}`,
      "",
      `ghost-caught (specific lint fires):    ${buckets["ghost-caught"].length}`,
      `compile-error (specific E-* fires):    ${buckets["compile-error"].length}`,
      `generic-error (E-SCOPE-001 etc. — quality gap, goal c): ${buckets["generic-error"].length}`,
      `silent-bad-js (compiles, JS broken):   ${buckets["silent-bad-js"].length}`,
      `clean-pass (valid scrml regr guard):   ${buckets["clean-pass"].length}`,
      `uncovered-gap (silent acceptance — goal a): ${buckets["uncovered-gap"].length}`,
      "",
      "generic-error details (diagnostic-quality opportunities):",
      ...buckets["generic-error"].map((n) => `  - ${n}`),
      "",
      "uncovered-gap details (lint catalog candidates):",
      ...buckets["uncovered-gap"].map((n) => `  - ${n}`),
    ];
    // eslint-disable-next-line no-console
    console.error("\n" + lines.join("\n") + "\n");
    // Always passes — this is informational
    expect(true).toBe(true);
  });
});
