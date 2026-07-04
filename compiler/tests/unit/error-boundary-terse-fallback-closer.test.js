// Regression guard for Peter #22 (GitHub #22, change-id
// peter-22-errorboundary-empty-fallback):
//
//   <errorBoundary fallback={<div>...text/}> caught the error but rendered an
//   EMPTY fallback. compileBoundaryMarkup re-parses the fallback markup value
//   through an isolated BS -> TAB -> generateHtml pipeline that only understood
//   the `</>` / `</tag>` closer forms. scrml's TERSE `/` markup-value closer
//   (SPEC §19.6.2's canonical `{<div>...text/}` shape — the DOMINANT form across
//   the SPEC's boundary examples) yielded ZERO re-parsed nodes, so the declared
//   fallback compiled to an empty string and the boundary showed nothing.
//
// The fix (emit-error-boundary.ts convertTerseClosers) rewrites each terse `/`
// closer to the explicit `</>` the re-parse handles, WITHOUT touching literal
// text slashes (`and/or`, `http://x`) — a `/` is a closer only when the next
// non-whitespace char is end-of-fragment or `<`. The conformance case
// error-boundary/terse-fallback-closer covers the runtime DOM half; this unit
// test locks the compile-time template contract at the function level.
import { test, expect } from "bun:test";
import { compileBoundaryMarkup } from "../../src/codegen/emit-error-boundary.ts";
import { generateHtml } from "../../src/codegen/emit-html.ts";

const compile = (raw) => compileBoundaryMarkup(raw, generateHtml);

test("terse `/` closer renders the declared fallback markup (Peter #22)", () => {
  // The SPEC §19.6.2 canonical form + Peter's exact repro.
  expect(compile("<div class=\"fb\">FALLBACK: something went wrong/").htmlTemplate).toBe(
    "<div class=\"fb\">FALLBACK: something went wrong</div>",
  );
  expect(compile("<div>Something went wrong/").htmlTemplate).toBe(
    "<div>Something went wrong</div>",
  );
});

test("terse and explicit closers lower to identical DOM (idempotency)", () => {
  // The existing `</>`-form fixtures must be byte-identical before/after the fix.
  const explicit = compile("<div class=\"eb-fallback\">Boundary fallback shown</>").htmlTemplate;
  const terse = compile("<div class=\"eb-fallback\">Boundary fallback shown/").htmlTemplate;
  expect(explicit).toBe("<div class=\"eb-fallback\">Boundary fallback shown</div>");
  expect(terse).toBe(explicit);
});

test("nested markup with terse closers", () => {
  // inner explicit, outer terse
  expect(compile("<div class=\"wrap\"><strong>Error</> occurred/").htmlTemplate).toBe(
    "<div class=\"wrap\"><strong>Error</strong> occurred</div>",
  );
  // inner terse, outer explicit
  expect(compile("<div class=\"wrap\"><strong>Error/</>").htmlTemplate).toBe(
    "<div class=\"wrap\"><strong>Error</strong></div>",
  );
  // both terse
  expect(compile("<div><span>bad/</>").htmlTemplate).toBe("<div><span>bad</span></div>");
});

test("literal text slashes are preserved, not treated as closers", () => {
  // `and/or` — the mid-text `/` must stay literal; only the trailing `/` closes.
  const andor = compile("<div>read and/or write/");
  expect(andor.htmlTemplate).toBe("<div>read and/or write</div>");
  // a URL slash inside a quoted attribute + a text slash must both survive.
  const url = compile("<a href=\"http://example.com/x\">link/");
  expect(url.htmlTemplate).toBe("<a href=\"http://example.com/x\">link</a>");
  // explicit-closer form with a text slash is unchanged (pre-fix baseline).
  expect(compile("<div>and/or</>").htmlTemplate).toBe("<div>and/or</div>");
});

test("interpolating fallback with a terse closer captures payload fields", () => {
  const terse = compile("<div class=\"fb\">Error: ${msg}/");
  expect(terse.fields).toEqual(["msg"]);
  // The explicit-closer twin produces the same field capture + template shape.
  const explicit = compile("<div class=\"fb\">Error: ${msg}</>");
  expect(explicit.fields).toEqual(terse.fields);
  expect(terse.htmlTemplate).toBe(explicit.htmlTemplate);
});

test("empty fallback markup stays empty (no `fallback` default, §19.6.5)", () => {
  expect(compile("").htmlTemplate).toBe("");
  expect(compile("   ").htmlTemplate).toBe("");
});
