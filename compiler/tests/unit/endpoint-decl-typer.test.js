// ---------------------------------------------------------------------------
// <endpoint> typer — accepts= resolution + exhaustiveness (S219 W3,
// endpoint-primitive-2026-06-25)
// ---------------------------------------------------------------------------
//
// SPEC §61 (Typed Inbound Endpoint). W3 (the type-system wave) RESOLVES each
// `<endpoint>`'s `accepts=` enum type-ref against the §14/§53 type surface and
// runs the §18.0.1/§51 exhaustiveness check over the per-variant arms:
//
//   E-ENDPOINT-NOT-EXHAUSTIVE   — an `accepts=` enum variant has no matching arm
//                                 (§61.4 inbound-honesty guarantee, §61.9).
//   E-ENDPOINT-ACCEPTS-NOT-ENUM — `accepts=` resolves to a CONCRETE non-enum
//                                 (struct / primitive / refinement). A HARD Error
//                                 (NOT `<api>`'s Info-lint): parseVariant (§41.13)
//                                 is a tagged-variant decoder, so a non-enum
//                                 request shape cannot be decoded OR dispatched
//                                 (§61.3).
//   E-TYPE-UNKNOWN-NAME         — an UNDECLARED `accepts=` ref (§14.1.2 reuse,
//                                 exactly as `<api>`'s reqShape/responseType).
//
// A dead/duplicate arm reuses the EXISTING §18.0.1 arm-validity codes (no
// parallel `E-ENDPOINT-*` code minted). W3 is RESOLVE + CHECK only — NO codegen
// (the parseVariant decode + dispatch + JSON envelope + route registration are W4).
//
// Diagnostic-stream partition: every E-* code is an Error → result.errors, NEVER
// result.warnings (the W-/I- partition). The non-enum case asserts BOTH streams
// (it is the one place `<endpoint>` deliberately diverges from `<api>`'s Info).

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";

const TMP = mkdtempSync(join(tmpdir(), "endpoint-typer-"));

// ---- helpers --------------------------------------------------------------
function compile(src) {
  const p = join(TMP, `t-${Math.random().toString(36).slice(2)}.scrml`);
  writeFileSync(p, src);
  return compileScrml({ inputFiles: [p], write: false, outputDir: join(TMP, "out") });
}
function errCodes(r, code) {
  return (r.errors ?? []).filter(e => (e.code ?? "") === code);
}
function warnCodes(r, code) {
  return (r.warnings ?? []).filter(w => (w.code ?? "") === code);
}

// A FspMethod enum with three variants — two carry positional payloads (the
// §18.0.1 payload-binding form the arms reuse).
const FSP_ENUM =
  `type FspMethod:enum = { FleetStatus, Dispatch(prompt: string, proj: string), DeltaSince(seq: int) }\n`;

// ===========================================================================
describe("<endpoint> typer — valid exhaustive declaration (§61.2/§61.4)", () => {
  const VALID =
    FSP_ENUM +
    `<endpoint path="/fsp" method="POST" accepts=FspMethod>\n` +
    `    <FleetStatus : fleetStatus()>\n` +
    `    <Dispatch(prompt, proj) : dispatch(prompt, proj)>\n` +
    `    <DeltaSince(seq) : deltasSince(seq)>\n` +
    `</endpoint>\n` +
    `<p>hi</p>\n`;

  test("a valid, exhaustive <endpoint> fires NO E-ENDPOINT-* / E-TYPE-UNKNOWN-NAME", () => {
    const r = compile(VALID);
    const epErrs = (r.errors ?? []).filter(e =>
      (e.code ?? "").startsWith("E-ENDPOINT-") || (e.code ?? "") === "E-TYPE-UNKNOWN-NAME");
    expect(epErrs).toEqual([]);
  });
});

