# dpa-030 — PA verification of the Phase-1 OQs (S349-peter, 2026-08-17)

**Authority:** PA-produced, reproduced by execution / source-enumeration. Nothing ratified; no SPEC
edited; no compiler source touched.

> **⚠ FRAMING CORRECTION (grounded against the gate after pulling #554).** dpa-030 is **already RULED
> fork(a)** — S347-bryan wrap `e38ccc1a` (#554), which is NEWER than the S348-peter wrap `8d0e8018`
> (#553) whose stale PICKUP still lists dpa-030 as owed-to-operator. So these OQs are **not**
> ratification-gates; they are **Phase-1 implementation** prerequisites (OQ-1 was named "blocking
> Phase 1") and a **finding against bryan's held D2/D3/D4 branch** (OQ-2 — see Net Effect). `File` is
> NOT a builtin on main (grep `type-system.ts` = 0); Phase 0 defects sit in held branch `45fc29b5`;
> Phase 1 (the `File` mint) is unstarted. Routes to bryan (held-branch owner) + Peter.

**Method rule honored:** every claim below is PA-reproduced (OQ-1 by running a Bun server; OQ-2 by
reading emitted codegen), not relayed from the dPA panel — per the S347 durable lesson (findings are
claims until the PA executes them).

---

## OQ-1 — streaming byte-budget abort on `req.body`: **PASS (SOUND)**

**Question (DD, blocking Phase 1):** Can a Bun handler read `req.body` as a `ReadableStream`, count
bytes, and abort at N *without materializing the body*? If not, the declared bound is advisory-only
and pole 5 flips (a)→(b).

**Answer: YES, sound.** Probe: `Bun.serve` handler, 64 KB budget, `req.body.getReader()` loop,
`reader.cancel()` at budget.

| sent | server bytes READ before abort | % of payload | client saw |
|---|---|---|---|
| 4 MB | 524,118 | 12.50% | HTTP 413 |
| 40 MB | 524,117 | 1.25% | HTTP 413 |

**The soundness signature:** server-side bytes-read is **524,118 vs 524,117 — a 1-byte spread across
a 10× payload swing.** The ~512 KB is a *constant* (the Windows TCP/socket receive buffer already
in-flight), **not a fraction of the body.** A materialized-whole-body failure mode would show
`seen ≈ payload` (200 MB), the opposite of a fixed constant. → a declared `length(<=N)` bound on a
`File` parameter **is enforceable as a streaming abort**. Pole 5 stays on fork (a); the DD's
recommendation holds.

**One nuance the ruling must carry:** a mid-upload abort surfaces to the client as a **connection
reset**, not a guaranteed clean 413 — because the server tears the socket down while the client is
still uploading (reproduced at ≥200 MB: `ECONNRESET`). This is the correct, universal behavior
(nginx `client_max_body_size`; LiveView per-chunk enforcement). **Spec the surface as "413-or-reset,"
not "always a clean 413."**

Probes: `scratchpad/oq1-stream-abort.mjs`, `oq1c-serverside.mjs`, `oq1d-confirm.mjs` (Bun 1.3.14, Win x64).

---

## OQ-2 — is there a fourth ingress door? **YES — and it needs a one-clause narrowing, not a flip**

**Question (DD, "must be enumerated before ratification"):** Do SSE/WS message handlers decode adopter
payloads outside the three `emit-server.ts` prologues? If so, "(a) inherits complete mediation" is
false and the `IngressSource` set must be enumerated.

**Answer: there IS a fourth door.** Full enumeration of compiler-emitted ingress body decodes
(grep `compiler/src`, verbs `.json/.text/.formData/.arrayBuffer/.blob` on a request + WS message):

| # | site | transport | decode | mediated by the 3 prologues? |
|---|---|---|---|---|
| 1 | `emit-server.ts:3889` | HTTP | `await _scrml_req.json()` | — (IS a prologue) |
| 2 | `emit-server.ts:4092` | HTTP | `await _scrml_req.json()` | — (IS a prologue) |
| 3 | `emit-server.ts:4602` | HTTP | `await _scrml_req.json()` | — (IS a prologue) |
| **4** | **`emit-channel.ts:1109`** | **WS (server)** | **`JSON.parse(raw)`** in `message(ws, raw)` | **NO — outside the prologues** |

Site 4 is server-side: `emit-channel.ts:1092` `export const _scrml_ws_handlers` is passed to
`Bun.serve({ websocket: … })`; `message(ws, raw)` (`:1107`) runs `JSON.parse(raw)` on adopter-supplied
inbound frames and binds the payload to the channel's `onserver:message` handler param (§38.6.1).
(The `.json()` hits at `emit-functions.ts:1004/1006` and `emit-reactive-wiring.ts:1667` are
*response*-side — client reading a reply — NOT ingress. `emit-channel.ts:750` is the *client*
`onmessage`. `.formData/.text/.arrayBuffer/.blob` on a request: **0** compiler-emitted — corroborates
D3, the unawaited `request.formData()` is adopter-authored inside `handle()`, emitted verbatim.)

**Consequence — narrow the claim, don't flip the ruling:**
- **"(a) inherits complete mediation" is false as a blanket statement.** Correct `IngressSource` set =
  `{ emit-server.ts:3889, :4092, :4602, emit-channel.ts:1109 }`.
- **But the fourth door is JSON-text-only and cannot carry file bytes** — a binary WS frame hits
  `JSON.parse(raw)`, throws inside the `try`, and is swallowed. So a `File` cannot enter via `<channel>`
  today. **Fork (a) still inherits complete mediation for the file-upload transport specifically** —
  the DD's argument survives with the mediation claim scoped to "the file transport," not "all ingress."
- **Ties into D4 (DoS):** site 4 has **no scrml size ceiling** either — `JSON.parse(raw)` on an
  arbitrarily large inbound frame is the same unbounded-buffering class D4 filed, on a door D4's census
  (three `emit-server.ts` prologues) did not enumerate. Only backstop is Bun's default
  `websocket.maxPayloadLength` (16 MB), not anything scrml declares. **D4 should be widened to include
  the WS message door.**

---

## Net effect (ruling already fork(a); these feed the held branch + Phase 1)

1. **OQ-1 SOUND** → when Phase 1 is built, keep pole 2's "predicate at the contract site, lowered to a
   streaming abort (413)"; it is executable, not advisory. Emitted surface is **"413-or-reset"**
   (mid-upload aborts reset the socket — reproduced at ≥200 MB).
2. **★ OQ-2 = a gap in bryan's held D4 fix, actionable NOW.** D4 (body-size ceiling) censused the
   three `emit-server.ts` HTTP prologues. There is a **fourth unbounded ingress door** —
   `emit-channel.ts:1109` `message(ws, raw) → JSON.parse(raw)`, with **no scrml size ceiling**.
   Hardened against main (S349): (i) the `message()` emit at `emit-channel.ts:1106-1145` contains no
   length/byte/size/413 guard; (ii) **`maxPayloadLength` appears ZERO times in the entire repo**
   (codegen, runtime templates, build.js, dev.js) → the only bound is Bun's 16 MB default, which
   scrml never narrows. **When D4's S239 pass runs, verify the held branch `45fc29b5` also bounds the
   WS message door — if it only patches the three HTTP prologues, the DoS class D4 claims to close is
   still open on the `<channel>` path.** (I could not inspect `45fc29b5` directly — bryan's held
   branches are on his own remote, not origin; the local worktrees are unrelated SHAs.) This is the
   single most actionable item in this memo and it is bryan's lane (held-branch owner).
3. **OQ-2 also narrows a DD claim (docs-only):** "(a) inherits complete mediation" is false as a
   blanket statement — true only for the *file transport* (the WS door is JSON-text-only and carries
   no file bytes). Minor; not load-bearing now that the shape is ruled.

Still open, non-blocking: OQ-3 (client `bind:files` → server-fn stub marshalling) and OQ-4
(direct-to-cloud handle) — Phase-1 cost/capability refinements.
