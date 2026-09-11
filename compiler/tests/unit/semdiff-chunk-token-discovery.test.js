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

  // --- S412: the captured group is the attribute VALUE, and three attributes carry
  // --- author/row data (g-semdiff-chunk-token-discovery-over-discovers) -------------
  //
  // The S411 family patterns anchored on the compiler-emitted PREFIX (`data-scrml-`),
  // which is true of the prefix and does not constrain the VALUE. `data-scrml-ref`
  // carries the author's ref name, `data-scrml-key` the row key from data, and
  // `data-scrml-scope` is likewise author-facing — so ordinary values were discovered
  // as chunk tokens and then replaced EVERYWHERE, page text included. That is the
  // false-COSMETIC direction, which hides a regression.
  //
  // The real discriminator is a property of the token itself: `fnv1a-hash.ts` emits
  // lowercase base36 zero-padded to exactly 8 chars, and a u32 maximum is `1z141z3` —
  // seven digits — so EVERY chunk token begins with `0`.
  describe("S412 — author-controlled attribute values are not chunk tokens", () => {
    for (const [attr, value, word] of [
      ["data-scrml-key", "customer_record_1", "customer"],
      ["data-scrml-ref", "userdata_7", "userdata"],
      ["data-scrml-scope", "sidebar1_main", "sidebar1"],
      ["data-scrml-key", "rowabcde_12", "rowabcde"],
    ]) {
      test(`NEGATIVE — ${attr}="${value}" does not seed discovery`, () => {
        // The word also appears in page TEXT, which is what made this bite: a
        // discovered token is replaced across the whole artifact, not just the attr.
        const html = `<div ${attr}="${value}">${word} says hello</div>`;
        expect(canonicalizeChunkNamespaceToken(html)).toBe(html);
      });
    }

    test("⚑ two artifacts differing ONLY in author data still compare DIFFERENT", () => {
      // The false-COSMETIC failure in its load-bearing form: if both sides canonicalize
      // to the same bytes, a real behavioural difference reads as cosmetic.
      const a = `<div data-scrml-key="customer_record_1">customer</div>`;
      const b = `<div data-scrml-key="supplier_record_1">supplier</div>`;
      expect(canonicalizeChunkNamespaceToken(a)).not.toBe(canonicalizeChunkNamespaceToken(b));
    });

    test("POSITIVE — a GENUINE token (leading `0`) is still discovered in each shape", () => {
      // The fix must not under-discover: every shape #923 added has to keep working.
      const shapes = [
        `<div data-scrml-each-mount="each_0a1b2c3d_0">rows</div>`,
        `<!--scrml-each:0a1b2c3d_24--><!--/scrml-each:0a1b2c3d_24-->`,
        `<div data-scrml-engine-mount="0zz9y8x7_phase"></div>`,
        `<div data-scrml-match-mount="match_0a1b2c3d_3"></div>`,
      ];
      for (const s of shapes) {
        expect(canonicalizeChunkNamespaceToken(s)).not.toBe(s);
      }
    });

    test("the leading-`0` invariant this fix rests on actually holds", async () => {
      // Guard the PREMISE, not just the behaviour: if `fnv1a-hash` ever stops
      // zero-padding, the patterns above silently stop discovering real tokens.
      const { fnv1aHash } = await import("../../src/codegen/fnv1a-hash.ts");
      for (let i = 0; i < 5000; i++) {
        expect(fnv1aHash(`chunk/${i}/some/path.scrml#${i * 7919}`)).toMatch(/^0[0-9a-z]{7}$/);
      }
    });
  });
});
