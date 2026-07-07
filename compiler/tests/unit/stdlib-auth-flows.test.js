/**
 * stdlib-auth-flows — unit tests for scrml:auth magic-link / email-verify /
 * password-reset flows (BaaS auth-flows-jwks-2026-07-06).
 *
 * Tests the REAL shim (runtime/stdlib/auth.js) against the REAL SQLite store
 * (runtime/stdlib/store.js) for the happy / single-use / namespace-isolation
 * paths, plus an in-memory stub store for the deterministic expiry branch and
 * a captured-token stub sendEmail (dependency injection — no built-in mailer).
 *
 * Coverage:
 *   F1   requestMagicLink + verifyMagicLink — valid once
 *   F2   single-use — a second verify fails (used-or-invalid)
 *   F3   request returns a NEUTRAL result and never leaks the token
 *   F4   purpose-binding — a magic-link token replayed in the pwreset namespace fails
 *   F5   TTL — an expired record → reason "expired"
 *   F6   email-verify flow (request/verify) works in its namespace
 *   F7   password-reset flow (requestPasswordReset/verifyResetToken) works
 *   F8   resetPassword composes verify + hash + injected updateHash; single-use
 *   F9   resetPassword without an injected updateHash → no-update-hash
 *   F10  verify with no store / no token → used-or-invalid
 *   F11  enumeration resistance — request result is neutral regardless of address
 *   F12  high-entropy tokens — 256-bit hex, distinct per request
 */

import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
    requestMagicLink,
    verifyMagicLink,
    requestEmailVerification,
    verifyEmail,
    requestPasswordReset,
    verifyResetToken,
    resetPassword,
} from "../../runtime/stdlib/auth.js";
import { createStore } from "../../runtime/stdlib/store.js";

// A stub sendEmail that captures the last token it was asked to send (DI seam).
function makeCapture() {
    const box = { token: null, calls: 0, lastInfo: null, lastTo: null };
    const sendEmail = (to, info) => {
        box.calls++;
        box.lastTo = to;
        box.lastInfo = info;
        box.token = info.token;
    };
    return { box, sendEmail };
}

const tmpDir = mkdtempSync(join(tmpdir(), "scrml-auth-flows-"));
afterAll(() => {
    try {
        rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
        /* best-effort temp cleanup */
    }
});

describe("scrml:auth — magic-link flow", () => {
    test("F1: request then verify → valid + email", async () => {
        const store = createStore(":memory:", "magic-link");
        const { box, sendEmail } = makeCapture();
        await requestMagicLink("user@example.com", {
            store,
            sendEmail,
            baseUrl: "https://app/login",
            ttl: 900,
        });
        expect(box.token).not.toBeNull();
        const res = verifyMagicLink(box.token, { store });
        expect(res.valid).toBe(true);
        expect(res.email).toBe("user@example.com");
        store.close();
    });

    test("F2: single-use — a second verify fails", async () => {
        const store = createStore(":memory:", "magic-link");
        const { box, sendEmail } = makeCapture();
        await requestMagicLink("user@example.com", { store, sendEmail });
        const first = verifyMagicLink(box.token, { store });
        expect(first.valid).toBe(true);
        const second = verifyMagicLink(box.token, { store });
        expect(second.valid).toBe(false);
        expect(second.reason).toBe("used-or-invalid");
        store.close();
    });

    test("F3: request is neutral and never returns the token", async () => {
        const store = createStore(":memory:", "magic-link");
        const { box, sendEmail } = makeCapture();
        const req = await requestMagicLink("user@example.com", {
            store,
            sendEmail,
            baseUrl: "https://app/login",
        });
        expect(req.ok).toBe(true);
        // The neutral result carries NO token (the token travels only via email).
        expect(req.token).toBeUndefined();
        expect(Object.keys(req)).toEqual(["ok"]);
        // The link that WAS emailed embeds the token.
        expect(box.lastInfo.link).toContain(box.token);
        store.close();
    });
});

