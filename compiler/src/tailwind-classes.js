/**
 * Tailwind Utility Classes — embedded registry for the scrml compiler.
 *
 * Per SPEC section 26, the scrml compiler embeds Tailwind utility definitions
 * and emits only the CSS rules for classes actually used. No Tailwind CLI,
 * PostCSS, or purge step is required.
 *
 * Exports:
 *   getTailwindCSS(className)                   — CSS rule string or null
 *   getTailwindCSSWithDiagnostic(className)     — { css, diagnostic } pair
 *   getAllUsedCSS(classNames[])                 — combined CSS string
 *   getAllUsedCSSWithDiagnostics(classNames[])  — { css, diagnostics }
 *   scanClassesFromHtml(html)                   — class names from HTML
 *   findUnsupportedTailwindShapes(source)       — W-TAILWIND-001 diagnostics
 *                                                 for class strings that look
 *                                                 like Tailwind variant or
 *                                                 arbitrary-value syntax but
 *                                                 fail registry lookup
 *   findUnrecognizedClasses(source)             — W-TAILWIND-UNRECOGNIZED-CLASS
 *                                                 FLOOR-fix lint (dogfood Bug
 *                                                 1, S108) for any class name
 *                                                 in `class="..."` that does
 *                                                 NOT resolve via
 *                                                 `getTailwindCSS()`. Covers
 *                                                 typos, unsupported arbitrary
 *                                                 values, and custom CSS
 *                                                 classes (acknowledged
 *                                                 false-positive at floor
 *                                                 level — adopters can suppress
 *                                                 via `compilerSettings`).
 *
 * Variant prefixes supported (per §26.3): responsive (`sm:`–`2xl:`), state
 * pseudo-classes (`hover:`, `focus:`, `active:`, `disabled:`, `first:`,
 * `last:`, `odd:`, `even:`, `visited:`, `focus-within:`, `focus-visible:`),
 * `dark:`, `print:`, `motion-safe:`, `motion-reduce:`. Stacking is permitted.
 *
 * Arbitrary values supported (per §26.4): `<utility-prefix>-[<value>]`. The
 * compiler validates bracket content at compile time per §26.4 and emits
 * E-TAILWIND-001 on invalid syntax.
 */

// ---------------------------------------------------------------------------
// Tailwind spacing scale (shared by padding, margin, gap, etc.)
// ---------------------------------------------------------------------------

const SPACING_SCALE = {
  "0": "0px",
  "px": "1px",
  "0.5": "0.125rem",
  "1": "0.25rem",
  "1.5": "0.375rem",
  "2": "0.5rem",
  "2.5": "0.625rem",
  "3": "0.75rem",
  "3.5": "0.875rem",
  "4": "1rem",
  "5": "1.25rem",
  "6": "1.5rem",
  "7": "1.75rem",
  "8": "2rem",
  "9": "2.25rem",
  "10": "2.5rem",
  "11": "2.75rem",
  "12": "3rem",
  "14": "3.5rem",
  "16": "4rem",
  "20": "5rem",
  "24": "6rem",
  "28": "7rem",
  "32": "8rem",
  "36": "9rem",
  "40": "10rem",
  "44": "11rem",
  "48": "12rem",
  "52": "13rem",
  "56": "14rem",
  "60": "15rem",
  "64": "16rem",
  "72": "18rem",
  "80": "20rem",
  "96": "24rem",
};

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------

const COLOR_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

const COLOR_PALETTE = {
  slate:   { 50: "#f8fafc", 100: "#f1f5f9", 200: "#e2e8f0", 300: "#cbd5e1", 400: "#94a3b8", 500: "#64748b", 600: "#475569", 700: "#334155", 800: "#1e293b", 900: "#0f172a", 950: "#020617" },
  gray:    { 50: "#f9fafb", 100: "#f3f4f6", 200: "#e5e7eb", 300: "#d1d5db", 400: "#9ca3af", 500: "#6b7280", 600: "#4b5563", 700: "#374151", 800: "#1f2937", 900: "#111827", 950: "#030712" },
  zinc:    { 50: "#fafafa", 100: "#f4f4f5", 200: "#e4e4e7", 300: "#d4d4d8", 400: "#a1a1aa", 500: "#71717a", 600: "#52525b", 700: "#3f3f46", 800: "#27272a", 900: "#18181b", 950: "#09090b" },
  neutral: { 50: "#fafafa", 100: "#f5f5f5", 200: "#e5e5e5", 300: "#d4d4d4", 400: "#a3a3a3", 500: "#737373", 600: "#525252", 700: "#404040", 800: "#262626", 900: "#171717", 950: "#0a0a0a" },
  stone:   { 50: "#fafaf9", 100: "#f5f5f4", 200: "#e7e5e4", 300: "#d6d3d1", 400: "#a8a29e", 500: "#78716c", 600: "#57534e", 700: "#44403c", 800: "#292524", 900: "#1c1917", 950: "#0c0a09" },
  red:     { 50: "#fef2f2", 100: "#fee2e2", 200: "#fecaca", 300: "#fca5a5", 400: "#f87171", 500: "#ef4444", 600: "#dc2626", 700: "#b91c1c", 800: "#991b1b", 900: "#7f1d1d", 950: "#450a0a" },
  orange:  { 50: "#fff7ed", 100: "#ffedd5", 200: "#fed7aa", 300: "#fdba74", 400: "#fb923c", 500: "#f97316", 600: "#ea580c", 700: "#c2410c", 800: "#9a3412", 900: "#7c2d12", 950: "#431407" },
  amber:   { 50: "#fffbeb", 100: "#fef3c7", 200: "#fde68a", 300: "#fcd34d", 400: "#fbbf24", 500: "#f59e0b", 600: "#d97706", 700: "#b45309", 800: "#92400e", 900: "#78350f", 950: "#451a03" },
  yellow:  { 50: "#fefce8", 100: "#fef9c3", 200: "#fef08a", 300: "#fde047", 400: "#facc15", 500: "#eab308", 600: "#ca8a04", 700: "#a16207", 800: "#854d0e", 900: "#713f12", 950: "#422006" },
  green:   { 50: "#f0fdf4", 100: "#dcfce7", 200: "#bbf7d0", 300: "#86efac", 400: "#4ade80", 500: "#22c55e", 600: "#16a34a", 700: "#15803d", 800: "#166534", 900: "#14532d", 950: "#052e16" },
  emerald: { 50: "#ecfdf5", 100: "#d1fae5", 200: "#a7f3d0", 300: "#6ee7b7", 400: "#34d399", 500: "#10b981", 600: "#059669", 700: "#047857", 800: "#065f46", 900: "#064e3b", 950: "#022c22" },
  teal:    { 50: "#f0fdfa", 100: "#ccfbf1", 200: "#99f6e4", 300: "#5eead4", 400: "#2dd4bf", 500: "#14b8a6", 600: "#0d9488", 700: "#0f766e", 800: "#115e59", 900: "#134e4a", 950: "#042f2e" },
  cyan:    { 50: "#ecfeff", 100: "#cffafe", 200: "#a5f3fc", 300: "#67e8f9", 400: "#22d3ee", 500: "#06b6d4", 600: "#0891b2", 700: "#0e7490", 800: "#155e75", 900: "#164e63", 950: "#083344" },
  sky:     { 50: "#f0f9ff", 100: "#e0f2fe", 200: "#bae6fd", 300: "#7dd3fc", 400: "#38bdf8", 500: "#0ea5e9", 600: "#0284c7", 700: "#0369a1", 800: "#075985", 900: "#0c4a6e", 950: "#082f49" },
  blue:    { 50: "#eff6ff", 100: "#dbeafe", 200: "#bfdbfe", 300: "#93c5fd", 400: "#60a5fa", 500: "#3b82f6", 600: "#2563eb", 700: "#1d4ed8", 800: "#1e40af", 900: "#1e3a8a", 950: "#172554" },
  indigo:  { 50: "#eef2ff", 100: "#e0e7ff", 200: "#c7d2fe", 300: "#a5b4fc", 400: "#818cf8", 500: "#6366f1", 600: "#4f46e5", 700: "#4338ca", 800: "#3730a3", 900: "#312e81", 950: "#1e1b4b" },
  violet:  { 50: "#f5f3ff", 100: "#ede9fe", 200: "#ddd6fe", 300: "#c4b5fd", 400: "#a78bfa", 500: "#8b5cf6", 600: "#7c3aed", 700: "#6d28d9", 800: "#5b21b6", 900: "#4c1d95", 950: "#2e1065" },
  purple:  { 50: "#faf5ff", 100: "#f3e8ff", 200: "#e9d5ff", 300: "#d8b4fe", 400: "#c084fc", 500: "#a855f7", 600: "#9333ea", 700: "#7e22ce", 800: "#6b21a8", 900: "#581c87", 950: "#3b0764" },
  fuchsia: { 50: "#fdf4ff", 100: "#fae8ff", 200: "#f5d0fe", 300: "#f0abfc", 400: "#e879f9", 500: "#d946ef", 600: "#c026d3", 700: "#a21caf", 800: "#86198f", 900: "#701a75", 950: "#4a044e" },
  pink:    { 50: "#fdf2f8", 100: "#fce7f3", 200: "#fbcfe8", 300: "#f9a8d4", 400: "#f472b6", 500: "#ec4899", 600: "#db2777", 700: "#be185d", 800: "#9d174d", 900: "#831843", 950: "#500724" },
  rose:    { 50: "#fff1f2", 100: "#ffe4e6", 200: "#fecdd3", 300: "#fda4af", 400: "#fb7185", 500: "#f43f5e", 600: "#e11d48", 700: "#be123c", 800: "#9f1239", 900: "#881337", 950: "#4c0519" },
};

// ---------------------------------------------------------------------------
// Static utility registry (built once on import)
// ---------------------------------------------------------------------------

/** @type {Map<string, string>} className -> CSS rule */
const registry = new Map();

// ---------------------------------------------------------------------------
// Spacing utilities: p-*, px-*, py-*, pt/pr/pb/pl-*, m-*, mx-*, my-*, mt/mr/mb/ml-*
// ---------------------------------------------------------------------------

const PADDING_MAP = {
  "p": "padding",
  "px": ["padding-left", "padding-right"],
  "py": ["padding-top", "padding-bottom"],
  "pt": "padding-top",
  "pr": "padding-right",
  "pb": "padding-bottom",
  "pl": "padding-left",
};

const MARGIN_MAP = {
  "m": "margin",
  "mx": ["margin-left", "margin-right"],
  "my": ["margin-top", "margin-bottom"],
  "mt": "margin-top",
  "mr": "margin-right",
  "mb": "margin-bottom",
  "ml": "margin-left",
};

