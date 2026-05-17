/**
 * @module lint-ghost-patterns
 * Ghost-error lint pre-pass for scrml.
 *
 * Scans a .scrml source string for known React/Vue/Svelte syntax patterns that
 * do not exist in scrml and emits "did you mean?" diagnostics. Runs BEFORE the
 * main compiler pipeline — diagnostics are warnings, not fatal errors. The real
 * compiler always runs regardless of lint findings.
 *
 * Anti-pattern catalog: scrml-support/docs/ghost-error-mitigation-plan.md §Anti-Pattern Catalog
 * Integration: called by api.js:compileScrml() before Stage 2 (BS).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   line: number,
 *   column: number,
 *   ghost: string,
 *   correction: string,
 *   message: string,
 *   severity: 'warning',
 *   code: string,
 * }} LintDiagnostic
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a flat string offset to { line, column } (1-based).
 *
 * @param {string} source
 * @param {number} offset — byte offset into source
 * @returns {{ line: number, column: number }}
 */
function offsetToLineCol(source, offset) {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") {
      line++;
      lastNewline = i;
    }
  }
  const column = offset - lastNewline;
  return { line, column };
}

/**
 * Build a lint diagnostic from a regex match.
 *
 * @param {string} source
 * @param {RegExpExecArray} match
 * @param {string} ghost        — short pattern label shown in message
 * @param {string} correction   — correct scrml equivalent
 * @param {string} see          — spec section reference (e.g. "§5")
 * @param {string} code         — lint warning code (W-LINT-NNN)
 * @returns {LintDiagnostic}
 */
function makeDiag(source, match, ghost, correction, see, code) {
  const { line, column } = offsetToLineCol(source, match.index);
  return {
    line,
    column,
    ghost,
    correction,
    message: `Line ${line}: Found '${ghost}' — scrml uses '${correction}'. See ${see}.`,
    severity: "warning",
    code,
  };
}

// ---------------------------------------------------------------------------
// Logic-block exclusion
// ---------------------------------------------------------------------------

/**
 * Build an array of [start, end] ranges that correspond to `${...}` logic
 * blocks in the source. Matches are brace-balanced. Content inside these
 * ranges should not trigger ghost-pattern detection (the user is writing JS
 * expression syntax inside a legitimate scrml logic interpolation).
 *
 * Also excludes `#{...}` CSS context blocks from some checks (per-pattern).
 *
 * @param {string} source
 * @returns {Array<[number, number]>}
 */
function buildLogicRanges(source) {
  const ranges = [];
  let i = 0;
  while (i < source.length) {
    // Match ${ — logic interpolation start
    if (source[i] === "$" && source[i + 1] === "{") {
      const start = i;
      i += 2;
      let depth = 1;
      while (i < source.length && depth > 0) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") depth--;
        i++;
      }
      ranges.push([start, i]);
    } else {
      i++;
    }
  }
  return ranges;
}

/**
 * Returns true if the given offset falls inside any of the provided ranges.
 *
 * @param {number} offset
 * @param {Array<[number, number]>} ranges
 * @returns {boolean}
 */