describe("scrml:auth — purpose-binding (namespace isolation)", () => {
    test("F4: a magic-link token cannot be replayed as a reset token", async () => {
        // ONE db file, two namespaces — the honest test of namespace isolation.
        const dbFile = join(tmpDir, "isolation.db");
        const magicStore = createStore(dbFile, "magic-link");
        const pwStore = createStore(dbFile, "pwreset");
        const { box, sendEmail } = makeCapture();
        await requestMagicLink("user@example.com", { store: magicStore, sendEmail });
        // Same token, WRONG namespace → not found → rejected.
        const crossed = verifyResetToken(box.token, { store: pwStore });
        expect(crossed.valid).toBe(false);
        expect(crossed.reason).toBe("used-or-invalid");
        // And it still verifies correctly in its OWN namespace.
        const correct = verifyMagicLink(box.token, { store: magicStore });
        expect(correct.valid).toBe(true);
        magicStore.close();
        pwStore.close();
    });
});

describe("scrml:auth — TTL / expiry", () => {
    test("F5: an expired record → reason expired", () => {
        // Stub store whose get() returns a record already past its embedded
        // expiresAt — exercises the flow's authoritative expiry check.
        const expiredStore = {
            get: () => ({
                email: "user@example.com",
                purpose: "magic-link",
                expiresAt: Date.now() - 1000,
            }),
            set: () => {},
            delete: () => {},
        };
        const res = verifyMagicLink("any-token", { store: expiredStore });
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("expired");
    });
});

describe("scrml:auth — email-verify + password-reset flows", () => {
    test("F6: email-verify request/verify works in its namespace", async () => {
        const store = createStore(":memory:", "email-verify");
        const { box, sendEmail } = makeCapture();
        await requestEmailVerification("user@example.com", { store, sendEmail });
        const res = verifyEmail(box.token, { store });
        expect(res.valid).toBe(true);
        expect(res.email).toBe("user@example.com");
        // single-use here too
        expect(verifyEmail(box.token, { store }).valid).toBe(false);
        store.close();
    });

    test("F7: password-reset request/verify works", async () => {
        const store = createStore(":memory:", "pwreset");
        const { box, sendEmail } = makeCapture();
        await requestPasswordReset("user@example.com", { store, sendEmail });
        const res = verifyResetToken(box.token, { store });
        expect(res.valid).toBe(true);
        expect(res.email).toBe("user@example.com");
        store.close();
    });

    test("F8: resetPassword composes verify + hash + injected updateHash (single-use)", async () => {
        const store = createStore(":memory:", "pwreset");
        const { box, sendEmail } = makeCapture();
        await requestPasswordReset("user@example.com", { store, sendEmail });

        const updates = [];
        const updateHash = (email, hash) => {
            updates.push({ email, hash });
        };
        const res = await resetPassword(box.token, "n3w-p@ssw0rd", { store, updateHash });
        expect(res.valid).toBe(true);
        expect(res.email).toBe("user@example.com");
        expect(updates).toHaveLength(1);
        expect(updates[0].email).toBe("user@example.com");
        // The injected updateHash received an Argon2id hash string, not the plaintext.
        expect(typeof updates[0].hash).toBe("string");
        expect(updates[0].hash).not.toBe("n3w-p@ssw0rd");
        expect(updates[0].hash.startsWith("$argon2")).toBe(true);

        // Single-use: the token was consumed by the verify step.
        const again = await resetPassword(box.token, "another", { store, updateHash });
        expect(again.valid).toBe(false);
        expect(again.reason).toBe("used-or-invalid");
        expect(updates).toHaveLength(1); // no second hash/update
        store.close();
    });

    test("F9: resetPassword without an injected updateHash → no-update-hash", async () => {
        const store = createStore(":memory:", "pwreset");
        const { box, sendEmail } = makeCapture();
        await requestPasswordReset("user@example.com", { store, sendEmail });
        const res = await resetPassword(box.token, "whatever", { store });
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("no-update-hash");
        store.close();
    });
});

