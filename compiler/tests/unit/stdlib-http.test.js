/**
 * stdlib-http — unit tests for scrml:http
 *
 * Tests isOk, isError, withBaseUrl URL resolution, and request logic
 * via mock fetch (no real network calls).
 *
 * Functions extracted here match stdlib/http/index.scrml exactly.
 *
 * Coverage:
 *   H1-H3   isOk()
 *   H4-H8   isError()
 *   H9-H13  withBaseUrl() URL resolution (real shim; S462 client struct)
 *   H14-H20 request logic via mock fetch
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
// S462: the client surface (withBaseUrl / withAuth / withDefaults + the
// client-first request shape) is tested against the REAL shim, with fetch
// stubbed — the clients are config structs, not objects of functions.
import * as http from "../../runtime/stdlib/http.js";

// Capture every fetch the real shim makes; answer 200 JSON.
let fetchCalls = [];
let realFetch;
function stubFetch() {
    realFetch = globalThis.fetch;
    fetchCalls = [];
    globalThis.fetch = async (url, init) => {
        fetchCalls.push({ url: String(url), init });
        return new Response(JSON.stringify({ ok: true }), {
            status: 200, headers: { "content-type": "application/json" },
        });
    };
}
function restoreFetch() { globalThis.fetch = realFetch; }

function isOk(response) {
    return response && response.ok === true
}

function isError(response) {
    return response && response.status >= 400
}

async function makeRequest(url, options, mockFetch) {
    const opts = options || {}
    const retryCount = opts.retry || 0
    const extraHeaders = opts.headers || {}
    const fetchOptions = { method: opts.method || "GET", headers: {} }
    for (const [k, v] of Object.entries(extraHeaders)) fetchOptions.headers[k] = v
    if (opts.body !== undefined) {
        if (typeof opts.body === "string") {
            fetchOptions.body = opts.body
        } else {
            fetchOptions.body = JSON.stringify(opts.body)
            if (!fetchOptions.headers["Content-Type"]) {
                fetchOptions.headers["Content-Type"] = "application/json"
            }
        }
    }
    let lastError = null
    for (let attempt = 0; attempt <= retryCount; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 0))
        try {
            const raw = await mockFetch(url, fetchOptions)
            const contentType = raw.headers.get("content-type") || ""
            let data
            if (contentType.includes("application/json")) { data = await raw.json() }
            else { data = await raw.text() }
            return { ok: raw.ok, status: raw.status, data, headers: raw.headers, raw }
        } catch(err) {
            if (err.name === "AbortError") throw new Error(`timed out: ${url}`)
            lastError = err
            if (attempt === retryCount) throw lastError
        }
    }
    throw lastError
}

function mockResponse(status, body, contentType) {
    const ct = contentType || "text/plain"
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (k) => k.toLowerCase() === "content-type" ? ct : null },
        json: async () => JSON.parse(body),
        text: async () => body
    }
}

describe("scrml:http — isOk()", () => {
    test("H1: true for ok:true", () => { expect(isOk({ ok: true, status: 200 })).toBe(true) })
    test("H2: false for ok:false", () => { expect(isOk({ ok: false, status: 404 })).toBe(false) })
    test("H3: false for null", () => { expect(isOk(null)).toBeFalsy() })
})

describe("scrml:http — isError()", () => {
    test("H4: true for 400", () => { expect(isError({ ok: false, status: 400 })).toBe(true) })
    test("H5: true for 500", () => { expect(isError({ ok: false, status: 500 })).toBe(true) })
    test("H6: false for 200", () => { expect(isError({ ok: true, status: 200 })).toBe(false) })
    test("H7: false for 201", () => { expect(isError({ ok: true, status: 201 })).toBe(false) })
    test("H8: false for 301", () => { expect(isError({ ok: false, status: 301 })).toBe(false) })
})

describe("scrml:http — withBaseUrl() (real shim, S462 config struct)", () => {
    beforeEach(stubFetch)
    afterEach(restoreFetch)
    test("H9: a client is a struct with no function-valued fields", () => {
        const c = http.withBaseUrl("https://api.example.com")
        expect(c).toEqual({ baseUrl: "https://api.example.com", defaults: {}, authorization: null })
        for (const v of Object.values(c)) expect(typeof v).not.toBe("function")
    })
    test("H10: resolves relative path", async () => {
        await http.get(http.withBaseUrl("https://api.example.com"), "/users/42")
        expect(fetchCalls[0].url).toBe("https://api.example.com/users/42")
        expect(fetchCalls[0].init.method).toBe("GET")
    })
    test("H11: preserves absolute URL", async () => {
        await http.get(http.withBaseUrl("https://api.example.com"), "https://other.com/p")
        expect(fetchCalls[0].url).toBe("https://other.com/p")
    })
    test("H12: trailing slash stripped from base", async () => {
        await http.del(http.withBaseUrl("https://api.example.com/"), "/users")
        expect(fetchCalls[0].url).toBe("https://api.example.com/users")
        expect(fetchCalls[0].init.method).toBe("DELETE")
    })
    test("H13: path without leading slash gets one; body methods shift one slot", async () => {
        const c = http.withBaseUrl("https://api.example.com")
        await http.post(c, "users", { name: "A" }, { headers: { "X-T": "1" } })
        expect(fetchCalls[0].url).toBe("https://api.example.com/users")
        expect(fetchCalls[0].init.method).toBe("POST")
        expect(fetchCalls[0].init.body).toBe(JSON.stringify({ name: "A" }))
        expect(fetchCalls[0].init.headers["X-T"]).toBe("1")
        await http.put(c, "/u/1", { a: 1 })
        await http.patch(c, "/u/1", { b: 2 })
        expect(fetchCalls.map(f => f.init.method)).toEqual(["POST", "PUT", "PATCH"])
    })
    test("H13b: the URL-first form is unchanged", async () => {
        const r = await http.post("https://x.test/a", { n: 1 }, { headers: { "X-Q": "q" } })
        expect(r.ok).toBe(true)
        expect(fetchCalls[0].url).toBe("https://x.test/a")
        expect(fetchCalls[0].init.body).toBe(JSON.stringify({ n: 1 }))
        expect(fetchCalls[0].init.headers["X-Q"]).toBe("q")
        await http.get("https://x.test/b", { headers: { "X-R": "r" } })
        expect(fetchCalls[1].init.headers["X-R"]).toBe("r")
    })
})

describe("scrml:http — request logic (mock fetch)", () => {
    test("H14: JSON response parsed", async () => {
        const r = await makeRequest("/api", {}, async () =>
            mockResponse(200, '{"name":"Alice"}', "application/json")
        )
        expect(r.ok).toBe(true)
        expect(r.data).toEqual({ name: "Alice" })
    })
    test("H15: text response", async () => {
        const r = await makeRequest("/api", {}, async () =>
            mockResponse(200, "hello", "text/plain")
        )
        expect(r.data).toBe("hello")
    })
    test("H16: 404 sets ok:false", async () => {
        const r = await makeRequest("/api", {}, async () =>
            mockResponse(404, "Not Found", "text/plain")
        )
        expect(r.ok).toBe(false)
        expect(r.status).toBe(404)
    })
    test("H17: default method is GET", async () => {
        let method = null
        await makeRequest("/api", {}, async (url, opts) => {
            method = opts.method
            return mockResponse(200, "", "text/plain")
        })
        expect(method).toBe("GET")
    })
    test("H18: POST object body → JSON serialized", async () => {
        let body = null
        await makeRequest("/api", { method: "POST", body: { name: "Alice" } }, async (url, opts) => {
            body = opts.body
            return mockResponse(201, '{"id":1}', "application/json")
        })
        expect(body).toBe('{"name":"Alice"}')
    })
    test("H20: retry on network error — 3 total attempts for retry:2", async () => {
        let attempts = 0
        try {
            await makeRequest("/api", { retry: 2 }, async () => {
                attempts++
                const e = new Error("Network")
                e.name = "TypeError"
                throw e
            })
        } catch(e) {}
        expect(attempts).toBe(3)
    })
})

// --- S57 Tier 3 middleware extensions ----------------------------------------

// S462: retry is tested against the REAL shim — shouldRetry is a positional
// argument, not an options field.
const retry = http.retry

function multipart(fields) {
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields || {})) {
        if (v === undefined || v === null) continue
        if (v instanceof Blob || v instanceof File) {
            fd.append(k, v)
        } else {
            fd.append(k, String(v))
        }
    }
    return fd
}

describe("scrml:http — withAuth (Tier 3, real shim)", () => {
    beforeEach(stubFetch)
    afterEach(restoreFetch)
    test("HM1: adds Bearer auth header by default", async () => {
        await http.get(http.withAuth("token-xyz"), "https://x.test/x")
        expect(fetchCalls[0].init.headers.Authorization).toBe("Bearer token-xyz")
    })
    test("HM2: custom scheme", async () => {
        await http.get(http.withAuth("creds", "Basic"), "https://x.test/x")
        expect(fetchCalls[0].init.headers.Authorization).toBe("Basic creds")
    })
    test("HM3: preserves user-set headers; the client credential beats a per-call one", async () => {
        await http.get(http.withAuth("t"), "https://x.test/x", { headers: { "X-Trace": "abc", Authorization: "spoof" } })
        expect(fetchCalls[0].init.headers["X-Trace"]).toBe("abc")
        expect(fetchCalls[0].init.headers.Authorization).toBe("Bearer t")
    })
    test("HM4: composes with another wrapped client", async () => {
        const inner = http.withDefaults({ timeout: 5000 }, http.withBaseUrl("https://api.test"))
        const auth = http.withAuth("t", "Bearer", inner)
        expect(auth).toEqual({ baseUrl: "https://api.test", defaults: { timeout: 5000 }, authorization: "Bearer t" })
        await http.get(auth, "/x")
        expect(fetchCalls[0].url).toBe("https://api.test/x")
        expect(fetchCalls[0].init.headers.Authorization).toBe("Bearer t")
    })
    test("HM4b: re-wrapping replaces the credential (outermost withAuth wins)", () => {
        const a = http.withAuth("old")
        expect(http.withAuth("new", "Bearer", a).authorization).toBe("Bearer new")
        expect(a.authorization).toBe("Bearer old") // the wrapped client is not mutated
    })
})

describe("scrml:http — withDefaults (Tier 3, real shim)", () => {
    test("HM5: injects timeout default", () => {
        const c = http.withDefaults({ timeout: 30000 })
        expect(c.defaults.timeout).toBe(30000)
    })
    test("HM6: per-call options override defaults", async () => {
        stubFetch()
        try {
            // timeout is not observable on fetch; retry count is — a per-call
            // retry: 0 overrides a default retry: 5 (one fetch, no retries).
            const c = http.withDefaults({ retry: 5, retryDelay: 1, headers: { "X-D": "d" } })
            await http.get(c, "https://x.test/x", { retry: 0 })
            expect(fetchCalls.length).toBe(1)
            expect(fetchCalls[0].init.headers["X-D"]).toBe("d")
        } finally { restoreFetch() }
    })
    test("HM7: headers merge by key (call over defaults; outer defaults over inner)", async () => {
        stubFetch()
        try {
            const inner = http.withDefaults({ headers: { "X-A": "inner", "X-Z": "z" } })
            const c = http.withDefaults({ headers: { "X-A": "1", "X-B": "2" } }, inner)
            await http.get(c, "https://x.test/x", { headers: { "X-B": "override", "X-C": "3" } })
            const h = fetchCalls[0].init.headers
            expect(h["X-A"]).toBe("1")
            expect(h["X-B"]).toBe("override")
            expect(h["X-C"]).toBe("3")
            expect(h["X-Z"]).toBe("z")
        } finally { restoreFetch() }
    })
})

describe("scrml:http — retry (Tier 3)", () => {
    test("HM8: returns first-call result on success", async () => {
        const r = await retry(async () => 42, { maxRetries: 2, baseDelay: 1, jitter: 0 })
        expect(r).toBe(42)
    })
    test("HM9: retries on failure up to maxRetries", async () => {
        let calls = 0
        try {
            await retry(async () => { calls++; throw new Error("fail") }, { maxRetries: 2, baseDelay: 1, jitter: 0 })
        } catch(e) {}
        expect(calls).toBe(3)  // 1 initial + 2 retries
    })
    test("HM10: shouldRetry stops retrying when false", async () => {
        let calls = 0
        try {
            await retry(
                async () => { calls++; throw new Error("nope") },
                { maxRetries: 5, baseDelay: 1, jitter: 0 },
                () => false
            )
        } catch(e) {}
        expect(calls).toBe(1)
    })
    test("HM10b: shouldRetry receives the error; true keeps retrying", async () => {
        const seen = []
        let calls = 0
        await expect(retry(
            async () => { calls++; throw new Error("e" + calls) },
            { maxRetries: 2, baseDelay: 1, jitter: 0 },
            (err) => { seen.push(err.message); return true }
        )).rejects.toThrow("e3")
        expect(calls).toBe(3)
        expect(seen).toEqual(["e1", "e2"])
    })
    test("HM10c: a legacy opts.shouldRetry is refused, not silently ignored (S462)", async () => {
        let calls = 0
        await expect(retry(
            async () => { calls++; return 1 },
            { maxRetries: 2, shouldRetry: () => false }
        )).rejects.toThrow(/third argument/)
        expect(calls).toBe(0)
    })
    test("HM10d: opts stays data — no function-valued field is needed", async () => {
        expect(await retry(async () => 7, { maxRetries: 0 })).toBe(7)
        expect(await retry(async () => 8)).toBe(8)
    })
})

describe("scrml:http — multipart (Tier 3)", () => {
    test("HM11: returns FormData", () => {
        const fd = multipart({ name: "alice" })
        expect(fd).toBeInstanceOf(FormData)
        expect(fd.get("name")).toBe("alice")
    })
    test("HM12: stringifies non-blob values", () => {
        const fd = multipart({ count: 3, ratio: 0.5, flag: true })
        expect(fd.get("count")).toBe("3")
        expect(fd.get("ratio")).toBe("0.5")
        expect(fd.get("flag")).toBe("true")
    })
    test("HM13: skips null/undefined", () => {
        const fd = multipart({ name: "a", missing: null, nope: undefined })
        expect(fd.get("name")).toBe("a")
        expect(fd.get("missing")).toBeNull()
    })
    test("HM14: preserves Blob values as files", () => {
        const blob = new Blob(["hello"], { type: "text/plain" })
        const fd = multipart({ file: blob })
        const got = fd.get("file")
        expect(got).toBeInstanceOf(Blob)
    })
})
