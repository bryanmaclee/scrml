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
  PayloadBinding,
  MessageArmEntry,
} from "./symbol-table";

// url-comment-match-engine (2026-07-09) — reuse the block-splitter's URL
// detector so a URL in a state-child's PROSE body (`<Idle rule=.X> <p>Docs at
// https://x</p> </>`) is NOT eaten as a `//` line comment by
// `skipCommentOrString` below. ONE source of truth (SPEC §27-preserving: only a
// genuine URL is exempted; a real `// comment` still strips). See the
// `urlSlashesAt` doc-comment in block-splitter.js for the exemption criteria.
import { urlSlashesAt } from "./block-splitter.js";

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
 * B1 (§51.0.B.1, S98 amendment) — reserved engine state-child attribute
 * names. These take PRECEDENCE over payload-binding interpretation per the
 * amendment's reserved-name precedence rule:
 *
 *   "The reserved state-child attribute names — `rule`, `effect`, `history`,
 *    `internal:rule` — take precedence over payload-binding interpretation
 *    in the bare-attribute form."  (SPEC §51.0.B.1)
 *
 * Mirror of `ENGINE_STATE_CHILD_RESERVED_ATTRS` in `codegen/emit-variant-guard.ts`
 * (kept in sync — both consult the same SPEC §51.0.B/F/H/N/O reserved set).
 */
const RESERVED_STATE_CHILD_ATTRS = new Set<string>([
  "rule",
  "effect",
  "history",
  "internal:rule",
]);

/**
 * B1 (§51.0.B.1, S98 amendment) — extract payload bindings from a state-
 * child opener's attribute substring.
 *
 * `afterTag` is the opener inner-text following the variant tag (everything
 * between `<Tag` and the closing `>`, excluding self-close `/`). Example:
 *
 *   For `<Done rows rule=.Idle>`:    afterTag = " rows rule=.Idle"
 *   For `<Done(rows) rule=.Idle>`:   afterTag = "(rows) rule=.Idle"
 *   For `<Done rows=r rule=.Idle>`:  afterTag = " rows=r rule=.Idle"
 *   For `<OpenAt depth opener span rule=...>`: afterTag = " depth opener span rule=..."
 *
 * Distinguishes the three SPEC §51.0.B.1 source forms:
 *
 *   1. Bare-attribute form (positional)  — bareword tokens after the tag,
 *      separated by whitespace, NOT in the reserved set, NOT followed by
 *      `=`. Each produces `{kind:"positional", name:<bareword>}`.
 *
 *   2. Parenthesized form (positional)   — `(name1, name2, ...)` at the
 *      start of `afterTag`. Each comma-separated identifier produces
 *      `{kind:"positional", name:<ident>}`. Named-form inside parens
 *      (`(field: local)`) is ALSO accepted — emits
 *      `{kind:"named", field, name}`.
 *
 *   3. Named form (named-by-field-name)  — `field=local` attribute pair
 *      where `field` is NOT in the reserved set AND the value is a
 *      single bareword identifier. Produces
 *      `{kind:"named", field, name}`.
 *
 * Reserved attrs (`rule`, `effect`, `history`, `internal:rule`) and
 * `rule=`/`internal:rule=`/`effect=` attribute pairs are SKIPPED (they are
 * not bindings per §51.0.B.1 reserved-name precedence).
 *
 * Mixed-form prohibition (§18.7 inheritance via §51.0.B.1): if the result
 * contains BOTH a `positional` AND a `named` entry, the caller (PASS 11)
 * fires `E-ENGINE-PAYLOAD-ARITY-MISMATCH`. The parser does not reject
 * mixed forms itself — it returns them all and lets PASS 11 emit the
 * diagnostic.
 *
 * Returns the bindings in source order. Returns `[]` when no bindings are
 * present.
 */
