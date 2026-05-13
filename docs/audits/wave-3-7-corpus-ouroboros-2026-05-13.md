# Wave 3.7 corpus-ouroboros audit — 2026-05-13

**Audit type:** read-only sweep of the public-facing scrml corpus (kickstarter, primer, articles, examples) for divergence from stated user-voice / pa.md / SPEC intent.
**Discipline:** corpus is artifact, NOT evidence of design intent. When stated intent contradicts corpus, the corpus is migration backlog (per `feedback_stated_intent_vs_corpus_migration.md` / S88 + `feedback_idiomatic_examples_styling.md` / S86).
**HEAD:** `9b98118` (S88 close). **Date:** 2026-05-13.

---

## §1 Methodology

### §1.1 Stated-intent sources consulted (normative)

| Source | Anchor lines | What it normatively says |
|---|---|---|
| `pa.md` Rule 2 | 36-47 | "creating language that will be the future of how programming is done for the browser"; bar is full-production-language fidelity; corpus is the artifact of past parser limits, NOT evidence of design intent |
| `pa.md` Rule 3 | 49-55 | Right answer beats easy answer 99.999% of the time; default hard to the structural fix |
| `pa.md` Rule 4 | 57-77 | Spec is normative; derived docs are NOT; "drift is suspect; spec is authoritative" |
| `docs/PA-SCRML-PRIMER.md` §6 | 130-164 | "try/catch is not in scrml's vocabulary. Public claim. Surface a retraction if anyone slips and uses it." Failable-fn `!{}` is canonical. |
| `docs/PA-SCRML-PRIMER.md` §11 anti-pattern table | 422-438 | `===`/`!==` → `==`/`!=` (E-EQ-004); `useState`/`useEffect`/`ref()` forbidden; `try/catch` forbidden; `throw new Error` forbidden |
| `docs/PA-SCRML-PRIMER.md` Business Invariants (domain.map.md) | 85-86 | "`null` / `undefined` are NOT valid scrml tokens in any context (SPEC §42, E-SYNTAX-042). The only non-presence value is `not`." + "`===` / `!==` are NOT valid in scrml source (E-EQ-004). Canonical forms: `==` / `!=`." |
| user-voice §S81 (2026-05-11) | 5947-5965 | Verbatim: *"null and undefined will not ever exist in any context in scrml in any way. 'not' is the only non-presance word. library mode inclusive."* + *"the 'not' directive that I stated is still in play. null/undefined should not compile."* |
| user-voice §S86 (2026-05-12) | 6268-6288 | Verbatim styling rule + corpus-ouroboros warning: corpus is artifact NOT evidence; idiomatic examples MUST NOT promote file-top `#{}` |
| user-voice §S88 (2026-05-12/13) | 6337-6361 | Verbatim try/catch rule: *"I have said explicitly a dozen times, no try-catch."* Stated intent vs corpus → migration backlog (NOT deliberation trigger) |
| design-insights "Insight 30" | 1934-1979 | Channel cross-file dispensation; PURE-CHANNEL-FILE shape canonical |
| design-insights "Insight 31" | 1986-2014 | §36 live-input retention DESIGN-AND-SHIP; "corpus-ouroboros rule respected" methodology signal |
| memory `feedback_idiomatic_examples_styling.md` | full | File-top `#{}` never canonical in idiomatic examples |
| memory `feedback_stated_intent_vs_corpus_migration.md` | full | Stated-intent verbatim ≥ 1 → CLOSED; corpus showing otherwise = migration backlog |

### §1.2 Corpus inventory

**Articles (`docs/articles/*.md`), 17 files:**

| File | Lines | Audit status |
|---|---|---|
| `llm-kickstarter-v0-2026-04-25.md` | 1135 | **superseded by v1** (`docs/changes/llm-kickstarter-v0/...` known-stale per S78 non-compliance carry-forward); v1 + v2 are the live canonical versions. Audited for completeness. |
| `llm-kickstarter-v1-2026-04-25.md` | 730+ | live canonical agent-brief (per pa.md S82 dispatch protocol) |
| `llm-kickstarter-v2-2026-05-04.md` | 1300+ | live v0.next canonical agent-brief (extends v1) |
| `lsp-and-giti-advantages-devto-2026-04-28.md` | 230+ | published dev.to article |
| `npm-myth-devto-2026-04-28.md` | 160+ | published dev.to article |
| `why-programming-for-the-browser-needs-a-different-kind-of-language-devto-2026-04-27.md` | 250+ | published dev.to article |
| `server-boundary-disappears-devto-2026-04-28.md` | 200+ | published dev.to article |
| `css-without-build-step-devto-2026-04-29.md` | 200+ | published dev.to article |
| `components-are-states-devto-2026-04-29.md` | 250+ | published dev.to article |
| `mutability-contracts-devto-2026-04-29.md` | 280+ | published dev.to article |
| `orm-trap-devto-2026-04-29.md` | 170+ | published dev.to article |
| `realtime-and-workers-as-syntax-devto-2026-04-29.md` | 230+ | published dev.to article (line 200 known-drift carry-forward per non-compliance.report) |
| `tier-ladder-promotion-devto-2026-05-04.md` | n/a | published dev.to article |
| `why-scrml-has-to-deprecate-function-and-component-overloading-devto-2026-05-06.md` | n/a | published dev.to article |
| `scrml-debate-amends-zod-claim-devto-2026-05-06.md` | n/a | published dev.to article |
| `x-snippet-zod-calibration-2026-05-06.md` | n/a | snippet draft |
| `teej_baiting_tweet.md` | n/a | tweet draft |