function registerSpacing() {
  for (const [prefix, prop] of Object.entries(PADDING_MAP)) {
    for (const [scale, value] of Object.entries(SPACING_SCALE)) {
      const cls = `${prefix}-${scale}`;
      if (Array.isArray(prop)) {
        registry.set(cls, `.${escapeCssClass(cls)} { ${prop.map(p => `${p}: ${value}`).join("; ")} }`);
      } else {
        registry.set(cls, `.${escapeCssClass(cls)} { ${prop}: ${value} }`);
      }
    }
  }

  for (const [prefix, prop] of Object.entries(MARGIN_MAP)) {
    for (const [scale, value] of Object.entries(SPACING_SCALE)) {
      const cls = `${prefix}-${scale}`;
      if (Array.isArray(prop)) {
        registry.set(cls, `.${escapeCssClass(cls)} { ${prop.map(p => `${p}: ${value}`).join("; ")} }`);
      } else {
        registry.set(cls, `.${escapeCssClass(cls)} { ${prop}: ${value} }`);
      }
    }
    // Auto margin
    if (prefix === "mx" || prefix === "my" || prefix === "m" || prefix === "ml" || prefix === "mr" || prefix === "mt" || prefix === "mb") {
      const cls = `${prefix}-auto`;
      if (Array.isArray(prop)) {
        registry.set(cls, `.${escapeCssClass(cls)} { ${prop.map(p => `${p}: auto`).join("; ")} }`);
      } else {
        registry.set(cls, `.${escapeCssClass(cls)} { ${prop}: auto }`);
      }
    }
  }

  // space-x-* and space-y-*. Per Tailwind v3, the margin lands on the
  // adjacent sibling: `.space-y-{N} > :not([hidden]) ~ :not([hidden])`
  // applies margin-top to every child after the first (modulo `[hidden]`).
  for (const [scale, value] of Object.entries(SPACING_SCALE)) {
    registry.set(`space-x-${scale}`, `.space-x-${escapeCssClass(scale)} > :not([hidden]) ~ :not([hidden]) { margin-left: ${value} }`);
    registry.set(`space-y-${scale}`, `.space-y-${escapeCssClass(scale)} > :not([hidden]) ~ :not([hidden]) { margin-top: ${value} }`);
  }

  // space-x-reverse and space-y-reverse swap which sibling receives the
  // margin via the --tw-space-{x,y}-reverse custom property (Tailwind v3
  // behavior). When `reverse` is applied with a numeric scale, the margin
  // lands on the LEFT/TOP sibling instead of the RIGHT/BOTTOM one.
  registry.set("space-x-reverse", ".space-x-reverse > :not([hidden]) ~ :not([hidden]) { --tw-space-x-reverse: 1 }");
  registry.set("space-y-reverse", ".space-y-reverse > :not([hidden]) ~ :not([hidden]) { --tw-space-y-reverse: 1 }");
}

// ---------------------------------------------------------------------------
// Sizing: w-*, h-*, min-w-*, min-h-*, max-w-*, max-h-*
// ---------------------------------------------------------------------------

const SIZE_SCALE = {
  ...SPACING_SCALE,
  "auto": "auto",
  "1/2": "50%",
  "1/3": "33.333333%",
  "2/3": "66.666667%",
  "1/4": "25%",
  "2/4": "50%",
  "3/4": "75%",
  "1/5": "20%",
  "2/5": "40%",
  "3/5": "60%",
  "4/5": "80%",
  "1/6": "16.666667%",
  "full": "100%",
  "screen": "100vw",
  "min": "min-content",
  "max": "max-content",
  "fit": "fit-content",
};

const HEIGHT_SCALE = {
  ...SPACING_SCALE,
  "auto": "auto",
  "1/2": "50%",
  "1/3": "33.333333%",
  "2/3": "66.666667%",
  "1/4": "25%",
  "2/4": "50%",
  "3/4": "75%",
  "1/5": "20%",
  "2/5": "40%",
  "3/5": "60%",
  "4/5": "80%",
  "1/6": "16.666667%",
  "full": "100%",
  "screen": "100vh",
  "min": "min-content",
  "max": "max-content",
  "fit": "fit-content",
};

function registerSizing() {
  for (const [scale, value] of Object.entries(SIZE_SCALE)) {
    registry.set(`w-${scale}`, `.${escapeCssClass(`w-${scale}`)} { width: ${value} }`);
  }
  for (const [scale, value] of Object.entries(HEIGHT_SCALE)) {
    registry.set(`h-${scale}`, `.${escapeCssClass(`h-${scale}`)} { height: ${value} }`);
  }

  // min-w, max-w
  for (const [k, v] of [["0", "0px"], ["full", "100%"], ["min", "min-content"], ["max", "max-content"], ["fit", "fit-content"], ["screen", "100vw"]]) {
    registry.set(`min-w-${k}`, `.${escapeCssClass(`min-w-${k}`)} { min-width: ${v} }`);
    registry.set(`max-w-${k}`, `.${escapeCssClass(`max-w-${k}`)} { max-width: ${v} }`);
  }
  // Common max-w breakpoints
  for (const [k, v] of [["xs", "20rem"], ["sm", "24rem"], ["md", "28rem"], ["lg", "32rem"], ["xl", "36rem"], ["2xl", "42rem"], ["3xl", "48rem"], ["4xl", "56rem"], ["5xl", "64rem"], ["6xl", "72rem"], ["7xl", "80rem"]]) {
    registry.set(`max-w-${k}`, `.${escapeCssClass(`max-w-${k}`)} { max-width: ${v} }`);
  }

  // min-h, max-h
  for (const [k, v] of [["0", "0px"], ["full", "100%"], ["min", "min-content"], ["max", "max-content"], ["fit", "fit-content"], ["screen", "100vh"]]) {
    registry.set(`min-h-${k}`, `.${escapeCssClass(`min-h-${k}`)} { min-height: ${v} }`);
    registry.set(`max-h-${k}`, `.${escapeCssClass(`max-h-${k}`)} { max-height: ${v} }`);
  }
}

// ---------------------------------------------------------------------------
// Flexbox
// ---------------------------------------------------------------------------

