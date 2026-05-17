/* SPDX-License-Identifier: MIT
 * Phase A1b Step B15 — Engine state-child structural parser.
 * Phase A7 Step A5-2 (S70) — extended for §51.0.M-Q ratified extensions:
 *   - `<onTimeout>` body-scan, nested `<engine>` body-scan,
 *   - `history` bare attribute on state-child openers,
 *   - `internal:rule=` prefix on state-child openers,
 *   - `.Variant.history` target form in `rule=` / `internal:rule=`.
 * Phase A1b Step B17.2 (S74) — extended for §51.0.H ratified extensions:
 *   - `effect=${...}` attribute on state-child openers (parser captures
 *     verbatim; B17.3 typer fires E-ENGINE-EFFECT-AMBIGUOUS).
 *   - `<onTransition to|from|once|if=>...</>` body-scan (mirrors A5-2's
 *     `<onTimeout>` body-scan precedent).
 *
 * Parses an engine's `rulesRaw` body text into a flat list of state-child
 * entries. State-children are the §51.0.B PascalCase variant tags inside an
 * `<engine for=Type>` body; each carries an optional `rule=` attribute (the
 * §51.0.F transition contract) and a body.
 *
 * **Why a custom parser?** The AST today stores engine bodies as raw text
 * (`engine-decl.rulesRaw`), not walkable AST nodes — see primer §13.7 B14
 * specifics ("Engine bodies are RAW TEXT (engine-decl.rulesRaw) — no
 * walkable children today"). This module fills the gap structurally enough
 * for B15's three responsibilities (exhaustiveness, rule= form check,
 * initial= validation). When the parser gains structural state-child
 * support, this module's output will mirror the AST one-to-one and the
 * file becomes a thin shim or is replaced.
 *
 * **What this parser DOES:**
 *   1. Recognize legacy arrow-rule lines (`.From => .To`) and SKIP them —
 *      legacy `<machine>` form is handled by `parseMachineRules` in the
 *      type-system; B15's PASS 11 walks only the new `<engine>` form.
 *   2. Recognize state-child opener tags (`<Variant rule=.X>`, `<Variant>`,
 *      `<Variant rule=(.A | .B)>`) and pair them with their closers
 *      (`</>`, `</Variant>`).
 *   3. Recognize `:`-shorthand body form (`<Variant rule=.X> : "..."`).
 *   4. Parse the `rule=` attribute value into one of the §51.0.F forms.
 *   5. (A5-2) Recognize `history` bare attribute and `internal:rule=`
 *      prefix on state-child openers (§51.0.N, §51.0.O).
 *   6. (A5-2) Body-scan for `<onTimeout/>` siblings and nested `<engine>`
 *      declarations (§51.0.M, §51.0.Q.1).
 *   7. (A5-2) Recognize `.Variant.history` target form in `rule=` /
 *      `internal:rule=` values (§51.0.N).
 *
 * **What this parser does NOT do:**
 *   - Parse the BODY of state-children semantically (raw text + structural
 *     element extraction only). A5-3 typer walks `bodyRaw` /
 *     `onTimeoutElements` / `innerEngines` / `onTransitionElements` for
 *     diagnostics.
 *   - Substitute for the type-system's enum-variant validation (it merely
 *     extracts the tag string; validation against the type's variants
 *     happens in PASS 11).
 *
 * **What B17.2 (S74) ADDED to this parser (NEW responsibility):**
 *   8. Recognize `effect=${...}` attribute on state-child openers (§51.0.H,
 *      Form 1). Captures the inner expression text verbatim into
 *      `EngineStateChildEntry.effectRaw`.
 *   9. Body-scan for `<onTransition>` siblings (§51.0.H, Form 2) with
 *      attribute extraction (`to=`, `from=`, `once`, `if=`) and body-text
 *      capture (bare-body, `:`-shorthand, or self-closing). Records into
 *      `EngineStateChildEntry.onTransitionElements`.
 *   10. `<onTransition>` body regions are added to skipRegions for the
 *       `<onTimeout>` + nested `<engine>` body-scans, preventing
 *       double-counting (mirrors A5-2 nested-engine skipRegions pattern).
 */

import type {
  EngineRuleForm,
  EngineStateChildEntry,
  OnTimeoutEntry,
  OnIdleEntry,
  NestedEngineEntry,
  OnTransitionEntry,
} from "./symbol-table";

/**
 * HTML void elements (mirrors `block-splitter.js` VOID_ELEMENTS). Their opener
 * tags never have a matching closer in source text. The closer-finder routines
 * below use this set to AVOID pushing void-element openers onto the lowercase
 * opener stack (which would otherwise leave an unbalanced phantom opener that
 * the next `</>` or other lowercase closer would attempt to pop, corrupting
 * the state-child / engine / onTransition depth counters).
 */
const VOID_ELEMENTS_LC = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "source", "track", "wbr",
]);

/**
 * Determine whether the engine body text appears to be in the LEGACY
 * `<machine>` arrow-rule form (`.From => .To`). The new `<engine>` state-
 * child form uses `<Variant ...>...</>` openers and never uses `=>`.
 *
 * Heuristic: presence of `=>` at top level (not inside braces) AND absence
 * of `<` opener for a state-child. The check is conservative — when in
 * doubt, return false so the parser attempts state-child extraction.
 *
 * Returns true iff the body is unambiguously legacy arrow-rules. Such
 * bodies are SKIPPED by B15's parser (the legacy form is the type-system's
 * territory; B15 deals exclusively with the new `<engine>` state-child
 * surface).
 */
export function isLegacyArrowRulesBody(rulesRaw: string): boolean {
  const trimmed = rulesRaw.trim();
  if (!trimmed) return false;
  // If the body never contains `<` followed by an uppercase letter
  // (state-child opener) but DOES contain `=>`, treat as legacy.
  const hasStateChildOpener = /<\s*[A-Z]/.test(trimmed);
  const hasArrow = /=>/.test(trimmed);
  if (!hasStateChildOpener && hasArrow) return true;
  return false;
}

/**
 * Split a top-level `|` alternation list into individual items. Respects
 * parentheses depth so nested groupings (rare in `rule=` but possible in
 * future extensions) don't fragment.
 */