**Primer:** `docs/PA-SCRML-PRIMER.md` (856 lines) — canon snapshot of scrml's syntax + mindset + recipes; mandatory session-start reading per pa.md §"Session-start checklist".

**Examples — root files** (`examples/*.scrml`), 21 files:

01-hello, 02-counter, 03-contact-book, 04-live-search, 05-multi-step-form, 06-kanban-board, 07-admin-dashboard, 08-chat, 09-error-handling, 10-inline-tests, 11-meta-programming, 12-snippets-slots, 13-worker, 14-mario-state-machine, 15-channel-chat, 16-remote-data, 17-schema-migrations, 18-state-authority, 19-lin-token, 20-middleware, 21-navigation.

**Examples — multi-file apps:**
- `examples/22-multifile/` — 3 files (app, components, types)
- `examples/23-trucking-dispatch/` — 35 `.scrml` files across `app.scrml` + `schema.scrml` + `seeds.scrml` + channels (4) + components (8) + models (1) + pages (auth 2, customer 6, dispatch 5, driver 6)

**Total:** 17 articles + 1 primer + 21 root examples + 38 multi-file examples = **77 corpus files audited.**

### §1.3 Drift categories applied (numbered per audit brief)

1. **try/catch in scrml source** — user-voice S88 verbatim "a dozen times, no try-catch"
2. **File-top `#{}` meta-blocks as canonical** — user-voice S86 verbatim
3. **`===` / `!==` vs `==` / `!=`** — primer Business Invariants + S87 stdlib Phase 1 sweep
4. **Bare-name local refs where `@cell` access is required** — V5-strict
5. **React/Vue/JSX idioms** — `useState`, `useEffect`, JSX curly-attr, etc.
6. **`null` / `undefined` literals** — user-voice S81 verbatim + primer/domain map
7. **stdlib npm-reach equivalents** — `JSON.parse`/`stringify`/`Math.*`/etc. when stdlib has a wrapper
8. **Engine `<engine>` declarations outside the canonical recipe**
9. **Match-statement Tier 0/1/2 misuse** — primer §1 Tier ladder
10. **`derived=` engine-attribute misuse** — primer L20 lock

---

## §2 Per-document findings

### §2.1 `docs/PA-SCRML-PRIMER.md`

| Line | Category | Excerpt | Proposed fix |
|---|---|---|---|
| 90 | #6 null | `<startTime default=null> = Date.now()` | Replace `default=null` with `default=not`. Also requires SPEC §6.4 mirror (out of corpus-audit scope — flag in §5 / migration-side) |

Otherwise primer is **substantially aligned**. The anti-pattern table (lines 422-438) correctly cites `try/catch`, `===`/`!==`, `useState`, `useEffect`, `ref()`, `throw new Error`, `null`/`undefined` as forbidden — this is normative-side content used in dev-dispatch briefs (per pa.md S82 protocol). The various `string | null` / `record: null` etc. references throughout §13.7 specifics are descriptions of TypeScript AST types in `compiler/src/types/ast.ts` — describing compiler-internal data structures, NOT scrml source surface. Out of audit scope.

### §2.2 `docs/articles/llm-kickstarter-v1-2026-04-25.md`

| Line | Category | Excerpt | Proposed fix |
|---|---|---|---|
| 308 | #6 null | `if (!user) return null` (inside canonical `server function login()` scrml example) | Convert to `if (!user) return not` (and tighten falsiness check to `user is not` per §42.2.5 / S81 directive) |
| 311 | #6 null | `: null` (ternary fallback inside same login() example) | Convert ternary `... ? signJwt(...) : null` to a `match` over verifyPassword's result OR use failable-fn + `!{}` arm |

Other `null` mentions in this file are SQL DDL `not null` (lines 487+) and constraint catalog prose (line 509) — legitimate per SPEC §39 SQL-mirror. The `===` mention on line 193 is in the anti-pattern column ("(TypeScript reflex)") — illustrative, not canonical. The `===` mention on line 652 is in §"Known traps" describing JS-emit lowering behavior (`==` lowers to `===` for primitives in server bundles) — accurate compiler-implementation prose, not a recommendation.

### §2.3 `docs/articles/llm-kickstarter-v2-2026-05-04.md`

| Line | Category | Excerpt | Proposed fix |
|---|---|---|---|
| 243 | #6 null | `<startTime default=null> = Date.now()` (Shape-1 example demonstrating `default=`) | Replace `default=null` with `default=not`. Mirrors primer line 90; same upstream-SPEC question |
| 858 | #6 null | `if (!user) return null` (canonical login() example, mirror of v1 line 308) | Same fix as v1 line 308 |
| 861 | #6 null | `: null` (ternary fallback, mirror of v1 line 311) | Same fix as v1 line 311 |

