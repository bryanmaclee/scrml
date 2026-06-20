---
status: current
last-reviewed: 2026-06-20
authority: dpa-001 RATIFIED S210 (user "ratify ship A2") — design-insights.md + dpa-queue.md#dpa-001
change-id: api-primitive-a2-2026-06-20
---

# A2 — thin typed external-API primitive (`<api>`) — build scope & decomposition

> **Status: SCOPE, not started.** Ratification (S210) committed the **direction** (A2), not a build. This
> doc decomposes the build and — crucially — surfaces the **embedded design forks that must be resolved
> first** (§3). It is NOT itself a SPEC amendment; every spec-derivative claim below is to be verified
> against `compiler/SPEC.md` during its wave (pa.md Rule 4).

## §0 What's ratified (and what isn't)

**Ratified (dpa-001, S210):** scrml will ship **A2** — a *thin, declared-shape* typed external-API
primitive (the `<api>` direction), typing the **request/endpoint half only** — layered on **B's
documentation** (a "frontend-only / BYOB" guide that ships alongside). The poll measured the BYOB segment
at ~75% of realistic adopters.

**NOT in this scope (explicit):**
- **A1** (ingest a published OpenAPI doc) — the heavier "observation" form; **gated to first-party + CI-enforced contracts**, a separate follow-on, not A2.
- **The retry/cache/pagination gravity well** — A2 must REFUSE it (LIMIT-PRIMITIVES; the openapi-codegen + simplicity-defender knife). A thin typed-callable declaration, nothing more.
- **SSR-of-external-data** — structurally gapped for all approaches (needs a scrml BFF → re-introduces a server). State plainly in the B-docs; do not try to close it here.

## §1 The A2 surface (what `<api>` is)

The **request-side dual of `<db src= tables>`**: `<db>` binds a read contract and types `?{}` against
SQL; `<api>` declares external HTTP endpoints + request shapes + response types **inline**, reuses §53
types, delegates response decode to §41.13 `parseVariant`, and binds to the **existing `<request>`**
primitive (§6.7.7) — **no new reactive surface**. Net-new surface = endpoint declaration + request typing
+ wiring `parseVariant`'s `T` to the declared response contract. (That is exactly the small "request/
endpoint half" OQ-4 leaves open — the response half is already `parseVariant`-covered.)

Identity reframe (the ratified justification): "no API layer to drift" holds where scrml owns BOTH ends;
BYOB is precisely where it does NOT. The foreign backend has already built the API layer — so the real
choice is **untyped-silent-drift vs typed-compile-loud-drift.** `<api>` converts silent drift into a
compile error = the identity's own value applied to the one boundary scrml ships naked.

## §2 Load-bearing constraints (verbatim from the ratified insight — the build MUST satisfy these)

1. **Must-not-lie (THE ratified constraint).** `<db>` types a boundary scrml controls end-to-end (the
   disappearing-boundary promise is KEPT); `<api>` types a **belief** about a boundary scrml does NOT
   control (the promise cannot be kept). The epistemic difference must be encoded **at the declaration
   site** — a type-system-visible distinction, NOT a runtime warning — so a developer's "what the compiler
   guarantees" model cannot silently extend to cover what the compiler cannot reach. → drives **F1**.
2. **LIMIT-PRIMITIVES (S174).** A2 is a *second data story* beside `<db>`; defensible ONLY as a thin typed
   declaration that refuses the retry/cache/pagination gravity well. No god-object.
3. **Co-location (S206).** "If a thing does a thing, look at the thing and know what it does." The `<api>`
   declaration + its use must read together; avoid name-referenced indirection that pulls the contract
   away from the call site (the elm/htmx co-location critique of A).
4. **Client-only (§12.2).** A2 stays a pure-client SPA path — raw `fetch()` is NOT a §12.2 server-trigger.
   The build must CONFIRM `<api>` does not accidentally become a §12.2 escalation trigger.

## §3 EMBEDDED DESIGN FORKS — resolve in Wave 0 (these GATE the build shape)