function splitTopLevelPipe(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (c === "|" && depth === 0) {
      out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * Parse a `rule=` attribute value (the substring after `rule=`, with any
 * surrounding quotes stripped) into one of the §51.0.F forms.
 *
 * Examples:
 *   ".NextVariant"            → { kind: "single", target: "NextVariant" }
 *   ".NextVariant.history"    → { kind: "single", target: "NextVariant", historyForm: true } (§51.0.N)
 *   "(.A | .B | .C)"          → { kind: "multi", targets: ["A","B","C"] }
 *   "(.A | .B.history)"       → { kind: "multi", targets: ["A","B"], historyForms: [false, true] } (§51.0.N)
 *   "*"                       → { kind: "wildcard" }
 *   "event -> Variant"        → { kind: "legacy-arrow", raw: "event -> Variant" }
 *   "garbage"                 → { kind: "parse-error", raw: "garbage", reason: ... }
 *
 * A5-2 EXTENSION (§51.0.N — `.Variant.history` target form): the per-target
 * regex is extended with an optional `.history` suffix; matched targets carry
 * `historyForm: true` (single) or set the corresponding `historyForms[i]`
 * slot to `true` (multi). Mixed lists like `(.A | .B.history)` are tolerated
 * defensively — spec doesn't forbid mixing within a multi-target list.
 */
export function parseRuleAttrValue(raw: string): EngineRuleForm {
  const v = raw.trim();
  if (v.length === 0) {
    return { kind: "parse-error", raw, reason: "empty rule= value" };
  }

  // Wildcard escape hatch — §51.0.F.
  if (v === "*") return { kind: "wildcard" };

  // Legacy event-arrow form — §51.3, deprecated. We detect to fire
  // E-ENGINE-RULE-LEGACY-SYNTAX in PASS 11.
  // Heuristic: contains `->` (not `=>` — that's the legacy *machine* arrow
  // INSIDE rulesRaw, distinct from the `rule=` attribute value).
  // Per §51.3 the form is `event -> Variant` (or `event(payload) -> Variant`).
  if (/->/.test(v) || /=>/.test(v)) {
    return { kind: "legacy-arrow", raw };
  }

  // Single-target form: `.Variant` or `.Variant.history` (§51.0.N).
  // Pattern: leading dot, PascalCase identifier, optional `.history` suffix, end.
  const singleMatch = v.match(/^\.([A-Z][A-Za-z0-9_]*)(\.history)?$/);
  if (singleMatch) {
    const form: EngineRuleForm = { kind: "single", target: singleMatch[1]! };
    if (singleMatch[2]) form.historyForm = true;
    return form;
  }

  // Multi-target form: `(.A | .B | .C)` — items may be `.A` or `.A.history`.
  // Strip enclosing parens, split on `|`, parse each per single-target rule.
  if (v.startsWith("(") && v.endsWith(")")) {
    const inner = v.slice(1, -1).trim();
    const parts = splitTopLevelPipe(inner);
    const targets: string[] = [];
    const historyForms: boolean[] = [];
    let anyHistory = false;
    for (const p of parts) {
      const m = p.match(/^\.([A-Z][A-Za-z0-9_]*)(\.history)?$/);
      if (!m) {
        return {
          kind: "parse-error",
          raw,
          reason: `multi-target alternative '${p}' is not a valid '.Variant' reference`,
        };
      }
      targets.push(m[1]!);
      const isHist = !!m[2];
      historyForms.push(isHist);
      if (isHist) anyHistory = true;
    }
    if (targets.length === 0) {
      return { kind: "parse-error", raw, reason: "empty multi-target list" };
    }
    // Only populate `historyForms` when at least one target uses the history
    // form — keeps the canonical multi-target shape unchanged for the common
    // case (defensive shape per Phase 0 SURVEY §1.6 / §7.6).
    if (anyHistory) return { kind: "multi", targets, historyForms };
    return { kind: "multi", targets };
  }

  // Bare PascalCase form (no leading dot) — accept defensively as single-
  // target. Spec is `.Variant`, but ergonomic surfacing has historically
  // accepted `Variant` too. Document the deviation as a future tightening.
  // Bare form admits the `.history` suffix for symmetry with the leading-dot
  // form (§51.0.N — wherever `.Variant` is legal, `.Variant.history` is too).
  const bareMatch = v.match(/^([A-Z][A-Za-z0-9_]*)(\.history)?$/);
  if (bareMatch) {
    const form: EngineRuleForm = { kind: "single", target: bareMatch[1]! };
    if (bareMatch[2]) form.historyForm = true;
    return form;
  }

  return {
    kind: "parse-error",
    raw,
    reason: `'${v}' is not one of the §51.0.F forms (single-target '.X', multi-target '(.A | .B)', or wildcard '*')`,
  };
}

/**
 * A5-2 (§51.0.M) — scan a state-child body for `<onTimeout/>` siblings.
 *
 * `<onTimeout>` is a self-closing structural element with required `after`
 * and `to` attributes per §51.0.M form `<onTimeout after=DURATION to=.Variant/>`.
 * Per BRIEF §4.1, A5-2 captures `after` as the raw attribute value (literal
 * or `${expr}<unit>`); A5-3 typer parses the duration form.
 *
 * **Composition with nested engines** (Phase 0 SURVEY §2 edge-case): when
 * a nested `<engine>` declaration appears in `bodyRaw`, its `<onTimeout>`
 * siblings belong to the INNER engine's state-children, NOT the outer's.
 * To avoid mis-association, the caller passes a list of nested-engine body
 * regions (`skipRegions`) — `[start, end)` pairs in `bodyRaw` coordinates.
 * The scan SKIPS those regions.
 *
 * The scan is conservative: only the spec-canonical self-closing form
 * `<onTimeout ...attrs.../>` is recognized. A non-self-closing form
 * `<onTimeout>...</onTimeout>` is not in spec and is not matched here —
 * if observed, A5-3 typer can flag it.
 */
export function scanForOnTimeoutEntries(
  bodyRaw: string,
  skipRegions: ReadonlyArray<readonly [number, number]> = [],
): OnTimeoutEntry[] {
  const out: OnTimeoutEntry[] = [];
  if (!bodyRaw) return out;

  const inSkipRegion = (idx: number): boolean => {
    for (const [start, end] of skipRegions) {
      if (idx >= start && idx < end) return true;
    }
    return false;
  };

  // Match self-closing `<onTimeout ...attrs.../>`. Lazy capture for attrs
  // so `>` inside attribute values is handled minimally — `<onTimeout>` does
  // not host structural children, so no quote/paren depth tracking is needed
  // for the spec-canonical form.
  const re = /<onTimeout\b([^>]*?)\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bodyRaw)) !== null) {
    const startIdx = m.index;
    if (inSkipRegion(startIdx)) continue;

    const attrs = m[1] ?? "";
    // Extract `after=` value — accepts:
    //   after=Nms / after=Ns / after="500ms" / after=${expr}<unit>
    // Greedy-stop at next bareword `<ident>=` OR self-close.
    const afterMatch = attrs.match(/\bafter\s*=\s*(.+?)(?=\s+\w+\s*=|\s*\/?\s*$)/s);
    let afterVal = "";
    if (afterMatch) {
      let v = afterMatch[1]!.trim();
      if ((v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1).trim();
      }
      afterVal = v;
    }

    // Extract `to=` value — accepts:
    //   to=.Variant / to="Variant" / to=Variant
    // Multi-target / wildcard `to=` is NOT legal per §51.0.M; A5-3 enforces.
    const toMatch = attrs.match(/\bto\s*=\s*(.+?)(?=\s+\w+\s*=|\s*\/?\s*$)/s);
    let toVal = "";
    if (toMatch) {
      let v = toMatch[1]!.trim();
      if ((v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1).trim();
      }
      // Strip leading `.` for the variant name (mirror parseRuleAttrValue).
      if (v.startsWith(".")) v = v.slice(1);
      toVal = v;
    }

    // A5-6 Feature 1 (§51.0.M name= extension, S79) — extract optional
    // `name=` value. Accepts: name=ident / name="ident" / name='ident'.
    // Identifier-shape validation deferred to A5-3 typer (E-TIMER-NAME-INVALID).
    const nameMatch = attrs.match(/\bname\s*=\s*(.+?)(?=\s+\w+\s*=|\s*\/?\s*$)/s);
    let nameVal: string | undefined;
    if (nameMatch) {
      let v = nameMatch[1]!.trim();
      if ((v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1).trim();
      }
      if (v.length > 0) nameVal = v;
    }

    const entry: OnTimeoutEntry = { after: afterVal, to: toVal, rawOffset: startIdx };
    if (nameVal !== undefined) entry.name = nameVal;
    out.push(entry);
  }

  return out;
}

/**
 * A5-6 (§51.0.R, S77) — scan an engine's `rulesRaw` for `<onIdle/>` self-
 * closing elements at the engine-root scope (sibling of state-children).
 *
 * Captures ALL matches (regardless of placement) so the typer can fire
 * `E-IDLE-MISPLACED` when an entry falls inside a state-child body. The
 * typer cross-references against the state-child boundary map produced by
 * `parseEngineStateChildren`; an `<onIdle>` whose `rawOffset` falls within
 * any state-child opener-to-closer range is misplaced.
 *
 * Same shape as `scanForOnTimeoutEntries` (lazy regex, attribute extraction
 * with quoted-string handling, leading-dot strip on `to=`). The duration
 * shape is identical to `<onTimeout>`'s `after=` (literal Nms/Ns/Nm/Nh OR
 * computed `${expr}<unit>` per §51.12.3.1).
 */