// ===========================================================================
describe("<endpoint> typer — E-ENDPOINT-NOT-EXHAUSTIVE on a missing arm (§61.4)", () => {
  const MISSING =
    FSP_ENUM +
    `<endpoint path="/fsp" method="POST" accepts=FspMethod>\n` +
    `    <FleetStatus : fleetStatus()>\n` +
    `    <Dispatch(prompt, proj) : dispatch(prompt, proj)>\n` +
    `</endpoint>\n` +
    `<p>hi</p>\n`;

  test("an accepts= variant with no arm fires E-ENDPOINT-NOT-EXHAUSTIVE", () => {
    const r = compile(MISSING);
    expect(errCodes(r, "E-ENDPOINT-NOT-EXHAUSTIVE").length).toBe(1);
  });

  test("the diagnostic NAMES the missing variant (DeltaSince)", () => {
    const r = compile(MISSING);
    const e = errCodes(r, "E-ENDPOINT-NOT-EXHAUSTIVE")[0];
    expect(e).toBeTruthy();
    expect(e.message).toContain("DeltaSince");
  });

  test("E-ENDPOINT-NOT-EXHAUSTIVE partitions into result.errors, NEVER result.warnings", () => {
    const r = compile(MISSING);
    expect(errCodes(r, "E-ENDPOINT-NOT-EXHAUSTIVE").length).toBeGreaterThanOrEqual(1);
    expect(warnCodes(r, "E-ENDPOINT-NOT-EXHAUSTIVE").length).toBe(0);
  });
});

// ===========================================================================
describe("<endpoint> typer — E-ENDPOINT-ACCEPTS-NOT-ENUM on a non-enum accepts= (§61.3)", () => {
  test("accepts= resolving to a STRUCT fires E-ENDPOINT-ACCEPTS-NOT-ENUM", () => {
    const r = compile(
      `type FspReq:struct = { id: number }\n` +
      `<endpoint path="/x" method="POST" accepts=FspReq>\n` +
      `    <Whatever : foo()>\n` +
      `</endpoint>\n` +
      `<p>hi</p>\n`
    );
    expect(errCodes(r, "E-ENDPOINT-ACCEPTS-NOT-ENUM").length).toBe(1);
  });

  test("accepts= resolving to a PRIMITIVE fires E-ENDPOINT-ACCEPTS-NOT-ENUM", () => {
    const r = compile(
      `<endpoint path="/x" method="POST" accepts=number>\n` +
      `    <Whatever : foo()>\n` +
      `</endpoint>\n` +
      `<p>hi</p>\n`
    );
    expect(errCodes(r, "E-ENDPOINT-ACCEPTS-NOT-ENUM").length).toBe(1);
  });

  test("E-ENDPOINT-ACCEPTS-NOT-ENUM is an ERROR (NOT the <api> Info-lint) — errors, never warnings", () => {
    const r = compile(
      `type FspReq:struct = { id: number }\n` +
      `<endpoint path="/x" method="POST" accepts=FspReq>\n` +
      `    <Whatever : foo()>\n` +
      `</endpoint>\n` +
      `<p>hi</p>\n`
    );
    // The load-bearing divergence from <api>'s W-API-RESPONSE-NOT-VARIANT (Info):
    // a non-enum INBOUND accepts= is undecodable, so it is a HARD Error.
    expect(errCodes(r, "E-ENDPOINT-ACCEPTS-NOT-ENUM").length).toBeGreaterThanOrEqual(1);
    expect(warnCodes(r, "E-ENDPOINT-ACCEPTS-NOT-ENUM").length).toBe(0);
    const e = errCodes(r, "E-ENDPOINT-ACCEPTS-NOT-ENUM")[0];
    expect(e.severity === undefined || e.severity === "error").toBe(true);
  });

  test("a non-enum accepts= does NOT also fire E-ENDPOINT-NOT-EXHAUSTIVE (no double-report)", () => {
    const r = compile(
      `type FspReq:struct = { id: number }\n` +
      `<endpoint path="/x" method="POST" accepts=FspReq>\n` +
      `    <Whatever : foo()>\n` +
      `</endpoint>\n` +
      `<p>hi</p>\n`
    );
    expect(errCodes(r, "E-ENDPOINT-NOT-EXHAUSTIVE").length).toBe(0);
  });
});