describe("scrml:auth — guard rails + entropy", () => {
    test("F10: verify with no store / no token → used-or-invalid", () => {
        expect(verifyMagicLink("t", {}).reason).toBe("used-or-invalid");
        expect(verifyMagicLink("t", { store: undefined }).reason).toBe("used-or-invalid");
        const store = createStore(":memory:", "magic-link");
        expect(verifyMagicLink("", { store }).reason).toBe("used-or-invalid");
        store.close();
    });

    test("F11: enumeration resistance — the request result is neutral regardless of address", async () => {
        const store = createStore(":memory:", "magic-link");
        const { sendEmail } = makeCapture();
        const a = await requestMagicLink("real-account@example.com", { store, sendEmail });
        const b = await requestMagicLink("does-not-exist@example.com", { store, sendEmail });
        // Byte-identical neutral shape — no existence signal leaks.
        expect(a).toEqual(b);
        expect(a).toEqual({ ok: true });
        store.close();
    });

    test("F12: high-entropy tokens — 256-bit hex, distinct per request", async () => {
        const store = createStore(":memory:", "magic-link");
        const c1 = makeCapture();
        const c2 = makeCapture();
        await requestMagicLink("user@example.com", { store, sendEmail: c1.sendEmail });
        await requestMagicLink("user@example.com", { store, sendEmail: c2.sendEmail });
        expect(c1.box.token).toMatch(/^[0-9a-f]{64}$/); // 32 bytes = 256 bits
        expect(c2.box.token).toMatch(/^[0-9a-f]{64}$/);
        expect(c1.box.token).not.toBe(c2.box.token);
        store.close();
    });
});

