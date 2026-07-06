# SPEC-AMENDMENT — clean-print primitive `print()` / `println()` (§20.7)

**Status:** RULED + SPEC-TEXT AUTHORED (S241, 2026-07-06). **Forks ruled by bryan: A(i) + B(i)**
("A(i) and B(i)"). SPEC.md amended: NEW §20.7 (+§20.7.1–.6) · §12.2 Trigger 3 (+host-stdout
server-only signal) · §64.8 xref · §20.6 xref · SPEC-INDEX regenerated (45 rows) + header note.
**Pending:** landing authorization (commit to main) + the impl dispatch (emit-tool.ts `_scrml_print`
+ web-app server-emit path + the 2 codes + tests + conformance) AFTER GITI-033 lands.
Below is the design record (forks now resolved — A(i)/B(i) marked).
**Authority:** ruled **(a)** S238 close ("a dedicated `print`/`println` clean-stdout primitive; `log()`
stays the decorated dev-logger everywhere") + reaffirmed S240. flogence R26 residual: `log()` §20.6
decorates stdout `[server]…(file:line)`; a CLI's stdout is machine-parsed → needs clean output.
**Consumer/R26:** flogence (re-ports `fleet` CLI once landed).
**Class:** SPEC-TEXT / Nominal (spec-ahead). Impl (emit-tool.ts inlines `_scrml_print`) dispatches AFTER
this ratifies AND after GITI-033 lands (avoid codegen landing-concurrency). §34 rows land WITH the impl
(Rule 4 / §60·§61·§64 named-codes-land-with-impl precedent).

---

## The core contrast (why print ≠ log)

| | `log()` (§20.6) | `print()` / `println()` (§20.7 NEW) |
|---|---|---|
| purpose | **diagnostics** (printf-debugging) | **program output** (the CLI's real stdout) |
| decoration | `[server\|client] … (file:line)` origin tag | **NONE** — raw text, exactly what's passed |
| production | **stripped to 0 bytes** | **survives** — it IS the program's output |
| dev-forwarding | client→terminal forward + browser console | none — writes host `process.stdout` directly |
| render | value-faithful (structs/enums readable) | *(Fork B)* |
| location-transparent | yes (compiler-certain side) | no — a host-stdout effect |

`log()` is unchanged. `print`/`println` are a NEW sibling. The line: **log is for the developer; print
is for the program's consumer.** They must not be entangled (the §20.6.5 "dev-log ≠ prod-log surface"
discipline applies in reverse — print is not a diagnostic).

## §20.7 (proposed) — `print()` / `println()` — Clean Stdout

- `print(...args)` writes its args to host stdout with **no trailing newline**; `println(...args)`
  appends a single `\n`. Args are **space-joined** (`println("a", "b")` → `a b\n`) — the console.log /
  conventional print shape.
- Both are compiler-managed builtins lowered at codegen (the `log()`/`navigate()` rewrite shape, §20.1),
  NOT stdlib imports. Emit: `print(x)` → `_scrml_print(x)` → `process.stdout.write(<joined>)`;
  `println` → `... + "\n"`. Helper inlined by emit-tool.ts (and the server-emit path for a web app).
- Statement-position; no usable return value (evaluates to `not`), same as `log()`.
- **Production: NOT stripped.** Unlike `log()`, print/println are program output and survive the
  production build verbatim. Explicit normative statement so no strip-pass touches them.
- **Shadowing:** a user-declared in-scope `print`/`println` wins; the builtin steps aside and emits
  info-lint `W-PRINT-SHADOWED` (mirror of `W-LOG-SHADOWED`, §20.6.7; reserved `E-PRINT-SHADOWED` at
  window-end). `print`/`println` are NOT reserved identifiers.

## §12 / §23.2.4 / §64 interaction — placement (**FORK A**, needs ruling)

print/println write host `process.stdout`, which exists in the server process and the `kind="tool"`
process — NOT in a browser client. Two ways to spec placement:

- **A(i) — server-escalation trigger (my lean; Pillar-3 "compiler owns placement").** Add print/println
  to the §12 escalation-trigger list (alongside `?{}` SQL, `Bun.*`, file I/O): a `function` calling
  print auto-escalates to server; the client call compiles to a fetch, symmetric with every other
  server-only effect. In a `kind="tool"` "server" IS the tool process (clean stdout). A print in a
  MUST-be-client position surfaces the ordinary §12 placement conflict — no new code needed. Uniform
  with the whole-stack thesis; costs the escalation wiring.
- **A(ii) — host-context-only (simpler; covers the motivating case).** print/println are valid only in
  an already-host context (`kind="tool"` body + server-inferred functions); a client-reachable use fires
  a NEW `E-PRINT-CLIENT-CONTEXT` (steer to `log()` for client diagnostics). No escalation semantics.
  Less machinery; a `print` in a plain web-app handler is a compile error rather than a server effect.

**My lean: A(i)** — it's the Rule-3 "right answer" (compiler owns placement; print is just another
server-only effect), and freeze discipline is do-it-right. But A(ii) covers flogence's actual need
(kind="tool" CLIs) with far less surface. Load-bearing → your call.