// ===========================================================================
describe("<endpoint> typer — E-TYPE-UNKNOWN-NAME on an undeclared accepts= (§14.1.2 reuse)", () => {
  const UNDECLARED =
    `<endpoint path="/x" method="POST" accepts=NopeEnum>\n` +
    `    <Whatever : foo()>\n` +
    `</endpoint>\n` +
    `<p>hi</p>\n`;

  test("an undeclared accepts= enum ref fires E-TYPE-UNKNOWN-NAME (Error)", () => {
    const r = compile(UNDECLARED);
    expect(errCodes(r, "E-TYPE-UNKNOWN-NAME").length).toBeGreaterThanOrEqual(1);
    expect(warnCodes(r, "E-TYPE-UNKNOWN-NAME").length).toBe(0);
  });

  test("an undeclared accepts= does NOT also fire E-ENDPOINT-ACCEPTS-NOT-ENUM (asIs, no double-report)", () => {
    const r = compile(UNDECLARED);
    expect(errCodes(r, "E-ENDPOINT-ACCEPTS-NOT-ENUM").length).toBe(0);
  });
});

// ===========================================================================
describe("<endpoint> typer — a wildcard <_> arm satisfies exhaustiveness (§18.8.1 reuse)", () => {
  const WILDCARD =
    FSP_ENUM +
    `<endpoint path="/fsp" method="POST" accepts=FspMethod>\n` +
    `    <FleetStatus : fleetStatus()>\n` +
    `    <_ : fallback()>\n` +
    `</endpoint>\n` +
    `<p>hi</p>\n`;

  test("a wildcard arm covers the un-armed variants — NO E-ENDPOINT-NOT-EXHAUSTIVE", () => {
    const r = compile(WILDCARD);
    expect(errCodes(r, "E-ENDPOINT-NOT-EXHAUSTIVE").length).toBe(0);
  });
});

// ===========================================================================
// §61.4 / §61.9 — a DEAD/UNKNOWN arm (one naming a variant that is NOT a member
// of the `accepts=` enum, with all real variants also covered) follows the
// §18.0.1 arm-validity rules: it fires the §18.0.1 dead-arm diagnostic
// (E-MATCH-SUBSET-DEAD-ARM, the code the §34 E-ENDPOINT-NOT-EXHAUSTIVE row names
// as the endpoint's reused dead-arm surface), NOT a parallel E-ENDPOINT-* code.
describe("<endpoint> typer — a dead/unknown arm fires E-MATCH-SUBSET-DEAD-ARM (§61.4/§18.0.1)", () => {
  const DEAD_ARM =
    FSP_ENUM +
    `<endpoint path="/fsp" method="POST" accepts=FspMethod>\n` +
    `    <FleetStatus : fleetStatus()>\n` +
    `    <Dispatch(prompt, proj) : dispatch(prompt, proj)>\n` +
    `    <DeltaSince(seq) : deltasSince(seq)>\n` +
    `    <Bogus : nope()>\n` +
    `</endpoint>\n` +
    `<p>hi</p>\n`;

  test("an arm naming a variant not in accepts= fires E-MATCH-SUBSET-DEAD-ARM (Error)", () => {
    const r = compile(DEAD_ARM);
    expect(errCodes(r, "E-MATCH-SUBSET-DEAD-ARM").length).toBe(1);
    expect(warnCodes(r, "E-MATCH-SUBSET-DEAD-ARM").length).toBe(0);
  });

  test("the dead-arm diagnostic NAMES the offending variant (Bogus)", () => {
    const r = compile(DEAD_ARM);
    const e = errCodes(r, "E-MATCH-SUBSET-DEAD-ARM")[0];
    expect(e).toBeTruthy();
    expect(e.message).toContain("Bogus");
  });

  test("the dead/unknown arm does NOT mint a parallel E-ENDPOINT-* code (§61.9)", () => {
    const r = compile(DEAD_ARM);
    const epErrs = (r.errors ?? []).filter(e => (e.code ?? "").startsWith("E-ENDPOINT-"));
    expect(epErrs).toEqual([]);
  });

  test("a dead/unknown arm does NOT hide a genuine missing variant (both fire)", () => {
    const r = compile(
      FSP_ENUM +
      `<endpoint path="/fsp" method="POST" accepts=FspMethod>\n` +
      `    <FleetStatus : fleetStatus()>\n` +
      `    <Dispatch(prompt, proj) : dispatch(prompt, proj)>\n` +
      `    <Bogus : nope()>\n` +
      `</endpoint>\n` +
      `<p>hi</p>\n`
    );
    expect(errCodes(r, "E-MATCH-SUBSET-DEAD-ARM").length).toBe(1);
    expect(errCodes(r, "E-ENDPOINT-NOT-EXHAUSTIVE").length).toBe(1);
  });
});