export function scanForOnIdleEntries(rulesRaw: string): OnIdleEntry[] {
  const out: OnIdleEntry[] = [];
  if (!rulesRaw) return out;

  const re = /<onIdle\b([^>]*?)\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rulesRaw)) !== null) {
    const startIdx = m.index;
    const attrs = m[1] ?? "";

    // Extract `after=` value — accepts:
    //   after=Nms / after=Ns / after="500ms" / after=${expr}<unit>
    const afterMatch = attrs.match(/\bafter\s*=\s*(.+?)(?=\s+\w+\s*=|\s*\/?\s*$)/s);
    let afterVal = "";
    if (afterMatch) {
      let v = afterMatch[1]!.trim();
      if ((v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1).trim();
      }
      afterVal = v;
    }

    // Extract `to=` value — accepts: to=.Variant / to="Variant" / to=Variant.
    const toMatch = attrs.match(/\bto\s*=\s*(.+?)(?=\s+\w+\s*=|\s*\/?\s*$)/s);
    let toVal = "";
    if (toMatch) {
      let v = toMatch[1]!.trim();
      if ((v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1).trim();
      }
      if (v.startsWith(".")) v = v.slice(1);
      toVal = v;
    }

    out.push({ after: afterVal, to: toVal, rawOffset: startIdx });
  }

  return out;
}

/**
 * A5-2 (§51.0.Q.1) — scan a state-child body for nested `<engine>`
 * declarations. Each match yields a `NestedEngineEntry` capturing the
 * verbatim source slice (`<engine ...>...</>`) and its offset.
 *
 * Per Phase 0 SURVEY §1.5, A5-2 captures shape ONLY (no recursive parse —
 * A5-3 typer or A1c codegen will walk the raw text via the same engine-decl
 * construction path).
 *
 * The scan walks the body looking for `<engine\b` openers, then finds the
 * matching `</>` or `</engine>` closer using the same depth-tracking pattern
 * as `findStateChildCloser`. Self-closing `<engine .../>` is NOT a legal
 * nested-engine form (engines must contain state-children) — such openers
 * are skipped here; A5-3 typer can flag them.
 */
export function scanForNestedEngineEntries(bodyRaw: string): NestedEngineEntry[] {
  const out: NestedEngineEntry[] = [];
  if (!bodyRaw) return out;

  let i = 0;
  while (i < bodyRaw.length) {
    const lt = bodyRaw.indexOf("<engine", i);
    if (lt < 0) break;
    // Boundary check: ensure `<engine` is followed by whitespace or `>` (not
    // a longer identifier prefix like `<engineering>`).
    const nextCh = bodyRaw[lt + 7];
    if (nextCh !== undefined && nextCh !== " " && nextCh !== "\t" &&
        nextCh !== "\n" && nextCh !== ">" && nextCh !== "/") {
      i = lt + 1;
      continue;
    }

    const openerEnd = findOpenerEnd(bodyRaw, lt + 1);
    if (openerEnd < 0) break;

    // Self-closing `<engine .../>` is NOT a legal nested-engine form.
    const isSelfClose = bodyRaw[openerEnd - 1] === "/";
    if (isSelfClose) {
      i = openerEnd + 1;
      continue;
    }

    // Find matching `</engine>` or `</>` closer via depth-tracking.
    const closerStart = findEngineCloser(bodyRaw, openerEnd + 1);
    if (closerStart < 0) {
      // Malformed nested engine — skip and continue.
      i = openerEnd + 1;
      continue;
    }
    // Advance past the closer.
    let closerEnd: number;
    if (bodyRaw.startsWith("</>", closerStart)) {
      closerEnd = closerStart + 3;
    } else {
      const gt = bodyRaw.indexOf(">", closerStart);
      closerEnd = gt >= 0 ? gt + 1 : bodyRaw.length;
    }

    out.push({
      rawText: bodyRaw.slice(lt, closerEnd),
      rawOffset: lt,
    });
    i = closerEnd;
  }

  return out;
}

/**
 * B17.2 attribute walker — parse the attribute substring of an opener tag
 * (the text BETWEEN the tag name and the trailing `>` / `/>`) into a flat
 * map of name → value (for `name=value`) and a set of bare attributes (for
 * standalone `name` tokens).
 *
 * **Why a walker, not a regex.** Mixed bare + valued attributes are common in
 * `<onTransition>` openers (e.g., `to=.Cape once if=(@x == y) once`). A naive
 * `match(/name\s*=\s*(.+?)(?=\s+\w+\s*=|\s*\/?\s*$)/)` is greedy past bare
 * attrs because they don't trigger the `\w+\s*=` lookahead — the value
 * captures across the bare attr. The walker handles each token in source order
 * and respects paren / quote / `${}` / `.history`-style depth for values.
 *
 * **Captured values are returned VERBATIM** (no leading-dot stripping, no
 * quote-stripping) — callers normalise per-attribute (e.g., `to=` strips
 * leading `.`; `if=` keeps parens).
 *
 * Returns:
 *   - `valued`: Map<string, string> — attribute name → raw value substring.
 *   - `bare`:   Set<string>          — bare attribute names (e.g., `once`).
 */
function parseOpenerAttributes(attrs: string): {
  valued: Map<string, string>;
  bare: Set<string>;
} {
  const valued = new Map<string, string>();
  const bare = new Set<string>();
  let i = 0;
  const n = attrs.length;
  while (i < n) {
    // Skip whitespace.
    if (attrs[i] === " " || attrs[i] === "\t" || attrs[i] === "\n") {
      i++;
      continue;
    }
    // Trailing `/` (self-close marker) — stop.
    if (attrs[i] === "/") break;
    // Read identifier (allow `:` for `internal:rule=`-style namespaced attrs).
    if (!/[A-Za-z_]/.test(attrs[i] ?? "")) {
      // Unrecognised character — skip defensively.
      i++;
      continue;
    }
    let nameStart = i;
    while (i < n && /[A-Za-z0-9_:]/.test(attrs[i] ?? "")) i++;
    const name = attrs.slice(nameStart, i);
    // Skip whitespace before `=` (or end-of-attr).
    let j = i;
    while (j < n && (attrs[j] === " " || attrs[j] === "\t" || attrs[j] === "\n")) j++;
    if (j >= n || attrs[j] !== "=") {
      // Bare attribute (no `=` follows).
      bare.add(name);
      i = j;
      continue;
    }
    // Consume `=`.
    j++;
    while (j < n && (attrs[j] === " " || attrs[j] === "\t" || attrs[j] === "\n")) j++;
    // Read value with paren / quote / `${...}` depth tracking. Value ends at
    // unescaped whitespace at top level OR at `/` (self-close) at top level OR
    // at end of string.
    let valStart = j;
    let parenDepth = 0;
    let braceDepth = 0;
    let inQuote = "";
    while (j < n) {
      const c = attrs[j]!;
      if (inQuote) {
        if (c === inQuote) inQuote = "";
        j++;
        continue;
      }
      if (c === '"' || c === "'") {
        inQuote = c;
        j++;
        continue;
      }
      // Logic-context `${...}` opener — consume a balanced brace block.
      if (c === "$" && attrs[j + 1] === "{") {
        j += 2;
        braceDepth = 1;
        while (j < n && braceDepth > 0) {
          const c2 = attrs[j];
          if (c2 === "{") braceDepth++;
          else if (c2 === "}") braceDepth--;
          j++;
        }
        continue;
      }
      if (c === "(") { parenDepth++; j++; continue; }
      if (c === ")") { parenDepth--; j++; continue; }
      if (parenDepth === 0 && (c === " " || c === "\t" || c === "\n")) break;
      if (parenDepth === 0 && c === "/") break;
      j++;
    }
    const value = attrs.slice(valStart, j);
    valued.set(name, value);
    i = j;
  }
  return { valued, bare };
}