Other matches are SQL DDL `not null` (1064+) + prose mentions of feature semantics ("`is some` value EXISTS / null+undefined fail" at line 527). The `===` mentions on lines 685 + 1252 are explicit anti-pattern callouts ("State machine via `if @phase === 'loading'` chains | (any) | An engine") — illustrating what NOT to do. Correct usage.

### §2.4 `docs/articles/llm-kickstarter-v0-2026-04-25.md` (already superseded)

| Line | Category | Excerpt | Proposed fix |
|---|---|---|---|
| 229 | #6 null | `if (!user) return null` | (v0 is per-S78-non-compliance pending archival — fix not needed; defer to non-compliance archival) |
| 230 | #6 null | `: null` | same as 229 |

Already flagged in S78 non-compliance report as carry-forward (`-draft-` name-heuristic, superseded by v1). **Not added to §4 backlog** — archival is the right disposition.

### §2.5 `docs/articles/realtime-and-workers-as-syntax-devto-2026-04-29.md`

KNOWN-DRIFT per pa.md Rule 1 (published articles are immutable) + non-compliance.report.md line 167-168 (`<channel protect=>` → `<channel auth=>` rename drift on line 200).

| Line | Category | Excerpt | Proposed fix |
|---|---|---|---|
| 42 | #1 try/catch | `try { msg = JSON.parse(raw.toString()); }` | **NO FIX** — inside the "before scrml" TypeScript code block (lines 24-57) illustrating the framework status quo, not advocating for try/catch in scrml |
| 47 | #3 === | `if (peer !== ws && peer.readyState === peer.OPEN) {` | **NO FIX** — same TS "before" block |
| 65 | #6 null | `let ws: WebSocket | null = null;` | **NO FIX** — same TS "before" block (TypeScript type, not scrml source) |
| 82 | #3 === | `if (ws?.readyState === WebSocket.OPEN) {` | **NO FIX** — same TS "before" block |
| 200 | (channel) | `<channel protect=>` (vs canonical `auth=`) | KNOWN-DRIFT carry-forward (S80 rename); already in non-compliance report |

No NEW drift; the existing carry-forward stands.

### §2.6 `docs/articles/components-are-states-devto-2026-04-29.md`

| Line | Category | Excerpt | Proposed fix |
|---|---|---|---|
| 35 | #6 null | `error: string | null;` | **NO FIX** — inside TypeScript fenced block describing Zustand store interface (the "before scrml" framework setup, lines 28-91) |
| 43 | #6 null | `error: null,` | **NO FIX** — same TS "before" block |
| 46-50 | #1 try/catch | `try { ... } catch (e) { ... }` | **NO FIX** — same TS "before" block |
| 69 | #6 null | `useState<string | null>(null);` | **NO FIX** — same TS "before" block |
| 85 | #6 null | `onCancelEdit={() => setEditingId(null)}` | **NO FIX** — same TS "before" block (and the JSX `={...}` is a JSX idiom illustrated in the "before" frame) |
| 81 | #3 === | `isEditing={editingId === c.id}` | **NO FIX** — same TS "before" block |

All occurrences are in the "before scrml" TypeScript code block contrasting framework status quo with scrml's idiomatic form. Article structure is legitimate (contrast pattern).

### §2.7 `docs/articles/mutability-contracts-devto-2026-04-29.md`

| Line | Category | Excerpt | Proposed fix |
|---|---|---|---|
| 129 | #6 null | `passwordHash: (null -> string),` (inside scrml fenced block illustrating lifecycle annotation `(null -> string)`) | **BORDERLINE — defer to §5.** Article §"Status (v0.2.x)" preamble (line 14) explicitly states "lifecycle / typestate layer … SPEC-ratified design surfaces that are not yet implemented in the v0.2.4 compiler." If the `(null -> T)` syntax is normatively part of scrml's lifecycle layer, this is a stated-intent ↔ S81 directive conflict (S81 says `null` should not exist in *any* context). Surface for user disposition. |
| 130 | #6 null | `metadata: (!null && !number)` | Same disposition as line 129 |
| 134, 138-144 | #6 null | Prose mentions of `null -> string` semantics + inline `if (x !== null) ceremony` callouts | Prose — primarily anti-pattern framing; the `if (x !== null)` references describe the *competing* TypeScript ceremony tax, not scrml syntax |
| 232 | #6 null | `So is (null -> string).` (prose summary in §"types stay types") | Same prose semantics — same borderline disposition as 129 |
| 248, 250 | #6 null | Prose section §"Wrong defaults this fixes" describes `(null -> T)` lifecycle | Same prose — same disposition |

Note: this article is published (dev.to) — per pa.md Rule 1, published articles are immutable. If the lifecycle-syntax design is being held but the `null` token within it is migration-target, the SPEC side needs a normative update first, then a republish-or-leave decision. Pure §5 disposition material.

