/**
 * escalation-reason-text.ts — the ONE human phrase for "why §12.2 placed this
 * function on the server".
 *
 * Read by route inference (E-ROUTE-005, the unplaceable both-sides diagnostic)
 * and by the type system (E-CHANNEL-006, an `onclient:*` handler §12.2 placed
 * on the server). It lives in its own module because type-system.ts cannot
 * import route-inference.ts (route-inference imports type-system), and the two
 * diagnostics must describe one placement decision the same way.
 */
import type { EscalationReason } from "./route-inference.ts";

/**
 * A short phrase for the FIRST (most concrete) server trigger among a
 * function's escalation reasons. Prefers a body/resource reason over the bare
 * `server` keyword.
 */
export function describeServerTrigger(reasons: readonly EscalationReason[]): string {
  const ordered = [...reasons].sort(
    (a, b) =>
      (a.kind === "explicit-annotation" ? 1 : 0) -
      (b.kind === "explicit-annotation" ? 1 : 0),
  );
  const first = ordered[0];
  if (!first) return "a server-only resource";
  switch (first.kind) {
    case "server-only-resource":
      if (first.resourceType === "sql-query") return "a `?{}` SQL query";
      if (first.resourceType === "caller-context-propagation") {
        return "being called only from server-side functions (§12.2 Trigger 5)";
      }
      return `the server-only resource \`${first.resourceType}\``;
    case "protected-field-access":
      return `the protected field \`${first.field}\``;
    case "explicit-annotation":
      return "the `server` keyword";
    case "channel-broadcast":
      // `detail` is "broadcast() call" / "disconnect() call" (route-inference.ts
      // detectChannelBroadcastReason).
      return `a call to the channel built-in \`${first.detail.replace(/ call$/, "")}\` (§38.6)`;
    case "middleware-handle":
      return "the reserved middleware name `handle()`";
    case "channel-ws-handler":
      return "an `onserver:` channel handler";
    default:
      return "a server-only resource";
  }
}