function registerFlexbox() {
  registry.set("flex", ".flex { display: flex }");
  registry.set("inline-flex", ".inline-flex { display: inline-flex }");
  registry.set("flex-row", ".flex-row { flex-direction: row }");
  registry.set("flex-row-reverse", ".flex-row-reverse { flex-direction: row-reverse }");
  registry.set("flex-col", ".flex-col { flex-direction: column }");
  registry.set("flex-col-reverse", ".flex-col-reverse { flex-direction: column-reverse }");
  registry.set("flex-wrap", ".flex-wrap { flex-wrap: wrap }");
  registry.set("flex-nowrap", ".flex-nowrap { flex-wrap: nowrap }");
  registry.set("flex-wrap-reverse", ".flex-wrap-reverse { flex-wrap: wrap-reverse }");
  registry.set("flex-1", ".flex-1 { flex: 1 1 0% }");
  registry.set("flex-auto", ".flex-auto { flex: 1 1 auto }");
  registry.set("flex-initial", ".flex-initial { flex: 0 1 auto }");
  registry.set("flex-none", ".flex-none { flex: none }");
  registry.set("grow", ".grow { flex-grow: 1 }");
  registry.set("grow-0", ".grow-0 { flex-grow: 0 }");
  registry.set("shrink", ".shrink { flex-shrink: 1 }");
  registry.set("shrink-0", ".shrink-0 { flex-shrink: 0 }");

  // items-*
  for (const [k, v] of [["start", "flex-start"], ["end", "flex-end"], ["center", "center"], ["baseline", "baseline"], ["stretch", "stretch"]]) {
    registry.set(`items-${k}`, `.items-${k} { align-items: ${v} }`);
  }

  // justify-*
  for (const [k, v] of [["start", "flex-start"], ["end", "flex-end"], ["center", "center"], ["between", "space-between"], ["around", "space-around"], ["evenly", "space-evenly"]]) {
    registry.set(`justify-${k}`, `.justify-${k} { justify-content: ${v} }`);
  }

  // gap-*
  for (const [scale, value] of Object.entries(SPACING_SCALE)) {
    registry.set(`gap-${scale}`, `.${escapeCssClass(`gap-${scale}`)} { gap: ${value} }`);
    registry.set(`gap-x-${scale}`, `.${escapeCssClass(`gap-x-${scale}`)} { column-gap: ${value} }`);
    registry.set(`gap-y-${scale}`, `.${escapeCssClass(`gap-y-${scale}`)} { row-gap: ${value} }`);
  }
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

function registerGrid() {
  registry.set("grid", ".grid { display: grid }");
  registry.set("inline-grid", ".inline-grid { display: inline-grid }");

  // grid-cols-1 through grid-cols-12 + none
  for (let i = 1; i <= 12; i++) {
    registry.set(`grid-cols-${i}`, `.grid-cols-${i} { grid-template-columns: repeat(${i}, minmax(0, 1fr)) }`);
  }
  registry.set("grid-cols-none", ".grid-cols-none { grid-template-columns: none }");

  // grid-rows-1 through grid-rows-6 + none
  for (let i = 1; i <= 6; i++) {
    registry.set(`grid-rows-${i}`, `.grid-rows-${i} { grid-template-rows: repeat(${i}, minmax(0, 1fr)) }`);
  }
  registry.set("grid-rows-none", ".grid-rows-none { grid-template-rows: none }");

  // col-span-1 through col-span-12 + full
  for (let i = 1; i <= 12; i++) {
    registry.set(`col-span-${i}`, `.col-span-${i} { grid-column: span ${i} / span ${i} }`);
  }
  registry.set("col-span-full", ".col-span-full { grid-column: 1 / -1 }");

  // row-span-1 through row-span-6 + full
  for (let i = 1; i <= 6; i++) {
    registry.set(`row-span-${i}`, `.row-span-${i} { grid-row: span ${i} / span ${i} }`);
  }
  registry.set("row-span-full", ".row-span-full { grid-row: 1 / -1 }");
}

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

function registerTypography() {
  // Text sizes
  const TEXT_SIZES = {
    "xs": ["0.75rem", "1rem"],
    "sm": ["0.875rem", "1.25rem"],
    "base": ["1rem", "1.5rem"],
    "lg": ["1.125rem", "1.75rem"],
    "xl": ["1.25rem", "1.75rem"],
    "2xl": ["1.5rem", "2rem"],
    "3xl": ["1.875rem", "2.25rem"],
    "4xl": ["2.25rem", "2.5rem"],
    "5xl": ["3rem", "1"],
    "6xl": ["3.75rem", "1"],
    "7xl": ["4.5rem", "1"],
    "8xl": ["6rem", "1"],
    "9xl": ["8rem", "1"],
  };

  for (const [k, [fs, lh]] of Object.entries(TEXT_SIZES)) {
    registry.set(`text-${k}`, `.text-${escapeCssClass(k)} { font-size: ${fs}; line-height: ${lh} }`);
  }

  // Font weights
  const FONT_WEIGHTS = {
    "thin": "100",
    "extralight": "200",
    "light": "300",
    "normal": "400",
    "medium": "500",
    "semibold": "600",
    "bold": "700",
    "extrabold": "800",
    "black": "900",
  };

  for (const [k, v] of Object.entries(FONT_WEIGHTS)) {
    registry.set(`font-${k}`, `.font-${k} { font-weight: ${v} }`);
  }

  // Font families (Tailwind v3 defaults). Each value is the full font-family stack.
  const FONT_FAMILY = {
    "sans": `ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"`,
    "serif": `ui-serif, Georgia, Cambria, "Times New Roman", Times, serif`,
    "mono": `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`,
  };

  for (const [k, v] of Object.entries(FONT_FAMILY)) {
    registry.set(`font-${k}`, `.font-${k} { font-family: ${v} }`);
  }

  // Text alignment
  registry.set("text-left", ".text-left { text-align: left }");
  registry.set("text-center", ".text-center { text-align: center }");
  registry.set("text-right", ".text-right { text-align: right }");
  registry.set("text-justify", ".text-justify { text-align: justify }");

  // Leading (line-height)
  const LEADING = {
    "3": ".75rem", "4": "1rem", "5": "1.25rem", "6": "1.5rem",
    "7": "1.75rem", "8": "2rem", "9": "2.25rem", "10": "2.5rem",
    "none": "1", "tight": "1.25", "snug": "1.375",
    "normal": "1.5", "relaxed": "1.625", "loose": "2",
  };

  for (const [k, v] of Object.entries(LEADING)) {
    registry.set(`leading-${k}`, `.leading-${k} { line-height: ${v} }`);
  }

  // Tracking (letter-spacing)
  const TRACKING = {
    "tighter": "-0.05em", "tight": "-0.025em", "normal": "0em",
    "wide": "0.025em", "wider": "0.05em", "widest": "0.1em",
  };

  for (const [k, v] of Object.entries(TRACKING)) {
    registry.set(`tracking-${k}`, `.tracking-${k} { letter-spacing: ${v} }`);
  }

  // Text transforms
  registry.set("uppercase", ".uppercase { text-transform: uppercase }");
  registry.set("lowercase", ".lowercase { text-transform: lowercase }");
  registry.set("capitalize", ".capitalize { text-transform: capitalize }");
  registry.set("normal-case", ".normal-case { text-transform: none }");

  // Truncate
  registry.set("truncate", ".truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }");

  // Whitespace
  registry.set("whitespace-normal", ".whitespace-normal { white-space: normal }");
  registry.set("whitespace-nowrap", ".whitespace-nowrap { white-space: nowrap }");
  registry.set("whitespace-pre", ".whitespace-pre { white-space: pre }");

  // Font style
  registry.set("italic", ".italic { font-style: italic }");
  registry.set("not-italic", ".not-italic { font-style: normal }");

  // Text decoration
  registry.set("underline", ".underline { text-decoration-line: underline }");
  registry.set("overline", ".overline { text-decoration-line: overline }");
  registry.set("line-through", ".line-through { text-decoration-line: line-through }");
  registry.set("no-underline", ".no-underline { text-decoration-line: none }");

  // List style type
  registry.set("list-disc", ".list-disc { list-style-type: disc }");
  registry.set("list-decimal", ".list-decimal { list-style-type: decimal }");
  registry.set("list-none", ".list-none { list-style-type: none }");
  registry.set("list-square", ".list-square { list-style-type: square }");

  // List style position
  registry.set("list-inside", ".list-inside { list-style-position: inside }");
  registry.set("list-outside", ".list-outside { list-style-position: outside }");
}

// ---------------------------------------------------------------------------
// Colors: text-{color}-{shade}, bg-{color}-{shade}
// ---------------------------------------------------------------------------

function registerColors() {
  // Special colors
  registry.set("text-white", ".text-white { color: #ffffff }");
  registry.set("text-black", ".text-black { color: #000000 }");
  registry.set("text-transparent", ".text-transparent { color: transparent }");
  registry.set("bg-white", ".bg-white { background-color: #ffffff }");
  registry.set("bg-black", ".bg-black { background-color: #000000 }");
  registry.set("bg-transparent", ".bg-transparent { background-color: transparent }");

  for (const [colorName, shades] of Object.entries(COLOR_PALETTE)) {
    for (const shade of COLOR_SHADES) {
      const hex = shades[shade];
      if (!hex) continue;
      registry.set(`text-${colorName}-${shade}`, `.text-${colorName}-${shade} { color: ${hex} }`);
      registry.set(`bg-${colorName}-${shade}`, `.bg-${colorName}-${shade} { background-color: ${hex} }`);
    }
  }
}

// ---------------------------------------------------------------------------
// Borders
// ---------------------------------------------------------------------------

function registerBorders() {
  // Border widths
  registry.set("border", ".border { border-width: 1px }");
  registry.set("border-0", ".border-0 { border-width: 0px }");
  registry.set("border-2", ".border-2 { border-width: 2px }");
  registry.set("border-4", ".border-4 { border-width: 4px }");
  registry.set("border-8", ".border-8 { border-width: 8px }");

  // Border sides
  for (const [side, prop] of [["t", "border-top-width"], ["r", "border-right-width"], ["b", "border-bottom-width"], ["l", "border-left-width"]]) {
    registry.set(`border-${side}`, `.border-${side} { ${prop}: 1px }`);
    registry.set(`border-${side}-0`, `.border-${side}-0 { ${prop}: 0px }`);
    registry.set(`border-${side}-2`, `.border-${side}-2 { ${prop}: 2px }`);
    registry.set(`border-${side}-4`, `.border-${side}-4 { ${prop}: 4px }`);
  }

  // Border colors
  for (const [colorName, shades] of Object.entries(COLOR_PALETTE)) {
    for (const shade of COLOR_SHADES) {
      const hex = shades[shade];
      if (!hex) continue;
      registry.set(`border-${colorName}-${shade}`, `.border-${colorName}-${shade} { border-color: ${hex} }`);
    }
  }
  registry.set("border-white", ".border-white { border-color: #ffffff }");
  registry.set("border-black", ".border-black { border-color: #000000 }");
  registry.set("border-transparent", ".border-transparent { border-color: transparent }");

  // Border style
  registry.set("border-solid", ".border-solid { border-style: solid }");
  registry.set("border-dashed", ".border-dashed { border-style: dashed }");
  registry.set("border-dotted", ".border-dotted { border-style: dotted }");
  registry.set("border-none", ".border-none { border-style: none }");

  // Rounded
  const ROUNDED_SIZES = {
    "": "0.25rem", "none": "0px", "sm": "0.125rem", "md": "0.375rem",
    "lg": "0.5rem", "xl": "0.75rem", "2xl": "1rem", "3xl": "1.5rem", "full": "9999px",
  };

  for (const [k, v] of Object.entries(ROUNDED_SIZES)) {
    const cls = k ? `rounded-${k}` : "rounded";
    registry.set(cls, `.${escapeCssClass(cls)} { border-radius: ${v} }`);
  }

  // Rounded per-side
  for (const [side, props] of [
    ["t", ["border-top-left-radius", "border-top-right-radius"]],
    ["r", ["border-top-right-radius", "border-bottom-right-radius"]],
    ["b", ["border-bottom-right-radius", "border-bottom-left-radius"]],
    ["l", ["border-top-left-radius", "border-bottom-left-radius"]],
  ]) {
    for (const [k, v] of Object.entries(ROUNDED_SIZES)) {
      const cls = k ? `rounded-${side}-${k}` : `rounded-${side}`;
      registry.set(cls, `.${escapeCssClass(cls)} { ${props.map(p => `${p}: ${v}`).join("; ")} }`);
    }
  }
}

// ---------------------------------------------------------------------------
// Effects: shadow, opacity
// ---------------------------------------------------------------------------

function registerEffects() {
  const SHADOWS = {
    "sm": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
    "": "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
    "md": "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
    "lg": "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
    "xl": "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
    "2xl": "0 25px 50px -12px rgb(0 0 0 / 0.25)",
    "inner": "inset 0 2px 4px 0 rgb(0 0 0 / 0.05)",
    "none": "0 0 #0000",
  };

  for (const [k, v] of Object.entries(SHADOWS)) {
    const cls = k ? `shadow-${k}` : "shadow";
    registry.set(cls, `.${escapeCssClass(cls)} { box-shadow: ${v} }`);
  }

  // Opacity
  for (const n of [0, 5, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 95, 100]) {
    registry.set(`opacity-${n}`, `.opacity-${n} { opacity: ${n / 100} }`);
  }
}

// ---------------------------------------------------------------------------
// Layout: display, position, overflow, z-index, inset
// ---------------------------------------------------------------------------

function registerLayout() {
  // Display
  registry.set("block", ".block { display: block }");
  registry.set("inline-block", ".inline-block { display: inline-block }");
  registry.set("inline", ".inline { display: inline }");
  registry.set("hidden", ".hidden { display: none }");
  registry.set("table", ".table { display: table }");
  registry.set("table-row", ".table-row { display: table-row }");
  registry.set("table-cell", ".table-cell { display: table-cell }");

  // Position
  registry.set("static", ".static { position: static }");
  registry.set("relative", ".relative { position: relative }");
  registry.set("absolute", ".absolute { position: absolute }");
  registry.set("fixed", ".fixed { position: fixed }");
  registry.set("sticky", ".sticky { position: sticky }");

  // Overflow
  for (const v of ["auto", "hidden", "visible", "scroll", "clip"]) {
    registry.set(`overflow-${v}`, `.overflow-${v} { overflow: ${v} }`);
    registry.set(`overflow-x-${v}`, `.overflow-x-${v} { overflow-x: ${v} }`);
    registry.set(`overflow-y-${v}`, `.overflow-y-${v} { overflow-y: ${v} }`);
  }

  // Inset (top, right, bottom, left)
  for (const [dir, prop] of [["top", "top"], ["right", "right"], ["bottom", "bottom"], ["left", "left"]]) {
    for (const [scale, value] of Object.entries(SPACING_SCALE)) {
      registry.set(`${dir}-${scale}`, `.${escapeCssClass(`${dir}-${scale}`)} { ${prop}: ${value} }`);
    }
    registry.set(`${dir}-auto`, `.${dir}-auto { ${prop}: auto }`);
    registry.set(`${dir}-full`, `.${dir}-full { ${prop}: 100% }`);
  }
  // inset-*
  for (const [scale, value] of Object.entries(SPACING_SCALE)) {
    registry.set(`inset-${scale}`, `.${escapeCssClass(`inset-${scale}`)} { inset: ${value} }`);
  }
  registry.set("inset-auto", ".inset-auto { inset: auto }");

  // Z-index
  for (const n of [0, 10, 20, 30, 40, 50]) {
    registry.set(`z-${n}`, `.z-${n} { z-index: ${n} }`);
  }
  registry.set("z-auto", ".z-auto { z-index: auto }");

  // Object fit
  registry.set("object-contain", ".object-contain { object-fit: contain }");
  registry.set("object-cover", ".object-cover { object-fit: cover }");
  registry.set("object-fill", ".object-fill { object-fit: fill }");
  registry.set("object-none", ".object-none { object-fit: none }");

  // Cursor
  registry.set("cursor-pointer", ".cursor-pointer { cursor: pointer }");
  registry.set("cursor-default", ".cursor-default { cursor: default }");
  registry.set("cursor-not-allowed", ".cursor-not-allowed { cursor: not-allowed }");
  registry.set("cursor-wait", ".cursor-wait { cursor: wait }");

  // Pointer events
  registry.set("pointer-events-none", ".pointer-events-none { pointer-events: none }");
  registry.set("pointer-events-auto", ".pointer-events-auto { pointer-events: auto }");

  // Select
  registry.set("select-none", ".select-none { user-select: none }");
  registry.set("select-text", ".select-text { user-select: text }");
  registry.set("select-all", ".select-all { user-select: all }");
  registry.set("select-auto", ".select-auto { user-select: auto }");

  // Table — border-collapse + table-layout
  registry.set("border-collapse", ".border-collapse { border-collapse: collapse }");
  registry.set("border-separate", ".border-separate { border-collapse: separate }");
  registry.set("table-auto", ".table-auto { table-layout: auto }");
  registry.set("table-fixed", ".table-fixed { table-layout: fixed }");
}

// ---------------------------------------------------------------------------
// Typography plugin: prose, prose-{color}, prose-{size}, not-prose
// (Tailwind v3 @tailwindcss/typography port — SPEC §26.6)
// ---------------------------------------------------------------------------
//
// Implementation strategy: rather than hand-author hundreds of lines of CSS
// string literals, we describe the prose nested-element styling as a
// structured spec (element selector → declarations) and emit it via a
// builder. Each nested rule is suffixed `:not(:where([class~="not-prose"] *))`
// so that the `not-prose` opt-out marker works at any depth without bumping
// specificity. Tailwind v3 wraps the element selector itself in `:where()`
// for the same reason — descendant rules stay specificity 0,1,0.
//
// Color and size variants override specific declarations on the base prose
// shape. We re-emit only the changed declarations so callers can compose
// `prose prose-slate prose-lg` and get the union behavior cleanly.

/**
 * Build a single nested prose rule.
 *
 *   .{proseClass} :where({selector}):not(:where([class~="not-prose"] *)) { decls }
 *
 * `proseClass` is the outer container class (e.g. "prose", "prose-slate",
 * "prose-lg"). `selector` is the descendant element selector (e.g. "p",
 * "h1", "blockquote", "code:not(pre code)").
 *
 * @param {string} proseClass
 * @param {string} selector
 * @param {string} decls   semicolon-separated declarations, no trailing `;`
 * @returns {string}
 */
function buildProseRule(proseClass, selector, decls) {
  return `.${proseClass} :where(${selector}):not(:where([class~="not-prose"] *)) { ${decls} }`;
}

/**
 * Emit the base `.prose` rule + all nested-element rules for the bare
 * `prose` class. Mirrors Tailwind v3 typography plugin's `DEFAULTS.css`
 * shape; values come from the plugin's slate-700 / 1.75 line-height
 * defaults.
 *
 * @returns {string[]}
 */
function buildBaseProseRules() {
  const rules = [];

  // The outermost `.prose` rule itself — color, max-width, line-height,
  // baseline font-size.
  rules.push(
    `.prose { color: #374151; max-width: 65ch; font-size: 1rem; line-height: 1.75 }`
  );

  // Helper: nested rule with the not-prose opt-out suffix.
  const r = (sel, decls) => buildProseRule("prose", sel, decls);

  // Paragraphs
  rules.push(r("p", "margin-top: 1.25em; margin-bottom: 1.25em"));

  // Lead paragraph (first paragraph with .lead applied)
  rules.push(r("[class~=\"lead\"]", "color: #4b5563; font-size: 1.25em; line-height: 1.6; margin-top: 1.2em; margin-bottom: 1.2em"));

  // Links
  rules.push(r("a", "color: #111827; text-decoration: underline; font-weight: 500"));

  // Strong / em
  rules.push(r("strong", "color: #111827; font-weight: 600"));
  rules.push(r("a strong", "color: inherit"));
  rules.push(r("blockquote strong", "color: inherit"));
  rules.push(r("thead th strong", "color: inherit"));
  rules.push(r("em", "font-style: italic"));

  // Lists — ordered / unordered / list items
  rules.push(r("ol", "list-style-type: decimal; margin-top: 1.25em; margin-bottom: 1.25em; padding-left: 1.625em"));
  rules.push(r("ol[type=\"A\"]", "list-style-type: upper-alpha"));
  rules.push(r("ol[type=\"a\"]", "list-style-type: lower-alpha"));
  rules.push(r("ol[type=\"I\"]", "list-style-type: upper-roman"));
  rules.push(r("ol[type=\"i\"]", "list-style-type: lower-roman"));
  rules.push(r("ol[type=\"1\"]", "list-style-type: decimal"));
  rules.push(r("ul", "list-style-type: disc; margin-top: 1.25em; margin-bottom: 1.25em; padding-left: 1.625em"));
  rules.push(r("li", "margin-top: 0.5em; margin-bottom: 0.5em"));
  rules.push(r("ol > li", "padding-left: 0.375em"));
  rules.push(r("ul > li", "padding-left: 0.375em"));
  rules.push(r("> ul > li p", "margin-top: 0.75em; margin-bottom: 0.75em"));
  rules.push(r("> ul > li > *:first-child", "margin-top: 1.25em"));
  rules.push(r("> ul > li > *:last-child", "margin-bottom: 1.25em"));
  rules.push(r("> ol > li > *:first-child", "margin-top: 1.25em"));
  rules.push(r("> ol > li > *:last-child", "margin-bottom: 1.25em"));
  rules.push(r("ul ul, ul ol, ol ul, ol ol", "margin-top: 0.75em; margin-bottom: 0.75em"));

  // Horizontal rule
  rules.push(r("hr", "border-color: #e5e7eb; border-top-width: 1px; margin-top: 3em; margin-bottom: 3em"));

  // Blockquote
  rules.push(r("blockquote", "font-weight: 500; font-style: italic; color: #111827; border-left-width: 0.25rem; border-left-color: #e5e7eb; quotes: \"\\201C\" \"\\201D\" \"\\2018\" \"\\2019\"; margin-top: 1.6em; margin-bottom: 1.6em; padding-left: 1em"));
  rules.push(r("blockquote p:first-of-type::before", "content: open-quote"));
  rules.push(r("blockquote p:last-of-type::after", "content: close-quote"));

  // Headings — h1..h4
  rules.push(r("h1", "color: #111827; font-weight: 800; font-size: 2.25em; margin-top: 0; margin-bottom: 0.8888889em; line-height: 1.1111111"));
  rules.push(r("h1 strong", "font-weight: 900; color: inherit"));
  rules.push(r("h2", "color: #111827; font-weight: 700; font-size: 1.5em; margin-top: 2em; margin-bottom: 1em; line-height: 1.3333333"));
  rules.push(r("h2 strong", "font-weight: 800; color: inherit"));
  rules.push(r("h3", "color: #111827; font-weight: 600; font-size: 1.25em; margin-top: 1.6em; margin-bottom: 0.6em; line-height: 1.6"));
  rules.push(r("h3 strong", "font-weight: 700; color: inherit"));
  rules.push(r("h4", "color: #111827; font-weight: 600; margin-top: 1.5em; margin-bottom: 0.5em; line-height: 1.5"));
  rules.push(r("h4 strong", "font-weight: 700; color: inherit"));

  // Images / figures / videos
  rules.push(r("img", "margin-top: 2em; margin-bottom: 2em"));
  rules.push(r("picture", "display: block; margin-top: 2em; margin-bottom: 2em"));
  rules.push(r("video", "margin-top: 2em; margin-bottom: 2em"));
  rules.push(r("kbd", "font-weight: 500; font-family: inherit; color: #111827; box-shadow: 0 0 0 1px rgb(0 0 0 / 0.1), 0 3px 0 rgb(0 0 0 / 0.1); font-size: 0.875em; border-radius: 0.3125rem; padding-top: 0.1875em; padding-right: 0.375em; padding-bottom: 0.1875em; padding-left: 0.375em"));
  rules.push(r("figure", "margin-top: 2em; margin-bottom: 2em"));
  rules.push(r("figure > *", "margin-top: 0; margin-bottom: 0"));
  rules.push(r("figcaption", "color: #6b7280; font-size: 0.875em; line-height: 1.4285714; margin-top: 0.8571429em"));

  // Inline code + code blocks
  // (Inline code is `<code>` not inside `<pre>`; the `:not(pre code)`
  // selector keeps block code from inheriting the inline-code styling.)
  rules.push(r("code", "color: #111827; font-weight: 600; font-size: 0.875em; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace"));
  rules.push(r("code::before", "content: \"`\""));
  rules.push(r("code::after", "content: \"`\""));
  rules.push(r("a code", "color: inherit"));
  rules.push(r("h1 code, h2 code, h3 code, h4 code", "color: inherit"));
  rules.push(r("blockquote code", "color: inherit"));
  rules.push(r("thead th code", "color: inherit"));
  rules.push(r("pre", "color: #e5e7eb; background-color: #1f2937; overflow-x: auto; font-weight: 400; font-size: 0.875em; line-height: 1.7142857; margin-top: 1.7142857em; margin-bottom: 1.7142857em; border-radius: 0.375rem; padding-top: 0.8571429em; padding-right: 1.1428571em; padding-bottom: 0.8571429em; padding-left: 1.1428571em; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace"));
  rules.push(r("pre code", "background-color: transparent; border-width: 0; border-radius: 0; padding: 0; font-weight: inherit; color: inherit; font-size: inherit; font-family: inherit; line-height: inherit"));
  rules.push(r("pre code::before", "content: none"));
  rules.push(r("pre code::after", "content: none"));

  // Tables
  rules.push(r("table", "width: 100%; table-layout: auto; text-align: left; margin-top: 2em; margin-bottom: 2em; font-size: 0.875em; line-height: 1.7142857"));
  rules.push(r("thead", "border-bottom-width: 1px; border-bottom-color: #d1d5db"));
  rules.push(r("thead th", "color: #111827; font-weight: 600; vertical-align: bottom; padding-right: 0.5714286em; padding-bottom: 0.5714286em; padding-left: 0.5714286em"));
  rules.push(r("tbody tr", "border-bottom-width: 1px; border-bottom-color: #e5e7eb"));
  rules.push(r("tbody tr:last-child", "border-bottom-width: 0"));
  rules.push(r("tbody td", "vertical-align: baseline; padding: 0.5714286em"));
  rules.push(r("tfoot", "border-top-width: 1px; border-top-color: #d1d5db"));
  rules.push(r("tfoot td", "vertical-align: top; padding: 0.5714286em"));

  return rules;
}

/**
 * Color-variant overrides for `prose-{color}`. Each variant overrides
 * body-text color, heading colors, link colors, strong colors, code
 * colors, blockquote, hr, table borders, etc. against the named color's
 * shade palette.
 *
 * Tailwind v3 ships variants for slate, gray, zinc, neutral, stone — the
 * five neutral palettes already present in COLOR_PALETTE.
 *
 * Per Tailwind v3, the prose-{color} variant only changes the
 * gray-tone scale used for body/headings/code. We map shade overrides:
 *
 *   body          → 700
 *   headings      → 900
 *   lead          → 600
 *   links         → 900
 *   bold          → 900
 *   counters      → 500
 *   bullets       → 300
 *   hr / border   → 200
 *   quotes        → 900
 *   captions      → 500
 *   kbd           → 900
 *   code          → 900
 *   pre code      → 200
 *   pre bg        → 800
 *   th borders    → 300
 *   td borders    → 200
 *
 * @param {string} colorName  one of slate / gray / zinc / neutral / stone
 * @returns {string[]}
 */
function buildProseColorRules(colorName) {
  const shades = COLOR_PALETTE[colorName];
  if (!shades) return [];

  const cls = `prose-${colorName}`;
  const r = (sel, decls) => buildProseRule(cls, sel, decls);
  const rules = [];

  // No outer `.prose-{color}` self rule; the variant only overrides
  // descendant styling. Body color override happens on the container
  // via a non-nested rule for the `prose` class itself when combined.
  // Tailwind v3 does this via CSS custom properties — we inline the
  // colors directly here for simpler emission.

  rules.push(`.${cls} { color: ${shades[700]} }`);
  rules.push(r("[class~=\"lead\"]", `color: ${shades[600]}`));
  rules.push(r("a", `color: ${shades[900]}`));
  rules.push(r("strong", `color: ${shades[900]}`));
  rules.push(r("ol > li::marker", `color: ${shades[500]}`));
  rules.push(r("ul > li::marker", `color: ${shades[300]}`));
  rules.push(r("hr", `border-color: ${shades[200]}`));
  rules.push(r("blockquote", `color: ${shades[900]}; border-left-color: ${shades[200]}`));
  rules.push(r("h1", `color: ${shades[900]}`));
  rules.push(r("h2", `color: ${shades[900]}`));
  rules.push(r("h3", `color: ${shades[900]}`));
  rules.push(r("h4", `color: ${shades[900]}`));
  rules.push(r("kbd", `color: ${shades[900]}`));
  rules.push(r("code", `color: ${shades[900]}`));
  rules.push(r("pre", `color: ${shades[200]}; background-color: ${shades[800]}`));
  rules.push(r("thead", `border-bottom-color: ${shades[300]}`));
  rules.push(r("thead th", `color: ${shades[900]}`));
  rules.push(r("tbody tr", `border-bottom-color: ${shades[200]}`));
  rules.push(r("tfoot", `border-top-color: ${shades[300]}`));
  rules.push(r("figcaption", `color: ${shades[500]}`));

  return rules;
}

/**
 * Size-variant overrides. Each `prose-{size}` overrides font-size,
 * line-height, and per-element margin/padding/font-size scales.
 *
 * Tailwind v3 ships prose-sm, prose-base, prose-lg, prose-xl, prose-2xl.
 * The per-size specs are the ones from the Tailwind v3 plugin
 * `styles.js` (sm / base / lg / xl / 2xl).
 *
 * To keep this readable, each entry is a fontSize/lineHeight pair plus a
 * minimal element-override set (paragraph/heading/code/pre). Adopters
 * needing finer-grained overrides per element can layer additional
 * utilities or write per-page CSS.
 *
 * @returns {Map<string, string[]>}   size variant class -> rule strings
 */
function buildProseSizeRules() {
  const sizes = {
    "sm": {
      fontSize: "0.875rem",
      lineHeight: "1.7142857",
      h1: "2.1428571em; margin-top: 0; margin-bottom: 0.8em; line-height: 1.2",
      h2: "1.4285714em; margin-top: 1.6em; margin-bottom: 0.8em; line-height: 1.4",
      h3: "1.2857143em; margin-top: 1.5555556em; margin-bottom: 0.4444444em; line-height: 1.5555556",
      h4: "margin-top: 1.4285714em; margin-bottom: 0.5714286em; line-height: 1.4285714",
      pre: "font-size: 0.7857143em; line-height: 1.6363636; margin-top: 1.6363636em; margin-bottom: 1.6363636em; border-radius: 0.25rem; padding-top: 0.6363636em; padding-right: 1em; padding-bottom: 0.6363636em; padding-left: 1em",
      code: "font-size: 0.8571429em",
    },
    "base": {
      fontSize: "1rem",
      lineHeight: "1.75",
      h1: "2.25em; margin-top: 0; margin-bottom: 0.8888889em; line-height: 1.1111111",
      h2: "1.5em; margin-top: 2em; margin-bottom: 1em; line-height: 1.3333333",
      h3: "1.25em; margin-top: 1.6em; margin-bottom: 0.6em; line-height: 1.6",
      h4: "margin-top: 1.5em; margin-bottom: 0.5em; line-height: 1.5",
      pre: "font-size: 0.875em; line-height: 1.7142857; margin-top: 1.7142857em; margin-bottom: 1.7142857em; border-radius: 0.375rem; padding-top: 0.8571429em; padding-right: 1.1428571em; padding-bottom: 0.8571429em; padding-left: 1.1428571em",
      code: "font-size: 0.875em",
    },
    "lg": {
      fontSize: "1.125rem",
      lineHeight: "1.7777778",
      h1: "2.6666667em; margin-top: 0; margin-bottom: 0.8333333em; line-height: 1",
      h2: "1.6666667em; margin-top: 1.8666667em; margin-bottom: 1.0666667em; line-height: 1.3333333",
      h3: "1.3333333em; margin-top: 1.6666667em; margin-bottom: 0.6666667em; line-height: 1.5",
      h4: "margin-top: 1.7777778em; margin-bottom: 0.4444444em; line-height: 1.5555556",
      pre: "font-size: 0.8888889em; line-height: 1.75; margin-top: 2em; margin-bottom: 2em; border-radius: 0.375rem; padding-top: 1em; padding-right: 1.5em; padding-bottom: 1em; padding-left: 1.5em",
      code: "font-size: 0.8888889em",
    },
    "xl": {
      fontSize: "1.25rem",
      lineHeight: "1.8",
      h1: "2.8em; margin-top: 0; margin-bottom: 0.8571429em; line-height: 1",
      h2: "1.8em; margin-top: 1.5555556em; margin-bottom: 0.8888889em; line-height: 1.1111111",
      h3: "1.5em; margin-top: 1.6em; margin-bottom: 0.6666667em; line-height: 1.3333333",
      h4: "margin-top: 1.8em; margin-bottom: 0.6em; line-height: 1.6",
      pre: "font-size: 0.9em; line-height: 1.7777778; margin-top: 2em; margin-bottom: 2em; border-radius: 0.5rem; padding-top: 1.1111111em; padding-right: 1.3333333em; padding-bottom: 1.1111111em; padding-left: 1.3333333em",
      code: "font-size: 0.9em",
    },
    "2xl": {
      fontSize: "1.5rem",
      lineHeight: "1.6666667",
      h1: "2.6666667em; margin-top: 0; margin-bottom: 0.875em; line-height: 1",
      h2: "2em; margin-top: 1.5em; margin-bottom: 0.8333333em; line-height: 1.0833333",
      h3: "1.5em; margin-top: 1.5555556em; margin-bottom: 0.6666667em; line-height: 1.2222222",
      h4: "margin-top: 1.6666667em; margin-bottom: 0.6666667em; line-height: 1.5",
      pre: "font-size: 0.8333333em; line-height: 1.8; margin-top: 2em; margin-bottom: 2em; border-radius: 0.5rem; padding-top: 1.2em; padding-right: 1.6em; padding-bottom: 1.2em; padding-left: 1.6em",
      code: "font-size: 0.8333333em",
    },
  };

  const out = new Map();
  for (const [size, spec] of Object.entries(sizes)) {
    const cls = `prose-${size}`;
    const r = (sel, decls) => buildProseRule(cls, sel, decls);
    const rules = [];

    // Container-level font-size + line-height override.
    rules.push(`.${cls} { font-size: ${spec.fontSize}; line-height: ${spec.lineHeight} }`);

    // Per-element overrides — h1..h4, pre, inline code.
    rules.push(r("h1", `font-size: ${spec.h1}`));
    rules.push(r("h2", `font-size: ${spec.h2}`));
    rules.push(r("h3", `font-size: ${spec.h3}`));
    rules.push(r("h4", spec.h4));
    rules.push(r("pre", spec.pre));
    rules.push(r("code", spec.code));

    out.set(cls, rules);
  }

  return out;
}

/**
 * Register the prose family (SPEC §26.6). Bare `prose` ships the base
 * nested-element styling. `prose-{slate,gray,zinc,neutral,stone}` override
 * color tones. `prose-{sm,base,lg,xl,2xl}` override sizing. `not-prose`
 * is an opt-out marker that relies on the `:not(:where([class~="not-prose"] *))`
 * suffix already present in every nested rule.
 */
function registerProse() {
  // Bare `prose` — base rule + nested-element shape.
  registry.set("prose", buildBaseProseRules().join("\n"));

  // Color variants
  for (const colorName of ["slate", "gray", "zinc", "neutral", "stone"]) {
    const rules = buildProseColorRules(colorName);
    if (rules.length > 0) {
      registry.set(`prose-${colorName}`, rules.join("\n"));
    }
  }

  // Size variants
  for (const [cls, rules] of buildProseSizeRules()) {
    registry.set(cls, rules.join("\n"));
  }

  // `not-prose` is an opt-out marker. The actual opt-out wiring lives in
  // every nested rule above via `:not(:where([class~="not-prose"] *))`.
  // The rule itself emits an empty declaration block so it's a no-op for
  // CSS purposes — present so adopters can write `class="not-prose"`
  // without triggering W-TAILWIND-001 or an unknown-class miss.
  registry.set("not-prose", ".not-prose { }");
}

// ---------------------------------------------------------------------------
// Variant prefixes (responsive, state, theme/media; per §26.3)
// ---------------------------------------------------------------------------
//
// `kind` decides how the rule is wrapped:
//   "media"      — `@media (...)` wrapper
//   "pseudo"     — `:pseudo` selector suffix on the class itself
//   ("media" wins outermost; "pseudo" stacks innermost.)
//
// Adding a new variant: register it here with its kind/value. The parser
// (`parseClassName`) and emitter (`getTailwindCSSWithDiagnostic`) consult
// the same registry.
//
// `dark:`, `print:`, `motion-safe:`, `motion-reduce:` are theme/feature
// media queries — they share an emit slot with responsive breakpoints
// (only one outer @media wrapper per class) but live in their own registry
// so a class like `dark:hover:bg-red-500` emits cleanly without the user
// also writing `md:`. Combining a responsive breakpoint and a theme query
// (e.g. `md:dark:hover:p-4`) is permitted; the parser nests them.

const RESPONSIVE_BREAKPOINTS = {
  "sm": "640px",
  "md": "768px",
  "lg": "1024px",
  "xl": "1280px",
  "2xl": "1536px",
};

const STATE_PSEUDO_CLASSES = {
  "hover": "hover",
  "focus": "focus",
  "active": "active",
  "disabled": "disabled",
  "first": "first-child",
  "last": "last-child",
  "odd": "nth-child(odd)",
  "even": "nth-child(even)",
  "visited": "visited",
  "focus-within": "focus-within",
  "focus-visible": "focus-visible",
};

// Theme/feature media queries (kind: "media"). Stack outside responsive.
const THEME_MEDIA_QUERIES = {
  "dark": "(prefers-color-scheme: dark)",
  "print": "print",
  "motion-safe": "(prefers-reduced-motion: no-preference)",
  "motion-reduce": "(prefers-reduced-motion: reduce)",
};

// ---------------------------------------------------------------------------
// CSS class name escaping
// ---------------------------------------------------------------------------

/**
 * Escape special characters in a CSS class name for use in a selector.
 * Covers all special chars seen in arbitrary-value class names:
 *   `.` `:` `/` `\` `%` `[` `]` `#` `(` `)` `,` `+` `*` `<space>`
 * Unescaped, any of these would either change selector meaning or
 * produce invalid CSS.
 * @param {string} cls
 * @returns {string}
 */
function escapeCssClass(cls) {
  return cls.replace(/[.:/\\%[\]#(),+*\s]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Arbitrary value support (per §26.4)
// ---------------------------------------------------------------------------
//
// Syntax: `<utility-prefix>-[<value>]`
//
// `<value>` is validated at compile time against the rules in §26.4.
// On failure, the diagnostic-bearing API returns an E-TAILWIND-001 entry
// instead of a CSS rule. Callers that need only the rule string
// (`getTailwindCSS`) get null on validation failure.
//
// To add a new utility prefix: append it to ARBITRARY_PREFIX_MAP.

/**
 * Map from utility prefix (the part before `-[`) to the CSS property
 * to emit. A `function` value is consulted when the property depends on
 * the value's shape (e.g., `text-` is font-size for `<num><unit>`,
 * `color` for hex/rgb).
 */
const ARBITRARY_PREFIX_MAP = {
  // Spacing
  "p": "padding",
  "px": ["padding-left", "padding-right"],
  "py": ["padding-top", "padding-bottom"],
  "pt": "padding-top",
  "pr": "padding-right",
  "pb": "padding-bottom",
  "pl": "padding-left",
  "m": "margin",
  "mx": ["margin-left", "margin-right"],
  "my": ["margin-top", "margin-bottom"],
  "mt": "margin-top",
  "mr": "margin-right",
  "mb": "margin-bottom",
  "ml": "margin-left",
  "gap": "gap",
  "gap-x": "column-gap",
  "gap-y": "row-gap",
  // Sizing
  "w": "width",
  "h": "height",
  "min-w": "min-width",
  "max-w": "max-width",
  "min-h": "min-height",
  "max-h": "max-height",
  // Position
  "top": "top",
  "right": "right",
  "bottom": "bottom",
  "left": "left",
  "inset": "inset",
  // Typography
  "leading": "line-height",
  "tracking": "letter-spacing",
  // Effects
  "opacity": "opacity",
  "shadow": "box-shadow",
  // Layout
  "z": "z-index",
  // Border radius
  "rounded": "border-radius",
};

// Overloaded prefixes — property depends on value shape.
// Each function receives a parsed-value descriptor and returns a CSS
// property name (or array of names) — or null if the value is not
// acceptable for any branch (caller emits E-TAILWIND-001).
const ARBITRARY_OVERLOADED_PREFIXES = {
  "text": (v) => {
    if (v.kind === "color") return "color";
    if (v.kind === "length" || v.kind === "number") return "font-size";
    if (v.kind === "var") return "font-size"; // default per §26.4
    if (v.kind === "keyword") return "color";  // currentColor, transparent, inherit
    return null;
  },
  "bg": (v) => {
    if (v.kind === "color") return "background-color";
    if (v.kind === "url") return "background-image";
    if (v.kind === "var") return "background-color";
    if (v.kind === "keyword") return "background-color";
    return null;
  },
  "border": (v) => {
    if (v.kind === "length" || v.kind === "number") return "border-width";
    if (v.kind === "color") return "border-color";
    if (v.kind === "var") return "border-width";
    if (v.kind === "keyword") return "border-color";
    return null;
  },
};

// CSS length units accepted in arbitrary values. (Time/angle/freq/resolution
// units included for completeness — `transition-duration: [200ms]` etc.)
const VALID_CSS_UNITS = new Set([
  "px", "em", "rem", "%", "vh", "vw", "vmin", "vmax",
  "ch", "ex", "lh", "rlh", "pt", "pc", "in", "cm", "mm", "Q",
  "fr", "s", "ms", "deg", "rad", "grad", "turn",
  "Hz", "kHz", "dpi", "dppx", "dpcm",
  "svh", "lvh", "dvh", "svw", "lvw", "dvw",
  "cqw", "cqh", "cqi", "cqb", "cqmin", "cqmax",
]);

// CSS color-function names accepted in arbitrary values.
const VALID_COLOR_FUNCTIONS = new Set([
  "rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch",
  "oklab", "oklch", "color", "color-mix",
]);

// CSS math/utility-function names accepted in arbitrary values.
const VALID_MATH_FUNCTIONS = new Set([
  "calc", "min", "max", "clamp", "var",
]);

// CSS-wide keywords accepted as bare values.
const VALID_CSS_KEYWORDS = new Set([
  "auto", "none", "inherit", "initial", "unset", "revert", "revert-layer",
  "currentColor", "transparent",
]);

/**
 * Detect an arbitrary-value class shape.
 *   `p-[1.5rem]` -> { prefix: "p", raw: "1.5rem" }
 *   `bg-[#ff00ff]` -> { prefix: "bg", raw: "#ff00ff" }
 *   `not-arbitrary` -> null
 *
 * Empty bracket content (`p-[]`) IS detected as an arbitrary-value shape;
 * the validator (`validateArbitraryCss`) emits E-TAILWIND-001 on the
 * empty case so callers get a diagnostic rather than a silent miss.
 *
 * @param {string} base
 * @returns {{ prefix: string, raw: string } | null}
 */
function parseArbitraryValue(base) {
  // The class must end with `]` and contain a `-[` separator.
  if (typeof base !== "string" || base.length < 4) return null;
  if (base.charCodeAt(base.length - 1) !== 0x5D /* ] */) return null;
  const open = base.indexOf("-[");
  if (open < 0) return null;
  const prefix = base.slice(0, open);
  const raw = base.slice(open + 2, base.length - 1);
  if (!prefix) return null;
  // Note: empty raw IS allowed at this layer so the validator can emit
  // E-TAILWIND-001 ("empty bracket value `[]`") rather than a silent null.
  return { prefix, raw };
}

/**
 * Validate the bracket content of an arbitrary value at compile time.
 * Returns a structured value descriptor on success, or a diagnostic
 * `{ code, reason }` on failure.
 *
 * Accepted shapes (per §26.4):
 *   - hex color:           `#fff`, `#ffff`, `#ffffff`, `#ffffffff`
 *   - color function:      `rgb(...)`, `rgba(...)`, `hsl(...)`, etc.
 *   - math function:       `calc(...)`, `min(...)`, `max(...)`, `clamp(...)`
 *   - var() reference:     `var(--name)` or `var(--name, fallback)`
 *   - url() reference:     `url(/foo.png)`, `url('foo')`, `url("foo")`
 *   - length:              `1.5rem`, `42px`, `100%`, `-10px`
 *   - bare number:         `1.5`, `42`, `-0.25`
 *   - css keyword:         `auto`, `none`, `inherit`, `currentColor`, etc.
 *
 * Rejected shapes:
 *   - empty `[]`
 *   - whitespace inside brackets (would break HTML class scanning)
 *   - injection-vector chars: `<`, `>`, `;`, `{`, `}`, backtick, quote
 *     (quotes accepted only inside `url()` for compatibility)
 *   - unbalanced parens
 *   - unknown unit on a length value
 *   - malformed hex
 *   - unknown function name
 *   - `var()` without a leading `--` ident
 *
 * @param {string} raw  the bracket content (no surrounding `[` `]`)
 * @returns {{ kind: string, css: string } | { error: { code: string, reason: string } }}
 */
function validateArbitraryCss(raw) {
  if (raw.length === 0) {
    return { error: { code: "E-TAILWIND-001", reason: "empty bracket value `[]`" } };
  }
  // Whitespace is rejected unconditionally — Tailwind users must not
  // write `[1.5 rem]` (and the HTML-class scanner would split on it).
  if (/\s/.test(raw)) {
    return { error: { code: "E-TAILWIND-001", reason: `whitespace not permitted inside [] (in \`${raw}\`)` } };
  }
  // Forbid CSS-injection vectors that allow escaping the property
  // context inside the emitted rule. `;` would close the declaration;
  // `{` `}` would open a new rule; `<` `>` are not allowed here.
  if (/[;{}<>]/.test(raw)) {
    return { error: { code: "E-TAILWIND-001", reason: `invalid character in arbitrary value \`${raw}\`` } };
  }
  // Backtick is never a CSS value.
  if (raw.indexOf("`") >= 0) {
    return { error: { code: "E-TAILWIND-001", reason: `invalid character (backtick) in \`${raw}\`` } };
  }

  // Function-shaped value: `name(...)`
  const fnMatch = raw.match(/^([a-zA-Z][a-zA-Z0-9-]*)\((.*)\)$/);
  if (fnMatch) {
    const [, name, body] = fnMatch;
    if (!balancedParens(body)) {
      return { error: { code: "E-TAILWIND-001", reason: `unbalanced parens in \`${raw}\`` } };
    }
    const lname = name.toLowerCase();
    if (lname === "url") {
      // url(...) — body is a URL, possibly quoted.
      if (!validateUrlBody(body)) {
        return { error: { code: "E-TAILWIND-001", reason: `malformed url() in \`${raw}\`` } };
      }
      return { kind: "url", css: raw };
    }
    if (lname === "var") {
      if (!/^--[a-zA-Z_][a-zA-Z0-9_-]*(?:,.*)?$/.test(body)) {
        return { error: { code: "E-TAILWIND-001", reason: `malformed var() reference \`${raw}\` (must start with --identifier)` } };
      }
      return { kind: "var", css: raw };
    }
    if (VALID_COLOR_FUNCTIONS.has(lname)) {
      return { kind: "color", css: raw };
    }
    if (VALID_MATH_FUNCTIONS.has(lname)) {
      return { kind: "length", css: raw };
    }
    return { error: { code: "E-TAILWIND-001", reason: `unknown CSS function \`${name}\` in \`${raw}\`` } };
  }

  // Reject naked unbalanced parens (e.g., `bg-[rgb(255,0,0]` reaches here
  // because the outer match `name(...)` requires a trailing `)`. Without
  // it, the regex doesn't match — but the value still contains `(`.)
  if (!balancedParens(raw)) {
    return { error: { code: "E-TAILWIND-001", reason: `unbalanced parens in \`${raw}\`` } };
  }

  // Hex color: #RGB, #RGBA, #RRGGBB, #RRGGBBAA
  if (raw.charCodeAt(0) === 0x23 /* # */) {
    const hex = raw.slice(1);
    if (!/^[0-9a-fA-F]+$/.test(hex)) {
      return { error: { code: "E-TAILWIND-001", reason: `invalid hex color \`${raw}\` (non-hex digit)` } };
    }
    if (![3, 4, 6, 8].includes(hex.length)) {
      return { error: { code: "E-TAILWIND-001", reason: `invalid hex color \`${raw}\` (length must be 3, 4, 6, or 8)` } };
    }
    return { kind: "color", css: raw };
  }

  // Length / number: optional sign, digits, optional fraction, optional unit
  const lenMatch = raw.match(/^(-?\d+(?:\.\d+)?|-?\.\d+)([a-zA-Z%]*)$/);
  if (lenMatch) {
    const [, , unit] = lenMatch;
    if (unit === "") {
      return { kind: "number", css: raw };
    }
    if (VALID_CSS_UNITS.has(unit)) {
      return { kind: "length", css: raw };
    }
    return { error: { code: "E-TAILWIND-001", reason: `invalid CSS unit \`${unit}\` in \`${raw}\`` } };
  }

  // Bare CSS keyword
  if (VALID_CSS_KEYWORDS.has(raw)) {
    return { kind: "keyword", css: raw };
  }

  // Identifier (e.g., `red`, `linear-gradient` if someone uses it bare —
  // but we keep this conservative: only accept lowercase ASCII idents
  // with hyphens as a generic "ident" value, treated as color.)
  if (/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(raw)) {
    return { kind: "color", css: raw };
  }

  return { error: { code: "E-TAILWIND-001", reason: `unrecognized arbitrary value \`${raw}\`` } };
}

/**
 * Balanced-paren check on a string. Brackets and braces are not allowed
 * (rejected upstream), so we only count `(` and `)`.
 * @param {string} s
 * @returns {boolean}
 */
function balancedParens(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x28 /* ( */) depth++;
    else if (c === 0x29 /* ) */) {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/**
 * Validate the body of a `url(...)` arbitrary value.
 *   url(/foo)             — unquoted, OK
 *   url('foo')            — single-quoted, OK
 *   url("foo")            — double-quoted, OK
 *   url(foo bar)          — whitespace upstream-rejected
 * @param {string} body
 * @returns {boolean}
 */
function validateUrlBody(body) {
  if (body.length === 0) return false;
  // Quoted form: leading + matching trailing quote, no embedded matching
  // unescaped quote of the same kind.
  const first = body.charCodeAt(0);
  if (first === 0x27 /* ' */ || first === 0x22 /* " */) {
    if (body.length < 2) return false;
    const last = body.charCodeAt(body.length - 1);
    if (last !== first) return false;
    return true;
  }
  // Unquoted: any non-whitespace, non-`(`, non-`)` char (whitespace was
  // already rejected by validateArbitraryCss).
  return !/[()]/.test(body);
}

// ---------------------------------------------------------------------------
// Lookup logic
// ---------------------------------------------------------------------------

/**
 * Split a class name on `:` only outside `[...]` brackets.
 * `bg-[url(http://x:y)]` -> ["bg-[url(http://x:y)]"]
 * `md:bg-[#fff]` -> ["md", "bg-[#fff]"]
 * `md:hover:bg-[rgb(0:0:0)]` -> ["md", "hover", "bg-[rgb(0:0:0)]"]
 * @param {string} className
 * @returns {string[]}
 */
function splitClassNameSegments(className) {
  const segments = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < className.length; i++) {
    const c = className.charCodeAt(i);
    if (c === 0x5B /* [ */) depth++;
    else if (c === 0x5D /* ] */) {
      if (depth > 0) depth--;
    } else if (c === 0x3A /* : */ && depth === 0) {
      segments.push(className.slice(start, i));
      start = i + 1;
    }
  }
  segments.push(className.slice(start));
  return segments;
}

/**
 * Parse a class name into its prefix chain and base utility.
 * E.g., "sm:hover:text-red-500" -> { breakpoint: "sm", theme: null, state: "hover", base: "text-red-500" }
 *
 * The split is bracket-aware so `:` characters inside an arbitrary-value
 * `[...]` (e.g., `bg-[url(http://x:y)]`) are NOT treated as variant
 * separators.
 *
 * @param {string} className
 * @returns {{ breakpoint: string|null, theme: string|null, state: string|null, base: string }}
 */
function parseClassName(className) {
  const parts = splitClassNameSegments(className);
  let breakpoint = null;
  let theme = null;
  let state = null;
  let hasUnrecognizedPrefix = false;
  const base = parts[parts.length - 1];

  for (let i = 0; i < parts.length - 1; i++) {
    const prefix = parts[i];
    if (RESPONSIVE_BREAKPOINTS[prefix]) {
      breakpoint = prefix;
    } else if (THEME_MEDIA_QUERIES[prefix]) {
      theme = prefix;
    } else if (STATE_PSEUDO_CLASSES[prefix]) {
      state = prefix;
    } else {
      hasUnrecognizedPrefix = true;
    }
  }

  return { breakpoint, theme, state, base, hasUnrecognizedPrefix };
}

/**
 * Resolve an arbitrary-value base name to a CSS rule string.
 * Returns:
 *   { css: string, diagnostic: null }   on success
 *   { css: null,   diagnostic: {...} }  on validation failure
 *   null                                on "not an arbitrary value at all"
 *
 * The selector emitted is the FULL escaped class name (including any
 * variant prefixes the caller may have stripped) — pass it via
 * `escapedClassName`.
 *
 * @param {string} base                  the part after variant prefixes (e.g., "p-[1.5rem]")
 * @param {string} escapedClassName     the already-escaped full class name
 * @returns {{ css: string|null, diagnostic: { code: string, message: string }|null } | null}
 */
function resolveArbitraryValue(base, escapedClassName) {
  const parsed = parseArbitraryValue(base);
  if (!parsed) return null;

  const { prefix, raw } = parsed;
  const validated = validateArbitraryCss(raw);
  if (validated.error) {
    return {
      css: null,
      diagnostic: {
        code: validated.error.code,
        message: `${validated.error.code}: ${validated.error.reason}`,
      },
    };
  }

  // Choose property: direct map first, then overloaded resolver.
  let prop = ARBITRARY_PREFIX_MAP[prefix];
  if (prop === undefined) {
    const overload = ARBITRARY_OVERLOADED_PREFIXES[prefix];
    if (overload) {
      prop = overload(validated);
      if (prop === null) {
        return {
          css: null,
          diagnostic: {
            code: "E-TAILWIND-001",
            message: `E-TAILWIND-001: arbitrary value \`${raw}\` not acceptable for utility \`${prefix}-[]\``,
          },
        };
      }
    }
  }
  if (prop === undefined) {
    // Prefix not registered for arbitrary values — caller treats as miss
    // (returns null + no diagnostic, so unknown classes still fall through
    // to the existing "silently dropped" behavior).
    return null;
  }

  let decl;
  if (Array.isArray(prop)) {
    decl = prop.map(p => `${p}: ${validated.css}`).join("; ");
  } else {
    decl = `${prop}: ${validated.css}`;
  }
  return {
    css: `.${escapedClassName} { ${decl} }`,
    diagnostic: null,
  };
}

/**
 * Build a CSS rule from a base rule + variant prefixes.
 * The base rule is `.<some-name> { decl }` (or null for arbitrary, in
 * which case `arbitraryDecl` is used).
 *
 * For multi-rule registry values (newline-separated rules — used by the
 * prose family per §26.6), each constituent rule's leading class selector
 * is rewritten so the variant-prefixed class name takes its place. The
 * descendant selectors (e.g., ` :where(p)...`) are preserved verbatim.
 *
 * @param {string|null} baseRule
 * @param {string|null} arbitraryDecl    css declaration body for arbitrary values
 * @param {string} escapedClassName
 * @param {{ breakpoint, theme, state }} variants
 * @param {string} [baseName]   the un-prefixed class name (e.g., "prose-lg")
 *                              — required for multi-rule rewriting
 * @returns {string|null}
 */
function wrapWithVariants(baseRule, arbitraryDecl, escapedClassName, { breakpoint, theme, state }, baseName) {
  let rule;
  if (arbitraryDecl !== null) {
    // Arbitrary-value path: single declaration body, no descendant rules.
    if (state) {
      const pseudo = STATE_PSEUDO_CLASSES[state];
      rule = `.${escapedClassName}:${pseudo} {${arbitraryDecl}}`;
    } else {
      rule = `.${escapedClassName} {${arbitraryDecl}}`;
    }
  } else if (baseRule) {
    // Multi-rule detection: a registry value containing more than one
    // top-level rule (joined with `\n`) needs per-rule selector
    // substitution. Single-rule case stays on the original simple path.
    if (baseRule.includes("\n") && baseName) {
      rule = rewriteMultiRuleSelector(baseRule, baseName, escapedClassName, state);
    } else {
      const m = baseRule.match(/^(\.[^\s{]+)\s*\{(.+)\}$/s);
      if (!m) return baseRule;
      const declaration = m[2];
      if (state) {
        const pseudo = STATE_PSEUDO_CLASSES[state];
        rule = `.${escapedClassName}:${pseudo} {${declaration}}`;
      } else {
        rule = `.${escapedClassName} {${declaration}}`;
      }
    }
  } else {
    return null;
  }

  // Theme media query stacks INSIDE the responsive query so that
  // `md:dark:hover:p-4` becomes
  //   @media (min-width: 768px) { @media (prefers-color-scheme: dark) { .md\:dark\:hover\:p-4:hover { ... } } }
  if (theme) {
    const tq = THEME_MEDIA_QUERIES[theme];
    rule = `@media ${tq} { ${rule} }`;
  }
  if (breakpoint) {
    const bp = RESPONSIVE_BREAKPOINTS[breakpoint];
    rule = `@media (min-width: ${bp}) { ${rule} }`;
  }
  return rule;
}

/**
 * Rewrite a multi-rule registry value so each constituent rule's leading
 * `.{baseName}` selector is replaced with `.{escapedFullName}`, optionally
 * suffixed with a `:pseudo` state.
 *
 * Used by the prose family, where one logical utility expands to a base
 * `.prose { ... }` rule plus many `.prose :where(<tag>)... { ... }` nested
 * rules. For `md:prose`, every constituent's `.prose` prefix becomes
 * `.md\:prose` so the variant-prefixed class scopes ALL descendant rules.
 *
 * The base class name is matched as a token immediately following the
 * leading `.`, terminating at the next character that is not a valid
 * CSS-class-name continuation. This preserves trailing selector content
 * (descendant combinators, `:where()` parts, pseudo-class chains).
 *
 * @param {string} baseRules         newline-joined rules
 * @param {string} baseName          un-escaped registered class name (e.g., "prose-lg")
 * @param {string} escapedFullName   already-escaped variant-prefixed class name
 * @param {string|null} state        state pseudo-class name (e.g., "hover") or null
 * @returns {string}
 */
function rewriteMultiRuleSelector(baseRules, baseName, escapedFullName, state) {
  const pseudoSuffix = state ? `:${STATE_PSEUDO_CLASSES[state]}` : "";
  const newSelectorBase = `.${escapedFullName}${pseudoSuffix}`;
  // Build a regex that matches `.<baseName>` at the start of any selector
  // token in the rule block. Escape the baseName for regex use.
  const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\.${escaped}(?![a-zA-Z0-9_-])`, "g");
  // Function-form .replace() so any `$` chars in newSelectorBase (possible
  // via escapedFullName from arbitrary-value Tailwind classes like
  // `bg-[var($foo)]`) aren't interpreted as `$&` / `$N` backreferences
  // (S100 `01eeda9` bug class). escapeCssClass does NOT escape `$`.
  return baseRules.replace(re, () => newSelectorBase);
}

/**
 * Get the CSS rule for a single Tailwind utility class name AND any
 * compile-time diagnostic that arose from validating an arbitrary value.
 *
 * Returns `{ css, diagnostic }`:
 *   - css: string when the class resolves
 *   - css: null when the class is unrecognized OR validation failed
 *   - diagnostic: null when no validation error was produced
 *   - diagnostic: { code, message } when an arbitrary value failed validation
 *
 * Unrecognized non-arbitrary classes return `{ css: null, diagnostic: null }` —
 * the caller is free to silently drop them (current `getAllUsedCSS` behavior)
 * or emit a separate W-TAILWIND-001 (the diagnostic-warning agent's territory).
 *
 * @param {string} className
 * @returns {{ css: string|null, diagnostic: { code: string, message: string }|null }}
 */
export function getTailwindCSSWithDiagnostic(className) {
  if (!className || typeof className !== "string") {
    return { css: null, diagnostic: null };
  }

  const { breakpoint, theme, state, base, hasUnrecognizedPrefix } = parseClassName(className);

  // If any prefix in the chain is unrecognized (e.g. `weird:p-4`, `group-hover:p-4`),
  // the class is unhandled by the embedded engine. Returning null prevents the
  // silent-strip pattern where `weird:p-4` would otherwise produce a `.p-4 { ... }`
  // rule with a selector that doesn't match the source class. The detector
  // (`findUnsupportedTailwindShapes`) then emits W-TAILWIND-001.
  // (Closes a silent-failure bug surfaced during S49 review; preserved across
  // the variant-table refactor that ships dark/print/motion-* in §26.3.)
  if (hasUnrecognizedPrefix) {
    return { css: null, diagnostic: null };
  }

  const escapedName = escapeCssClass(className);

  // Try arbitrary-value path first only if the base looks bracketed.
  if (parseArbitraryValue(base)) {
    const arb = resolveArbitraryValue(base, escapedName);
    if (arb) {
      if (arb.diagnostic) {
        return { css: null, diagnostic: arb.diagnostic };
      }
      // arb.css is `.<name> { decl }` — extract decl and apply variants.
      const m = arb.css.match(/^(\.[^\s{]+)\s*\{(.+)\}$/s);
      const decl = m ? m[2] : null;
      if (!breakpoint && !theme && !state) {
        return { css: arb.css, diagnostic: null };
      }
      const wrapped = wrapWithVariants(null, decl, escapedName, { breakpoint, theme, state });
      return { css: wrapped, diagnostic: null };
    }
  }

  // Static-registry path.
  const baseRule = registry.get(base);
  if (!baseRule) {
    return { css: null, diagnostic: null };
  }
  if (!breakpoint && !theme && !state) {
    return { css: baseRule, diagnostic: null };
  }
  const wrapped = wrapWithVariants(baseRule, null, escapedName, { breakpoint, theme, state }, base);
  return { css: wrapped, diagnostic: null };
}

/**
 * Get the CSS rule for a single Tailwind utility class name.
 * Returns the CSS rule string or null if the class is not recognized
 * OR if an arbitrary value failed compile-time validation.
 *
 * Use `getTailwindCSSWithDiagnostic` to recover the validation message.
 *
 * Supports responsive prefixes (sm:, md:, lg:, xl:, 2xl:),
 * theme/feature media queries (dark:, print:, motion-safe:, motion-reduce:),
 * state pseudo-classes (hover:, focus:, active:, disabled:, first:, last:,
 * odd:, even:, visited:, focus-within:, focus-visible:), and arbitrary
 * values per §26.4.
 *
 * @param {string} className
 * @returns {string|null}
 */
export function getTailwindCSS(className) {
  return getTailwindCSSWithDiagnostic(className).css;
}

/**
 * Get combined CSS for an array of class names AND the array of
 * compile-time diagnostics produced during arbitrary-value validation.
 *
 * Unknown classes are silently ignored (no diagnostic). Use the
 * concurrent W-TAILWIND-001 detection rule to warn on those.
 *
 * @param {string[]} classNames
 * @returns {{ css: string, diagnostics: Array<{ className: string, code: string, message: string }> }}
 */
export function getAllUsedCSSWithDiagnostics(classNames) {
  if (!classNames || !Array.isArray(classNames)) {
    return { css: "", diagnostics: [] };
  }

  const seen = new Set();
  const rules = [];
  const diagnostics = [];

  for (const cls of classNames) {
    if (!cls || seen.has(cls)) continue;
    seen.add(cls);
    const { css, diagnostic } = getTailwindCSSWithDiagnostic(cls);
    if (css) rules.push(css);
    if (diagnostic) {
      diagnostics.push({ className: cls, code: diagnostic.code, message: diagnostic.message });
    }
  }

  return { css: rules.join("\n"), diagnostics };
}

/**
 * Get combined CSS for an array of class names.
 * Unknown classes are silently ignored, and arbitrary values that fail
 * validation are silently dropped (use `getAllUsedCSSWithDiagnostics` to
 * recover the diagnostics).
 *
 * @param {string[]} classNames
 * @returns {string}
 */
export function getAllUsedCSS(classNames) {
  return getAllUsedCSSWithDiagnostics(classNames).css;
}

/**
 * Scan an HTML string for all class="" attribute values and extract individual class names.
 *
 * @param {string} html
 * @returns {string[]}
 */
export function scanClassesFromHtml(html) {
  if (!html || typeof html !== "string") return [];

  const classNames = new Set();
  const re = /\bclass="([^"]*)"/g;
  let match;

  while ((match = re.exec(html)) !== null) {
    const value = match[1];
    for (const cls of value.split(/\s+/)) {
      if (cls) classNames.add(cls);
    }
  }

  return [...classNames];
}

// ---------------------------------------------------------------------------
// W-TAILWIND-001: unsupported Tailwind syntax detection (SPEC §26.3,
// SPEC-ISSUE-012). When adopters write class strings using Tailwind variant
// or arbitrary-value syntax that the embedded engine doesn't handle, the
// compiler silently emits no CSS for them. This pre-pass surfaces a warning
// so adopters see compile-time friction instead of a silent runtime drop.
//
// Detection rule:
//   1. Skip names that contain neither `:` nor `[` (look like USER classes).
//   2. Skip names the embedded engine handles (`getTailwindCSS(cls) !== null`).
//      The engine's variant subset (5 responsive + 11 state pseudo-classes)
//      is partially shipped; classes the engine handles produce real CSS
//      today and aren't silent-failure cases — no warning needed.
//   3. Otherwise fire. The class has Tailwind shape but no engine match,
//      indicating an unsupported variant (`dark:`, `print:`, `motion-*:`,
//      etc.) or any arbitrary value (`p-[1.5rem]`).
//
// This rule is intentionally aligned with the user's S49 validation
// principle: "if the compiler is happy, the program should be good." A
// class the engine handles is a class the program can rely on; warning
// on it would be the compiler being unhappy when the program is good.
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
 * Replace each `${...}` interpolation region in the given string with the same
 * number of spaces. Preserves source byte offsets so callers can keep using
 * `attrMatch.index + classMatch.index` arithmetic against the original source.
 *
 * Handles brace-balanced `${...}` (nested objects, ternary expressions, etc.).
 * If a `${` has no matching closing `}` the rest of the string is masked.
 *
 * Used by `findUnsupportedTailwindShapes` to avoid false-positive warnings on
 * the contents of `class="${cond ? 'a' : 'b'}"` (the `:` from the ternary
 * would otherwise be parsed as a Tailwind variant shape).
 *
 * @param {string} value
 * @returns {string}
 */
function maskInterpolations(value) {
  let out = "";
  let i = 0;
  while (i < value.length) {
    if (value[i] === "$" && value[i + 1] === "{") {
      // Brace-balanced scan.
      let depth = 1;
      let j = i + 2;
      while (j < value.length && depth > 0) {
        if (value[j] === "{") depth++;
        else if (value[j] === "}") depth--;
        if (depth === 0) break;
        j++;
      }
      // Replace [i, j+1] with spaces (preserving newlines so offsetToLineCol
      // still produces correct line numbers).
      const end = Math.min(j + 1, value.length);
      for (let k = i; k < end; k++) {
        out += value[k] === "\n" ? "\n" : " ";
      }
      i = end;
    } else {
      out += value[i];
      i++;
    }
  }
  return out;
}

/**
 * @typedef {{
 *   line: number,
 *   column: number,
 *   className: string,
 *   message: string,
 *   severity: 'warning',
 *   code: 'W-TAILWIND-001',
 * }} TailwindLintDiagnostic
 */

/**
 * Scan a source string (any text, typically a `.scrml` file) for class names
 * inside `class="..."` attributes that look like Tailwind variant or
 * arbitrary-value syntax. Return one diagnostic per offending (offset, class)
 * pair. Within a single `class="..."` value duplicate offenders are reported
 * once; across multiple `class=` attributes each occurrence is reported.
 *
 * `${...}` interpolation regions inside the attribute value are masked before
 * scanning so dynamic-class expressions like `class="${cond ? 'a' : 'b'}"`
 * do not produce false positives on the ternary's `:`.
 *
 * @param {string} source
 * @returns {TailwindLintDiagnostic[]}
 */
export function findUnsupportedTailwindShapes(source) {
  if (!source || typeof source !== "string") return [];

  const diagnostics = [];
  const attrRe = /\bclass="([^"]*)"/g;
  let attrMatch;

  while ((attrMatch = attrRe.exec(source)) !== null) {
    const attrValue = attrMatch[1];
    const attrValueStart = attrMatch.index + attrMatch[0].indexOf('"') + 1;

    // Mask out ${...} interpolation regions inside the attribute value. Their
    // contents are JS expressions that frequently include ':' (ternaries) and
    // would otherwise produce false-positive W-TAILWIND-001 diagnostics. The
    // mask preserves length so source offsets stay accurate.
    const masked = maskInterpolations(attrValue);

    // Walk the (masked) attribute value, recording each class name and its
    // source offset. Classes are whitespace-separated; we need per-class
    // offsets so messages point at the offending class, not the start of the
    // attribute.
    const classRe = /\S+/g;
    let classMatch;
    const seenInThisAttr = new Set();
    while ((classMatch = classRe.exec(masked)) !== null) {
      const cls = classMatch[0];
      if (seenInThisAttr.has(cls)) continue;
      seenInThisAttr.add(cls);

      // Skip user-shaped classes (no Tailwind variant/arbitrary syntax).
      if (!cls.includes(":") && !cls.includes("[")) continue;

      // Skip classes the embedded engine handles. `md:p-4`, `hover:bg-blue-500`,
      // `sm:hover:bg-blue-500` and the like produce real CSS today via the
      // partial variant subset (5 responsive + 11 state pseudo-classes); they
      // are not silent-failure cases. Only fire on classes the engine can't
      // match — unsupported variants (`dark:`, `print:`, `motion-*:`) or any
      // arbitrary value (`p-[1.5rem]`).
      if (getTailwindCSS(cls) !== null) continue;

      // Tailwind-shape with no engine match: emit W-TAILWIND-001.
      const offset = attrValueStart + classMatch.index;
      const { line, column } = offsetToLineCol(source, offset);
      diagnostics.push({
        line,
        column,
        className: cls,
        message:
          `Line ${line}: Class \`${cls}\` looks like Tailwind variant/arbitrary ` +
          `syntax that is not handled by the embedded engine (SPEC-ISSUE-012). ` +
          `The class will not produce any CSS. Use a supported variant prefix ` +
          `(sm/md/lg/xl/2xl, hover/focus/active/disabled/first/last/odd/even/` +
          `visited/focus-within/focus-visible) or define your own CSS rule.`,
        severity: "warning",
        code: "W-TAILWIND-001",
      });
    }
  }

  // Sort by line, then column for deterministic output (mirrors lintGhostPatterns).
  diagnostics.sort((a, b) => a.line !== b.line ? a.line - b.line : a.column - b.column);
  return diagnostics;
}

// ---------------------------------------------------------------------------
// W-TAILWIND-UNRECOGNIZED-CLASS — FLOOR-fix lint for the broader silent-no-op
// surface (dogfood Bug 1, S108).
//
// `findUnsupportedTailwindShapes` (above) fires only when a class string is
// shaped like Tailwind variant/arbitrary syntax (contains `:` or `[`) but
// fails registry lookup. That misses the dogfood-Bug-1 friction class: a
// non-shaped class name (e.g. a typo `flexx` instead of `flex`, or an
// unsupported arbitrary-value class whose engine returns null like
// `grid-cols-[auto_1fr_auto]`) emits no CSS rule AND no diagnostic — layout
// breaks silently and the adopter has nothing to chase.
//
// This pre-pass widens the surface: every class-name token inside a
// `class="..."` attribute that fails `getTailwindCSS()` resolution gets a
// `W-TAILWIND-UNRECOGNIZED-CLASS` info-level lint. The message points
// adopters at three legitimate causes (typo / unsupported arbitrary / user
// CSS class) so they can self-triage.
//
// FLOOR fix scope (vs full fix):
//   - Floor (this code): lint-only. Acknowledged false-positives on custom
//     user-defined CSS classes. Adopters using only Tailwind get clean
//     diagnostics; mixed adopters can suppress via the
//     `compilerSettings.lintTailwindUnrecognizedClass = "off"` knob.
//   - Full (deferred): actually emit CSS for the unrecognized arbitrary-value
//     classes (`grid-cols-[auto_1fr_auto]` -> `grid-template-columns:
//     auto 1fr auto`) + a safelist/@apply mechanism to distinguish custom
//     classes from misspellings.
//
// Severity: `info` (not `warning`) to keep it lower-noise than
// W-TAILWIND-001. Both lints together cover the silent-no-op surface.
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   line: number,
 *   column: number,
 *   className: string,
 *   message: string,
 *   severity: 'info',
 *   code: 'W-TAILWIND-UNRECOGNIZED-CLASS',
 * }} TailwindUnrecognizedDiagnostic
 */