### §2.8 `docs/articles/server-boundary-disappears-devto-2026-04-28.md`

| Line | Category | Excerpt | Proposed fix |
|---|---|---|---|
| 48-49 | #1 try/catch | `try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }` | **NO FIX** — inside TS "before scrml" code block (lines 30-60) |
| 53 | (JSON.stringify) | `return new Response(JSON.stringify(parsed.error), ...)` | **NO FIX** — same TS "before" block |
| 73 | (JSON.stringify) | `body: JSON.stringify(input),` | **NO FIX** — same TS "before" block |
| 75 | (throw new Error) | `if (!res.ok) throw new Error(await res.text());` | **NO FIX** — same TS "before" block |

No drift. All inside the contrast "before" TS block.

### §2.9 `docs/articles/orm-trap-devto-2026-04-29.md`

Only `null` mentions are SQL DDL `not null` constraints in `<schema>` block (lines 55-62). Legitimate per SPEC §39 SQL-mirror. **No drift.**

### §2.10 `docs/articles/lsp-and-giti-advantages-devto-2026-04-28.md`, `npm-myth-devto-2026-04-28.md`, `tier-ladder-promotion-devto-2026-05-04.md`, `css-without-build-step-devto-2026-04-29.md`, `why-programming-for-the-browser-needs-a-different-kind-of-language-devto-2026-04-27.md`, `why-scrml-has-to-deprecate-function-and-component-overloading-devto-2026-05-06.md`, `scrml-debate-amends-zod-claim-devto-2026-05-06.md`, `x-snippet-zod-calibration-2026-05-06.md`, `teej_baiting_tweet.md`

Grep-clean for categories #1, #3, #6 in scrml-fenced contexts. **No drift detected.**

### §2.11 `examples/14-mario-state-machine.scrml`

| Line | Category | Excerpt | Proposed fix |
|---|---|---|---|
| 17 | #2 file-top `#{}` (comment promoting the pattern) | `// `#{}` for the body font.` | Remove the comment line (it advertises file-top `#{}` as canonical) OR leave only if line 19-21 is removed |
| 19-21 | #2 file-top `#{}` | `#{`\n`    body { background: #1a1a2e; font-family: 'Press Start 2P', 'Courier New', monospace; }`\n`}` | Per S86 verbatim rule: either delete entirely (idiomatic examples prefer inline `class="..."`), OR move `<body>` font setup to inline Tailwind utility classes on the root `<div>` (S86 is explicit: file-top `#{}` is reserved for shapes that can't express inline — element-tag selectors qualify, but the example is teaching a styling pattern via what should be inline, which IS the corpus-ouroboros vector S86 forbids). **Recommended:** delete the `#{}` block; demonstrate font via Tailwind `font-mono` + inline color on root container. |

This is the ONLY file-top `#{}` instance in any example file. Confirmed via systematic scan across all 59 example `.scrml` files (root + multifile + trucking-dispatch).

### §2.12 `examples/23-trucking-dispatch/models/auth.scrml`

| Line | Category | Excerpt | Proposed fix |
|---|---|---|---|
| 48 | #6 null (in JSDoc) | `* Returns the value string, or null if not found.` | Update comment to "Returns the value string, or `not` if not found." |
| 51 | #6 null | `if (!cookieHeader) return null` | Replace with `if (cookieHeader is not) return not` |
| 60 | #6 null | `return null` | Replace with `return not` |
| 72 | #6 null (in JSDoc) | `* `token` may be empty/null to clear the cookie (logout flow).` | Update comment to "may be empty/`not`" or "may be `not`" |

### §2.13 `examples/23-trucking-dispatch/components/driver-card.scrml`

| Line | Category | Excerpt | Proposed fix |
|---|---|---|---|
| 31 | #6 null + `==`/`!=` with null | `if (cdlExpires == null || cdlExpires == "") return "text-slate-500"` | Replace `cdlExpires == null` with `cdlExpires is not`. Convert to `if (cdlExpires is not || cdlExpires == "") return "text-slate-500"` |
| 58 | #6 null | `<span if=(driver.current_location != null && driver.current_location != "")>` | Replace `!= null` with `is some` |
| 61 | #6 null | `<span if=(driver.current_location == null || driver.current_location == "") class="text-slate-400">` | Replace `== null` with `is not` |
| 67 | #6 null | `<span if=(currentLoadId != null)>` | Replace with `<span if=(currentLoadId is some)>` |
| 75 | #6 null | `<span if=(currentLoadId == null) class="text-slate-400">` | Replace with `<span if=(currentLoadId is not) ...>` |
| 81 | #6 null | `${driver.cdl_expires == null ? "—" : driver.cdl_expires}` | Replace `== null` with `is not`. Consider `match` rewrite if ternary form is also flagged |

### §2.14 `examples/23-trucking-dispatch/components/load-card.scrml`