function inRange(offset, ranges) {
  for (const [start, end] of ranges) {
    if (offset >= start && offset < end) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// CSS context detection
// ---------------------------------------------------------------------------

/**
 * Build ranges for `#{...}` CSS context blocks (brace-balanced).
 * Used to detect Svelte-style `${}` interpolations inside CSS values.
 *
 * @param {string} source
 * @returns {Array<[number, number]>}
 */
function buildCssRanges(source) {
  const ranges = [];
  let i = 0;
  while (i < source.length) {
    if (source[i] === "#" && source[i + 1] === "{") {
      const start = i;
      i += 2;
      let depth = 1;
      while (i < source.length && depth > 0) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") depth--;
        i++;
      }
      ranges.push([start, i]);
    } else {
      i++;
    }
  }
  return ranges;
}

// ---------------------------------------------------------------------------
// Comment-region detection
// ---------------------------------------------------------------------------

/**
 * Build ranges for `//` line comments and block comments (slash-star ... star-slash).
 * Used to exclude comment text from ghost-pattern detection — comment regions
 * per SPEC §27 are not parsed as code, so any framework-shaped text inside a
 * comment is documentation, not a real ghost.
 *
 * Edge cases:
 *  - `//` inside a string literal: the builder does not track string state, so
 *    a `//` inside a string opens a phantom "comment" range to end-of-line.
 *    Acceptable: false negatives on lint warnings are not failures, just
 *    reduced signal. The cost of over-exclusion is low.
 *  - Block comment with no closing marker: i advances past end-of-source and
 *    the outer `i < source.length` check terminates the loop cleanly.
 *
 * @param {string} source
 * @returns {Array<[number, number]>}
 */
function buildCommentRanges(source) {
  const ranges = [];
  let i = 0;
  while (i < source.length) {
    // Line comment: // through end of line
    if (source[i] === "/" && source[i + 1] === "/") {
      const start = i;
      i += 2;
      while (i < source.length && source[i] !== "\n") i++;
      ranges.push([start, i]);
      continue;
    }
    // Block comment: /* ... */
    if (source[i] === "/" && source[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i < source.length - 1 && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2; // consume the closing */
      ranges.push([start, i]);
      continue;
    }
    i++;
  }
  return ranges;
}

// ---------------------------------------------------------------------------
// Tilde-sigil detection
// ---------------------------------------------------------------------------

/**
 * Build ranges for `~{...}` test-sigil blocks (brace-balanced).
 *
 * Per SPEC §32, `~{}` is the inline-test sigil. Its body contains scrml code
 * (test declarations, assertions, reactive reads/writes) that should not
 * trigger ghost-pattern detection — `@count = 0` inside a test body is a
 * legitimate reactive assignment, not a Vue-style attribute shorthand.
 *
 * Mirrors `buildLogicRanges` / `buildCssRanges`: requires the sigil pair
 * (`~{`) to start a range, so a bare `~` elsewhere does not accidentally
 * open a phantom range.
 *
 * @param {string} source
 * @returns {Array<[number, number]>}
 */
function buildTildeRanges(source) {
  const ranges = [];
  let i = 0;
  while (i < source.length) {
    if (source[i] === "~" && source[i + 1] === "{") {
      const start = i;
      i += 2;
      let depth = 1;
      while (i < source.length && depth > 0) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") depth--;
        i++;
      }
      ranges.push([start, i]);
    } else {
      i++;
    }
  }
  return ranges;
}

/**
 * Collect ranges that correspond to `function NAME(...) { ... }` and
 * `fn NAME(...) -> T { ... }` bodies at file scope (v0.3 logic-default
 * mode). Inside these bodies, lint patterns that target attribute-position
 * shapes should not fire — `@cell = .Variant` reactive writes look
 * superficially like Vue `@click=` shorthand but are valid scrml.
 *
 * Brace-matching mirrors `buildLogicRanges` / `buildTildeRanges`: the
 * opener pair (the `(` and `{`) lock the range start; depth-counting walks
 * to the matching `}`. Does NOT handle braces inside string literals
 * (same caveat as the sibling builders).
 *
 * S96 Bug 9 fix.
 *
 * @param {string} source
 * @returns {Array<[number, number]>}
 */
function buildFunctionBodyRanges(source) {
  const ranges = [];
  // Match `function NAME(...)` or `fn NAME(...) -> T` followed by `{`.
  // The return-type clause is optional (functions don't have it; `fn` does).
  const re = /\b(?:function|fn)\s+\w+\s*\([^)]*\)\s*(?:->[^{]*)?\{/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const start = m.index;
    let i = m.index + m[0].length; // position after the opening `{`
    let depth = 1;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
      i++;
    }
    ranges.push([start, i]);
  }
  return ranges;
}

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

/**
 * Each pattern:
 *   regex       — RegExp with global flag (exec loop)
 *   ghost       — display label for message
 *   correction  — scrml equivalent
 *   see         — spec section
 *   code        — W-LINT-NNN
 *   skipIf      — optional fn(offset, logicRanges, cssRanges, commentRanges, tildeRanges) -> bool
 *                 to skip match. Backwards compatible — patterns may use shorter signatures.
 */
