/**
 * diagnostic-span-fallback.test.js — the compile-command formatters surface a
 * diagnostic's source location from `.span` when it is not flattened to
 * top-level `line`/`column`/`file` fields.
 *
 * g-compile-formatter-drops-span-location (2026-08-29, peter): TS-stage
 * diagnostics (E-STATE-UNDECLARED, E-SCOPE-001, …) reach the compile CLI as
 * TSError-derived objects that carry their location ONLY on `.span`
 * (`{ file, line, col }`) — `collectErrors("TS", …)` never flattens it to the
 * top-level `line`/`file` fields the compile formatters read. So those errors
 * printed `stage: TS` with NO `--> file:line:col` line, while build.js / dev.js
 * (which already read the `.span` fallback) showed it. All three compile
 * formatters now resolve location through the shared `resolveDiagLocation`
 * helper (top-level → `.span`, incl. the middle `?? diag.col` level). The
 * diagnostic DATA (`.span`) is untouched — only the display path changed.
 */
import { describe, test, expect } from "bun:test";
import { formatError, formatWarning, formatLintDiagnostic } from "../../src/commands/compile.js";

// Strip the FULL ANSI SGR sequence INCLUDING the leading ESC (\x1b) byte. A
// regex that omits `\x1b` leaves the ESC in place, so a `.toContain("--> …")`
// assertion only passes because the colorizer is a no-op under isTTY=false;
// matching the ESC makes the assertions hold regardless of TTY state.
// eslint-disable-next-line no-control-regex
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("compile formatters — source location falls back to `.span`", () => {
  test("an error carrying its location ONLY on `.span` prints `--> file:line:col`", () => {
    // Shape of a TSError-derived diagnostic reaching the CLI: code + message +
    // stage + span, but NO top-level line/column/file.
    const err = {
      code: "E-STATE-UNDECLARED",
      message: "E-STATE-UNDECLARED: bare `@stamp` read with no reactive cell in scope.",
      stage: "TS",
      severity: "error",
      span: { file: "/proj/a.scrml", start: 0, end: 0, line: 9, col: 18 },
    };
    const out = stripAnsi(formatError(err, "/proj"));
    expect(out).toContain("--> a.scrml:9:18");
    // The stage line is still present (unchanged behavior).
    expect(out).toContain("stage: TS");
  });

  test("top-level line/file still win over span (regression — no double-read)", () => {
    const err = {
      code: "E-CG-000",
      message: "boom",
      file: "/proj/b.scrml",
      line: 3,
      column: 4,
      // A span with DIFFERENT coords must NOT override the explicit top-level fields.
      span: { file: "/proj/other.scrml", line: 99, col: 99 },
    };
    const out = stripAnsi(formatError(err, "/proj"));
    expect(out).toContain("--> b.scrml:3:4");
    expect(out).not.toContain("other.scrml");
    expect(out).not.toContain(":99:99");
  });

  test("the MIDDLE `diag.col` level resolves col when only top-level `col` (not `column`) is set", () => {
    // build.js:905/918 + dev.js all use `diag.column ?? diag.col ?? diag.span?.col`.
    // The first pass dropped the middle `?? diag.col`; a diagnostic whose column
    // lives on `col` (not `column`, not `span.col`) must still render `:line:col`.
    const err = {
      code: "E-EXAMPLE",
      message: "middle-col level",
      file: "/proj/m.scrml",
      line: 12,
      col: 5,
    };
    const out = stripAnsi(formatError(err, "/proj"));
    expect(out).toContain("--> m.scrml:12:5");
  });

  test("no file/span anywhere → no `-->` line (no crash)", () => {
    const err = { code: "E-X", message: "no location", stage: "TS", severity: "error" };
    const out = stripAnsi(formatError(err, "/proj"));
    expect(out).not.toContain("-->");
    expect(out).toContain("stage: TS");
  });

  test("formatWarning falls back to `.span` and prints `:line:col` (not line only)", () => {
    const warn = {
      code: "W-EXAMPLE-001",
      message: "W-EXAMPLE-001: something noteworthy",
      severity: "warning",
      span: { file: "/proj/c.scrml", line: 7, col: 2 },
    };
    const out = stripAnsi(formatWarning(warn, "/proj"));
    expect(out).toContain("--> c.scrml:7:2");
  });

  test("formatLintDiagnostic on a span-only lint prints `--> file:line:col`, not `undefined`", () => {
    // Regression for the unconditional `:${diag.line}:${diag.column}` that printed
    // `--> path:undefined:undefined` for a lint carrying location only on `.span`.
    const lint = {
      code: "W-LINT-001",
      message: "W-LINT-001: ghost pattern",
      span: { file: "/proj/l.scrml", line: 4, col: 9 },
    };
    const out = stripAnsi(formatLintDiagnostic(lint, "/proj"));
    expect(out).toContain("--> l.scrml:4:9");
    expect(out).not.toContain("undefined");
  });
});