| Line | Category | Excerpt | Proposed fix |
|---|---|---|---|
| 17 | #6 null | `if (at == null || at == "") return "—"` | Replace `at == null` with `at is not` |
| 26 | #6 null | `if (dollars == null) return "—"` | Replace with `if (dollars is not) return "—"` |
| 59 | #6 null | `<span if=(load.weight_lbs != null) class="text-slate-400">` | Replace `!= null` with `is some` |
| 73 | #6 null | `<div if=(customerName != null) class="text-xs text-slate-500 mt-1 truncate">` | Replace `!= null` with `is some` |

### §2.15 `examples/23-trucking-dispatch/components/customer-card.scrml`

| Line | Category | Excerpt | Proposed fix |
|---|---|---|---|
| 39 | #6 null | `${customer.contact_name == null ? "—" : customer.contact_name}` | Replace `== null` with `is not` |
| 44 | #6 null | `<div>${customer.contact_email == null ? "—" : customer.contact_email}</div>` | Same |
| 46 | #6 null | `${customer.contact_phone == null ? "" : customer.contact_phone}` | Same |
| 52 | #6 null | `${customer.billing_address == null ? "—" : customer.billing_address}` | Same |

### §2.16 `examples/23-trucking-dispatch/components/invoice-card.scrml`

| Line | Category | Excerpt | Proposed fix |
|---|---|---|---|
| 15 | #6 null | `if (inv.paid_at != null && inv.paid_at != "") return "paid"` | Replace `!= null` with `is some` |
| 16 | #6 null | `if (inv.due_at != null && inv.due_at != "" && inv.due_at < todayIso) return "overdue"` | Same |
| 35 | #6 null | `if (at == null || at == "") return "—"` | Replace `== null` with `is not` |
| 52 | #6 null | `${loadOriginCity == null ? "" : loadOriginCity}` | Same |
| 53 | #6 null | `<span if=(loadOriginCity != null && loadDestinationCity != null) class="text-slate-400 mx-1">→</span>` | Replace both `!= null` with `is some` |
| 54 | #6 null | `${loadDestinationCity == null ? "" : loadDestinationCity}` | Replace `== null` with `is not` |
| 71 | #6 null | `<div if=(invoice.payment_reference != null && invoice.payment_reference != "") ...>` | Replace `!= null` with `is some` |
| 77 | #6 null | `<button if=(invoice.paid_at == null || invoice.paid_at == "") ...>` | Replace `== null` with `is not` |
| 83 | #6 null | `<span if=(invoice.paid_at != null && invoice.paid_at != "") ...>` | Replace `!= null` with `is some` |

### §2.17 Remaining trucking-dispatch files (pages, channels, schema, app, seeds)

Systematic null-literal scan returned zero non-SQL-DDL hits outside the files listed above. The newer pages (`app.scrml`, `pages/dispatch/billing.scrml`, `pages/driver/*.scrml`, `pages/customer/loads.scrml`) consistently use the canonical `is some`/`is not` idiom — they are aligned. The drift is concentrated in older files: `components/*.scrml` (4 of 7) + `models/auth.scrml` (1).

### §2.18 Examples 22-multifile

`grep -rnE '\bnull\b|===|!==|\btry\b\s*\{|\bcatch\s*\('` over `examples/22-multifile/*.scrml` → zero hits. **No drift.**

### §2.19 Root examples 01–13, 15–21

Systematic scan returned zero category #1, #3, or #6 (non-SQL) hits across all 18 of these files. **No drift.** (Example 14 is the only exception, covered above.)

---

## §3 Cross-cutting patterns

### §3.1 Drift frequency by category

| Category | Drift findings in §4 backlog | Borderline in §5 |
|---|---|---|
| #1 try/catch | 0 | 0 (all article mentions are TS "before" blocks; primer + examples clean) |
| #2 file-top `#{}` | 1 (example 14 only) | 0 |
| #3 === / !== | 0 | 0 (all anti-pattern illustrations; no scrml-source drift) |
| #4 bare-name local refs | 0 | 0 (no occurrences detected) |
| #5 React/JSX idioms | 0 | 0 (no `useState`/`useEffect`/`ref()` in any `.scrml` file; JSX-style `={value}` only in TS "before" blocks) |
| #6 null / undefined | 25 (24 in trucking-dispatch components + 1 in primer + 5 in kickstarter v1/v2 = 30 total — 5 are in v0 already-marked-superseded + kickstarter v1+v2 are 3) | 6 (lifecycle `(null -> T)` syntax in mutability-contracts article; SPEC §6.4 `default=null` upstream question) |
| #7 stdlib npm-reach equivalents | 0 | 0 (`Math.round`/`Math.floor`/`Date.now` are host globals, not stdlib-wrapper substitutes; no `JSON.parse`/`stringify` in scrml source) |
| #8 engine outside recipe | 0 | 0 (mario engine follows §51.0 canonical form) |
| #9 match Tier misuse | 0 | 0 |
| #10 derived= misuse | 0 | 0 |

### §3.2 Heaviest-drift cluster