/**
 * B17.2 (§51.0.H) — scan a state-child body for `<onTransition>` siblings.
 *
 * `<onTransition>` is a structural element with optional `to=`, `from=`,
 * `once`, `if=` attributes per §51.0.H. Three body forms supported (per
 * §51.0.I + B17.2 SURVEY decision sub-3a):
 *   - Bare body: `<onTransition to=.X>${...}</>` or `<onTransition to=.X>...</onTransition>`
 *   - `:`-shorthand: `<onTransition to=.X> : expr` (defensive — typer may
 *     forbid).
 *   - Self-closing: `<onTransition to=.X/>` (degenerate but harmless per
 *     SURVEY decision 2).
 *
 * **Composition with other body-scan elements** (mirrors A5-2 nested-engine
 * skipRegions). When `<onTransition>` body contains an `<onTimeout/>` or a
 * nested `<engine>`, those should NOT be double-counted by the outer
 * state-child's body-scan. The caller passes the `<onTransition>` body
 * regions to `scanForOnTimeoutEntries` and `scanForNestedEngineEntries` via
 * their `skipRegions` parameter.
 *
 * **Robustness.** Malformed openers (missing `to=` AND `from=`, unbalanced
 * `${...}` in `if=`, etc.) are CAPTURED with null fields per SURVEY decision
 * 3 — the typer (B17.3) surfaces diagnostics on the captured shape rather
 * than the parser silently skipping.
 *
 * **Returned offsets** are bodyRaw-relative; the absolute file offset is
 * reconstructable by adding the engine-decl's span + bodyRaw start offset +
 * the entry's `rawOffset` (mirrors `OnTimeoutEntry.rawOffset` semantics).
 */
export function scanForOnTransitionEntries(
  bodyRaw: string,
  skipRegions: ReadonlyArray<readonly [number, number]> = [],
): OnTransitionEntry[] {
  const out: OnTransitionEntry[] = [];
  if (!bodyRaw) return out;

  const inSkipRegion = (idx: number): boolean => {
    for (const [start, end] of skipRegions) {
      if (idx >= start && idx < end) return true;
    }
    return false;
  };

  let i = 0;
  while (i < bodyRaw.length) {
    const lt = bodyRaw.indexOf("<onTransition", i);
    if (lt < 0) break;
    // Boundary check: ensure `<onTransition` is followed by whitespace, `>`,
    // or `/` (not a longer identifier prefix).
    const nextCh = bodyRaw[lt + 13];
    if (nextCh !== undefined && nextCh !== " " && nextCh !== "\t" &&
        nextCh !== "\n" && nextCh !== ">" && nextCh !== "/") {
      i = lt + 1;
      continue;
    }
    if (inSkipRegion(lt)) {
      i = lt + 1;
      continue;
    }

    // Find the opener's `>`. findOpenerEnd handles parens and quotes — same
    // pattern as state-child opener scanning. Position is one past `<`.
    const openerEnd = findOpenerEnd(bodyRaw, lt + 1);
    if (openerEnd < 0) break;

    const openerInner = bodyRaw.slice(lt + 1, openerEnd);
    // openerInner starts with `onTransition`. Strip the tag and parse attrs.
    const attrs = openerInner.replace(/^onTransition/, "");
    const isSelfClose = openerInner.trimEnd().endsWith("/");

    // Use the attribute walker (handles mixed bare + valued attributes per
    // SURVEY decision 1 + 3). The walker respects paren/quote/${} depth so
    // values like `if=(@a == b)` capture cleanly past internal whitespace.
    const { valued, bare } = parseOpenerAttributes(attrs);

    const stripDot = (v: string): string => {
      let s = v.trim();
      if ((s.startsWith('"') && s.endsWith('"')) ||
          (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1).trim();
      }
      if (s.startsWith(".")) s = s.slice(1);
      return s;
    };

    // `to=.Variant` / `to=Variant` / `to="Variant"` — strip leading `.`.
    const toRaw = valued.get("to");
    const toVal: string | null = toRaw !== undefined ? stripDot(toRaw) : null;

    // `from=.Variant` — same shape as `to=`.
    const fromRaw = valued.get("from");
    const fromVal: string | null = fromRaw !== undefined ? stripDot(fromRaw) : null;

    // `once` bare attribute.
    const once = bare.has("once");

    // `if=expr` — captures verbatim; per SURVEY decision 1, paren-form,
    // logic-context (`${...}`), and bare expression all retained as-is.
    const ifRaw = valued.get("if");
    const ifExprRaw: string | null = ifRaw !== undefined ? ifRaw.trim() : null;

    // Locate body end. Mirrors parseEngineStateChildren body-end logic.
    let bodyStart = openerEnd + 1;
    let bodyEnd: number;
    let nextI: number;
    let isColonShorthand = false;
    if (isSelfClose) {
      bodyEnd = bodyStart;
      nextI = bodyStart;
    } else {
      // `:`-shorthand body? After `>`, optional whitespace, then `:`.
      const afterOpener = bodyRaw.slice(bodyStart);
      const colonShortcutMatch = afterOpener.match(/^\s*:\s*([^\n]*)/);
      if (colonShortcutMatch) {
        const colonStart = bodyStart + colonShortcutMatch[0].indexOf(":");
        const lineEnd = bodyStart + colonShortcutMatch[0].length;
        bodyEnd = lineEnd;
        nextI = lineEnd;
        bodyStart = colonStart + 1;
        isColonShorthand = true;
      } else {
        // Find matching closer — `</>` or `</onTransition>`.
        const closerStart = findOnTransitionCloser(bodyRaw, bodyStart);
        if (closerStart < 0) {
          // Malformed — capture entry with empty body and advance past opener.
          out.push({
            to: toVal,
            from: fromVal,
            once,
            ifExprRaw,
            bodyRaw: "",
            isColonShorthand: false,
            rawOffset: lt,
          });
          i = openerEnd + 1;
          continue;
        }
        bodyEnd = closerStart;
        if (bodyRaw.startsWith("</>", closerStart)) {
          nextI = closerStart + 3;
        } else {
          const gt = bodyRaw.indexOf(">", closerStart);
          nextI = gt >= 0 ? gt + 1 : bodyRaw.length;
        }
      }
    }

    out.push({
      to: toVal,
      from: fromVal,
      once,
      ifExprRaw,
      bodyRaw: bodyRaw.slice(bodyStart, bodyEnd),
      isColonShorthand,
      rawOffset: lt,
    });
    i = nextI;
  }

  return out;
}

/**
 * B17.2 — find the matching closer for an `<onTransition>` opener whose body
 * starts at index `from` in `bodyRaw`. Recognizes `</>` and `</onTransition>`
 * closers. Honors `${...}` interpolation skipping and nested PascalCase
 * openers (mirrors `findStateChildCloser` for `<onTransition>` body context).
 *
 * Returns the index of the closer's `<`, or -1 if no matching closer found.
 */