const PATTERNS = [
  // Pattern 1: <style> block — unambiguous, no scrml meaning
  {
    regex: /<style\b/gi,
    ghost: "<style>",
    correction: "#{ css rules }",
    see: "§9",
    code: "W-LINT-001",
    skipIf: null, // Never a valid scrml construct
  },

  // Pattern 2: oninput=${...} arrow that assigns to @var — ghost bind pattern
  // Matches: oninput=${  (any)  @var = ...}
  {
    regex: /\boninput\s*=\s*\$\{[^}]*@\w+\s*=/gi,
    ghost: "oninput=${e => @x = e.target.value}",
    correction: "bind:value=@x",
    see: "§5",
    code: "W-LINT-002",
    skipIf: null, // Whole pattern including ${ is the ghost; no false-positive risk
  },

  // Pattern 3: className= — React class attribute
  {
    regex: /\bclassName\s*=/g,
    ghost: "className={expr}",
    correction: 'class:name=@cond or class="name"',
    see: "§5",
    code: "W-LINT-003",
    skipIf: (offset, logicRanges) => inRange(offset, logicRanges),
  },

  // Pattern 4: onChange=, onSubmit= (camelCase events)
  // Matches any on[Upper] event name assignment
  {
    regex: /\bon[A-Z]\w*\s*=/g,
    ghost: "onChange={handler}",
    correction: "onchange=handler()",
    see: "§5",
    code: "W-LINT-004",
    skipIf: (offset, logicRanges) => inRange(offset, logicRanges),
  },

  // Pattern 5: value={expr} where { is NOT preceded by $ — JSX attribute braces
  // Must match: value={  but NOT value=${
  // Negative lookbehind: not preceded by $
  {
    regex: /\bvalue\s*=\s*(?<!\$)\{/g,
    ghost: "value={@state}",
    correction: "value=@state",
    see: "§5",
    code: "W-LINT-005",
    skipIf: (offset, logicRanges) => inRange(offset, logicRanges),
  },

  // Pattern 6: for (item of @items) — JS for-of loop in markup context
  // (only meaningful outside ${} logic blocks)
  {
    regex: /\bfor\s*\(\s*\w+\s+of\s+@/g,
    ghost: "for (item of @items)",
    correction: "for @items / lift item /",
    see: "§10",
    code: "W-LINT-006",
    skipIf: (offset, logicRanges) => inRange(offset, logicRanges),
  },

  // Pattern 7: <Comp prop={val}> — JSX attribute braces on component props
  // Matches prop={  but NOT prop=${ and NOT value= (covered by P5)
  // Only trigger when the attribute name is NOT 'value' (P5 covers that)
  // Skip when the match falls inside a `//` or block comment (per SPEC §27).
  //
  // S96 Bug 8 fix:
  //   - `(?<![:\w])` excludes `:struct`/`:enum`/`:union` etc. — the colon-
  //     tagged type-shape in `type Task:struct = { ... }` made `struct = {`
  //     fire as a false positive. `:\w` includes any word-char-preceded
  //     identifier (covers `type:X` shape variants).
  //   - `(?<!type )` excludes the non-tagged form `type X = { ... }`.
  //   - `props\b` added to the exclusion list — canonical component-prop
  //     declaration `props = { name: string }` is intentional scrml shape.
  {
    regex: /(?<!:\w*)(?<!type )\b(?!value\b|props\b)(\w+)\s*=\s*(?<!\$)\{(?!\{)/g,
    ghost: "<Comp prop={val}>",
    correction: "<Comp prop=val>",
    see: "§5",
    code: "W-LINT-007",
    skipIf: (offset, logicRanges, _cssRanges, commentRanges) =>
      inRange(offset, logicRanges) || inRange(offset, commentRanges),
  },

  // Pattern 8: {cond && <El>} — React conditional rendering
  // Only trigger outside ${} logic blocks (inside logic it's valid JS)
  {
    regex: /\{[^}]+&&\s*</g,
    ghost: "{cond && <El>}",
    correction: "<El if=@cond>",
    see: "§17",
    code: "W-LINT-008",
    skipIf: (offset, logicRanges) => inRange(offset, logicRanges),
  },

  // Pattern 9: onClick=, onDblClick= etc. (camelCase click events)
  // Note: onC... catches onClick, onClose etc. — but camelCase is the signal.
  // Covered generically by W-LINT-004 (on[Upper]) but kept explicit for clarity
  // Deduplicated: W-LINT-004 already matches onClick. This entry is intentionally
  // omitted — W-LINT-004 (on[A-Z]) covers all camelCase events including onClick.
  // Keeping the slot here as a comment so the pattern numbering matches the plan.
  // (No separate entry for W-LINT-009 — W-LINT-004 subsumes it.)

  // Pattern 10: ${} interpolation INSIDE #{} CSS context — Svelte pattern
  // Matches: #{ ... ${ ... } ... } — the ${ inside CSS is the ghost
  {
    regex: /\$\{/g,
    ghost: "${} in CSS context",
    correction: "@var directly in #{}",
    see: "§9",
    code: "W-LINT-010",
    skipIf: (offset, logicRanges, cssRanges) => {
      // Only trigger if we're inside a #{} CSS block
      if (!inRange(offset, cssRanges)) return true; // skip — not in CSS context
      // Also skip if this ${ is a logic interpolation itself (nested ${} in CSS is the ghost)
      return false;
    },
  },

  // Pattern 11: Vue `:attr=` colon-prefixed attribute binding
  // Matches: whitespace + `:ident=` where no ident precedes the colon
  // (distinguishes from scrml's `class:name=@cond` which has `class` before `:`)
  {
    regex: /\s:[a-z][a-zA-Z0-9-]*\s*=/g,
    ghost: ":attr=\"expr\"",
    correction: "attr=@var (or attr=\"literal\")",
    see: "§5",
    code: "W-LINT-011",
    skipIf: (offset, logicRanges) => inRange(offset, logicRanges),
  },

  // Pattern 12: Vue directives `v-if=`, `v-for=`, `v-model=`, `v-show=`,
  // `v-else`, `v-else-if=`, `v-on:event=`, `v-bind:attr=`, `v-html=`, `v-text=`,
  // `v-slot`, `v-cloak`, `v-once`, `v-pre`.
  {
    regex: /\bv-(?:if|else-if|else|for|model|show|on|bind|html|text|slot|cloak|once|pre)\b(?::[a-zA-Z]+)?\s*(?==|>|\s)/g,
    ghost: "v-if / v-for / v-model / @click / :class",
    correction: "scrml uses if=@cond, for @items, bind:value=@x, onclick=fn(), class:name=@cond",
    see: "§5, §10, §17",
    code: "W-LINT-012",
    skipIf: (offset, logicRanges) => inRange(offset, logicRanges),
  },

  // Pattern 13: Vue `@event=` attribute shorthand (e.g., `@click="fn"`,
  // `@click.stop="fn"`). Distinguished from scrml's `@var` reactive sigil by
  // requiring an `=` after the `@word` — scrml uses `@var` as VALUES
  // (`value=@count`), never as attribute NAMES. The trailing `(?!=)` negative
  // lookahead rejects `@var ==` (scrml equality per SPEC §45) so the lint
  // does not misfire on `assert @count == 0` or `if=(@x == 1)` expressions.
  // Also skips comment regions (per SPEC §27) via commentRanges and `~{}`
  // test-sigil bodies (per SPEC §32) via tildeRanges — `@count = 0` inside a
  // `~{}` test block is a legitimate reactive assignment, not a Vue ghost.
  {
    regex: /\s@[a-z][a-zA-Z0-9]*(?:\.[a-z]+)*\s*=(?!=)/g,
    ghost: "@click=\"handler\" (Vue event shorthand)",
    correction: "onclick=handler() (scrml uses standard on<event> attribute names)",
    see: "§5",
    code: "W-LINT-013",
    // S96 Bug 9 fix — also skip function-body ranges. `@dragPhase = .Dragging`
    // inside `function startDrag() { ... }` is a legitimate reactive write,
    // not a Vue ghost. Function bodies in v0.3 logic-default mode live at
    // file scope WITHOUT a wrapping `${...}`, so logicRanges doesn't cover
    // them.
    skipIf: (offset, logicRanges, _cssRanges, commentRanges, tildeRanges, functionBodyRanges) =>
      inRange(offset, logicRanges) ||
      inRange(offset, commentRanges) ||
      inRange(offset, tildeRanges) ||
      inRange(offset, functionBodyRanges || []),
  },

  // Pattern 14: Svelte block directives `{#if ...}`, `{:else}`, `{/if}`,
  // `{#each xs as x}`, `{#await}`, `{#key}`, `{:then}`, `{:catch}`.
  {
    regex: /\{[#:\/]\s*(?:if|else|each|await|then|catch|key)\b/g,
    ghost: "{#if @cond} ... {/if} (Svelte block)",
    correction: "scrml uses <el if=@cond>, for @items / lift ... /, or match + <:arms/>",
    see: "§10, §17",
    code: "W-LINT-014",
    skipIf: (offset, logicRanges) => inRange(offset, logicRanges),
  },

  // Pattern 15: Svelte raw-HTML directive `{@html expr}`.
  {
    regex: /\{@html\s/g,
    ghost: "{@html expr} (Svelte raw HTML)",
    correction: "scrml uses ${ rawHtml() } inside markup; no dedicated @html directive",
    see: "§5",
    code: "W-LINT-015",
    skipIf: (offset, logicRanges) => inRange(offset, logicRanges),
  },

  // Pattern 17: React hooks — useState, useEffect, useRef, useMemo, useCallback,
  // useContext, useReducer, useLayoutEffect, useTransition, useDeferredValue,
  // useId, useSyncExternalStore, useInsertionEffect (W-LINT-016, S97).
  //
  // The adopter likely came from React and is reaching for hooks. Each maps
  // to a scrml primitive that's structurally simpler:
  //   useState(init)         → <x> = init  (read @x, write @x = expr)
  //   useEffect(fn, [deps])  → reactive ${ ... } block (deps auto-tracked);
  //                            lifecycle via <onMount>/<onCleanup> tags (§6.7)
  //   useRef(init)           → <x> = init  OR  bind:this=@el for DOM refs
  //   useMemo(() => e, deps) → const <x> = e  (derived cell, deps auto-tracked)
  //   useCallback(fn, deps)  → just declare fn; no re-render model, no memo needed
  //   useContext(Ctx)        → component prop-passing or stdlib equivalents
  //   useReducer(red, init)  → <engine for=Type initial=.X> with rule= contracts
  //
  // Pattern matches `useFoo(` — the call form. Bare references without `(`
  // can't act as hooks anyway. Skip in comments to avoid false positives in
  // explanatory text.
  {
    regex: /\b(useState|useEffect|useRef|useMemo|useCallback|useContext|useReducer|useLayoutEffect|useTransition|useDeferredValue|useId|useSyncExternalStore|useInsertionEffect)\s*\(/g,
    ghost: "useState() / useEffect() / useRef() etc. (React hook call)",
    correction: "scrml has no React hooks (no virtual DOM, no re-render model). State: `<x> = init` (read `@x`, write `@x = expr`). Effects: reactive `${...}` blocks auto-track deps; lifecycle via `<onMount>` / `<onCleanup>`. Memo: `const <x> = expr`. Reducer: `<engine for=Type>` with `rule=` contracts. See SPEC §6 (state), §6.7 (lifecycle), §51 (engines).",
    see: "§6, §6.7, §51",
    code: "W-LINT-016",
    skipIf: (offset, _logicRanges, _cssRanges, commentRanges) => inRange(offset, commentRanges),
  },

  // Pattern 18: Vue composition-API calls (W-LINT-017, S97).
  //
  // Detects the most common reactivity / effect / lifecycle / composition
  // entry points: `ref`, `reactive`, `computed`, `readonly`, `shallowRef`,
  // `shallowReactive`, `toRef`, `toRefs`, `unref`, `watch`, `watchEffect`,
  // `watchPostEffect`, `watchSyncEffect`, `onMounted`, `onUpdated`,
  // `onUnmounted`, `onBeforeMount`, `onBeforeUpdate`, `onBeforeUnmount`,
  // `onErrorCaptured`, `provide`, `inject`, `defineComponent`, `defineProps`,
  // `defineEmits`, `defineExpose`.
  //
  // Skips: `useId` is omitted (also a React 19 hook; covered by W-LINT-016).
  // `onMount`-without-the-`ed`-suffix is NOT included — too risky given
  // scrml may grow its own lifecycle vocabulary using similar names.
  //
  // Match form is `\bword\s*\(` — the call. Skip in comments.
  {
    regex: /\b(ref|reactive|computed|readonly|shallowRef|shallowReactive|toRef|toRefs|unref|watch|watchEffect|watchPostEffect|watchSyncEffect|onMounted|onUpdated|onUnmounted|onBeforeMount|onBeforeUpdate|onBeforeUnmount|onErrorCaptured|provide|inject|defineComponent|defineProps|defineEmits|defineExpose)\s*\(/g,
    ghost: "ref() / reactive() / computed() / watch() / onMounted() etc. (Vue composition API)",
    correction: "scrml has no Vue composition API. State: `<x> = init` (read `@x`, write `@x = expr`). Computed: `const <x> = expr` (derived cell, deps auto-tracked). Watch / effect: reactive `${...}` blocks fire on dep change. Lifecycle: `<onMount>` / `<onCleanup>` (§6.7). Props: component `props={...}` block (§15.10). See SPEC §6 (state), §6.7 (lifecycle), §15 (components).",
    see: "§6, §6.7, §15",
    code: "W-LINT-017",
    skipIf: (offset, _logicRanges, _cssRanges, commentRanges) => inRange(offset, commentRanges),
  },

  // Pattern 19: Svelte store API calls (W-LINT-018, S97).
  //
  // Detects `writable`, `readable`, `derived` (from `svelte/store`), and
  // `tick`, `setContext`, `getContext`, `hasContext`, `createEventDispatcher`,
  // `beforeUpdate`, `afterUpdate` (lifecycle / context helpers from `svelte`).
  //
  // Skips: bare `derived` would collide with scrml's `derived=expr` engine
  // attribute (§51.0.J L20). The pattern requires `derived\s*\(` (call form)
  // to disambiguate — engine attribute is `derived=` not `derived(`.
  //
  // Also skips: `onMount` / `onDestroy` — too risky given scrml may grow its
  // own lifecycle vocabulary using similar names. `$store` auto-subscribe is
  // ALSO NOT detected here — distinguishing legitimate `$identifier` (rare
  // but possible) from Svelte auto-subscribe needs more context than this
  // pass has.
  {
    regex: /\b(writable|readable|derived|tick|setContext|getContext|hasContext|createEventDispatcher|beforeUpdate|afterUpdate)\s*\(/g,
    ghost: "writable() / readable() / derived() etc. (Svelte store / lifecycle helper)",
    correction: "scrml has no Svelte stores. State: `<x> = init` is automatically reactive (no store wrapper needed). Cross-component sharing: declare at `<program>` scope. Derived: `const <x> = expr` (auto-tracks deps). Effects: reactive `${...}` blocks. Lifecycle: `<onMount>` / `<onCleanup>` (§6.7). Context: component props + state passing. Events: `${dispatch(...)}` or direct handler call. See SPEC §6 (state), §6.7 (lifecycle), §15 (components).",
    see: "§6, §6.7, §15",
    code: "W-LINT-018",
    skipIf: (offset, _logicRanges, _cssRanges, commentRanges) => inRange(offset, commentRanges),
  },

  // Pattern 20: Solid reactivity / effect calls (W-LINT-019, S97).
  //
  // Detects: `createSignal`, `createEffect`, `createMemo`, `createStore`,
  // `createResource`, `createComputed`, `createDeferred`, `createSelector`,
  // `createReaction`, `createMutable`, `createRoot`, `createContext`,
  // `mergeProps`, `splitProps`, `untrack`, `batch`.
  //
  // Skips: `For`, `Show`, `Switch`, `Match`, `Index` — these are Solid
  // CONTROL-FLOW COMPONENTS used as markup tags. Detecting them needs the
  // markup-tag context (which this pre-Stage-2 lint doesn't have); also
  // PascalCase-bare-component-tags fire E-COMPONENT-020 if they're not
  // declared. Adopter feedback already exists via that path.
  //
  // `useContext` from `solid-js` collides with `useContext` from React
  // (covered by W-LINT-016 already — same lint message; one diagnostic
  // per call site is fine).
  {
    regex: /\b(createSignal|createEffect|createMemo|createStore|createResource|createComputed|createDeferred|createSelector|createReaction|createMutable|createRoot|createContext|mergeProps|splitProps|untrack|batch)\s*\(/g,
    ghost: "createSignal() / createEffect() / createMemo() / createStore() etc. (Solid primitive)",
    correction: "scrml has no Solid primitives. State: `<x> = init` (Solid signal). Effects: reactive `${...}` blocks (Solid createEffect). Memo: `const <x> = expr` (Solid createMemo). Store: nested compound state `<obj><field> = init</>` (§6.3 Variant C). Resource: server functions `${ server function fetch() { ... } }` + RemoteData enum (§13.5). Lifecycle: `<onMount>` / `<onCleanup>` (§6.7). Untrack / batch are no-ops in scrml — the compiler manages reactivity granularity. See SPEC §6, §6.3, §6.7, §13.5.",
    see: "§6, §6.3, §6.7, §13.5",
    code: "W-LINT-019",
    skipIf: (offset, _logicRanges, _cssRanges, commentRanges) => inRange(offset, commentRanges),
  },

  // Pattern 16: W-LIFECYCLE-CANDIDATE — string-discriminator trap.
  //
  // S64 debate-04 verdict A+ #2 (string-switch trap, gingerbill design insight):
  // detect a state-cell decl `<NAME>[: Type] = "VALUE"` whose RHS is a string
  // literal whose value lexically resembles an enum variant tag — single-word,
  // initial-uppercase, alphanumeric only (e.g. "Loading", "Idle", "Pending").
  // Predicate: ^[A-Z][A-Za-z0-9]*$. Lowercase-initial strings do NOT fire (high
  // false-positive cost — see docs/changes/a-plus-verdict-execution/SURVEY-NOTE.md).
  {
    regex: /<([a-zA-Z_][a-zA-Z0-9_]*)>\s*(?::\s*[A-Za-z_][\w.]*\s*)?=\s*(?:"([A-Z][A-Za-z0-9]*)"|'([A-Z][A-Za-z0-9]*)')/g,
    ghost: "<state> = \"PascalCaseValue\" (string-discriminator trap)",
    correction: "lift to an enum: `type Phase:enum = { Idle, Loading, Error, Success }; <phase>: Phase = .Idle`. Unlocks <match for=Phase> structural exhaustiveness (Tier 1) and <engine for=Phase> transition-validation (Tier 2). See primer §1 (tier ladder); debate-04 string-switch-trap design insight.",
    see: "§6 (W-LIFECYCLE-CANDIDATE)",
    code: "W-LIFECYCLE-CANDIDATE",
    skipIf: (offset, logicRanges, _cssRanges, commentRanges, tildeRanges) =>
      inRange(offset, logicRanges) ||
      inRange(offset, commentRanges) ||
      inRange(offset, tildeRanges),
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Lint a scrml source string for known ghost patterns from other frameworks.
 *
 * Each diagnostic describes a pattern that does not exist in scrml and suggests
 * the correct scrml equivalent. Diagnostics are warnings — they do not block
 * compilation.
 *
 * @param {string} source    — raw .scrml file content
 * @param {string} [filePath] — optional file path for future use (not currently used in messages)
 * @returns {LintDiagnostic[]}
 */
export function lintGhostPatterns(source, filePath) {
  if (!source || source.length === 0) return [];

  const logicRanges = buildLogicRanges(source);
  const cssRanges = buildCssRanges(source);
  const commentRanges = buildCommentRanges(source);
  const tildeRanges = buildTildeRanges(source);
  const functionBodyRanges = buildFunctionBodyRanges(source);
  const diagnostics = [];

  for (const pattern of PATTERNS) {
    const re = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match;
    while ((match = re.exec(source)) !== null) {
      const offset = match.index;

      // Apply false-positive guard
      if (pattern.skipIf && pattern.skipIf(offset, logicRanges, cssRanges, commentRanges, tildeRanges, functionBodyRanges)) {
        continue;
      }

      diagnostics.push(
        makeDiag(source, match, pattern.ghost, pattern.correction, pattern.see, pattern.code)
      );

      // Prevent infinite loops on zero-width matches
      if (match[0].length === 0) re.lastIndex++;
    }
  }

  // Sort by line, then column for deterministic output
  diagnostics.sort((a, b) => a.line !== b.line ? a.line - b.line : a.column - b.column);

  return diagnostics;
}