## Argument rendering (**FORK B**, needs ruling)

What may print's args be?

- **B(i) — string + primitive coercion (my lean).** Accept `string` verbatim, `number` → its decimal
  text, `boolean` → `"true"`/`"false"`. A struct / enum / array / map / markup / `not` arg → NEW
  `E-PRINT-NON-PRIMITIVE` (steer: "print emits raw text — serialize structured data explicitly").
  Keeps machine-parsed stdout intentional; forces the dev to choose the serialization (JSON vs custom),
  which is correct for a consumed stream.
- **B(ii) — value-faithful like log (§20.6.4).** Reuse log's readable render (structs/enums visible,
  absence as `not`). Convenient, but produces a *human* projection, not machine-parseable output — wrong
  for the motivating "stdout is parsed" case; a struct would print as a readable summary, not JSON.

**My lean: B(i)** — clean stdout should be intentional; structured output goes through an explicit
serializer. B(ii) risks the exact "readable-not-parseable" trap that motivated print over log.

## §34 codes (NAMED here; rows land WITH impl per Rule 4)
- `W-PRINT-SHADOWED` (Info) — user binding shadows the builtin; reserved `E-PRINT-SHADOWED`.
- `E-PRINT-NON-PRIMITIVE` (Error) — non-primitive arg **[only if Fork B = B(i)]**.
- `E-PRINT-CLIENT-CONTEXT` (Error) — client-reachable print **[only if Fork A = A(ii)]**.

## §64.6 E-TOOL-005 touch
E-TOOL-005 currently enumerates the v1 tool-inlined helpers (`_scrml_structural_eq`, `_scrml_log`, enum
backing). When the impl lands, `_scrml_print` joins that inlined set; the §64.5.1/§64.6 note is updated
in the impl landing (not this SPEC-TEXT amendment).

## Sections touched (at SPEC-text landing, after forks ruled)
- NEW §20.7 (the primitive) + §20.7.x normative statements + cross-refs to §20.6 / §12 / §64.
- §12 trigger list **[if A(i)]** · §23.2.4 admitted-context note **[if A(ii) scoping]**.
- §34: the codes above (land-with-impl).
- §64.8 cross-ref (print is the tool's clean-output primitive).

## Sequencing
1. bryan rules Fork A + Fork B.
2. I author the SPEC-text amendment (§20.7 + touches) per the rulings — SPEC-TEXT landing.
3. Impl dispatch (emit-tool.ts `_scrml_print` + server-emit path + the ruled codes + tests + a
   conformance case) — AFTER GITI-033 lands.
4. flogence re-ports `fleet` (R26).
