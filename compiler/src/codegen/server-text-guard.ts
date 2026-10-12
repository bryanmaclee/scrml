/**
 * server-text-guard.ts — S465 r4: NO server code that contains a call is lowered from TEXT.
 *
 * The await classifier (SPEC §13.2: "It MAY be called directly (the compiler awaits the
 * call)") answers on the expression TREE. A server position lowered by the string rewriter
 * (`rewriteServerExpr` / `rewriteServerExprArrowBody`, and through them `rewriteBlockBody`
 * in server mode and `emitExprField(null, text)`) is never seen by it: a call in that text
 * ships un-awaited — a Promise, which is truthy — so `if (!check(pass, hash))` let a wrong
 * password through (S465 rounds 1-4: arm bodies, handler arms, bare blocks, same-line bare
 * blocks, destructuring defaults, tagged templates).
 *
 * The rule is enforced at the string rewriter itself, so it holds for every server text
 * path by construction — the ones known today and any added later: a server text that
 * contains a call (`lexicalCallInText`, fail-closed: S465 r5) is a compile error, recorded in the run-wide
 * refused-lowering sink, and the site emits an inert placeholder. Sites that CAN lower the
 * code from a tree do so before they reach the rewriter (emit-logic bare blocks,
 * arm-structure.ts arms, destructuring defaults); what still arrives here is code the
 * compiler cannot read structurally.
 */
import { lexicalCallInText } from "../brace-pair.ts";
import { CGError } from "./errors.ts";
import { recordRefusedLowering } from "./refused-lowering-errors.ts";
import { currentLoweringSpan } from "./sql-one-statement-guard.ts";

function excerpt(t: string): string {
  const one = String(t ?? "").replace(/\s+/g, " ").trim();
  return one.length > 60 ? one.slice(0, 57) + "..." : one;
}

/**
 * The placeholder a refused server text lowers to (the compile already failed).
 */
export const REFUSED_SERVER_TEXT = "null /* E-CODEGEN-INVALID-LOGIC */";

/**
 * True (and a compile error recorded) when `text`, about to be lowered as server
 * code from text, contains a call. `what` names the position for the message.
 */
/**
 * Remove (in place) the guard's refusals when `errors` holds any other error: the
 * compile has failed regardless, and the other error names the construct precisely.
 * With no other error the refusal stays — it is then the reason nothing ships.
 */
export function dropCascadeOnlyErrors(errors: Array<{ severity?: string; cascadeOnly?: boolean }>): void {
  const primary = errors.some((e) => (e.severity ?? "error") === "error" && !e.cascadeOnly);
  if (!primary) return;
  for (let i = errors.length - 1; i >= 0; i--) if (errors[i].cascadeOnly) errors.splice(i, 1);
}

export function refuseServerTextCall(text: string, what = "this server expression", span?: object | null): boolean {
  const callee = lexicalCallInText(text);
  if (callee === null) return false;
  const at = span && typeof (span as { start?: unknown }).start === "number" && (span as { start: number }).start > 0
    ? span
    : currentLoweringSpan();
  const err = new CGError(
    "E-CODEGEN-INVALID-LOGIC",
    `${what} \`${excerpt(text)}\` cannot be lowered in server code: the ` +
      `compiler could not read it as a scrml expression or statement, and its text holds what may be a call ` +
      `(at \`${callee || "…"}(\`; S465 r6 — the check is lexical, so a \`(\` inside a string counts too). ` +
      "A call in server code must be read from the tree so the compiler can await it (§13.2) — lowered " +
      "from text it would run un-awaited. Rewrite it as ordinary statements (one expression per " +
      "statement, each block on its own line), or move the call into its own `const` first.",
    at as object,
  );
  (err as CGError & { cascadeOnly?: boolean }).cascadeOnly = true;
  recordRefusedLowering(err, null);
  return true;
}