**`examples/23-trucking-dispatch/components/*.scrml`** is the heaviest cluster. Four of seven component files (`driver-card.scrml`, `load-card.scrml`, `customer-card.scrml`, `invoice-card.scrml`) contain 24 total `== null` / `!= null` occurrences. The remaining three components (`address-form.scrml`, `assignment-picker.scrml`, `load-status-badge.scrml`, `status-picker.scrml`) are clean.

The drift is **clustered by file age** — the trucking-dispatch components were written earlier in the v0.2.x cycle when the `== null`/`!= null` form was apparently tolerated; the newer pages and `app.scrml` have been migrated to `is some`/`is not`. This is a partial migration that stopped; per S81's "the 'not' directive is still in play" + the standing rule that "null/undefined will not ever exist in any context in scrml," the components are unfinished migration work.

### §3.3 Article corpus is substantially aligned

All 17 articles use `try/catch`, `===`, `useState`, `useEffect`, JSX-curly-attr, `throw new Error`, etc. only in TypeScript "before scrml" contrast blocks. Article structure is consistent: TS framework example → "Now in scrml:" → scrml fenced block. The contrast structure is a deliberate pedagogical pattern and is NOT corpus-ouroboros (it is corpus showing what NOT to do, with the canonical form right next to it).

The two structural deviations are:
1. **kickstarter v1 + v2 `login()` example** (lines v1:308+311, v2:858+861) — uses `return null` and `: null` as canonical scrml code, not as a "before" anti-pattern. These are the most consequential corpus-ouroboros vectors because the kickstarter is the load-bearing agent-brief dispatched into every dev agent.
2. **mutability-contracts `(null -> T)` lifecycle syntax** — preview-of-future-feature material; needs upstream SPEC reconciliation with S81 directive before migration is straightforward. §5 disposition.

### §3.4 Primer is substantially aligned

Single `default=null` drift on line 90; otherwise the primer is the strongest defender of canonical form (anti-pattern table is explicit on all 10 categories; Business Invariants section in domain.map.md is unambiguous). The primer is fulfilling its role as canon snapshot.

### §3.5 Systematic pattern: drift concentrated where `not` would require an upstream API change

Two upstream questions surface:
1. **SPEC §6.4 `default=` attribute** — SPEC.md itself shows `<startTime default=null>` (lines 4832, 4834). Primer + kickstarter v2 mirror that. If S81 "null in no context" is normative, SPEC needs `default=not` and the corpus migration follows. (PA-side; outside corpus audit scope.)
2. **kickstarter `login()` return shape** — the canonical example returns `null` on failure. Per scrml's error model (primer §6 + §7), the failable-fn `!{}` form is canonical: `server function login(...)! -> LoginError { ... fail LoginError::InvalidCredentials }`. A `return null` is JS-flavored; the scrml-canonical rewrite is structural, not mechanical. Worth flagging that the rewrite is a meaningful pedagogy improvement, not just a token swap.

---

## §4 Migration backlog

Each item is self-contained — file path, line range, drift category, proposed fix. Sized for individual sub-dispatches; the trucking-dispatch component sweep can be ONE dispatch if mechanical (`== null` → `is not`, `!= null` → `is some`).

### M-1: `examples/23-trucking-dispatch/components/driver-card.scrml:31,58,61,67,75,81` — six `==/!= null` occurrences (category #6)

Mechanical: `cdlExpires == null` → `cdlExpires is not`; `driver.current_location != null` → `driver.current_location is some`; etc. Then `<span if=(cdl is not || cdl == "")>` may simplify to `<span if=(cdl is not || cdl == "")>` (no change to the empty-string check; `is not` covers null/undefined; `== ""` covers empty-string).

### M-2: `examples/23-trucking-dispatch/components/load-card.scrml:17,26,59,73` — four `==/!= null` occurrences (category #6)

Same mechanical rewrite as M-1.

### M-3: `examples/23-trucking-dispatch/components/customer-card.scrml:39,44,46,52` — four `== null ?` ternary occurrences (category #6)

`customer.contact_name == null ? "—" : customer.contact_name` → `customer.contact_name is not ? "—" : customer.contact_name`. Consider promoting to `match` form per primer §1 Tier 1 if the pattern recurs across multiple cells.

### M-4: `examples/23-trucking-dispatch/components/invoice-card.scrml:15,16,35,52,53,54,71,77,83` — nine `==/!= null` occurrences (category #6)

Same mechanical rewrite as M-1.

### M-5: `examples/23-trucking-dispatch/models/auth.scrml:51,60` — two `return null` + JSDoc references at lines 48, 72 (category #6)

`if (!cookieHeader) return null` → `if (cookieHeader is not) return not`. The `if (!x) return not` shape is the scrml-idiomatic form for "absent → absent." Update JSDoc comments at lines 48 and 72 in the same commit.

### M-6: `examples/14-mario-state-machine.scrml:17,19-21` — file-top `#{}` + comment promoting it (category #2)

Per S86 verbatim: idiomatic examples MUST NOT promote file-top `#{}`. Two viable fixes: (a) **delete** the `#{}` block + line 17 comment, demonstrate body styling via inline Tailwind on root container; (b) move the font-family + bg-color rule to inline `class="..."` on the example's root `<div>`. Recommended (a) — it's the cleanest "this example does NOT teach file-top `#{}`" outcome, which is the S86 intent.

