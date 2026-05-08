/* SPDX-License-Identifier: MIT
 * Phase A1b Step B15 — Engine state-child structural parser.
 * Phase A7 Step A5-2 (S70) — extended for §51.0.M-Q ratified extensions:
 *   - `<onTimeout>` body-scan, nested `<engine>` body-scan,
 *   - `history` bare attribute on state-child openers,
 *   - `internal:rule=` prefix on state-child openers,
 *   - `.Variant.history` target form in `rule=` / `internal:rule=`.
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
 *     `onTimeoutElements` / `innerEngines` for diagnostics.
 *   - Parse `effect=`, `<onTransition>` — those belong to B17.
 *   - Substitute for the type-system's enum-variant validation (it merely
 *     extracts the tag string; validation against the type's variants
 *     happens in PASS 11).
 */

import type {
  EngineRuleForm,
  EngineStateChildEntry,
  OnTimeoutEntry,
  NestedEngineEntry,
} from "./symbol-table";

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
    // Closer: `</>` (generic) — pops scDepth first; closes engine when scDepth=0.
    if (bodyRaw.startsWith("</>", i)) {
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
    // Closer: `</engine>` (explicit engine closer) or `</Variant>` (named
    // state-child closer).
    if (bodyRaw.startsWith("</", i)) {
      const end = bodyRaw.indexOf(">", i);
      if (end < 0) return -1;
      const closerName = bodyRaw.slice(i + 2, end).trim();
      if (closerName === "engine") {
        engineDepth--;
        if (engineDepth === 0) return i;
      } else if (closerName.length > 0) {
        // Named state-child closer (e.g., `</X>`). Pops scDepth.
        if (scDepth > 0) scDepth--;
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
    }
    i++;
  }
  return -1;
}

/**
 * Find the closing `>` for an opener that starts at index `open` in `s`.
 * Respects parentheses for `rule=(.A | .B)` and double-quoted attribute
 * values. Returns the index of `>` (one past the last attribute character)
 * or -1 if no closer was found.
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
    // Closer: `</>`
    if (rulesRaw.startsWith("</>", i)) {
      depth--;
      if (depth === 0) return i;
      i += 3;
      continue;
    }
    // Closer: `</Variant>`
    if (rulesRaw.startsWith("</", i)) {
      const end = rulesRaw.indexOf(">", i);
      if (end < 0) return -1;
      depth--;
      if (depth === 0) return i;
      i = end + 1;
      continue;
    }
    // Nested opener `<Tag` — increment depth (only for Pascal-cased tags;
    // HTML/lowercase tags don't matter for our state-child counting).
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
    let internalRuleForm: EngineRuleForm = { kind: "absent" };
    let afterTagForRule = afterTag;
    const internalRuleMatch = afterTag.match(
      /(?:^|\s)internal:rule\s*=\s*(.+?)(?=\s+\w+\s*=|\s*\/?\s*$)/s,
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
    const ruleMatch = afterTagForRule.match(/(?:^|\s)rule\s*=\s*(.+?)(?=\s+\w+\s*=|\s*\/?\s*$)/s);
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

    // §51.0.N (A5-2 sub-step 3) — `history` bare attribute. Negative-
    // lookahead avoids false-match on a hypothetical `history=...` attribute.
    const historyAttr = /\bhistory\b(?!\s*=)/.test(afterTag);

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
    // FIRST (so their body regions can be excluded from the <onTimeout> scan).
    // Skipped entirely for `:`-shorthand and self-closing forms, where bodyRaw
    // is single-expression / empty respectively.
    const innerEngines = (isColonShorthand || isSelfClose)
      ? []
      : scanForNestedEngineEntries(bodyRaw);

    // §51.0.M (A5-2 sub-step 6) — scan body for <onTimeout/> siblings.
    // Pass nested-engine body regions as skip-regions to avoid mis-attributing
    // an inner engine's <onTimeout> to the outer state-child (Phase 0 SURVEY
    // §2 edge-case).
    const skipRegions: Array<readonly [number, number]> = innerEngines.map(
      (e) => [e.rawOffset, e.rawOffset + e.rawText.length] as const,
    );
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
    });
    i = nextI;
  }

  return out;
}