export function parsePayloadBindings(afterTag: string): PayloadBinding[] {
  const out: PayloadBinding[] = [];
  if (typeof afterTag !== "string" || !afterTag) return out;

  // Working copy — strip self-close trailing `/` if present so it doesn't
  // bleed into the last bareword.
  let work = afterTag;
  if (work.endsWith("/")) work = work.slice(0, -1);

  // -----------------------------------------------------------------------
  // Step 1 — Handle parenthesized form `(name1, name2, ...)` at start.
  // §51.0.B.1: parenthesized form is positional by default; named-inside-
  // parens (`(field: local)`) is accepted with named semantics.
  // -----------------------------------------------------------------------
  const trimmedLeading = work.replace(/^\s+/, "");
  if (trimmedLeading.startsWith("(")) {
    // Find matching close-paren (paren-depth 0 means done).
    let depth = 1;
    let j = 1;
    while (j < trimmedLeading.length && depth > 0) {
      const ch = trimmedLeading[j];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (depth === 0) break;
      j++;
    }
    if (depth === 0) {
      const inner = trimmedLeading.slice(1, j).trim();
      // Split on commas (no nested parens in field lists per §14.4).
      const parts = inner.length === 0 ? [] : inner.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
      for (const p of parts) {
        // Named-inside-parens: `field: local` (with colon).
        const colonIdx = p.indexOf(":");
        if (colonIdx >= 0) {
          const field = p.slice(0, colonIdx).trim();
          const name = p.slice(colonIdx + 1).trim();
          if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(field) &&
              /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
            out.push({ kind: "named", field, name });
          }
        } else {
          // Positional: bare identifier.
          if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(p)) {
            out.push({ kind: "positional", name: p });
          }
        }
      }
      // Skip the `(...)` chunk for the bareword scan below.
      const skipped = trimmedLeading.length - j - 1;
      work = trimmedLeading.slice(j + 1);
      // Compensate for leading-whitespace strip — we want to continue
      // scanning AFTER the `(...)`, not from the original `afterTag`.
      void skipped;
    }
  }

  // -----------------------------------------------------------------------
  // Step 2 — Tokenize remaining attribute substring into name / value pairs.
  // For each non-reserved bareword (no `=`), record as positional binding.
  // For each non-reserved `name=local` where `local` is a bare identifier,
  // record as named binding.
  // -----------------------------------------------------------------------
  let i = 0;
  while (i < work.length) {
    // Skip whitespace.
    while (i < work.length && /\s/.test(work[i]!)) i++;
    if (i >= work.length) break;

    // Read attribute name.
    const nameStart = i;
    while (i < work.length) {
      const c = work[i]!;
      // Attribute names may include `:` (e.g., `internal:rule`).
      if (/[A-Za-z0-9_:$\-]/.test(c)) i++;
      else break;
    }
    const attrName = work.slice(nameStart, i);
    if (!attrName) {
      // Unexpected character — advance and retry.
      i++;
      continue;
    }

    // Check for `=` following the name.
    let hasEquals = false;
    let valueText = "";
    {
      let k = i;
      while (k < work.length && /\s/.test(work[k]!)) k++;
      if (k < work.length && work[k] === "=") {
        hasEquals = true;
        k++;
        while (k < work.length && /\s/.test(work[k]!)) k++;
        // Read value — accept:
        //   - quoted strings "..." / '...'
        //   - logic-context ${...}
        //   - parenthesized rule values (.A | .B)
        //   - dotted identifier paths (.X.history)
        //   - bare identifiers
        if (k < work.length) {
          const c = work[k]!;
          if (c === '"' || c === "'") {
            const quote = c;
            k++;
            const start = k;
            while (k < work.length && work[k] !== quote) {
              if (work[k] === "\\") k += 2;
              else k++;
            }
            valueText = work.slice(start, k);
            if (k < work.length) k++; // consume closing quote
          } else if (c === "$" && work[k + 1] === "{") {
            // ${...} — match balanced braces.
            k += 2;
            let depth = 1;
            const start = k;
            while (k < work.length && depth > 0) {
              if (work[k] === "{") depth++;
              else if (work[k] === "}") depth--;
              if (depth === 0) break;
              k++;
            }
            valueText = work.slice(start, k);
            if (k < work.length) k++; // consume `}`
          } else if (c === "(") {
            // Parenthesized — match balanced parens.
            let depth = 1;
            k++;
            const start = k;
            while (k < work.length && depth > 0) {
              if (work[k] === "(") depth++;
              else if (work[k] === ")") depth--;
              if (depth === 0) break;
              k++;
            }
            valueText = work.slice(start, k);
            if (k < work.length) k++; // consume `)`
          } else {
            // Bareword/dotted value — read until whitespace, `>`, `/`.
            const start = k;
            while (k < work.length) {
              const ch = work[k]!;
              if (/\s/.test(ch) || ch === ">" || ch === "/") break;
              k++;
            }
            valueText = work.slice(start, k);
          }
        }
        i = k;
      }
    }

    // Skip reserved attribute names entirely (whether bareword or with `=`).
    if (RESERVED_STATE_CHILD_ATTRS.has(attrName)) {
      continue;
    }

    if (!hasEquals) {
      // Bareword attribute — positional payload binding.
      // Validate identifier shape (must be a valid local name).
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(attrName)) {
        out.push({ kind: "positional", name: attrName });
      }
      continue;
    }

    // `name=value` form. For a NAMED payload binding, value MUST be a bare
    // identifier (the local name introduced into scope). Anything else
    // (string literal, `${expr}`, dotted path, paren-list) is NOT a binding.
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(valueText)) {
      out.push({ kind: "named", field: attrName, name: valueText });
    }
    // Else: non-binding attribute (e.g., `class="foo"`, custom user attr).
    // Ignored — not part of the payload-binding surface.
  }

  return out;
}

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

  // S98 (anomaly-1 fix) — precompute comment + string regions so regex
  // matches falling INSIDE a comment / string don't fire as real openers.
  const commentRegions = computeCommentRegions(bodyRaw);
  const inCommentRegion = (idx: number): boolean => {
    for (const [start, end] of commentRegions) {
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
    if (inCommentRegion(startIdx)) continue;

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

  // S98 (anomaly-1 fix) — comment + string region mask.
  const commentRegions = computeCommentRegions(rulesRaw);
  const inCommentRegion = (idx: number): boolean => {
    for (const [start, end] of commentRegions) {
      if (idx >= start && idx < end) return true;
    }
    return false;
  };

  const re = /<onIdle\b([^>]*?)\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rulesRaw)) !== null) {
    const startIdx = m.index;
    if (inCommentRegion(startIdx)) continue;
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
    // S98 (anomaly-1 fix) — comment / string skip. A `<engine>` inside a
    // comment or string literal MUST NOT be parsed as a nested-engine opener.
    {
      const skipped = skipCommentOrString(bodyRaw, i);
      if (skipped !== i) { i = skipped; continue; }
    }
    const lt = bodyRaw.indexOf("<engine", i);
    if (lt < 0) break;
    // Re-scan i..lt for skippable regions that might engulf the candidate.
    let scanned = i;
    let hitSkippable = false;
    while (scanned < lt) {
      const sk = skipCommentOrString(bodyRaw, scanned);
      if (sk !== scanned) {
        if (sk > lt) { i = sk; hitSkippable = true; break; }
        scanned = sk;
      } else {
        scanned++;
      }
    }
    if (hitSkippable) continue;
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
    // S98 (anomaly-1 fix) — comment / string skip. A `<onTransition>` inside
    // a comment or string literal MUST NOT be parsed as a real opener.
    {
      const skipped = skipCommentOrString(bodyRaw, i);
      if (skipped !== i) { i = skipped; continue; }
    }
    const lt = bodyRaw.indexOf("<onTransition", i);
    if (lt < 0) break;
    // Re-scan i..lt for skippable regions that might engulf the candidate.
    let scanned = i;
    let hitSkippable = false;
    while (scanned < lt) {
      const sk = skipCommentOrString(bodyRaw, scanned);
      if (sk !== scanned) {
        if (sk > lt) { i = sk; hitSkippable = true; break; }
        scanned = sk;
      } else {
        scanned++;
      }
    }
    if (hitSkippable) continue;
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
    // S98 (anomaly-1 fix) — comment / string skip. See skipCommentOrString.
    {
      const skipped = skipCommentOrString(bodyRaw, i);
      if (skipped !== i) { i = skipped; continue; }
    }
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
        // §4.14 `:`-shorthand openers are self-terminating (no closer) — do
        // NOT push them onto lowerDepth, exactly like void / self-closing.
        const isColonShorthand = isColonShorthandOpener(bodyRaw, j, openerEnd);
        if (!isSelfClose && !isColonShorthand && !VOID_ELEMENTS_LC.has(tagName)) {
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
    // S98 (anomaly-1 fix) — comment / string skip. See skipCommentOrString.
    {
      const skipped = skipCommentOrString(bodyRaw, i);
      if (skipped !== i) { i = skipped; continue; }
    }
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
        // Scan past the tag name so `isColonShorthandOpener` inspects only the
        // attribute region (mirrors the lowercase branch below).
        let jj = i + 1;
        while (jj < bodyRaw.length) {
          const c = bodyRaw[jj]!;
          if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") ||
              (c >= "0" && c <= "9") || c === "-") jj++;
          else break;
        }
        const oe = findOpenerEnd(bodyRaw, i + 1);
        if (oe < 0) return -1;
        const isSelfClose = bodyRaw[oe - 1] === "/";
        // §4.14 `:`-shorthand openers are self-terminating (no closer) — an
        // uppercase state-child written as `<P rule=.Q : "p">` must NOT bump
        // scDepth, exactly like the lowercase branch below (and self-close).
        // Without this guard, a `:`-shorthand inner-engine state-child pushed a
        // depth that never popped, corrupting the inner-engine boundary so
        // findEngineCloser overran the real closer and the inner children were
        // flattened up into the OUTER engine (→ false E-ENGINE-STATE-CHILD-*).
        const isColonShorthand = isColonShorthandOpener(bodyRaw, jj, oe);
        if (!isSelfClose && !isColonShorthand) {
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
        // §4.14 `:`-shorthand openers are self-terminating (no closer) — do
        // NOT push them onto lowerDepth, exactly like void / self-closing.
        const isColonShorthand = isColonShorthandOpener(bodyRaw, j, oe);
        if (!isSelfClose && !isColonShorthand && !VOID_ELEMENTS_LC.has(tagName)) {
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
 * S98 (anomaly-1 fix) — comment/string skip helper.
 *
 * Engine `rulesRaw` body text is preserved VERBATIM by the AST builder (it
 * concatenates `child.raw` from each block-splitter child, INCLUDING `comment`
 * children — see ast-builder.js around line 9886). That means line comments,
 * block comments, and string literals end up in the text we hand to the
 * scanners below. Without this helper, a stray `${`, `<X`, `<engine`, or `</>`
 * inside a comment / string is mis-recognized as live syntax — derailing
 * depth tracking and (in the original repro) firing
 * `E-ENGINE-STATE-CHILD-MISSING` because the scanner walked clear past the
 * real `</>` closer in pursuit of a `}` that lived only in comment prose.
 *
 * Returns the index ONE PAST the end of the comment / string region starting
 * at `i`. Returns `i` (unchanged) when `i` is not the start of any such
 * region — callers should compare for inequality to decide whether to
 * `continue` the outer loop.
 *
 * Recognized regions:
 *   - `// ... \n`            line comment (consumes through the newline)
 *   - `/* ... *\/`           block comment (consumes through the closer)
 *   - `"..."` / `'...'`      string literals (honors `\` escape)
 *   - `` `...` ``            backtick template literal (honors `\` escape;
 *                            interior `${...}` is consumed as part of the
 *                            literal since the closing backtick is the real
 *                            terminator and we don't want a stray `${` to
 *                            kick scanning back into "live syntax" mode)
 *
 * Unterminated regions consume to EOF — matches BS-level best-effort
 * recovery for unclosed `//` / `<!-- -->` (block-splitter.js lines 701-704).
 */
function skipCommentOrString(s: string, i: number): number {
  if (i >= s.length) return i;
  const c = s[i];
  const c2 = s[i + 1];

  // Line comment: `// ... \n`
  if (c === "/" && c2 === "/") {
    // url-comment-match-engine (2026-07-09): a `//` that is part of a URL VALUE
    // in a state-child's prose body (`<Idle rule=.X> <p>Docs at https://x</p>
    // </>`) is DATA, not a comment. Eating it to end-of-line would swallow the
    // state-child's `</p>` / `</>` closer and derail the body-scan's nesting →
    // a spurious E-ENGINE-STATE-CHILD-MISSING (the scanner walks past the real
    // closer). Return `i` unchanged so the caller treats it as ordinary prose.
    // (SPEC §27 preserved — a genuine `// comment`, with whitespace/line-start
    // before the `//`, is NOT a URL and still strips.)
    if (urlSlashesAt(s, i)) return i;
    let j = i + 2;
    while (j < s.length && s[j] !== "\n") j++;
    if (j < s.length) j++; // consume the newline
    return j;
  }

  // Block comment: `/* ... */`
  if (c === "/" && c2 === "*") {
    let j = i + 2;
    while (j < s.length) {
      if (s[j] === "*" && s[j + 1] === "/") {
        return j + 2;
      }
      j++;
    }
    return s.length; // unterminated — consume to EOF
  }

  // HTML markup comment: `<!-- ... -->` (§27.2 — the markup-context native
  // comment). The whole span MUST be opaque: an odd quote / apostrophe /
  // backtick OR a `</Variant>` / `<tag>` mention inside a comment must not open
  // a phantom string or be read as a structural opener/closer by the walker.
  // Before this branch the walker fell through `<` and then tripped on a
  // comment-interior quote, opening a phantom string that swallowed the
  // subsequent state-children → a spurious E-ENGINE-STATE-CHILD-MISSING
  // (g-blocksplitter-comment-span-not-opaque, ss4 item 2). Pairs with
  // `skipHtmlComment` in block-splitter.js; `computeCommentRegions` records the
  // returned span as a comment region automatically.
  if (c === "<" && c2 === "!" && s[i + 2] === "-" && s[i + 3] === "-") {
    let j = i + 4;
    while (j < s.length) {
      if (s[j] === "-" && s[j + 1] === "-" && s[j + 2] === ">") {
        return j + 3;
      }
      j++;
    }
    return s.length; // unterminated — consume to EOF
  }

  // String literals (single / double quote) — honor backslash escape.
  if (c === '"' || c === "'") {
    const quote = c;
    let j = i + 1;
    while (j < s.length) {
      const ch = s[j];
      if (ch === "\\") {
        j += 2; // skip escaped char
        continue;
      }
      if (ch === quote) return j + 1;
      j++;
    }
    return s.length; // unterminated
  }

  // Backtick template literal — consume the whole literal, including any
  // interior `${...}` (the closing backtick is the real terminator). We
  // honor backslash escape on regular chars but NOT brace-depth: the
  // template-literal grammar already guarantees balanced braces inside
  // interpolations, and any imbalance is the user's problem (and would
  // have surfaced at TAB tokenization, not here).
  if (c === "`") {
    let j = i + 1;
    while (j < s.length) {
      const ch = s[j];
      if (ch === "\\") {
        j += 2;
        continue;
      }
      if (ch === "`") return j + 1;
      j++;
    }
    return s.length; // unterminated
  }

  return i;
}

/**
 * S98 (anomaly-1 fix) — precompute the set of comment + string-literal
 * regions in a body text. Returns `[start, end)` half-open intervals sorted
 * by start. Used by the regex-based scanners (`scanForOnTimeoutEntries`,
 * `scanForOnIdleEntries`) to filter out matches that fall inside a comment
 * or string. The walker-based scanners (`findStateChildCloser`, etc.) call
 * `skipCommentOrString` per-iteration instead.
 *
 * Pairs symmetrically with `skipCommentOrString` — both must classify the
 * same character ranges as "skippable", or the two filter paths could
 * disagree on a borderline character.
 */
function computeCommentRegions(s: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let i = 0;
  while (i < s.length) {
    const skipped = skipCommentOrString(s, i);
    if (skipped !== i) {
      out.push([i, skipped]);
      i = skipped;
    } else {
      i++;
    }
  }
  return out;
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
  let depth = 0;       // paren depth (rule=(.A | .B))
  let angleDepth = 0;  // S160 — nested markup-as-value depth inside an inside-opener `:`-body
  let inQuote = "";    // " or ' or empty
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
    // S160 (S154 ruling (b)) — angleDepth (§4.14 line 984). A normal opener
    // carries no `<` (attribute `<` only appears inside `${...}` / strings,
    // already consumed above), so angleDepth stays 0 and the first top-level
    // `>` terminates the opener unchanged. An INSIDE-opener `:`-shorthand body
    // with a nested markup-as-value (`<Idle : <button>Load</button>>`) opens a
    // nested `<` (angleDepth>0); the nested element's own `>` decrements rather
    // than terminating the opener, so the opener `>` is the FINAL balanced one.
    else if (c === "<") angleDepth++;
    else if (c === ">" && depth === 0) {
      if (angleDepth > 0) { angleDepth--; }
      else return i;
    }
    i++;
  }
  return -1;
}

/**
 * §4.14 `:`-shorthand opener detection (closer-finder support).
 *
 * A §4.14 `:`-shorthand child element (`<span : @label>`, `<li : @.name>`)
 * is a NON-void lowercase opener that has NO closer — its single-expression
 * body runs from the post-attribute `:` body-introducer through to the `>`
 * that terminates the opener (§4.14 line 979), and the closer-presence
 * override (§4.14 line 982) FORBIDS any `</tag>` / `</>` closer. It is
 * therefore SELF-TERMINATING, exactly like a void element (`<br>`) or a
 * self-closing tag (`<span/>`).
 *
 * The closer-finders below (`findStateChildCloser`, `findEngineCloser`,
 * `findOnTransitionCloser`) push non-void, non-self-closing lowercase
 * openers onto a `lowerDepth` counter, expecting a later closer to pop them.
 * A `:`-shorthand opener has no closer, so pushing it would leave an
 * unbalanced phantom opener that the enclosing structural `</>` later pops
 * against — corrupting depth accounting and making the real state-child /
 * engine / onTransition closer un-findable (→ E-ENGINE-STATE-CHILD-MISSING).
 * This predicate lets the closer-finders SKIP the push for `:`-shorthand
 * openers, mirroring the existing void-element + self-close exclusions.
 *
 * **Attribute-aware detection.** Returns `true` iff the opener inner-text
 * (the characters between `<` and the terminating `>`, exclusive) contains a
 * top-level (depth-0, non-string) `:` body-introducer that is preceded by at
 * least one whitespace character. Per §4.14 line 983 the mandatory leading
 * whitespace is the disambiguator: the `:`-shorthand body-introducer is
 * whitespace-preceded, whereas attribute-name namespace separators
 * (`bind:value`, `on:click`, `class:active`, `onserver:msg`) glue the `:`
 * directly to the identifier (no preceding whitespace). Colons inside
 * attribute VALUES (`style="color: red"`, `href="http://x"`, `title="a:b"`)
 * are skipped via string tracking; colons inside `${...}` interpolations
 * (`onclick=${a ? b : c}` — ternary) are skipped via brace tracking.
 *
 * `tagNameEnd` is the index in `s` ONE PAST the opener's tag name (so the
 * scan starts at the attribute region — we never inspect the tag name
 * itself). `openerEnd` is the index of the opener's terminating `>` (as
 * returned by `findOpenerEnd`). The scan is `[tagNameEnd, openerEnd)`.
 */
function isColonShorthandOpener(s: string, tagNameEnd: number, openerEnd: number): boolean {
  return findInsideOpenerColonPos(s, tagNameEnd, openerEnd) >= 0;
}

/**
 * S160 (S154 ruling (b)) — locate the INSIDE-opener `:`-shorthand body-
 * introducer position, or `-1` if the opener carries no inside-opener `:`-body.
 *
 * Identical scan to `isColonShorthandOpener` (the predicate delegates here),
 * but returns the index in `s` of the body-introducer `:` token so the engine
 * state-child parser can split the opener into its attribute region (before the
 * `:`) and its single-expression body (after the `:`, running to `openerEnd`).
 *
 * The scan is string-, `${...}`-, and bracket-aware (a `:` inside an attribute
 * value, a ternary, or a `[...]` / `(...)` is opaque). The mandatory leading
 * whitespace (§4.14 line 983) is the disambiguator vs. a `bind:` / `on:` /
 * `class:` attribute-namespace separator (which glues the `:` to the
 * identifier with no preceding whitespace). The scan is `[tagNameEnd, openerEnd)`.
 */
function findInsideOpenerColonPos(s: string, tagNameEnd: number, openerEnd: number): number {
  let i = tagNameEnd;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  // The character immediately before the candidate `:` must be whitespace
  // (§4.14 line 983). We track the previous non-skipped character so the
  // whitespace-precedence check works across the depth-0 scan.
  let prevChar = "";
  while (i < openerEnd) {
    const c = s[i]!;
    // String literals (single / double quote) — honor backslash escape so an
    // escaped quote inside the value doesn't terminate it early.
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < openerEnd) {
        const sc = s[i]!;
        if (sc === "\\") { i += 2; continue; }
        if (sc === quote) { i++; break; }
        i++;
      }
      prevChar = quote;
      continue;
    }
    // `${...}` logic-context interpolation — consume a balanced brace block so
    // a ternary `:` (`${a ? b : c}`) inside it is not mistaken for the body-
    // introducer.
    if (c === "$" && s[i + 1] === "{") {
      i += 2;
      let depth = 1;
      while (i < openerEnd && depth > 0) {
        const c2 = s[i]!;
        if (c2 === "{") depth++;
        else if (c2 === "}") depth--;
        i++;
      }
      prevChar = "}";
      continue;
    }
    if (c === "(") { parenDepth++; prevChar = c; i++; continue; }
    if (c === ")") { if (parenDepth > 0) parenDepth--; prevChar = c; i++; continue; }
    if (c === "[") { bracketDepth++; prevChar = c; i++; continue; }
    if (c === "]") { if (bracketDepth > 0) bracketDepth--; prevChar = c; i++; continue; }
    if (c === "{") { braceDepth++; prevChar = c; i++; continue; }
    if (c === "}") { if (braceDepth > 0) braceDepth--; prevChar = c; i++; continue; }
    // Top-level `:` preceded by whitespace → the `:`-shorthand body-introducer.
    if (c === ":" && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      if (prevChar === " " || prevChar === "\t" || prevChar === "\n" || prevChar === "\r") {
        return i;
      }
    }
    prevChar = c;
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
    // S98 (anomaly-1 fix) — skip past line/block comments + string literals
    // FIRST so a stray `${`, `<X`, or `</>` inside comment / string prose is
    // not mis-recognized as live syntax. See `skipCommentOrString` for
    // rationale (the AST builder preserves comment text verbatim in rulesRaw).
    {
      const skipped = skipCommentOrString(rulesRaw, i);
      if (skipped !== i) { i = skipped; continue; }
    }
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
        // Scan past the tag name so `isColonShorthandOpener` inspects only the
        // attribute region (mirrors the lowercase branch below).
        let jj = i + 1;
        while (jj < rulesRaw.length) {
          const c = rulesRaw[jj]!;
          if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") ||
              (c >= "0" && c <= "9") || c === "-") jj++;
          else break;
        }
        // Advance past the opener
        const openerEnd = findOpenerEnd(rulesRaw, i + 1);
        if (openerEnd < 0) return -1;
        // Self-closing? `<Tag/>`
        if (rulesRaw[openerEnd - 1] === "/") {
          depth--; // self-close cancels the increment
        } else if (isColonShorthandOpener(rulesRaw, jj, openerEnd)) {
          // §4.14 `:`-shorthand openers are self-terminating (no closer) — an
          // uppercase state-child written as `<P rule=.Q : "p">` must NOT bump
          // depth, exactly like the lowercase branch below (and self-close).
          depth--; // colon-shorthand cancels the increment
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
        // §4.14 `:`-shorthand openers are self-terminating (no closer) — do
        // NOT push them onto lowerDepth, exactly like void / self-closing.
        // This is the primary bug site: a `<span : @label>` child inside an
        // engine state-child body was pushed but never popped, corrupting the
        // depth counter so the real state-child `</>` was consumed against the
        // phantom opener (→ E-ENGINE-STATE-CHILD-MISSING).
        const isColonShorthand = isColonShorthandOpener(rulesRaw, j, openerEnd);
        if (!isSelfClose && !isColonShorthand && !VOID_ELEMENTS_LC.has(tagName)) {
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
 * §51.0.S.2.3 (S154 — #14 event-payload-transition, PARSER batch 1) — parse
 * the leading `(state × message)` arms out of an engine state-child `bodyRaw`.
 *
 * Arm grammar (the JS-style match arm shape, §51.0.S.2.3 reusing §18):
 *
 *     | .Variant(binding) :> body
 *     | .End             :> .Idle
 *     | .Drop(col)       :> { @tasks = taskMovedTo(@tasks, id, col); .Idle }
 *     | _                :> @<engineVar>          (wildcard, §51.0.S.2.4)
 *
 * Body-separation rule: the leading CONTIGUOUS run of `|`-arms (after the
 * body's leading whitespace) forms the message-dispatch table; scanning stops
 * at the first non-`|` content at the top level, which is the state-child's
 * RENDER body. Returns the parsed arms PLUS `renderBodyStart` — the byte
 * offset within `bodyRaw` where the (possibly-empty) render body begins.
 *
 * **Why a dedicated parser (not `parseMatchArms`)?** `parseMatchArms`
 * (match-statechild-parser.ts) parses the TAG-shaped block-form match arm
 * `<Variant> : body`. §51.0.S.2.3's message arm is the leading-`|` JS-style
 * shape `| .Variant(binding) :> body` — a genuinely different syntactic shape.
 * This parser MIRRORS `parseMatchArms`' discipline (balanced string/brace/
 * paren scanning; payload-binding extraction via the shared
 * `parsePayloadBindings`; the S147 `:>`/`=>`/`->` arm-arrow set) but recognizes
 * the leading-`|` form. RECOGNITION ONLY — no validation (batch 2 typer).
 *
 * @param bodyRaw — the raw text of a state-child body (the bare-body region
 *   between the state-child opener `>` and its `</>` closer).
 * @returns `{ arms, renderBodyStart }`
 */
export function parseMessageArms(
  bodyRaw: string,
): { arms: MessageArmEntry[]; renderBodyStart: number } {
  const arms: MessageArmEntry[] = [];
  if (typeof bodyRaw !== "string" || !bodyRaw) {
    return { arms, renderBodyStart: 0 };
  }

  const len = bodyRaw.length;
  let pos = 0;

  // Skip leading whitespace + comments to reach the first arm candidate. The
  // arm region is the leading contiguous `|`-run; if the first non-trivia char
  // is not `|`, there are no message arms and the whole body is render body.
  function skipTrivia(at: number): number {
    let p = at;
    for (;;) {
      while (p < len && /\s/.test(bodyRaw[p]!)) p++;
      const sk = skipCommentOrString(bodyRaw, p);
      if (sk !== p) { p = sk; continue; }
      break;
    }
    return p;
  }

  // Detect an arm-arrow glyph at `at`. Returns the glyph + its length, or null.
  // S147 set: `:>` / `=>` (1 char each at the string level) and `->` (2 chars).
  function arrowAt(at: number): { glyph: ":>" | "=>" | "->"; len: number } | null {
    const two = bodyRaw.slice(at, at + 2);
    if (two === ":>") return { glyph: ":>", len: 2 };
    if (two === "=>") return { glyph: "=>", len: 2 };
    if (two === "->") return { glyph: "->", len: 2 };
    return null;
  }

  pos = skipTrivia(pos);
  // If nothing starts with `|`, there is no message-arm table.
  if (pos >= len || bodyRaw[pos] !== "|") {
    return { arms, renderBodyStart: 0 };
  }

  // `renderBodyStart` defaults to "end of arm region"; updated after each arm.
  let renderBodyStart = pos;

  while (pos < len) {
    const triviaStart = skipTrivia(pos);
    if (triviaStart >= len || bodyRaw[triviaStart] !== "|") {
      // No further arm — the arm region ends here. The render body (if any)
      // starts at the first non-arm content.
      renderBodyStart = triviaStart;
      break;
    }
    const armStart = triviaStart;
    let p = triviaStart + 1; // consume `|`
    while (p < len && /\s/.test(bodyRaw[p]!)) p++;

    // -- Pattern --------------------------------------------------------------
    // Wildcard `_` OR a (possibly qualified) variant pattern `.Variant` /
    // `MsgType.Variant`. Capture the leaf variant name (last dotted segment).
    let variantName = "";
    let isWildcard = false;
    if (bodyRaw[p] === "_" && !/[A-Za-z0-9_$]/.test(bodyRaw[p + 1] ?? "")) {
      isWildcard = true;
      variantName = "_";
      p += 1;
    } else {
      // Leading `.` for the bare-variant form (§51.0.S worked examples use
      // `.Variant`); a qualified `MsgType.Variant` is also accepted.
      if (bodyRaw[p] === ".") p += 1;
      const patStart = p;
      while (p < len && /[A-Za-z0-9_$.]/.test(bodyRaw[p]!)) p++;
      const patText = bodyRaw.slice(patStart, p);
      // Leaf segment (the variant ident) — last component of a dotted path.
      const dotIdx = patText.lastIndexOf(".");
      variantName = dotIdx >= 0 ? patText.slice(dotIdx + 1) : patText;
    }

    // -- Payload bindings `(...)` ---------------------------------------------
    let payloadBindingsRaw = "";
    let payloadBindings: PayloadBinding[] = [];
    {
      let q = p;
      while (q < len && /\s/.test(bodyRaw[q]!)) q++;
      if (q < len && bodyRaw[q] === "(") {
        // Balanced paren scan (string-aware) — mirrors scanForOnTimeoutEntries.
        let depth = 1;
        let r = q + 1;
        let inDQ = false;
        let inSQ = false;
        const innerStart = r;
        while (r < len && depth > 0) {
          const c = bodyRaw[r]!;
          if (inDQ) { if (c === '"') inDQ = false; else if (c === "\\") r++; r++; continue; }
          if (inSQ) { if (c === "'") inSQ = false; else if (c === "\\") r++; r++; continue; }
          if (c === '"') { inDQ = true; r++; continue; }
          if (c === "'") { inSQ = true; r++; continue; }
          if (c === "(") { depth++; r++; continue; }
          if (c === ")") { depth--; if (depth === 0) break; r++; continue; }
          r++;
        }
        if (depth === 0) {
          payloadBindingsRaw = bodyRaw.slice(innerStart, r).trim();
          // Reuse the shared §51.0.B.1 / §18.7 binding parser. It expects the
          // attribute-substring shape; feeding it `(inner)` exercises the
          // parenthesized-form branch and yields one representation.
          payloadBindings = parsePayloadBindings(`(${payloadBindingsRaw})`);
          p = r + 1; // past `)`
        }
      } else {
        p = q;
      }
    }

    // -- Arm arrow `:>` / `=>` / `->` -----------------------------------------
    while (p < len && /\s/.test(bodyRaw[p]!)) p++;
    const arrow = arrowAt(p);
    if (!arrow) {
      // Malformed arm (no arm-arrow). Recognition-only: stop the arm scan; the
      // remainder becomes render body. Batch 2 surfaces structure diagnostics.
      renderBodyStart = armStart;
      break;
    }
    p += arrow.len;
    while (p < len && /\s/.test(bodyRaw[p]!)) p++;

    // -- Arm body — block `{ ... }` OR bare target expression -----------------
    let bodyText = "";
    let isBlockBody = false;
    if (p < len && bodyRaw[p] === "{") {
      // Balanced brace scan (string-aware) — capture WITH braces.
      isBlockBody = true;
      let depth = 1;
      let r = p + 1;
      let inDQ = false;
      let inSQ = false;
      let inTick = false;
      while (r < len && depth > 0) {
        const c = bodyRaw[r]!;
        if (inDQ) { if (c === '"') inDQ = false; else if (c === "\\") r++; r++; continue; }
        if (inSQ) { if (c === "'") inSQ = false; else if (c === "\\") r++; r++; continue; }
        if (inTick) { if (c === "`") inTick = false; else if (c === "\\") r++; r++; continue; }
        if (c === '"') { inDQ = true; r++; continue; }
        if (c === "'") { inSQ = true; r++; continue; }
        if (c === "`") { inTick = true; r++; continue; }
        if (c === "{") { depth++; r++; continue; }
        if (c === "}") { depth--; if (depth === 0) break; r++; continue; }
        r++;
      }
      if (depth === 0) {
        bodyText = bodyRaw.slice(p, r + 1).trim(); // include `{` .. `}`
        p = r + 1;
      } else {
        // Unbalanced — capture to EOF (best-effort; batch 2 surfaces).
        bodyText = bodyRaw.slice(p).trim();
        p = len;
      }
    } else {
      // Bare target expression — terminated by the next top-level `|` arm
      // separator OR end-of-body. Top-level = not inside (), [], {}, or a
      // string. (A `|` inside an expression — bitwise-or — is at depth > 0 or
      // would be inside parens in practice; we track depth to be safe.)
      const exprStart = p;
      let depth = 0;
      let inDQ = false;
      let inSQ = false;
      let inTick = false;
      while (p < len) {
        const c = bodyRaw[p]!;
        if (inDQ) { if (c === '"') inDQ = false; else if (c === "\\") p++; p++; continue; }
        if (inSQ) { if (c === "'") inSQ = false; else if (c === "\\") p++; p++; continue; }
        if (inTick) { if (c === "`") inTick = false; else if (c === "\\") p++; p++; continue; }
        if (c === '"') { inDQ = true; p++; continue; }
        if (c === "'") { inSQ = true; p++; continue; }
        if (c === "`") { inTick = true; p++; continue; }
        if (c === "(" || c === "[" || c === "{") { depth++; p++; continue; }
        if (c === ")" || c === "]" || c === "}") { if (depth > 0) depth--; p++; continue; }
        if (depth === 0 && c === "|") {
          // A `||` logical-or is NOT an arm separator; only a lone `|` that
          // begins the next arm. Peek: an arm `|` is followed (after trivia)
          // by `.`, `_`, or an identifier-start. A `||` is two `|`.
          if (bodyRaw[p + 1] === "|") { p += 2; continue; }
          break;
        }
        if (depth === 0 && c === "\n") {
          // Newline ends a bare-expression arm only if the next non-trivia
          // char begins another arm OR is non-arm render content. A bare
          // target expression is single-line by convention; break and let the
          // arm loop re-evaluate at the newline boundary.
          break;
        }
        p++;
      }
      bodyText = bodyRaw.slice(exprStart, p).trim();
    }

    arms.push({
      variantName,
      isWildcard,
      payloadBindingsRaw,
      payloadBindings,
      armArrow: arrow.glyph,
      bodyRaw: bodyText,
      isBlockBody,
      spanStart: armStart,
      spanEnd: p,
    });
    renderBodyStart = p;
    // Advance the outer cursor past this arm. Guard against a non-advancing
    // iteration (defensive — every successful arm advances `p` past the arm
    // body, but a degenerate parse must still terminate the loop).
    if (p <= pos) { pos = p + 1; } else { pos = p; }
  }

  // Trim trailing whitespace from the render-body start (point it at the first
  // non-whitespace render content, or `len` when only whitespace remains).
  {
    let r = renderBodyStart;
    while (r < len && /\s/.test(bodyRaw[r]!)) r++;
    renderBodyStart = r;
  }

  return { arms, renderBodyStart };
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
    // S98 (anomaly-1 fix) — comment / string skip at top-level scan. A `<X`
    // inside a `// line comment` or `"string"` MUST NOT be parsed as a
    // state-child opener.
    {
      const skipped = skipCommentOrString(rulesRaw, i);
      if (skipped !== i) { i = skipped; continue; }
    }
    // Find next `<` followed by an uppercase letter (state-child opener).
    const lt = rulesRaw.indexOf("<", i);
    if (lt < 0) break;
    // ss4 item 2 — a `<!-- -->` HTML comment beginning EXACTLY at `lt` would
    // otherwise fall through the `next`-is-uppercase check below (`next` ===
    // `!`) and step INTO the comment at `lt + 1`, past the `<` that
    // `skipCommentOrString` needs to recognize the comment — so a comment-
    // interior quote / apostrophe / backtick then opens a phantom string that
    // swallows the following state-children. Skip the whole skippable span
    // here. (The inner re-scan below handles a comment / string that STARTS
    // before `lt` but engulfs it; this handles one that starts AT `lt`.)
    {
      const skAtLt = skipCommentOrString(rulesRaw, lt);
      if (skAtLt !== lt) { i = skAtLt; continue; }
    }
    // Comment / string regions between `i` and `lt` may contain stray `<X`
    // tokens that aren't real openers — re-scan from `i` to `lt` and bail
    // back to the top of the loop if we hit one. (Cheap: most rulesRaw
    // strings contain few or no comments.)
    let scanned = i;
    let hitSkippable = false;
    while (scanned < lt) {
      const sk = skipCommentOrString(rulesRaw, scanned);
      if (sk !== scanned) {
        // If the skip region engulfs `lt`, the `<` we found was inside a
        // comment / string — restart the outer loop from past the region.
        if (sk > lt) { i = sk; hitSkippable = true; break; }
        scanned = sk;
      } else {
        scanned++;
      }
    }
    if (hitSkippable) continue;
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

    // S160 (S154 ruling (b)) — INSIDE-opener `:`-shorthand body. The canonical
    // placement opens the `:`-shorthand body INSIDE the opener (`<Variant rule=.X
    // : expr>`), the body running to the opener's `>` (which `findOpenerEnd`
    // already located, string-/paren-/`${}`-aware so a `>` inside a string or
    // markup body is opaque). Detect the body-introducer `:`; if present, the
    // attribute region is everything before it and the single-expression body is
    // everything after it (through `openerEnd`). The legacy AFTER-`>` placement
    // (`<Variant rule=.X> : expr`) is still recognized below (deprecation window)
    // and surfaces `W-COLON-SHORTHAND-LEGACY-PLACEMENT`.
    const tagNameStartAbs = lt + 1 + (openerInner.length - openerTrimmed.length);
    const tagNameEndAbs = tagNameStartAbs + tag.length;
    const insideColonAbs = findInsideOpenerColonPos(rulesRaw, tagNameEndAbs, openerEnd);
    // `afterTag` feeds the attribute regexes (rule=/effect=/payload). When the
    // opener carries an inside-opener `:`-body, strip the `: expr` tail so the
    // attribute scanners never see the body. (For the after-`>` / bare-body
    // paths `insideColonAbs` is -1 and `afterTag` is the full post-tag text.)
    const afterTag =
      insideColonAbs >= 0
        ? rulesRaw.slice(tagNameEndAbs, insideColonAbs)
        : openerTrimmed.slice(tag.length);

    // Self-closing? `<Variant/>` — accept and treat as empty body. An
    // inside-opener `:`-shorthand opener is never self-closing (the `:`-body
    // forbids a closer per §4.14; a trailing `/` would already be inside the
    // body text, not an opener self-close marker).
    const isSelfClose = insideColonAbs < 0 && openerInner.trimEnd().endsWith("/");

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
    // S182 (Fix 1) — `effect=` (state-child §51.0.H Form 1) is a §7 logic-
    // context block; the `${...}` form is REQUIRED. A bare value (`effect=foo()`)
    // or unbalanced/empty braces was captured as null → the effect was silently
    // tree-shaken. Flag the malformed case so PASS 17 (`validateEngineB17Diagnostics`)
    // fires `E-ENGINE-EFFECT-NOT-INTERPOLATED` (Error) instead of dropping it.
    let effectRaw: string | null = null;
    let effectMalformed = false;
    const effectPresentIdx = afterTagForRule.search(/(?:^|\s)effect\s*=/);
    const effectIdx = afterTagForRule.search(/(?:^|\s)effect\s*=\s*\$\{/);
    if (effectPresentIdx >= 0 && effectIdx < 0) {
      // `effect=` present but NOT followed by `${` — a bare value.
      effectMalformed = true;
    }
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
          // S182 (Fix 1) — an empty `${ }` body has nothing to run; treat as
          // malformed so PASS 17 surfaces E-ENGINE-EFFECT-NOT-INTERPOLATED.
          if (effectRaw.trim().length === 0) {
            effectRaw = null;
            effectMalformed = true;
          }
        } else {
          // S182 (Fix 1) — `${` present but braces never balanced: malformed.
          effectMalformed = true;
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

    // §51.0.B.1 (B1, S98 amendment — track 2 compiler-feature wiring) —
    // extract payload bindings from the opener's attribute substring. The
    // parser recognizes all three SPEC §51.0.B.1 forms (bare-attribute,
    // parenthesized, named); see `parsePayloadBindings` for the form
    // detection logic. PASS 11 in symbol-table.ts validates these bindings
    // against the variant's declared payload fields (arity, unit-variant
    // rejection, reserved-name collision).
    const payloadBindings = parsePayloadBindings(afterTag);

    // Locate body end.
    let bodyStart = openerEnd + 1;
    let bodyEnd: number;
    let nextI: number;
    let isColonShorthand = false;
    // S160 (S154 ruling (b)) — TRUE only for the LEGACY after-`>` `:`-shorthand
    // placement; drives W-COLON-SHORTHAND-LEGACY-PLACEMENT. Inside-opener and
    // bare-body / self-close leave it false.
    let legacyColonPlacement = false;
    if (insideColonAbs >= 0) {
      // S160 — INSIDE-opener `:`-shorthand (canonical). The body runs from one
      // past the `:` to the opener's `>` (`openerEnd`). After-`:` whitespace is
      // optional (§4.14) — the post-`:` text is trimmed by the AST builder /
      // codegen as it is for the after-`>` form, so `:@thing` and `: @thing`
      // produce the same body. Continue scanning past the opener `>`.
      bodyStart = insideColonAbs + 1;
      bodyEnd = openerEnd;
      nextI = openerEnd + 1;
      isColonShorthand = true;
    } else if (isSelfClose) {
      bodyEnd = bodyStart;
      nextI = bodyStart;
    } else {
      // LEGACY after-`>` `:`-shorthand body (deprecation window). After `>`,
      // optional whitespace, then `:`. Body extends until newline (the canonical
      // `:`-form is single-expression, terminated by a newline). Surfaces
      // W-COLON-SHORTHAND-LEGACY-PLACEMENT (§34) — the canonical placement is
      // inside-opener (handled above).
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
        legacyColonPlacement = true;
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

    // §51.0.S.2.3 (S154 — #14 event-payload-transition, PARSER batch 1) —
    // recognize the leading `(state × message)` arms inside the state-child
    // body. Only the bare-body form can host arms; `:`-shorthand bodies are
    // single-expression render bodies and self-close has no body. The arms are
    // captured UNCONDITIONALLY (no `accepts=` cross-check here — that is the
    // BATCH-2 typer's E-ENGINE-MSG-WITHOUT-ACCEPTS). `renderBodyStart` marks
    // where the post-arm render body begins; `bodyRaw` is retained verbatim
    // (including the arm region) so existing consumers are unchanged — batch 2/3
    // slice the render body via `renderBodyStart` when they need it.
    const messageArms: MessageArmEntry[] = (isColonShorthand || isSelfClose)
      ? []
      : parseMessageArms(bodyRaw).arms;

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
      // S160 (S154 ruling (b)) — legacy after-`>` placement marker.
      legacyColonPlacement,
      rawOffset: lt,
      // ---- A5-2 NEW (§51.0.M-Q) ----
      historyAttr,
      internalRule: internalRuleForm,
      onTimeoutElements,
      innerEngines,
      // ---- B17.2 NEW (§51.0.H) ----
      effectRaw,
      // S182 (Fix 1) — true iff `effect=` was present on this state-child but
      // NOT in the required `${...}` logic-block form (bare value, or
      // unbalanced/empty braces). PASS 17 fires E-ENGINE-EFFECT-NOT-INTERPOLATED.
      effectMalformed,
      onTransitionElements,
      // ---- B1 NEW (§51.0.B.1) ----
      payloadBindings,
      // ---- §51.0.S NEW (S154 — #14 event-payload-transition) ----
      messageArms,
    });
    i = nextI;
  }

  return out;
}

/**
 * Bug-AB fix (engine-direct `<onTransition>` parser-coverage gap, 2026-05-30).
 *
 * SPEC §51.0.H / PRIMER §7 — the CANONICAL / DOCUMENTED `<onTransition>`
 * placement is a DIRECT child of `<engine>` with BOTH endpoints explicit:
 *
 *     <engine for=Mode initial=.Nav>
 *       <Nav rule=.Edit />
 *       <Edit rule=.Nav />
 *       <onTransition from=.Nav to=.Edit>${ ... }</onTransition>
 *     </engine>
 *
 * `parseEngineStateChildren` only recognizes openers whose first char is an
 * uppercase A-Z (the state-child shape), so the lowercase-led `<onTransition>`
 * engine-DIRECT element is SKIPPED entirely and never enters the state-child
 * set. The only pre-existing path that captured `<onTransition>` is
 * `scanForOnTransitionEntries` invoked over a STATE-CHILD's `bodyRaw` — i.e.
 * the NESTED placement only. The engine-direct form was silently dropped,
 * leaving `collectEngineHooks` with nothing to emit (no fire fn, no fire call).
 *
 * This scan runs `scanForOnTransitionEntries` over the FULL engine `rulesRaw`,
 * EXCLUDING each state-child's opener-to-body span (so a `<onTransition>`
 * NESTED inside a state-child body is NOT double-counted — that one is already
 * captured per-state-child by `parseEngineStateChildren`). Engine-direct
 * entries carry BOTH `from` and `to` explicitly, so the codegen consumer maps
 * the edge directly without enclosing-state-child inference.
 *
 * Mirrors the `<onIdle>` engine-root placement classification in
 * symbol-table.ts PASS 11 (Step 3.5): a conservative opener-end + bodyRaw.length
 * span per state-child is sufficient to suppress nested entries.
 */
export function scanForEngineDirectOnTransitions(
  rulesRaw: string,
  stateChildren: ReadonlyArray<EngineStateChildEntry>,
): OnTransitionEntry[] {
  if (typeof rulesRaw !== "string" || !rulesRaw.trim()) return [];
  if (isLegacyArrowRulesBody(rulesRaw)) return [];

  // Build skip-regions that cover each state-child's opener+body span, so a
  // `<onTransition>` nested inside a state-child body is excluded from the
  // engine-direct scan (it is already captured by parseEngineStateChildren).
  // Self-closing / colon-shorthand state-children have empty / single-line
  // bodies and cannot host a nested `<onTransition>` block, so they contribute
  // no (or a harmless zero-width) range.
  const skipRegions: Array<readonly [number, number]> = [];
  for (const sc of stateChildren) {
    if (!sc || typeof sc.rawOffset !== "number") continue;
    const bodyLen = typeof sc.bodyRaw === "string" ? sc.bodyRaw.length : 0;
    if (bodyLen === 0) continue;
    const openerEnd = rulesRaw.indexOf(">", sc.rawOffset);
    if (openerEnd < 0) continue;
    // Conservative span: opener-end through opener-end + bodyRaw.length.
    // Covers the entire body where a nested `<onTransition>` would live.
    skipRegions.push([sc.rawOffset, openerEnd + 1 + bodyLen] as const);
  }

  return scanForOnTransitionEntries(rulesRaw, skipRegions);
}
