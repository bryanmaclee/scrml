// fixtures.js — the slice-M4 fixtures, each DERIVED from a verbatim §66.19
// source by named textual edits (so a SPEC change reaches it, and an edit whose
// site moved throws instead of silently doing nothing). Each edit says why.
// s444: §66.19.5 and §66.19.2 RUN FROM SOURCE now (audit.test.js / form.test.js
// load the verbatim programs); what is left here is determinism for the older
// review suites (a fixed clock, a button for the actor) and the validators
// (Phase B).

import { readM4, replaceLine } from "./harness.js";

/** Replace the ONE occurrence of `from` (throws on 0 or ≥ 2). */
export function editOnce(s, from, to) {
  const n = s.split(from).length - 1;
  if (n !== 1) throw new Error(`fixture edit: expected one ${JSON.stringify(from)}, found ${n}`);
  return s.replace(from, to);
}

/**
 * §66.19.5 made DETERMINISTIC for the s442 review suites (review-r1 / r2 /
 * typing pin `@0` timestamps and click "As alice"): `Date.now()` → `0` and the
 * bound input → a button that sets `@actor`. Plus the `let snapshot = @audit`
 * comment line (§66.10) as a probe function. (s444: neither construct is
 * Core-blocked any more — the verbatim program runs in audit.test.js.)
 */
export function auditFixture() {
  let s = readM4("src/audit/audit.scrml");
  const n = s.split("Date.now()").length - 1;
  if (n !== 2) throw new Error(`expected 2 Date.now() calls, found ${n}`);
  s = s.replaceAll("Date.now()", "0");
  s = replaceLine(s, "<input bind:value=@actor/>", `<button onclick=(@actor = "alice")>As alice</button>`);
  s = replaceLine(s, "let snapshot = @audit", "function probe() -> int {\n        let snapshot = @audit\n        record(\"probe\")\n        return snapshot.length\n    }");
  return s;
}

/** The audit fixture granting `front` too, with two more recognized shapes (§66.11.2). */
export function auditShapesFixture() {
  let s = editOnce(auditFixture(), "<audit:Entry[free, append]=[]/>", "<audit:Entry[free, append, prepend]=[]/>");
  s = replaceLine(s, "function recordBySpread(action: string) {", [
    "function recordTwo(a: string, b: string) {",
    "        @audit = [...@audit, { at: 1, actor: @actor, action: a }, { at: 2, actor: @actor, action: b }]",
    "    }",
    "    function recordFirst(a: string, b: string) {",
    "        @audit = [{ at: 3, actor: @actor, action: a }, { at: 4, actor: @actor, action: b }, ...@audit]",
    "    }",
    "    function recordBySpread(action: string) {",
  ].join("\n"));
  return s;
}

/**
 * §66.19.2 minus its validators only (s444: the three binds run — Core has
 * the bind form). The validators land in Phase B (dpa-058, RULED S442).
 * `extraMain` is appended after the `<*signup/>` line.
 */
export function formFixture(extraMain = "") {
  let s = readM4("src/form/signup.scrml");
  s = editOnce(s, ` req length(>=5)/>`, `/>`);
  s = editOnce(s, ` req length(>=8)/>`, `/>`);
  s = replaceLine(s, "render the shared signup instance", `<*signup/>${extraMain}`);
  return s;
}