describe("scrml:auth — flows security regressions (adversarial review)", () => {
    // Finding 1 — cross-purpose replay in a SHARED namespace is an auth bypass
    // unless verify* checks the record's purpose. Namespaces are the first line;
    // this is the defense-in-depth backstop for a mis-wired single store.
    test("F13: same-namespace cross-purpose replay fails AND does not consume the token", async () => {
        // ONE store, ONE namespace, wired (incorrectly) for two flows.
        const store = createStore(":memory:", "shared");
        const { box, sendEmail } = makeCapture();
        await requestMagicLink("user@example.com", { store, sendEmail });

        // Attacker submits the magic-link token to the reset verifier (same store).
        const crossed = verifyResetToken(box.token, { store });
        expect(crossed.valid).toBe(false);
        expect(crossed.reason).toBe("used-or-invalid");

        // The token was NOT consumed by the wrong-purpose attempt — it still
        // verifies for its OWN flow.
        const correct = verifyMagicLink(box.token, { store });
        expect(correct.valid).toBe(true);
        expect(correct.email).toBe("user@example.com");
        // ...and now (used correctly) it is single-use.
        expect(verifyMagicLink(box.token, { store }).valid).toBe(false);
        store.close();
    });

    // Finding 2 — a sendEmail rejection MUST NOT change the neutral result, or
    // request* leaks account existence (SMTP 550 for unknown recipients).
    test("F14: a throwing sendEmail still yields a neutral request result (both addresses)", async () => {
        const store = createStore(":memory:", "magic-link");
        const throwingSync = () => {
            throw new Error("SMTP 550: no such mailbox");
        };
        const throwingAsync = async () => {
            throw new Error("SMTP 550: no such mailbox");
        };
        const a = await requestMagicLink("real@example.com", { store, sendEmail: throwingSync });
        const b = await requestMagicLink("ghost@example.com", { store, sendEmail: throwingSync });
        const c = await requestMagicLink("ghost@example.com", { store, sendEmail: throwingAsync });
        expect(a).toEqual({ ok: true });
        expect(b).toEqual({ ok: true });
        expect(c).toEqual({ ok: true });
        store.close();
    });

    // Finding 5 — resetPassword must not burn the single-use token before it can
    // succeed, or a missing/throwing updateHash locks the user out.
    test("F15: resetPassword with a missing updateHash leaves the token usable on retry", async () => {
        const store = createStore(":memory:", "pwreset");
        const { box, sendEmail } = makeCapture();
        await requestPasswordReset("user@example.com", { store, sendEmail });

        // First attempt: no updateHash → rejected, token NOT consumed.
        const bad = await resetPassword(box.token, "new-pw", { store });
        expect(bad.valid).toBe(false);
        expect(bad.reason).toBe("no-update-hash");

        // Retry with a proper updateHash → succeeds (token was preserved).
        const updates = [];
        const updateHash = (email, hash) => updates.push({ email, hash });
        const good = await resetPassword(box.token, "new-pw", { store, updateHash });
        expect(good.valid).toBe(true);
        expect(updates).toHaveLength(1);
        store.close();
    });

    test("F16: resetPassword with a throwing updateHash CONSUMES the token (accepted trade-off; no reuse)", async () => {
        // Under the race-free ordering (validate-presence → atomic-consume → hash
        // → persist), a throw in the persist step happens AFTER the token was
        // consumed. That is the accepted trade-off: the token is gone (no reuse),
        // and the user re-requests. (Contrast F15: a MISSING updateHash is caught
        // BEFORE consuming, so it stays retryable.)
        const store = createStore(":memory:", "pwreset");
        const { box, sendEmail } = makeCapture();
        await requestPasswordReset("user@example.com", { store, sendEmail });

        let threw = false;
        try {
            await resetPassword(box.token, "new-pw", {
                store,
                updateHash: () => {
                    throw new Error("DB write failed");
                },
            });
        } catch (e) {
            threw = true;
        }
        expect(threw).toBe(true);

        // The token was consumed by the atomic step before the throw — a retry
        // sees not-found.
        const retry = await resetPassword(box.token, "new-pw", {
            store,
            updateHash: () => {},
        });
        expect(retry.valid).toBe(false);
        expect(retry.reason).toBe("used-or-invalid");
        store.close();
    });

    // Finding 3a — a non-finite / missing expiresAt must FAIL-CLOSED (reject),
    // matching the JWKS exp path (was fail-open: the token never expired).
    test("F17: a record with NaN / absent expiresAt is rejected (fail-closed)", () => {
        const nanStore = {
            get: () => ({ email: "u@x", purpose: "magic-link", expiresAt: NaN }),
            set: () => {},
            delete: () => {},
        };
        const r1 = verifyMagicLink("t", { store: nanStore });
        expect(r1.valid).toBe(false);
        expect(r1.reason).toBe("expired");

        const absentStore = {
            get: () => ({ email: "u@x", purpose: "magic-link" }), // no expiresAt
            set: () => {},
            delete: () => {},
        };
        const r2 = verifyMagicLink("t", { store: absentStore });
        expect(r2.valid).toBe(false);
        expect(r2.reason).toBe("expired");
    });

    // Finding 3b — a non-numeric ttl must be rejected at mint (was NaN expiresAt
    // = a never-expiring token).
    test("F18: requestMagicLink with a non-numeric ttl throws at mint (never stores NaN)", async () => {
        const store = createStore(":memory:", "magic-link");
        const { sendEmail } = makeCapture();
        let threw = false;
        try {
            await requestMagicLink("u@x", { store, sendEmail, ttl: "15m" });
        } catch (e) {
            threw = true;
        }
        expect(threw).toBe(true);
        // Nothing was minted (the throw is BEFORE store.set).
        expect(store.keys().length).toBe(0);
        store.close();
    });

    // Finding 2 — the atomic single-use consume closes the TOCTOU race.
    test("F19: two concurrent resetPassword with one token — exactly one succeeds", async () => {
        const store = createStore(":memory:", "pwreset");
        const { box, sendEmail } = makeCapture();
        await requestPasswordReset("user@example.com", { store, sendEmail });

        const updates = [];
        const updateHash = (email, hash) => updates.push({ email, hash });
        // resetPassword consumes synchronously (before its first await), so the
        // first of the two racing calls wins the atomic get-then-delete.
        const [a, b] = await Promise.all([
            resetPassword(box.token, "pw-a", { store, updateHash }),
            resetPassword(box.token, "pw-b", { store, updateHash }),
        ]);
        const successes = [a, b].filter((r) => r.valid).length;
        expect(successes).toBe(1);
        expect(updates).toHaveLength(1);
        store.close();
    });
});