/**
 * Scan a source string for class names inside `class="..."` attributes that
 * do NOT resolve via `getTailwindCSS()`. Returns one diagnostic per offending
 * `(offset, class)` pair. Within a single `class="..."` value duplicate
 * offenders are reported once; across multiple `class=` attributes each
 * occurrence is reported.
 *
 * `${...}` interpolation regions inside the attribute value are masked
 * before scanning so dynamic-class expressions like
 * `class="${cond ? 'a' : 'b'}"` do not produce spurious diagnostics on the
 * interpolation contents.
 *
 * This function is intentionally permissive about what is a "class" — every
 * whitespace-separated non-empty token in the attribute value is checked.
 * Custom user-defined CSS classes (e.g. `counter-app`, `my-card`) will
 * trigger the lint as false positives; adopters wanting them silenced
 * should suppress via the compiler-settings opt-out (see api.js).
 *
 * Sibling `findUnsupportedTailwindShapes` (W-TAILWIND-001) keeps firing on
 * Tailwind-shaped-but-unsupported classes (`group-hover:p-4`,
 * `weird:p-4`, arbitrary-values the engine doesn't resolve). The two lints
 * MAY both fire on the same class (e.g. `grid-cols-[auto_1fr_auto]`);
 * adopters get more information about the failure mode, not less.
 *
 * @param {string} source
 * @returns {TailwindUnrecognizedDiagnostic[]}
 */