- **F1 — decl-site epistemic encoding (THE gating fork; from constraint 1).** How does `<api>` make
  "this is a belief, not a guarantee" type-system-visible? Candidates: (a) a distinct keyword/element
  (`<api>` already reads differently from `<db>` — is the element name alone enough?); (b) a required
  `unverified:` / `external:` annotation on the declaration; (c) a distinct type-TIER for `<api>`-derived
  values (the compiler tracks "externally-sourced" through the type, surfacing it at use sites). Likely DD-
  or AskUserQuestion-shaped; everything downstream (syntax, typer, codegen) depends on it.
- **F2 — syntax surface.** The exact `<api>` shape: endpoint inventory + per-endpoint method/path/request-
  shape/response-type. Mirror `<db src= tables>`? One `<api>` block with child endpoint decls, or one
  `<api>` per endpoint? Inline request/response type refs vs §53 named types.
- **F3 — SPEC placement.** A new top-level § (next is §60), a §6.7.x subsection beside `<request>`
  (§6.7.7), or near `<db>`/schema (§39/§52)? The "request-side dual of `<db>`" framing argues for the
  `<db>` neighborhood; the "binds `<request>`" mechanic argues for §6.7.x. Decide before W1.
- **F4 — `<request>` + `parseVariant` wiring.** Does `<request>` gain a typed/`api=` mode that consumes an
  `<api>` endpoint? Is the response `T → parseVariant` wiring automatic from the `<api>` response decl or
  explicit at the call site? (Co-location constraint 3 pulls toward automatic-but-visible.)

## §4 Decomposition (waves)

- **W0 — resolve F1-F4** (design). F1 likely a DD/debate or a focused AskUserQuestion; F2-F4 fall out
  once F1 lands. Output: a ratified surface + placement. **GATES W1+.**
- **W1 — SPEC §-authoring (Nominal / spec-ahead).** Author the `<api>` section (per F3 placement) + the
  owned-vs-unowned type semantics (per F1) + §34 error codes, as a Nominal banner section (the §58/§59
  precedent: SPEC-ahead, impl waves flip the banner). SPEC-only landing.
- **W2 — parser** (BS / TAB / ast-builder): recognize the `<api>` element + endpoint sub-declarations +
  attrs; emit `E-API-*` codes for malformed declarations.
- **W3 — type-system**: the declared-shape request typing + the F1 unowned-boundary tier/annotation +
  response-`T` resolution against §53 + the §12.2 client-only confirmation gate.
- **W4 — codegen**: emit the thin typed fetch callable, wiring the existing `<request>` + `parseVariant`
  (per F4). No retry/cache/pagination machinery (constraint 2).
- **W5 — tests + example + B-docs**: unit + integration + conformance; a worked `examples/NN-external-api`
  (BYOB over a mock external endpoint); and the **B-docs "frontend-only / BYOB" guide** (ships with A2 —
  it was half the ratified verdict): documents the path, states plainly you own keeping types in sync,
  recommends full-stack where applicable.

## §5 Dependencies / integration points (verify each against SPEC during its wave — Rule 4)

- §6.7.7 `<request>` (the bind target) · §41.13 `parseVariant` (response decode) · §53 refinement/struct
  types (request + response shapes) · §12.2 escalation triggers (confirm `<api>` stays client-only) ·
  §34 error-code catalog (new `E-API-*` rows land WITH the productions, per Rule 4).
- Source-of-truth context: the debate artifact `scrml-support/docs/debates/external-backend-A-vs-B-vs-C-2026-06-20.md` + source DD `external-backend-frontend-only-2026-06-20.md` + the ratified insight in `~/.claude/design-insights.md`.

## §6 Open cross-axis tie-in
- **flogence raw-route (serve-side)** is the unresolved other half of this same typed-HTTP-boundary axis
  (this scope = scrml *consuming* a foreign backend; raw-route = scrml *serving* a raw wire to foreign
  clients). PA/user to decide: fold into the A2 philosophy (one "typed HTTP boundary" model, both
  directions) or bank as **dpa-002**. If folded, F1's epistemic-encoding answer likely informs both.

## §7 Sequencing note
W0 is the real next step — it is design, not code, and it is where the user/PA decide F1 (the must-not-lie
encoding). Do NOT dispatch W2+ before W0+W1 land (a primitive built before its decl-site epistemics are
ruled would bake in the exact false-confidence lie the ratification names as the worst outcome). Estimate:
W0 ~1 design session (DD or AskUserQuestion-driven); W1 ~1 session; W2-W4 ~1-2 dispatches each; W5 ~1.