function findOnTransitionCloser(bodyRaw: string, from: number): number {
  let i = from;
  let depth = 1;
  // Wave 4 fix (changes/fix-nested-engine-body-parser-lowercase-html, 2026-05-11):
  // Track lowercase HTML opener depth SEPARATELY (mirrors findStateChildCloser).
  // Pre-fix, lowercase HTML closers inside an `<onTransition>` body would
  // prematurely decrement depth (their corresponding openers don't increment
  // depth via the PascalCase branch below).
  let lowerDepth = 0;
  while (i < bodyRaw.length) {
    // Skip ${...} interpolation
    if (bodyRaw.startsWith("${", i)) {
      let j = i + 2;
      let braceDepth = 1;
      while (j < bodyRaw.length && braceDepth > 0) {
        if (bodyRaw[j] === "{") braceDepth++;
        else if (bodyRaw[j] === "}") braceDepth--;
        j++;
      }
      i = j;
      continue;
    }
    // Closer: `</>` (generic) — pops lowerDepth first, then depth.
    if (bodyRaw.startsWith("</>", i)) {
      if (lowerDepth > 0) {
        lowerDepth--;
        i += 3;
        continue;
      }
      depth--;
      if (depth === 0) return i;
      i += 3;
      continue;
    }
    // Closer: `</onTransition>` (explicit). Always pops depth.
    if (bodyRaw.startsWith("</onTransition", i)) {
      const ch = bodyRaw[i + 14];
      if (ch === undefined || ch === " " || ch === "\t" || ch === "\n" || ch === ">") {
        const end = bodyRaw.indexOf(">", i);
        if (end < 0) return -1;
        depth--;
        if (depth === 0) return i;
        i = end + 1;
        continue;
      }
    }
    // Closer: `</Variant>` (uppercase) or `</tag>` (lowercase HTML).
    if (bodyRaw.startsWith("</", i)) {
      const end = bodyRaw.indexOf(">", i);
      if (end < 0) return -1;
      const closerFirstChar = bodyRaw[i + 2];
      if (closerFirstChar && closerFirstChar >= "a" && closerFirstChar <= "z") {
        // Lowercase HTML named closer — pop lowerDepth only.
        if (lowerDepth > 0) lowerDepth--;
        i = end + 1;
        continue;
      }
      depth--;
      if (depth === 0) return i;
      i = end + 1;
      continue;
    }
    // Opener: PascalCase bumps depth, lowercase bumps lowerDepth (unless void).
    if (bodyRaw[i] === "<") {
      const next = bodyRaw[i + 1];
      if (next && next >= "A" && next <= "Z") {
        const openerEnd = findOpenerEnd(bodyRaw, i + 1);
        if (openerEnd < 0) return -1;
        if (bodyRaw[openerEnd - 1] !== "/") {
          depth++;
        }
        i = openerEnd + 1;
        continue;
      }
      if (next && next >= "a" && next <= "z") {
        let j = i + 1;
        while (j < bodyRaw.length) {
          const c = bodyRaw[j]!;
          if ((c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "-") j++;
          else break;
        }
        const tagName = bodyRaw.slice(i + 1, j);
        const openerEnd = findOpenerEnd(bodyRaw, i + 1);
        if (openerEnd < 0) return -1;
        const isSelfClose = bodyRaw[openerEnd - 1] === "/";
        if (!isSelfClose && !VOID_ELEMENTS_LC.has(tagName)) {
          lowerDepth++;
        }
        i = openerEnd + 1;
        continue;
      }
    }
    i++;
  }
  return -1;
}

/**
 * Find the matching closer for a nested `<engine>` opener whose body starts
 * at index `from` in `bodyRaw`. Recognizes `</>` and `</engine>` closers.
 *
 * **Closer-discrimination algorithm.** State-child openers `<Variant ...>`
 * inside the nested engine's body have their own `</>` / `</Variant>`
 * closers — those should NOT terminate the engine. To handle this, we
 * track depth of in-flight PascalCase state-child openers separately:
 *   - `<engine\b ...>` (non-self-closing) increments `engineDepth` (we
 *     enter at engineDepth=1 for the outermost nested engine).
 *   - `<PascalCase ...>` (non-self-closing) pushes a state-child onto a
 *     LIFO stack tracked by `scDepth`.
 *   - `</>` (generic closer) pops scDepth FIRST (consumed by the
 *     innermost open state-child); only when scDepth=0 does `</>` close
 *     an engine (engineDepth--).
 *   - `</engine>` (explicit closer) is unambiguous — closes the engine
 *     directly (engineDepth--).
 *   - `</Variant>` (explicit named state-child closer) pops scDepth.
 *
 * Returns the index of the matching closer's `<`, or -1 if not found.
 *
 * Mirrors `findStateChildCloser` semantics but specialized for engines.
 */
function findEngineCloser(bodyRaw: string, from: number): number {
  let i = from;
  let engineDepth = 1;
  let scDepth = 0; // depth of in-flight state-child openers
  // Wave 4 fix (changes/fix-nested-engine-body-parser-lowercase-html, 2026-05-11):
  // Track lowercase HTML opener depth SEPARATELY (mirrors findStateChildCloser).
  // Without this, a lowercase opener inside a nested engine body (`<button>` etc.)
  // would not increment any counter, but its `</>` closer or `</button>` closer
  // would pop scDepth (line `</>` branch) or fall into the `else if
  // (closerName.length > 0)` branch — corrupting state-child accounting.
  let lowerDepth = 0;
  while (i < bodyRaw.length) {
    // Skip ${...} interpolation
    if (bodyRaw.startsWith("${", i)) {
      let j = i + 2;
      let braceDepth = 1;
      while (j < bodyRaw.length && braceDepth > 0) {
        if (bodyRaw[j] === "{") braceDepth++;
        else if (bodyRaw[j] === "}") braceDepth--;
        j++;
      }
      i = j;
      continue;
    }
    // Closer: `</>` (generic). Pop the most-recently-opened element:
    // lowerDepth (lowercase HTML) first, then scDepth (state-child), then
    // engineDepth (the engine itself).
    if (bodyRaw.startsWith("</>", i)) {
      if (lowerDepth > 0) {
        lowerDepth--;
        i += 3;
        continue;
      }
      if (scDepth > 0) {
        scDepth--;
        i += 3;
        continue;
      }
      engineDepth--;
      if (engineDepth === 0) return i;
      i += 3;
      continue;
    }
    // Closer: `</engine>`, `</Variant>` (uppercase), or `</tag>` (lowercase HTML).
    if (bodyRaw.startsWith("</", i)) {
      const end = bodyRaw.indexOf(">", i);
      if (end < 0) return -1;
      const closerName = bodyRaw.slice(i + 2, end).trim();
      if (closerName === "engine") {
        engineDepth--;
        if (engineDepth === 0) return i;
      } else if (closerName.length > 0) {
        const firstChar = closerName[0]!;
        if (firstChar >= "a" && firstChar <= "z") {
          // Lowercase HTML named closer (`</button>`, ...). Pop lowerDepth
          // only; do NOT touch scDepth or engineDepth.
          if (lowerDepth > 0) lowerDepth--;
        } else {
          // Named state-child closer (uppercase, e.g., `</X>`). Pops scDepth.
          if (scDepth > 0) scDepth--;
        }
      }
      i = end + 1;
      continue;
    }
    // Opener `<engine\b` increments engineDepth; other PascalCase openers
    // are state-children — increment scDepth (unless self-closing).
    if (bodyRaw[i] === "<") {
      // Detect `<engine\b` opener (deeper-nested engines).
      if (bodyRaw.startsWith("<engine", i)) {
        const ch = bodyRaw[i + 7];
        if (ch === undefined || ch === " " || ch === "\t" || ch === "\n" ||
            ch === ">" || ch === "/") {
          const oe = findOpenerEnd(bodyRaw, i + 1);
          if (oe < 0) return -1;
          if (bodyRaw[oe - 1] !== "/") {
            engineDepth++;
          }
          i = oe + 1;
          continue;
        }
      }
      // B17.2 — `<onTransition>` opener inside a nested-engine body. Skip
      // past the entire <onTransition> block so its `</>` closer doesn't
      // decrement scDepth incorrectly (the lowercase `<onTransition` opener
      // doesn't trigger a scDepth bump via the PascalCase branch below).
      if (bodyRaw.startsWith("<onTransition", i)) {
        const ch = bodyRaw[i + 13];
        if (ch === undefined || ch === " " || ch === "\t" || ch === "\n" ||
            ch === ">" || ch === "/") {
          const oe = findOpenerEnd(bodyRaw, i + 1);
          if (oe < 0) return -1;
          if (bodyRaw[oe - 1] === "/") {
            i = oe + 1;
            continue;
          }
          const otCloserStart = findOnTransitionCloser(bodyRaw, oe + 1);
          if (otCloserStart < 0) return -1;
          if (bodyRaw.startsWith("</>", otCloserStart)) {
            i = otCloserStart + 3;
          } else {
            const gt = bodyRaw.indexOf(">", otCloserStart);
            i = gt >= 0 ? gt + 1 : bodyRaw.length;
          }
          continue;
        }
      }
      // PascalCase state-child opener `<X ...>`.
      const next = bodyRaw[i + 1];
      if (next && next >= "A" && next <= "Z") {
        const oe = findOpenerEnd(bodyRaw, i + 1);
        if (oe < 0) return -1;
        if (bodyRaw[oe - 1] !== "/") {
          scDepth++;
        }
        i = oe + 1;
        continue;
      }
      // Lowercase HTML opener. Track unless self-closing or void element.
      if (next && next >= "a" && next <= "z") {
        let j = i + 1;
        while (j < bodyRaw.length) {
          const c = bodyRaw[j]!;
          if ((c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "-") j++;
          else break;
        }
        const tagName = bodyRaw.slice(i + 1, j);
        const oe = findOpenerEnd(bodyRaw, i + 1);
        if (oe < 0) return -1;
        const isSelfClose = bodyRaw[oe - 1] === "/";
        if (!isSelfClose && !VOID_ELEMENTS_LC.has(tagName)) {
          lowerDepth++;
        }
        i = oe + 1;
        continue;
      }
    }
    i++;
  }
  return -1;
}

/**
 * Find the closing `>` for an opener that starts at index `open` in `s`.
 * Respects parentheses for `rule=(.A | .B)`, double-quoted attribute values,
 * AND `${...}` logic-context blocks (B17.2 — needed for `effect=${expr}` and
 * `<onTransition if=${expr}>` forms where the embedded expression may contain
 * `>` operators). Returns the index of `>` (one past the last attribute
 * character) or -1 if no closer was found.
 */
function findOpenerEnd(s: string, open: number): number {
  let i = open;
  let depth = 0;     // paren depth (rule=(.A | .B))
  let inQuote = "";  // " or ' or empty
  while (i < s.length) {
    const c = s[i]!;
    if (inQuote) {
      if (c === inQuote) inQuote = "";
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inQuote = c;
      i++;
      continue;
    }
    // B17.2 — `${...}` logic-context block. Consume balanced brace block
    // so `>` operators inside (e.g., `if=${@a > 0}`) don't terminate the
    // opener prematurely.
    if (c === "$" && s[i + 1] === "{") {
      let j = i + 2;
      let braceDepth = 1;
      while (j < s.length && braceDepth > 0) {
        const c2 = s[j];
        if (c2 === "{") braceDepth++;
        else if (c2 === "}") braceDepth--;
        j++;
      }
      i = j;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === ">" && depth === 0) return i;
    i++;
  }
  return -1;
}

/**
 * Find the matching closer for an opener tag whose name is `tag` starting
 * AT or AFTER index `from` in `rulesRaw`. Recognizes:
 *   - `</>`           — generic closer (most common)
 *   - `</Variant>`    — explicit closer
 *
 * Honors nesting: every nested opener `<` increments depth, every closer
 * decrements. Returns the index of the closer's `<` (start), or -1 if no
 * matching closer was found.
 *
 * Note: state-child bodies that contain LOGIC blocks (`${ ... }`) or
 * other markup with `<` are an edge case. This implementation skips any
 * `${...}` interpolation block bodily (one level of brace matching).
 */
function findStateChildCloser(rulesRaw: string, from: number, tag: string): number {
  let i = from;
  let depth = 1;
  // Wave 4 fix (changes/fix-nested-engine-body-parser-lowercase-html, 2026-05-11):
  // Track lowercase HTML opener depth SEPARATELY so lowercase closers
  // (`</button>`, `</div>`, etc.) and `</>` closers that match a lowercase
  // opener do NOT decrement the state-child depth counter. Pre-fix, an outer
  // composite state-child body like `<Playing>...<button>X</button>...<engine
  // for=Inner...>...</></>` was prematurely closed at `</button>` (depth: 1 -> 0)
  // because the `<button>` opener didn't bump depth but `</button>` decremented
  // it. The leftover content (the inner engine's state-children) was then
  // attributed to the OUTER engine by `parseEngineStateChildren`, firing
  // E-ENGINE-STATE-CHILD-INVALID-VARIANT + E-ENGINE-RULE-INVALID-VARIANT.
  // Symmetric fix applied in `findEngineCloser` + `findOnTransitionCloser`.
  let lowerDepth = 0;
  while (i < rulesRaw.length) {
    // Skip ${...} interpolation
    if (rulesRaw.startsWith("${", i)) {
      let j = i + 2;
      let braceDepth = 1;
      while (j < rulesRaw.length && braceDepth > 0) {
        if (rulesRaw[j] === "{") braceDepth++;
        else if (rulesRaw[j] === "}") braceDepth--;
        j++;
      }
      i = j;
      continue;
    }
    // A5-2 (§51.0.Q.1) — a nested `<engine ...>` opener inside a state-child
    // body has its own `</engine>` / `</>` closer pair AND its own state-
    // children. Skip past the entire engine block so its inner `</>` closers
    // (state-child closers + the engine's own) don't decrement the outer
    // state-child's depth counter.
    if (rulesRaw.startsWith("<engine", i)) {
      const ch = rulesRaw[i + 7];
      if (ch === undefined || ch === " " || ch === "\t" || ch === "\n" ||
          ch === ">" || ch === "/") {
        const oe = findOpenerEnd(rulesRaw, i + 1);
        if (oe < 0) return -1;
        if (rulesRaw[oe - 1] === "/") {
          // Self-closing engine — not legal but skip safely.
          i = oe + 1;
          continue;
        }
        const engineCloserStart = findEngineCloser(rulesRaw, oe + 1);
        if (engineCloserStart < 0) return -1;
        // Advance past the engine's closer.
        if (rulesRaw.startsWith("</>", engineCloserStart)) {
          i = engineCloserStart + 3;
        } else {
          const gt = rulesRaw.indexOf(">", engineCloserStart);
          i = gt >= 0 ? gt + 1 : rulesRaw.length;
        }
        continue;
      }
    }
    // B17.2 (§51.0.H) — a nested `<onTransition ...>` opener inside a
    // state-child body has its own `</onTransition>` / `</>` closer pair.
    // Without this skip, the `<onTransition>` body's `</>` closer would
    // prematurely decrement the outer state-child's depth counter (the
    // PascalCase check below skips lowercase-`o` openers entirely, so depth
    // never gets incremented for the opener — but the `</>` decrement still
    // fires, causing premature close). Skip past the entire <onTransition>
    // block.
    if (rulesRaw.startsWith("<onTransition", i)) {
      const ch = rulesRaw[i + 13];
      if (ch === undefined || ch === " " || ch === "\t" || ch === "\n" ||
          ch === ">" || ch === "/") {
        const oe = findOpenerEnd(rulesRaw, i + 1);
        if (oe < 0) return -1;
        if (rulesRaw[oe - 1] === "/") {
          // Self-closing — no body, skip past opener only.
          i = oe + 1;
          continue;
        }
        const otCloserStart = findOnTransitionCloser(rulesRaw, oe + 1);
        if (otCloserStart < 0) return -1;
        // Advance past the closer.
        if (rulesRaw.startsWith("</>", otCloserStart)) {
          i = otCloserStart + 3;
        } else {
          const gt = rulesRaw.indexOf(">", otCloserStart);
          i = gt >= 0 ? gt + 1 : rulesRaw.length;
        }
        continue;
      }
    }
    // Closer: `</>` (generic). Per scrml semantics `</>` closes the
    // most-recently-opened element. If there is a pending lowercase opener
    // (lowerDepth > 0), pop it first; the state-child counter is only
    // decremented when no lowercase opener is in flight.
    if (rulesRaw.startsWith("</>", i)) {
      if (lowerDepth > 0) {
        lowerDepth--;
        i += 3;
        continue;
      }
      depth--;
      if (depth === 0) return i;
      i += 3;
      continue;
    }
    // Closer: `</Variant>` (uppercase) OR `</tag>` (lowercase). Lowercase
    // closers pop the lowerDepth counter only — they MUST NOT decrement the
    // state-child depth (their corresponding opener never incremented it).
    if (rulesRaw.startsWith("</", i)) {
      const end = rulesRaw.indexOf(">", i);
      if (end < 0) return -1;
      const closerFirstChar = rulesRaw[i + 2];
      if (closerFirstChar && closerFirstChar >= "a" && closerFirstChar <= "z") {
        // Lowercase named closer (`</button>`, `</div>`, ...). Pop lowerDepth
        // if positive; otherwise ignore (stray closer, malformed body).
        if (lowerDepth > 0) lowerDepth--;
        i = end + 1;
        continue;
      }
      depth--;
      if (depth === 0) return i;
      i = end + 1;
      continue;
    }
    // Opener `<...`. PascalCase (uppercase first letter) bumps state-child
    // depth; lowercase HTML opener bumps lowerDepth. Void elements
    // (`<br>`, `<input>`, etc.) do NOT have closers — skip without bumping
    // lowerDepth.
    if (rulesRaw[i] === "<") {
      const next = rulesRaw[i + 1];
      if (next && next >= "A" && next <= "Z") {
        depth++;
        // Advance past the opener
        const openerEnd = findOpenerEnd(rulesRaw, i + 1);
        if (openerEnd < 0) return -1;
        // Self-closing? `<Tag/>`
        if (rulesRaw[openerEnd - 1] === "/") {
          depth--; // self-close cancels the increment
        }
        i = openerEnd + 1;
        continue;
      }
      if (next && next >= "a" && next <= "z") {
        // Lowercase HTML opener. Determine tag name to classify void status.
        let j = i + 1;
        while (j < rulesRaw.length) {
          const c = rulesRaw[j]!;
          if ((c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "-") j++;
          else break;
        }
        const tagName = rulesRaw.slice(i + 1, j);
        const openerEnd = findOpenerEnd(rulesRaw, i + 1);
        if (openerEnd < 0) return -1;
        const isSelfClose = rulesRaw[openerEnd - 1] === "/";
        if (!isSelfClose && !VOID_ELEMENTS_LC.has(tagName)) {
          lowerDepth++;
        }
        i = openerEnd + 1;
        continue;
      }
    }
    i++;
  }
  return -1;
}

/**
 * Parse engine `rulesRaw` body into a list of state-child entries.
 *
 * Returns an empty array if the body is empty or appears to be in the
 * legacy `<machine>` arrow-rule form (`.From => .To`).
 *
 * Robustness: malformed openers and missing closers DO NOT throw. They
 * skip the offending region and continue scanning. PASS 11 in
 * symbol-table.ts handles diagnostic emission based on the parsed entries.
 *
 * @param rulesRaw — the raw text inside `<engine>...</>`
 * @returns flat list of state-child entries in source order
 */
export function parseEngineStateChildren(rulesRaw: string): EngineStateChildEntry[] {
  const out: EngineStateChildEntry[] = [];
  if (typeof rulesRaw !== "string") return out;
  if (!rulesRaw.trim()) return out;

  // Legacy arrow-rule body — skip parsing; type-system handles those.
  if (isLegacyArrowRulesBody(rulesRaw)) return out;

  let i = 0;
  while (i < rulesRaw.length) {
    // Find next `<` followed by an uppercase letter (state-child opener).
    const lt = rulesRaw.indexOf("<", i);
    if (lt < 0) break;
    const next = rulesRaw[lt + 1];
    if (!next || next < "A" || next > "Z") {
      i = lt + 1;
      continue;
    }

    // Found a state-child opener candidate. Find its `>`.
    const openerEnd = findOpenerEnd(rulesRaw, lt + 1);
    if (openerEnd < 0) break;

    // Extract opener text WITHOUT the leading `<` and trailing `>`.
    const openerInner = rulesRaw.slice(lt + 1, openerEnd);

    // Strip leading whitespace; first identifier-run is the tag.
    const openerTrimmed = openerInner.replace(/^\s+/, "");
    const tagMatch = openerTrimmed.match(/^([A-Z][A-Za-z0-9_]*)/);
    if (!tagMatch) {
      i = openerEnd + 1;
      continue;
    }
    const tag = tagMatch[1]!;
    const afterTag = openerTrimmed.slice(tag.length);

    // Self-closing? `<Variant/>` — accept and treat as empty body.
    const isSelfClose = openerInner.trimEnd().endsWith("/");

    // §51.0.O (A5-2 sub-step 4) — extract `internal:rule=` BEFORE canonical
    // `rule=` to avoid the `rule=` regex's lookahead swallowing the prefix.
    // Strip-and-rerun pattern: capture the prefix, then remove the matched
    // substring from a working copy of `afterTag` before running the
    // canonical rule= regex.
    //
    // S97 — lookahead extended to recognize BOOLEAN attribute boundaries.
    // Pre-fix lookahead `(?=\s+\w+\s*=|\s*\/?\s*$)` only stopped at
    // `attr=value` or tag close; trailing boolean attrs (`history`,
    // `pinned`, etc.) got swallowed into the rule value. New lookahead
    // also stops at `\s+\w+(?=\s|>|\/|$)` — whitespace + word followed by
    // whitespace / `>` / `/` / end (the boolean-attr terminator shape).
    // Per §51.0.F rule values are limited to `.X`, `*`, or `(...)`; they
    // never contain a bare word at depth 0, so the new boundary check
    // doesn't false-trigger on valid values.
    let internalRuleForm: EngineRuleForm = { kind: "absent" };
    let afterTagForRule = afterTag;
    const internalRuleMatch = afterTag.match(
      /(?:^|\s)internal:rule\s*=\s*(.+?)(?=\s+\w+(?:\s*=|\s|>|\/|$)|\s*\/?\s*$)/s,
    );
    if (internalRuleMatch) {
      let val = internalRuleMatch[1]!.trim();
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1).trim();
      }
      if (val.endsWith("/")) val = val.slice(0, -1).trim();
      internalRuleForm = parseRuleAttrValue(val);
      // Remove the matched substring from the working afterTag so the
      // canonical `rule=` regex doesn't accidentally re-match the prefix.
      const matchStart = internalRuleMatch.index ?? afterTag.indexOf(internalRuleMatch[0]);
      afterTagForRule = afterTag.slice(0, matchStart) + " " + afterTag.slice(matchStart + internalRuleMatch[0].length);
    }

    // Extract `rule=` attribute value if present. Pattern accepts:
    //   rule=.X
    //   rule=(.A | .B)
    //   rule=*
    //   rule="event -> Variant"   (legacy form — flagged later)
    //   rule="(.A | .B)"          (quoted multi)
    //   rule=.X.history           (§51.0.N — A5-2 sub-step 5)
    let ruleForm: EngineRuleForm = { kind: "absent" };
    // S97 — boolean-attr boundary added to lookahead. See identical comment on
    // the `internal:rule=` regex above.
    const ruleMatch = afterTagForRule.match(/(?:^|\s)rule\s*=\s*(.+?)(?=\s+\w+(?:\s*=|\s|>|\/|$)|\s*\/?\s*$)/s);
    if (ruleMatch) {
      let val = ruleMatch[1]!.trim();
      // Strip surrounding quotes if present.
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1).trim();
      }
      // If trailing `/` got captured (self-close), strip it.
      if (val.endsWith("/")) val = val.slice(0, -1).trim();
      ruleForm = parseRuleAttrValue(val);
    }

    // §51.0.H (B17.2) — `effect=${...}` attribute on the state-child opener.
    //
    // Per SPEC line 20543: `<Small rule=.Big effect=${ playSound("grow") }>`.
    // The expression body is the substring between `${` and the matching `}`
    // per the standard logic-context delimiter rules. Captures the inner
    // expression text verbatim (no `${` `}` wrapper) into `effectRaw`.
    //
    // Robustness (per SURVEY decision 3): malformed `effect=` (unbalanced
    // braces, missing `${`) → `effectRaw: null`; B17.3 typer can surface a
    // diagnostic. Balanced-brace scan: find `effect=`, skip to `${`, then
    // walk to matching `}`.
    let effectRaw: string | null = null;
    const effectIdx = afterTagForRule.search(/(?:^|\s)effect\s*=\s*\$\{/);
    if (effectIdx >= 0) {
      // Locate the `${` after `effect=`.
      const dollarBrace = afterTagForRule.indexOf("${", effectIdx);
      if (dollarBrace >= 0) {
        let j = dollarBrace + 2;
        let braceDepth = 1;
        while (j < afterTagForRule.length && braceDepth > 0) {
          const ch = afterTagForRule[j];
          if (ch === "{") braceDepth++;
          else if (ch === "}") braceDepth--;
          if (braceDepth === 0) break;
          j++;
        }
        if (braceDepth === 0) {
          // `effectRaw` is the substring between `${` and the matching `}`.
          effectRaw = afterTagForRule.slice(dollarBrace + 2, j);
        }
        // If braces never balanced (j ran off the end), `effectRaw` stays
        // null per SURVEY decision 3.
      }
    }

    // §51.0.N (A5-2 sub-step 3) — `history` bare attribute.
    //
    // The regex MUST require `history` to be a STANDALONE token preceded by
    // whitespace and followed by whitespace / `>` / `/` / end-of-string —
    // NOT preceded by `.`. The naive `\bhistory\b(?!\s*=)` form fires
    // incorrectly inside `rule=.Variant.history` (a SPEC §51.0.N target form
    // where `history` is a structured-target suffix, NOT a bareword
    // attribute). Word boundary `\b` treats `.` as a boundary, so the naive
    // form mis-classifies `<Paused rule=.Playing.history>` as carrying the
    // `history` bare attribute. (Bug found S70 post-A5-3-SHIP via kitchen-
    // sink probe; canonical SPEC §51.0.N example was the trigger.)
    const historyAttr = /(?:^|\s)history(?=\s|>|\/|$)/.test(afterTag);

    // Locate body end.
    let bodyStart = openerEnd + 1;
    let bodyEnd: number;
    let nextI: number;
    let isColonShorthand = false;
    if (isSelfClose) {
      bodyEnd = bodyStart;
      nextI = bodyStart;
    } else {
      // `:`-shorthand body? After `>`, optional whitespace, then `:`.
      // Body extends until newline (the canonical `:`-form is
      // single-expression, terminated by a newline per SPEC §4.14 / §51.0.I).
      const afterOpener = rulesRaw.slice(bodyStart);
      const colonShortcutMatch = afterOpener.match(/^\s*:\s*([^\n]*)/);
      if (colonShortcutMatch) {
        const colonStart = bodyStart + colonShortcutMatch[0].indexOf(":");
        const lineEnd = bodyStart + colonShortcutMatch[0].length;
        bodyEnd = lineEnd;
        nextI = lineEnd;
        // For `:`-shorthand, the body is the post-`:` text.
        // (We don't currently need it for B15 validation but record it.)
        bodyStart = colonStart + 1;
        isColonShorthand = true;
      } else {
        // Find matching closer for this state-child.
        const closerStart = findStateChildCloser(rulesRaw, bodyStart, tag);
        if (closerStart < 0) {
          // Malformed — skip this opener and continue scanning.
          i = openerEnd + 1;
          continue;
        }
        bodyEnd = closerStart;
        // Advance past the closer (skip `</>` or `</Variant>`).
        if (rulesRaw.startsWith("</>", closerStart)) {
          nextI = closerStart + 3;
        } else {
          const closerEnd = rulesRaw.indexOf(">", closerStart);
          nextI = closerEnd >= 0 ? closerEnd + 1 : rulesRaw.length;
        }
      }
    }

    const bodyRaw = rulesRaw.slice(bodyStart, bodyEnd);

    // §51.0.Q.1 (A5-2 sub-step 7) — scan body for nested <engine> declarations
    // FIRST (so their body regions can be excluded from the <onTimeout> +
    // <onTransition> scans). Skipped entirely for `:`-shorthand and
    // self-closing forms, where bodyRaw is single-expression / empty
    // respectively.
    const innerEngines = (isColonShorthand || isSelfClose)
      ? []
      : scanForNestedEngineEntries(bodyRaw);

    // §51.0.H (B17.2) — scan body for <onTransition> siblings BEFORE
    // <onTimeout>, so <onTransition> body regions can be added to the
    // <onTimeout> skipRegions (preventing double-counting when <onTimeout>
    // appears inside <onTransition> body — composition concern mirrored from
    // A5-2 nested-engine handling).
    //
    // Pass nested-engine regions as skipRegions to <onTransition> scan also,
    // so a nested-engine's <onTransition> children aren't mis-attributed to
    // the outer state-child.
    const nestedEngineRegions: Array<readonly [number, number]> = innerEngines.map(
      (e) => [e.rawOffset, e.rawOffset + e.rawText.length] as const,
    );
    const onTransitionElements = (isColonShorthand || isSelfClose)
      ? []
      : scanForOnTransitionEntries(bodyRaw, nestedEngineRegions);

    // §51.0.M (A5-2 sub-step 6) — scan body for <onTimeout/> siblings.
    // Pass nested-engine + <onTransition> body regions as skip-regions to
    // avoid mis-attributing an inner engine's <onTimeout> to the outer
    // state-child (Phase 0 SURVEY §2 edge-case) AND to avoid double-counting
    // a <onTimeout> nested inside an <onTransition> body (B17.2 SURVEY
    // decision sub-3b).
    const onTransitionRegions: Array<readonly [number, number]> = onTransitionElements.map(
      (e) => {
        // Approximate region end: scan from rawOffset past opener + bodyRaw +
        // closer. For the skipRegions API a generous over-estimate is fine —
        // we just need to cover the opener+body+closer span so an inner
        // <onTimeout> isn't picked up.
        const openerStart = e.rawOffset;
        // Find the opener end (first `>` after `<onTransition`).
        const openerEnd = bodyRaw.indexOf(">", openerStart);
        if (openerEnd < 0) {
          // Malformed — skip just the opener prefix.
          return [openerStart, openerStart + 14] as const;
        }
        // For self-closing, body is empty and closer is the opener's `/>`.
        const isSelfClosingHere = bodyRaw[openerEnd - 1] === "/";
        if (isSelfClosingHere) {
          return [openerStart, openerEnd + 1] as const;
        }
        // For `:`-shorthand, region is opener + line.
        if (e.isColonShorthand) {
          // bodyRaw starts after `:`; line ends at next newline.
          const nl = bodyRaw.indexOf("\n", openerEnd + 1);
          const end = nl >= 0 ? nl : bodyRaw.length;
          return [openerStart, end] as const;
        }
        // For bare body, region covers opener + body + closer. Body length
        // is e.bodyRaw.length; add closer (assume `</>` = 3 chars or
        // `</onTransition>` = 16 chars — use a conservative 16-char estimate).
        const bodyEnd = openerEnd + 1 + e.bodyRaw.length;
        return [openerStart, bodyEnd + 16] as const;
      },
    );
    const skipRegions: Array<readonly [number, number]> = [
      ...nestedEngineRegions,
      ...onTransitionRegions,
    ];
    const onTimeoutElements = (isColonShorthand || isSelfClose)
      ? []
      : scanForOnTimeoutEntries(bodyRaw, skipRegions);

    out.push({
      tag,
      rule: ruleForm,
      bodyRaw,
      isColonShorthand,
      rawOffset: lt,
      // ---- A5-2 NEW (§51.0.M-Q) ----
      historyAttr,
      internalRule: internalRuleForm,
      onTimeoutElements,
      innerEngines,
      // ---- B17.2 NEW (§51.0.H) ----
      effectRaw,
      onTransitionElements,
    });
    i = nextI;
  }

  return out;
}