### M-7: `docs/PA-SCRML-PRIMER.md:90` — `default=null` in Shape-1 example (category #6)

`<startTime default=null> = Date.now()` → `<startTime default=not> = Date.now()`. **Prerequisite:** confirm SPEC §6.4 supports `default=not` (or migrate SPEC first). If SPEC still says `default=null`, this is a coordinated SPEC + primer change.

### M-8: `docs/articles/llm-kickstarter-v1-2026-04-25.md:308,311` — `return null` + `: null` in canonical `login()` example (category #6)

Two viable fixes: (a) **mechanical** — replace `return null` with `return not` and `: null` with `: not` (preserves the JS-flavored ternary); (b) **structural** — promote `login` to a failable function `server function login(email, password)! -> LoginError { … fail LoginError::InvalidCredentials … }` with caller-site `!{}` arm. Recommended (b) — kickstarter is the load-bearing dev-agent brief; the structural form teaches the canonical error model. (b) is meaningfully more work (~30 min instead of 2 min) but is the right answer per pa.md Rule 3.

### M-9: `docs/articles/llm-kickstarter-v2-2026-05-04.md:243` — `default=null` in Shape-1 example (category #6)

Same as M-7, mirrored in kickstarter v2.

### M-10: `docs/articles/llm-kickstarter-v2-2026-05-04.md:858,861` — `return null` + `: null` in canonical `login()` example (category #6)

Same as M-8, mirrored in kickstarter v2. Likely same commit/dispatch as M-8 since v1 + v2 have the same example shape.

---

## §5 Out of scope / deferred (borderline cases — surface for user disposition)

### D-1: `docs/articles/llm-kickstarter-v0-2026-04-25.md` — `return null` + `: null` at lines 229-230

v0 is already flagged in non-compliance.report.md as superseded by v1 (`-draft-` carry-forward, S78 baseline). Right disposition: archive v0 to `scrml-support/archive/articles/`, NOT migrate. **Don't include in §4 backlog.**

### D-2: `docs/articles/mutability-contracts-devto-2026-04-29.md:129-130, 232, 248, 250` — `(null -> string)` / `(!null && !number)` lifecycle annotation

The article's own preamble line 14 says: *"the lifecycle / typestate layer (`(null -> string)` field-transition annotations) and the `lin` linear-type layer described later in this piece are SPEC-ratified design surfaces that are not yet implemented in the v0.2.4 compiler."* So this is preview-of-future-feature framing. The S81 directive ("null/undefined will not ever exist in any context in scrml in any way") would forbid `null` token even in this lifecycle syntax — but if `(null -> T)` IS the normative lifecycle layer surface, the SPEC needs updating first (e.g., `(not -> T)`), then the article republish-or-leave decision. Disposition needs user input on:
- Is `(null -> T)` the normative lifecycle-syntax surface in SPEC?
- If yes, should it become `(not -> T)` per S81?
- If becoming `(not -> T)`, is this article republished or left as a known-published-drift carry-forward (pa.md Rule 1)?

### D-3: `docs/articles/realtime-and-workers-as-syntax-devto-2026-04-29.md:200` — `<channel protect=>` rename drift

Already a non-compliance.report.md carry-forward (line 167-168, S80 `protect=` → `auth=` rename). Right disposition: KNOWN-DRIFT per pa.md Rule 1; no action unless republished.

### D-4: SPEC.md §6.4 lines 4832, 4834 — `<startTime default=null>` + `<token default=null>` as canonical SPEC text

Out of CORPUS audit scope but flagged because primer M-7 + kickstarter v2 M-9 depend on it. If S81 "no null in any context" applies to SPEC text too, this is migration material in `compiler/SPEC.md` itself, which then propagates to primer + kickstarter + sample fixtures. **PA-side decision: does the migration sweep include SPEC.md or stop at the corpus?**

### D-5: Published dev.to article cluster (lines flagged in §2.5-§2.8 as "NO FIX — TS before block")

All "before scrml" TypeScript blocks legitimately use `try/catch`, `===`, `useState`, etc. as anti-pattern illustrations. The pattern is pedagogically correct. **Not drift.** Listed in §5 only to clarify the audit's filter discipline — these were inspected and confirmed-OK.

### D-6: Example 12 (`12-snippets-slots.scrml:46`) — single `console.log(...)` call

Not in the primer's anti-pattern table; `console.log` is a JS host global. Probably acceptable as ad-hoc debugging idiom in an examples file. Surface for user disposition only if a "no host-global I/O calls" rule is being enforced.

---

## §6 Summary metrics

**Total corpus files audited:** 77 (17 articles + 1 primer + 21 root example .scrml + 38 multi-file example .scrml).

**Total drift findings in §4 migration backlog:** **10 items (M-1 through M-10)**, covering **26 individual line-level fixes**:

