/**
 * CONF-SESSION-PROGRAM-ATTR-SCOPE | §20.5 / §20.5.1 — `<program>` session config is
 * PROGRAM-scoped, never BUILD-scoped; and a build that cannot answer the question is
 * REFUSED rather than guessed at (`E-MW-008`)
 *
 * ── THE ORIGINAL DEFECT (S436) ──────────────────────────────────────────────────
 * The S433 pre-scan in `codegen/index.ts` that makes `sessionExpiry` / `session-secure`
 * visible to a program's OTHER units iterated the ENTIRE `files` array with no
 * program-membership test and stamped one build-wide answer onto EVERY fileAST. So in
 * a compile set holding TWO unrelated programs, program A's `session-secure="false"`
 * silently reconfigured program B. MEASURED on `c46ebbf8`, both input orders, zero
 * hard errors, identical diagnostics in every run:
 *
 *   B alone           -> `__Host-scrml_sid`, Max-Age 3600   (correct, secure default)
 *   B beside A        -> `scrml_sid`,        Max-Age 604800 (A's settings)
 *
 * Executed against a real `Request`, the downgraded header was verbatim
 *   `scrml_sid=...; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`
 * — no `__Host-` prefix AND NO `Secure` ATTRIBUTE, so B's session cookie was
 * transmissible over plain HTTP. A real security downgrade, not a cosmetic rename.
 *
 * ── THE FIX, IN TWO PARTS ───────────────────────────────────────────────────────
 * 1. The pre-scan's inheritance is scoped to a compile set holding at most ONE
 *    `<program>` NODE (counted recursively — see F2/F3 below). That preserves the
 *    #282 / S433 case the pre-scan exists for: ONE program spread over several
 *    emitted units, where the minting unit declares nothing of its own and MUST pick
 *    up the program's, or the writer sets one cookie name while the reader's
 *    compile-time-specialized regex matches another.
 * 2. `E-MW-008` REFUSES the configuration the compiler cannot answer: 2+ `<program>`
 *    declarations in one compile set where at least one declares session config.
 *    Suppressing inheritance there was measured (F1) to split a genuine multi-unit
 *    program across two disjoint cookie readers — a hardened cookie its own program
 *    could not read. Operator ruling S436 round 3 = option A of
 *    `docs/changes/s436-program-session-config-scope/fork-f1.md`.
 *
 * `E-MW-008` is deliberately scoped to CONTESTED session config, NOT to the general
 * second-`<program>` shape — that is `E-PROGRAM-002`, still reserved, and implementing
 * it would reject a measured 75 of 1137 corpus compile sets. It is a sibling of
 * `E-MW-007` (SPEC §40, `:23763`), which already makes "two applications in one
 * compiled server" an Error with the same remedy.
 *
 * ── REVIEW FINDINGS FOLDED IN (S239 fix-round) ──────────────────────────────────
 * F2 — the count is over `<program>` NODES, not program-bearing FILES. One file
 *      holding two top-level `<program>` nodes used to count as ONE, so the guard
 *      never fired and the original leak survived it.
 * F3 — the scan RECURSES, because emit-server's `_readRawProgramAttr` (the reader
 *      that actually decides) recurses. A top-level-only scan missed a nested
 *      `<program>` entirely, which was a live PRE-EXISTING #282-class split measured
 *      on `origin/main`: a SINGLE-program set emitting two different cookie names.
 *
 * NOT CLOSED HERE: the separate, already-filed and SPEC §20.5-disclosed
 * `g-session-store-namespace-not-discriminated-per-program` (two programs in one dist
 * sharing one `.scrml-sessions.db` and one `"session"` namespace). Different
 * mechanism, different fix.
 *
 * Firing sites: the recursive `<program>`-node scan + `E-MW-008` in codegen/index.ts;
 * `_programSessionSecure` / `_programSessionExpiry` consumed in codegen/emit-server.ts.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "conf-session-attr-scope-")); });
afterAll(() => {
  // Best-effort. The runtime case below `import`s an emitted `.server.js` that opens
  // a bun:sqlite session store, and Windows keeps that file handle open for the life
  // of the process — `rmSync` then throws EBUSY. A temp dir the OS will reap is not
  // worth failing a conformance run over.
  try { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); } catch {}
});

let _n = 0;
// Compile a fixture directory as ONE compile set. `order: "rev"` feeds the same files
// in the opposite input order — the pre-scan took the FIRST match, so order is
// load-bearing evidence and every multi-program case is run both ways.
function compileFixture(name, files, order = "fwd") {
  const root = join(TMP, `${name}-${order}-${_n++}`);
  const inputFiles = [];
  for (const [rel, src] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, src);
    inputFiles.push(abs);
  }
  inputFiles.sort();
  if (order === "rev") inputFiles.reverse();
  return compileScrml({ inputFiles, outputDir: join(root, "dist"), write: false, log: () => {} });
}

// `result.outputs` is keyed by the SOURCE path, not the emitted `.server.js` path.
function serverJsFor(result, suffix) {
  for (const [path, out] of result.outputs) {
    if (path.replace(/\\/g, "/").endsWith(suffix)) return out.serverJs ?? "";
  }
  return null;
}

// Read the cookie NAME out of the EMITTED TEXT (never a summary field). `__Host-`
// swallows the bare token, so a secure build yields exactly ["__Host-scrml_sid"].
function cookieNames(js) {
  return [...new Set([...String(js).matchAll(/(?:__Host-)?scrml_sid/g)].map((m) => m[0]))].sort();
}
function maxAgeSecs(js) {
  return [...new Set([...String(js).matchAll(/_scrml_session_max_age\s*=\s*(\d+)/g)].map((m) => m[1]))].sort();
}
// All THREE diagnostic channels. `.errors` alone reports a false zero.
const allDiags = (result) =>
  [...(result.errors ?? []), ...(result.warnings ?? []), ...(result.lintDiagnostics ?? [])];
// A hard error is anything that is not a W-* warning or an I-* lint note.
const hardErrors = (result) => allDiags(result).filter((d) => !/^[WI]-/.test(d.code ?? ""));
const codes = (result) => hardErrors(result).map((d) => d.code).sort();

const SECURE = ["__Host-scrml_sid"];
const PLAIN = ["scrml_sid"];
const DEFAULT_MAXAGE = ["3600"];   // the §20.5 1h default
const SEVEN_DAYS = ["604800"];

// Program A — declares BOTH attributes; `session-secure="false"` is the downgrade
// that bled build-wide before the fix.
const PROG_A = `<program auth="optional" csrf="off" sessionExpiry="7d" session-secure="false">
  \${
    server function aLogin() {
      session.set("userId", 1)
      return { ok: true }
    }
  }
  <div><button onclick=aLogin()>a</button><outlet/></div>
</program>`;

// Program B — an UNRELATED program. Declares NEITHER attribute, so it must resolve to
// the language defaults whatever else is in the compile set.
const PROG_B = `<program auth="optional" csrf="off">
  \${
    server function bLogin() {
      session.set("userId", 2)
      return { ok: true }
    }
  }
  <div><button onclick=bLogin()>b</button><outlet/></div>
</program>`;

// Program B with a request-pipeline attribute (`log=`) — the E-MW-007 trigger, used
// to prove E-MW-008 does not MASK its older sibling.
const PROG_A_LOG = PROG_A.replace(` sessionExpiry="7d" session-secure="false"`, ` log="true"`);
const PROG_B_LOG = PROG_B.replace(`csrf="off"`, `csrf="off" log="true"`);

// A NON-program unit of the SAME program (no `<program>` opener) that MINTS the
// session — the #282 / S433 shape the pre-scan was built for. Declares nothing of its
// own and MUST keep inheriting the program's.
const MEMBER_MINTER = `<page>
  \${
    <ok> = not
    server function memberLogin() {
      session.set("userId", 3)
      return true
    }
    on mount { @ok = memberLogin() }
  }
  <div><p>\${@ok}</p></div>
</page>`;

describe("CONF-SESSION-PROGRAM-ATTR-SCOPE §20.5.1 — program-scoped, not build-scoped", () => {
  // =========================================================================
  // PART 1 — the language defaults, per program, compiled alone.
  // These pin what "correct" means and prove the harness can SEE both cookie
  // names and both Max-Ages, so the equality assertions below are not reading
  // a constant.
  // =========================================================================
  test("control — B alone (declares neither attribute) gets the SECURE default", () => {
    const result = compileFixture("b-alone", { "sub/zzz.scrml": PROG_B });
    expect(hardErrors(result)).toEqual([]);
    const js = serverJsFor(result, "sub/zzz.scrml");
    expect(js).toBeTruthy();
    expect(cookieNames(js)).toEqual(SECURE);
    expect(maxAgeSecs(js)).toEqual(DEFAULT_MAXAGE);
  });

  test("control — A alone honours its OWN declarations (harness can see the downgrade)", () => {
    const result = compileFixture("a-alone", { "aaa.scrml": PROG_A });
    expect(hardErrors(result)).toEqual([]);
    const js = serverJsFor(result, "/aaa.scrml");
    expect(js).toBeTruthy();
    expect(cookieNames(js)).toEqual(PLAIN);
    expect(maxAgeSecs(js)).toEqual(SEVEN_DAYS);
  });

  // =========================================================================
  // PART 2 — `E-MW-008`: the contested configuration is REFUSED.
  //
  // ⚑ THIS REPLACES THE PREVIOUS "KNOWN COST (F1, awaiting ruling)" TEST, which
  // asserted that a multi-unit program beside a second program SPLIT its own
  // cookie name across its own units, and asserted the two emitted reader
  // regexes were disjoint. That split was real and measured — it is exactly why
  // the fork was raised — but it was a functional regression the count guard
  // introduced, not a behaviour to keep. Operator ruling (S436 round 3) chose
  // option A: refuse the configuration. So the shape that test pinned no longer
  // compiles, and the assertion is inverted here from "it splits" to "it is
  // rejected". The old expectations are preserved in the fork doc as the
  // evidence that produced the ruling.
  // =========================================================================
  for (const order of ["fwd", "rev"]) {
    test(`E-MW-008 — 2 programs, one declaring session config, is REFUSED (input order: ${order})`, () => {
      const result = compileFixture("a-plus-b", { "aaa.scrml": PROG_A, "sub/zzz.scrml": PROG_B }, order);
      // Pre-ruling this compiled clean and emitted a downgraded (round 0) or split
      // (rounds 1-2) session cookie. It is now a hard error, order-insensitively.
      expect(codes(result)).toEqual(["E-MW-008"]);
    });
  }

  test("E-MW-008 message: basenames, agreeing counts, the blocked unit, and an HONEST remedy", () => {
    const result = compileFixture("a-plus-b-msg", { "aaa.scrml": PROG_A, "sub/zzz.scrml": PROG_B });
    const err = hardErrors(result).find((d) => d.code === "E-MW-008");
    expect(err).toBeTruthy();
    const m = String(err.message);
    // Names every <program> in the build, and the declaring one.
    expect(m).toContain("aaa.scrml");
    expect(m).toContain("zzz.scrml");
    // Says WHY it cannot be composed, in the language's own terms.
    expect(m).toContain("APPLICATION-scope");
    expect(m).toContain("E-PROGRAM-002");
    // Names the unit that could not be attributed — the actionable half.
    expect(m).toMatch(/unit emits a session cookie but does not resolve .* itself: zzz\.scrml/);
    // The remedy that always works.
    expect(m).toContain("build one application per output directory");

    // ── review finding F-E, pinned ───────────────────────────────────────────
    // BASENAMES, matching the stated sibling E-MW-007 — no absolute paths.
    expect(m).not.toMatch(/[A-Za-z]:[\\/]/);
    expect(m).not.toContain("/sub/");
    // Number agreement: "1 of them declares", never "1 of them declare".
    expect(m).toMatch(/\b1 of them declares\b/);
    // NODE count and FILE count are stated separately, so a file holding two
    // <program>s can no longer read as "2 <program>s (one-path)".
    expect(m).toMatch(/declares \d+ <program>s across \d+ files? \(/);
  });

  test("F-E — two <program> nodes in ONE file: the message says 2 programs across 1 file", () => {
    // The old wording printed `_all` (a deduped FILE list) beside a NODE count, so
    // this read "this build declares 2 <program>s (…/ddd.scrml)" — one path for two
    // nodes — and disagreed in number with "1 of them declare".
    const result = compileFixture("f-e-wording", {
      "ddd.scrml": `${PROG_A}\n${PROG_B}`, "pages/other.scrml": MEMBER_MINTER,
    });
    const err = hardErrors(result).find((d) => d.code === "E-MW-008");
    expect(err).toBeTruthy();
    const m = String(err.message);
    expect(m).toContain("declares 2 <program>s across 1 file (ddd.scrml)");
    expect(m).toMatch(/\b1 of them declares\b/);
  });

  test("the remedy is HONEST: when declaring-on-every-program would NOT clear it, the message says so", () => {
    // Two programs that BOTH declare, plus a page that MINTS a session. The page is
    // genuinely unattributable — declaring on the programs cannot help it — so the
    // build is still refused, and the message must not advertise a remedy that
    // would not work. This is the shape the S239 re-review's F-A list ended on.
    const declaring = (expiry, secure, fn) => `<program csrf="off" sessionExpiry="${expiry}" session-secure="${secure}">
  \${
    export server function ${fn}() {
      session.set("userId", "u-1")
      return "ok"
    }
  }
  <button onclick=${fn}()>login</button>
</program>`;
    const result = compileFixture("honest-remedy", {
      "aaa.scrml": declaring("30m", "false", "aLogin"),
      "zzz.scrml": declaring("7d", "true", "zLogin"),
      "pages/m.scrml": MEMBER_MINTER,
    });
    const err = hardErrors(result).find((d) => d.code === "E-MW-008");
    expect(err).toBeTruthy();
    const m = String(err.message);
    expect(m).toMatch(/m\.scrml/);
    expect(m).toContain("is enough ONLY if no other unit emits a session cookie");
    expect(m).toContain("build one application per output directory");
  });

  test("E-MW-008 fires on the F1 shape too — a multi-unit program beside a 2nd program", () => {
    // The F1 regression fixture: program A, A's OWN member page, and unrelated B.
    // Rounds 1-2 compiled this clean while splitting A across two cookie readers.
    const result = compileFixture("f1-shape", {
      "index.scrml": PROG_A,
      "pages/minter.scrml": MEMBER_MINTER,
      "other/zzz.scrml": PROG_B,
    });
    expect(codes(result)).toEqual(["E-MW-008"]);
  });

  for (const order of ["fwd", "rev"]) {
    test(`F2 — TWO top-level <program> nodes in ONE file are counted separately (input order: ${order})`, () => {
      // Counting program-bearing FILES read this as ONE program, so the guard never
      // fired and `pages/other.scrml` inherited A's downgrade. Counting NODES sees
      // two, and with one of them declaring session config that is now refused.
      const result = compileFixture(
        "two-programs-one-file",
        { "ddd.scrml": `${PROG_A}\n${PROG_B}`, "pages/other.scrml": MEMBER_MINTER },
        order,
      );
      // S443 (bryan, user-voice item 3): two top-level <program>s in ONE file are now
      // also E-PROGRAM-002 (same-file case only — the cross-file shape below stays legal).
      expect(codes(result)).toEqual(["E-MW-008", "E-PROGRAM-002"]);
    });
  }

  // =========================================================================
  // PART 3 — SCOPING. `E-MW-008` must fire on exactly the contested shape and
  // nothing else. Each of these is a way the rule could be too broad.
  // =========================================================================
  test("scoping — 2 programs declaring NEITHER attribute still compile (this is NOT E-PROGRAM-002)", () => {
    // Implementing the reserved E-PROGRAM-002 would reject this, and a measured 75
    // of 1137 corpus compile sets with it. E-MW-008 is scoped to CONTESTED session
    // config only, so an uncontested second <program> remains legal.
    const result = compileFixture("two-uncontested", {
      "aaa.scrml": PROG_B, "sub/zzz.scrml": PROG_B.replace(/bLogin/g, "cLogin"),
    });
    expect(hardErrors(result)).toEqual([]);
    // And both still get the secure default — the original leak cannot recur here,
    // because neither declares anything to leak.
    expect(cookieNames(serverJsFor(result, "/aaa.scrml"))).toEqual(SECURE);
    expect(cookieNames(serverJsFor(result, "sub/zzz.scrml"))).toEqual(SECURE);
  });

  test("scoping — the ESCAPE the message advertises actually works: every <program> declaring explicitly compiles", () => {
    // E-MW-008's message names two remedies. The second is "declare
    // session-secure=/sessionExpiry= explicitly on every <program> in this build".
    // The first cut of the rule fired whenever ANY program declared session config,
    // so following that advice did NOT clear the error — the message promised an
    // escape the code did not honour. It was caught by the S433 integration test
    // `session-program-scope-multi-unit.test.js` ("a unit's OWN sessionExpiry
    // outranks a SIBLING program's (F1-1)"), which pins this exact shape as RULED
    // valid: with every unit self-declaring there is no unattributable unit, so
    // nothing is guessed and nothing bleeds. Pinned here too, because it is THIS
    // diagnostic's advertised contract.
    const declaring = (expiry, secure, fn) => `<program csrf="off" sessionExpiry="${expiry}" session-secure="${secure}">
  \${
    export server function ${fn}() {
      session.set("userId", "u-1")
      return "ok"
    }
  }
  <button onclick=${fn}()>login</button>
</program>`;
    const result = compileFixture("both-declare", {
      "aaa.scrml": declaring("30m", "false", "aLogin"),
      "zzz.scrml": declaring("7d", "true", "zLogin"),
    });
    expect(codes(result)).not.toContain("E-MW-008");
    expect(hardErrors(result)).toEqual([]);
    // And each unit keeps its OWN answer — the S433 ruling.
    expect(cookieNames(serverJsFor(result, "/aaa.scrml"))).toEqual(PLAIN);
    expect(cookieNames(serverJsFor(result, "/zzz.scrml"))).toEqual(SECURE);
    expect(maxAgeSecs(serverJsFor(result, "/aaa.scrml"))).toEqual(["1800"]);
    expect(maxAgeSecs(serverJsFor(result, "/zzz.scrml"))).toEqual(SEVEN_DAYS);
  });

  test("scoping — but a PARTIAL declaration still fires: aaa declares only expiry, zzz only secure", () => {
    // The two attributes are independent, so the rule is evaluated per attribute.
    // Here each unit fails to resolve the OTHER attribute and would inherit its
    // sibling's — which is precisely the leak.
    const result = compileFixture("partial-declare", {
      "aaa.scrml": PROG_B.replace(`csrf="off"`, `csrf="off" sessionExpiry="30m"`),
      "zzz.scrml": PROG_B.replace(`csrf="off"`, `csrf="off" session-secure="false"`).replace(/bLogin/g, "cLogin"),
    });
    expect(codes(result)).toEqual(["E-MW-008"]);
  });

  // ⚑ RENAMED (S239 re-review). This was called "E-MW-008 does NOT mask E-MW-007",
  // which claimed more than it checked: it asserts through `compileScrml`, and
  // `E-MW-007` is emitted at the COMMAND layer (`commands/select-request-onion.js`,
  // consumed by build.js / dev.js), so the library API cannot produce it at all and
  // the test could never have observed masking. The real non-masking check needs the
  // CLI; it lives in `compiler/tests/commands/` alongside the other CLI cases. What
  // this test actually verifies — that a pipeline-only conflict is not hijacked by
  // E-MW-008 — is worth keeping, under its true name.
  test("scoping — a pipeline-only conflict does not raise E-MW-008 (library API)", () => {
    const result = compileFixture("pipeline-only-conflict", {
      "index.scrml": PROG_A_LOG, "other/zzz.scrml": PROG_B_LOG,
    });
    expect(codes(result)).not.toContain("E-MW-008");
  });

  // =========================================================================
  // F-A / F-B (S239 re-review) — THE ESCAPE MATRIX.
  //
  // Round 3 computed "can this unit resolve for itself?" in the DRIVER, ranging
  // over every file, and only a `<program>`-bearing file can carry the remedy the
  // message advertises. So adding any plain page, library or component to a set of
  // correctly-declaring programs re-triggered the error and made the advertised
  // escape unreachable — measured at 17 of 1137 corpus sets (F-A). Separately, an
  // `auth="required"` program gets sessionExpiry/sessionSecure defaults registered
  // by route-inference, so it answers from `authMiddlewareEntry` and never reaches
  // the stash; the driver's mirror did not know that and refused builds that could
  // not have bled (F-B).
  //
  // The condition is no longer computed in the driver: `session-config-resolve.ts`
  // holds the one resolution order, `emit-server` runs it and RECORDS a real
  // fall-through, and the driver reads the record. These cases pin that.
  // =========================================================================
  const DECLARING = (expiry, secure, fn) => `<program csrf="off" sessionExpiry="${expiry}" session-secure="${secure}">
  \${
    export server function ${fn}() {
      session.set("userId", "u-1")
      return "ok"
    }
  }
  <button onclick=${fn}()>login</button>
</program>`;
  const PLAIN_PAGE = `<page>
  \${ <n> = 1 }
  <div><p>\${@n}</p></div>
</page>`;
  const LIBRARY_FILE = `\${
  export function addTwo(a, b) {
    return a + b
  }
}`;
  const COMPONENT_FILE = `<component name="Badge">
  \${ <label> = "hi" }
  <span>\${@label}</span>
</component>`;
  const AUTH_REQUIRED = (fn) => `<program auth="required" loginRedirect="/login" csrf="off">
  \${
    export server function ${fn}() {
      session.set("userId", "u-1")
      return "ok"
    }
  }
  <button onclick=${fn}()>go</button>
</program>`;

  const ESCAPES = {
    "2 program files, nothing else": { "aaa.scrml": DECLARING("30m", "false", "aL"), "zzz.scrml": DECLARING("7d", "true", "zL") },
    "3 program files, nothing else": { "aaa.scrml": DECLARING("30m", "false", "aL"), "zzz.scrml": DECLARING("7d", "true", "zL"), "yyy.scrml": DECLARING("2h", "true", "yL") },
    "2 program files + a plain <page>": { "aaa.scrml": DECLARING("30m", "false", "aL"), "zzz.scrml": DECLARING("7d", "true", "zL"), "pages/p.scrml": PLAIN_PAGE },
    "2 program files + a library file": { "aaa.scrml": DECLARING("30m", "false", "aL"), "zzz.scrml": DECLARING("7d", "true", "zL"), "lib/u.scrml": LIBRARY_FILE },
    "2 program files + a <component> file": { "aaa.scrml": DECLARING("30m", "false", "aL"), "zzz.scrml": DECLARING("7d", "true", "zL"), "comp/Badge.scrml": COMPONENT_FILE },
  };
  for (const [label, files] of Object.entries(ESCAPES)) {
    test(`F-A escape clears — ${label}`, () => {
      const result = compileFixture(`escape-${label.replace(/[^a-z0-9]+/gi, "-")}`, files);
      expect(codes(result)).not.toContain("E-MW-008");
    });
  }

  test("F-B — two auth=\"required\" programs are attributable via route-inference, not refused", () => {
    // route-inference registers sessionExpiry (1h) and sessionSecure (true) for every
    // auth="required" program, and emit-server consults authMiddlewareEntry FIRST, so
    // such a unit never reaches the stash. Nothing could bleed; nothing is refused.
    const result = compileFixture("f-b-auth-required", {
      "aaa.scrml": AUTH_REQUIRED("aGo"), "zzz.scrml": AUTH_REQUIRED("zGo"),
    });
    expect(codes(result)).not.toContain("E-MW-008");
  });

  test("F-B — a second program that emits NO session infrastructure is not a conflict", () => {
    // The unit never resolves the attribute because it never asks. Round 3
    // over-rejected this by construction: it could not see `_needsSessionInfra`,
    // which is why the record is now made from inside the emitter.
    const result = compileFixture("f-b-no-session-infra", {
      "aaa.scrml": PROG_A,
      "zzz.scrml": `<program csrf="off">\n  <div><p>static</p></div>\n</program>`,
    });
    expect(codes(result)).not.toContain("E-MW-008");
  });

  test("F-B — two programs declaring IDENTICAL values are not refused", () => {
    const result = compileFixture("f-b-identical", {
      "aaa.scrml": DECLARING("7d", "true", "aL"), "zzz.scrml": DECLARING("7d", "true", "zL"),
    });
    expect(codes(result)).not.toContain("E-MW-008");
  });

  test("the line holds — a SESSION-MINTING page in a 2-program set IS still refused", () => {
    // The counterpart to the F-A escapes, and the reason they are safe: a plain page
    // clears because it emits no session cookie, while a page that MINTS one is
    // genuinely unattributable and must be refused. Declaring on the programs cannot
    // help it, and the message says so rather than advertising a remedy that fails.
    const result = compileFixture("minting-page-still-refused", {
      "aaa.scrml": DECLARING("30m", "false", "aL"),
      "zzz.scrml": DECLARING("7d", "true", "zL"),
      "pages/m.scrml": MEMBER_MINTER,
    });
    expect(codes(result)).toEqual(["E-MW-008"]);
  });

  // =========================================================================
  // PART 4 — what the pre-scan EXISTS for, and must never lose: ONE program
  // spread over several units keeps inheriting its own declaration.
  // =========================================================================
  for (const order of ["fwd", "rev"]) {
    test(`#282 preserved — ONE program over two units, the member STILL inherits (input order: ${order})`, () => {
      const result = compileFixture(
        "single-program-multi-unit",
        { "index.scrml": PROG_A, "pages/minter.scrml": MEMBER_MINTER },
        order,
      );
      expect(hardErrors(result)).toEqual([]);
      const progJs = serverJsFor(result, "/index.scrml");
      const memberJs = serverJsFor(result, "minter.scrml");
      expect(progJs).toBeTruthy();
      expect(memberJs).toBeTruthy();
      // Both units carry the PROGRAM's declarations. A regression here means the
      // writer mints a cookie the reader's specialized regex cannot match.
      expect(cookieNames(progJs)).toEqual(PLAIN);
      expect(cookieNames(memberJs)).toEqual(PLAIN);
      expect(maxAgeSecs(progJs)).toEqual(SEVEN_DAYS);
      expect(maxAgeSecs(memberJs)).toEqual(SEVEN_DAYS);
    });
  }

  for (const order of ["fwd", "rev"]) {
    test(`F3 — a <program> NESTED in markup still propagates to its own member (input order: ${order})`, () => {
      // PRE-EXISTING on origin/main and unchanged by the file-counting first draft:
      // `nest` emitted `scrml_sid` while its member emitted `__Host-scrml_sid` — a
      // writer/reader split inside ONE program, with no second program involved.
      // The scan recurses now, so both agree. Still ONE <program> node, so it is
      // NOT caught by E-MW-008 — this must keep COMPILING.
      const result = compileFixture(
        "nested-program",
        { "nest.scrml": `<div>\n${PROG_A}\n</div>`, "pages/minter.scrml": MEMBER_MINTER },
        order,
      );
      expect(hardErrors(result)).toEqual([]);
      const nestJs = serverJsFor(result, "nest.scrml");
      const memberJs = serverJsFor(result, "minter.scrml");
      expect(cookieNames(nestJs)).toEqual(PLAIN);
      expect(cookieNames(memberJs)).toEqual(PLAIN);
      expect(maxAgeSecs(nestJs)).toEqual(SEVEN_DAYS);
      expect(maxAgeSecs(memberJs)).toEqual(SEVEN_DAYS);
    });
  }

  // =========================================================================
  // PART 5 — RUNTIME. The original downgrade stripped the `Secure` ATTRIBUTE,
  // not merely the `__Host-` prefix, and emit-inspection understated that. The
  // header is therefore asserted from a real `Response`, not from emitted text.
  //
  // `write: true` + `chdir` + `import` the `.server.js` + a CSRF'd `Request` +
  // `route.handler` — the db-src-runtime-path-consistency recipe. NO happy-dom:
  // its globals strip CSRF and the handler answers 403.
  // =========================================================================
  test("runtime — a program declaring nothing mints a REAL __Host- cookie with Secure", async () => {
    if (typeof globalThis.document !== "undefined") return; // happy-dom-polluted worker

    const root = join(TMP, `runtime-${_n++}`);
    const src = join(root, "src");
    const inputFiles = [];
    for (const [rel, s] of Object.entries({ "sub/zzz.scrml": PROG_B })) {
      const abs = join(src, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, s);
      inputFiles.push(abs);
    }
    const dist = join(root, "dist");
    const result = compileScrml({ inputFiles, outputDir: dist, write: true, log: () => {} });
    expect(hardErrors(result)).toEqual([]);

    const walk = (d, acc = []) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p, acc); else acc.push(p);
      }
      return acc;
    };
    const bServer = walk(dist).find((p) => p.replace(/\\/g, "/").endsWith("zzz.server.js"));
    expect(bServer).toBeTruthy();

    const cwdBefore = process.cwd();
    process.chdir(dist);
    try {
      const mod = await import(`file:///${bServer.replace(/\\/g, "/")}?v=${Date.now()}-${Math.random()}`);
      const routes = Object.values(mod).filter(
        (v) => v && typeof v === "object" && typeof v.path === "string" && typeof v.handler === "function",
      );
      const route = routes.find((r) => /bLogin/i.test(r.path)) ?? routes[0];
      expect(route).toBeDefined();

      const TOKEN = "s436-csrf";
      const resp = await route.handler(new Request(`http://localhost${route.path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": TOKEN, Cookie: `scrml_csrf=${TOKEN}` },
        body: JSON.stringify({}),
      }));
      expect(resp.status).toBe(200);

      const setCookies = resp.headers.getSetCookie
        ? resp.headers.getSetCookie()
        : [resp.headers.get("set-cookie")].filter(Boolean);
      const sid = setCookies.find((c) => /scrml_sid=/.test(c));
      expect(sid).toBeTruthy();
      // On `c46ebbf8`, compiled beside program A, this header was verbatim:
      //   scrml_sid=...; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800
      // — no `__Host-`, NO `Secure`, and A's 7-day lifetime. That compile set is now
      // refused outright (E-MW-008); this asserts the surviving path still mints the
      // hardened cookie.
      expect(sid).toContain("__Host-scrml_sid=");
      expect(sid).toMatch(/;\s*Secure\b/);
      expect(sid).toContain("Max-Age=3600");
      expect(sid).toContain("Path=/");
      expect(sid).not.toContain("Max-Age=604800");
    } finally {
      process.chdir(cwdBefore);
    }
  });
});

// ── S438 — a `kind="tool"` program is not an application (`g-mw008-counts-headless-tool-programs`)
// A headless tool owns no cookie-session unit (§64: no page, `session.*` is E-SESSION-CONTEXT,
// a `serve=` tool refuses cookie auth). Counting it as a `<program>` made ONE web app plus a
// `tools/seed.scrml` read as two applications: E-MW-008 refused the build, and the member unit
// fell to `__Host-scrml_sid`/3600 while the root kept `scrml_sid`/604800 (the F1 split).
// Measured on 072741ca, every shape below except the two-app controls reported E-MW-008.
const TOOL = `<program kind="tool" lang="ts">
\${
  function main(args: string[]) {
    println("seeded")
  }
}
</program>`;
const TOOL_DECLARING = TOOL.replace(`kind="tool"`, `kind="tool" sessionExpiry="7d" session-secure="false"`);
const TOOL_SERVE = TOOL.replace(`kind="tool"`, `kind="tool" serve=8099`);

describe("CONF-SESSION-PROGRAM-ATTR-SCOPE §20.5.1 — a kind=\"tool\" program is not counted (S438)", () => {
  for (const order of ["fwd", "rev"]) {
    test(`one web app + its member + a headless tool: clean, and the member KEEPS the program's cookie (${order})`, () => {
      const result = compileFixture("app-member-tool", {
        "index.scrml": PROG_A, "pages/minter.scrml": MEMBER_MINTER, "tools/seed.scrml": TOOL,
      }, order);
      expect(codes(result)).toEqual([]);
      const member = serverJsFor(result, "pages/minter.scrml");
      expect(member).toBeTruthy();
      expect(cookieNames(member)).toEqual(PLAIN);
      expect(maxAgeSecs(member)).toEqual(SEVEN_DAYS);
      expect(cookieNames(serverJsFor(result, "/index.scrml"))).toEqual(PLAIN);
    });
  }

  test("a serve= tool is not counted either", () => {
    const result = compileFixture("app-member-servetool", {
      "index.scrml": PROG_A, "pages/minter.scrml": MEMBER_MINTER, "tools/srv.scrml": TOOL_SERVE,
    });
    expect(codes(result)).toEqual([]);
    expect(cookieNames(serverJsFor(result, "pages/minter.scrml"))).toEqual(PLAIN);
  });

  test("a tool's OWN session attributes govern nobody: the web app keeps the secure defaults", () => {
    const result = compileFixture("plainapp-member-decltool", {
      "index.scrml": PROG_B, "pages/minter.scrml": MEMBER_MINTER, "tools/seed.scrml": TOOL_DECLARING,
    });
    expect(codes(result)).toEqual([]);
    for (const unit of ["/index.scrml", "pages/minter.scrml"]) {
      const js = serverJsFor(result, unit);
      expect(js).toBeTruthy();
      expect(cookieNames(js)).toEqual(SECURE);
      expect(maxAgeSecs(js)).toEqual(DEFAULT_MAXAGE);
    }
  });

  // ── S438 review round (F1/F2): the unit is the FILE the emitter dispatches, not the node ──
  // `isToolProgram` sends a WHOLE file down the tool path by its first top-level
  // `<program>`, so any further `<program>` in that file is emitted nowhere.
  const TOOL_WITH_DEAD_DECLARING_SIBLING =
    `${TOOL}
<program session-secure="false" sessionExpiry="7d"></program>`;

  test("F1 — a dead declaring <program> inside a TOOL file governs nobody (was: refused; node-skip made it a silent downgrade)", () => {
    for (const order of ["fwd", "rev"]) {
      const result = compileFixture("tool-dead-sibling", {
        "tools/x.scrml": TOOL_WITH_DEAD_DECLARING_SIBLING, "pages/minter.scrml": MEMBER_MINTER,
      }, order);
      const member = serverJsFor(result, "pages/minter.scrml");
      expect(member).toBeTruthy();
      // Never `scrml_sid`/604800 — that declaration belongs to no emitted program.
      expect(cookieNames(member)).toEqual(SECURE);
      expect(maxAgeSecs(member)).toEqual(DEFAULT_MAXAGE);
    }
  });

  test("F1 — a bare <program> inside a tool file does not make a web app + member read as two applications", () => {
    const result = compileFixture("app-member-tool-bare-sibling", {
      "index.scrml": PROG_A, "pages/minter.scrml": MEMBER_MINTER,
      "tools/x.scrml": `${TOOL}
<program></program>`,
    });
    expect(codes(result).filter((c) => c === "E-MW-008")).toEqual([]);
    expect(cookieNames(serverJsFor(result, "pages/minter.scrml"))).toEqual(PLAIN);
  });

  test("F2 — a tool's declarations no longer leak into a program-less <page> (ACCEPTED on base, with the tool's plain 7d cookie)", () => {
    // On 072741ca this compiled clean and the page minted `scrml_sid`/604800 — the
    // tool's `session-secure="false"` reached a web unit it does not own. Now the
    // page gets the language default. Secure direction, but a cookie RENAME: an
    // adopter with this shape is logged out once on upgrade.
    const result = compileFixture("decltool-page-only", {
      "pages/minter.scrml": MEMBER_MINTER, "tools/seed.scrml": TOOL_DECLARING,
    });
    expect(codes(result)).toEqual([]);
    const member = serverJsFor(result, "pages/minter.scrml");
    expect(cookieNames(member)).toEqual(SECURE);
    expect(maxAgeSecs(member)).toEqual(DEFAULT_MAXAGE);
  });

  test("control — two web apps are STILL refused with a tool beside them (the exclusion opens no hole)", () => {
    const result = compileFixture("two-apps-tool", {
      "aaa.scrml": PROG_A, "sub/zzz.scrml": PROG_B, "tools/seed.scrml": TOOL,
    });
    expect(codes(result)).toEqual(["E-MW-008"]);
    // The census counts web-application programs only.
    const m = String(hardErrors(result).find((d) => d.code === "E-MW-008").message);
    expect(m).toMatch(/declares 2 <program>s across 2 files \(/);
    expect(m).not.toContain("seed.scrml");
  });
});