export function findUnrecognizedClasses(source) {
  if (!source || typeof source !== "string") return [];

  const diagnostics = [];
  const attrRe = /\bclass="([^"]*)"/g;
  let attrMatch;

  while ((attrMatch = attrRe.exec(source)) !== null) {
    const attrValue = attrMatch[1];
    const attrValueStart = attrMatch.index + attrMatch[0].indexOf('"') + 1;

    // Mask out ${...} interpolation regions inside the attribute value so the
    // JS expression contents (which may themselves contain class-name-shaped
    // string literals or arbitrary tokens) do not generate diagnostics. The
    // mask preserves length so source offsets stay accurate.
    const masked = maskInterpolations(attrValue);

    const classRe = /\S+/g;
    let classMatch;
    const seenInThisAttr = new Set();
    while ((classMatch = classRe.exec(masked)) !== null) {
      const cls = classMatch[0];
      if (seenInThisAttr.has(cls)) continue;
      seenInThisAttr.add(cls);

      // Engine recognized the class -> no diagnostic. This covers base
      // utilities (`flex`, `p-4`), supported variants (`md:p-4`,
      // `hover:bg-blue-500`), and supported arbitrary values
      // (`w-[420px]`, `p-[1.5rem]`).
      if (getTailwindCSS(cls) !== null) continue;

      // Unresolved -> emit the lint. The message names the three legitimate
      // causes so adopters can self-triage without consulting docs.
      const offset = attrValueStart + classMatch.index;
      const { line, column } = offsetToLineCol(source, offset);
      diagnostics.push({
        line,
        column,
        className: cls,
        message:
          `W-TAILWIND-UNRECOGNIZED-CLASS: Class name '${cls}' is not a ` +
          `recognized Tailwind utility. Either the class is misspelled, ` +
          `is a Tailwind arbitrary-value class (e.g., ` +
          `'grid-cols-[auto_1fr_auto]') which scrml's built-in Tailwind ` +
          `engine does not yet support, or is a custom class defined ` +
          `elsewhere. Workaround for arbitrary-value classes: drop a #{} ` +
          `CSS shim block with the rules written by hand.`,
        severity: "info",
        code: "W-TAILWIND-UNRECOGNIZED-CLASS",
      });
    }
  }

  diagnostics.sort((a, b) => a.line !== b.line ? a.line - b.line : a.column - b.column);
  return diagnostics;
}

// ---------------------------------------------------------------------------
// Initialize registry on module load
// ---------------------------------------------------------------------------

registerSpacing();
registerSizing();
registerFlexbox();
registerGrid();
registerTypography();
registerColors();
registerBorders();
registerEffects();
registerLayout();
registerProse();