| Category | M-items | Line-level fixes |
|---|---|---|
| #2 file-top `#{}` | M-6 | 2 lines (mario example only) |
| #6 null / undefined | M-1, M-2, M-3, M-4, M-5, M-7, M-8, M-9, M-10 | 24 lines (6+4+4+9+2 trucking + 1 primer + 2 v1 + 1 v2 + 2 v2) |

**Borderline / deferred items in §5:** 6 (one v0 superseded, one lifecycle-preview, one published-immutable carry-forward, one upstream-SPEC question, one TS-contrast block category, one ad-hoc debug call).

**Heaviest-drift file:** `examples/23-trucking-dispatch/components/invoice-card.scrml` — 9 findings (all category #6, mechanical).

**Lightest-drift file (among files with findings):** tied between `docs/PA-SCRML-PRIMER.md` (1 finding, line 90) and `examples/14-mario-state-machine.scrml` (1 logical finding spanning 3 lines).

**Substantial alignment confirmed in:** 50 of 77 files have zero category #1-#10 drift in scrml-source contexts (most articles via TS-before-block discipline; most examples via consistent `is some`/`is not` adoption).

**Estimated total migration effort (very rough, for sizing only):**

- M-1 through M-4 (mechanical `== null` → `is not` / `!= null` → `is some` sweep across 4 component files, 23 line edits): **~30-45 min**. Single dispatch. Possible candidate for `bun scrml migrate --fix-null` if/when that CLI lands per S81 design thought.
- M-5 (`models/auth.scrml`, 2 returns + 2 comments): **~10-15 min**. Could batch with M-1..M-4.
- M-6 (mario file-top `#{}`): **~10-15 min**. Inline-Tailwind decision + remove comment + verify mario example still compiles.
- M-7 (primer `default=null`): **~5 min** IF SPEC.md is also updated; **~15 min** if a coordinated 2-file rewrite.
- M-8 + M-10 (kickstarter v1 + v2 `login()` example): **~30-60 min** if structural rewrite to failable-fn `!{}` form; **~5 min** if mechanical-only `null` → `not`. Right answer per Rule 3 = the structural rewrite.
- M-9 (kickstarter v2 `default=null`): **~5 min** batched with M-7.

**Aggregate: ~1.5 - 2.5 hours** for the full Wave 3.7 migration sweep, assuming mechanical-only for the structural ones. **~3-4 hours** if the kickstarter `login()` example is restructured to the canonical failable-fn shape.

**Cross-cutting pattern summary:** Drift is concentrated in (a) one engineering-time-stratum of the trucking-dispatch components (4 files, pre-`is some`/`is not` migration era), (b) the canonical kickstarter `login()` example mirrored in v1 + v2, and (c) one styling example (mario). The corpus is **broadly aligned** with stated intent — most articles' use of forbidden idioms is in TypeScript "before scrml" contrast blocks (legitimate pedagogy), and the newer pages + app shell across the trucking-dispatch app consistently use canonical forms. The remaining drift is a migration backlog, not an open design question.

---

## Methodology cross-references

- `pa.md` Rules 1-4 + §"Maps-discipline protocol (S82)"
- `docs/PA-SCRML-PRIMER.md` §6 (error model) + §11 (anti-patterns table)
- user-voice §S81 (null directive verbatim) + §S86 (corpus-ouroboros + styling rule verbatim) + §S88 (try/catch directive verbatim)
- `feedback_idiomatic_examples_styling.md` (S86 memory rule)
- `feedback_stated_intent_vs_corpus_migration.md` (S88 memory rule)
- design-insights Insight 30 (channel cross-file dispensation) + Insight 31 (DESIGN-AND-SHIP §36 + "corpus-ouroboros rule respected" methodology signal)
- `.claude/maps/non-compliance.report.md` (existing carry-forwards for v0 + S80 article drift)
- `.claude/maps/domain.map.md` Business Invariants section (null/undefined + ===/!== forbidden lines)

## Maps consulted

- `.claude/maps/primary.map.md` — load-bearing for audit task-shape routing (§"Audit / diagnostic")
- `.claude/maps/non-compliance.report.md` — confirmed v0 + S80 `protect=` drift already filed; allowed §5 deferrals to be self-consistent with prior PA decisions
- `.claude/maps/domain.map.md` — Business Invariants list (lines 85-86) provided the verbatim "null/undefined NOT valid" + "===/!== NOT valid" anchors used to confirm category #3 + #6 normative status

**Load-bearing finding:** The corpus is substantially aligned with stated intent (50 of 77 files clean; all articles use forbidden idioms only in legitimate TS "before scrml" contrast blocks); the remaining drift is concentrated in (a) four older trucking-dispatch component files that missed the `is some`/`is not` migration that was completed in the newer pages, (b) the canonical kickstarter `login()` example (mirrored across v1 + v2) which uses `return null`, and (c) one file-top `#{}` in the mario state-machine example. 10 migration items in §4 (~26 line-level edits, ~1.5-2.5 hours mechanical), 6 borderline items in §5 deferred for user disposition (mostly upstream-SPEC questions or published-immutable carry-forwards).
