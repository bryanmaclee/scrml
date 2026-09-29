// fixtures.js — the slice-M4 fixtures, each DERIVED from a verbatim §66.19
// source by named textual edits (so a SPEC change reaches it, and an edit whose
// site moved throws instead of silently doing nothing). A fixture exists only
// where the verbatim program uses a construct the bootstrap cannot build —
// Core-blocked (core.scrml is outside this slice) or an OPEN item — and each
// edit says which.

import { readM4, replaceLine } from "./harness.js";

/** Replace the ONE occurrence of `from` (throws on 0 or ≥ 2). */
export function editOnce(s, from, to) {
  const n = s.split(from).length - 1;
  if (n !== 1) throw new Error(`fixture edit: expected one ${JSON.stringify(from)}, found ${n}`);
  return s.replace(from, to);
}

/**
 * §66.19.5 minus its two Core-blocked constructs: `Date.now()` (Core has no
 * host-call Expr) → `0`; `<input bind:value=@actor/>` (Core has no bind /
 * event-value form) → a button that sets `@actor`. Plus the `let snapshot =
 * @audit` comment line (§66.10) as a probe function.
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
  let s = editOnce(auditFixture(), "<audit:Entry[free, end]=[]/>", "<audit:Entry[free, end, front]=[]/>");
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
 * §66.19.2 minus its validators (⚑ O25 — their reach into `renders` — and the
 * validity surface, §6.4) and its three binds (Core has no bind form), plus a
 * "Toggle agree" button — a logic write through the shared instance — standing
 * in for the checkbox's bind. `extraMain` is appended after it.
 */
export function formFixture(extraMain = "") {
  let s = readM4("src/form/signup.scrml");
  s = editOnce(s, ` req length(>=5)/>`, `/>`);
  s = editOnce(s, ` req length(>=8)/>`, `/>`);
  s = editOnce(s, `<input type="email" bind:value=@email/>`, `<input type="email"/>`);
  s = editOnce(s, `<input type="password" bind:value=@password/>`, `<input type="password"/>`);
  s = editOnce(s, `<input type="checkbox" bind:checked=@signup.agree/>`, `<input type="checkbox"/>`);
  s = replaceLine(s, "render the shared signup instance", `<*signup/>\n        <button onclick=(@signup.agree = !@signup.agree)>Toggle agree</button>${extraMain}`);
  return s;
}
