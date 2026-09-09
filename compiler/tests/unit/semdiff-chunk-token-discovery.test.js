/**
 * g-semdiff-chunk-namespace-token-discovery-misses-every-non-engine-html-site
 *
 * `canonicalizeChunkNamespaceToken` neutralizes the per-chunk namespace token so that
 * the SAME program compiled at two different paths compares byte-identical. Discovery is
 * structural (never a blanket `0[0-9a-z]{7}` sweep) and runs PER ARTIFACT, so every
 * artifact kind needs at least one discoverable site of its own.
 *
 * Before S411 the three discovery sites were all engine- or prologue-derived, so an HTML
 * artifact for a program with NO engine had no discovery site at all and its path-derived
 * token survived — making any moved or renamed file read false-behavioral.
 *
 * ⚑ THE NEGATIVE TEST AT THE BOTTOM IS THE LOAD-BEARING ONE. Under-discovery over-reports
 * behavioral: noisy, but it fails safe. OVER-discovery neutralizes a real difference and
 * reports false-COSMETIC, which HIDES a regression. That is the direction that must not
 * regress, so a token-shaped literal outside any compiler-emitted marker is pinned as
 * untouched.
 */
import { describe, test, expect } from "bun:test";
import { canonicalizeChunkNamespaceToken } from "../../src/semdiff.ts";

const A = "01kueozx";
const B = "00ypmgmg";

/** Same content at two "paths" differs only by the namespace token. */
const pair = (tpl) => [tpl.replaceAll("<TOK>", A), tpl.replaceAll("<TOK>", B)];
const canonicalizesEqual = (tpl) => {
  const [a, b] = pair(tpl);
  expect(a).not.toBe(b); // the fixture must actually differ, or the test is vacuous
  return canonicalizeChunkNamespaceToken(a) === canonicalizeChunkNamespaceToken(b);
};

describe("canonicalizeChunkNamespaceToken — HTML artifact discovery (S411)", () => {
  test("each marker in HTML — `<!--scrml-each:<tok>_N-->`", () => {
    expect(canonicalizesEqual(
      `<ul><!--scrml-each:<TOK>_10--><!--/scrml-each:<TOK>_10--></ul>`,
    )).toBe(true);
  });

  test("match mount in HTML — `data-scrml-match-mount=\"match_<tok>_N\"`", () => {
    expect(canonicalizesEqual(
      `<div data-scrml-match-mount="match_<TOK>_8"></div>`,
    )).toBe(true);
  });

  test("meta marker in HTML — `data-scrml-meta=\"_scrml_meta_<tok>_N\"`", () => {
    expect(canonicalizesEqual(
      `<span data-scrml-meta="_scrml_meta_<TOK>_3"></span>`,
    )).toBe(true);
  });

  test("each mount attribute — `data-scrml-each-mount=\"each_<tok>_N\"`", () => {
    expect(canonicalizesEqual(
      `el.setAttribute("data-scrml-each-mount", "each_<TOK>_4");`,
    )).toBe(true);
  });

  // --- regressions: the three pre-S411 sites must keep working -------------------
  test("REGRESSION — the chunk cell scope prologue banner", () => {
    expect(canonicalizesEqual(`// --- chunk cell scope (<TOK>) ---\nconst x = 1;`)).toBe(true);
  });

  test("REGRESSION — engine-derived identifier", () => {
    expect(canonicalizesEqual(`__scrml_engine_<TOK>_transitions = {};`)).toBe(true);
  });

  test("REGRESSION — engine mount attribute", () => {
    expect(canonicalizesEqual(`<div data-scrml-engine-mount="<TOK>_phase"></div>`)).toBe(true);
  });

  // --- the direction that must not regress ---------------------------------------
  test("NEGATIVE — a token-shaped literal outside any scrml marker is NOT neutralized", () => {
    // Adopter content that merely LOOKS token-shaped. Neutralizing this would make two
    // genuinely different programs compare equal — a false-cosmetic verdict, which is
    // strictly worse than the noise the fix above removes.
    const a = `const commitSha = "01kueozx"; const label = "00ypmgmg_build";`;
    const b = `const commitSha = "0deadbee"; const label = "0feedface_build";`;
    expect(canonicalizeChunkNamespaceToken(a)).toBe(a);
    expect(canonicalizeChunkNamespaceToken(b)).toBe(b);
    expect(canonicalizeChunkNamespaceToken(a)).not.toBe(canonicalizeChunkNamespaceToken(b));
  });

  test("NEGATIVE — a non-scrml data attribute does not seed discovery", () => {
    const a = `<div data-build-id="01kueozx_7"></div>`;
    expect(canonicalizeChunkNamespaceToken(a)).toBe(a);
  });
});
