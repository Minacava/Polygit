import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchJson, HttpJsonError } from "../../dist/http/fetch-json.js";

describe("fetchJson", () => {
  it("parses JSON success bodies", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 });
    const result = await fetchJson("https://example.com/x", { fetchImpl, retries: 1 });
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { ok: true });
  });

  it("rejects HTML error bodies without calling response.json()", async () => {
    const fetchImpl = async () =>
      new Response("<html>502 Bad Gateway</html>", { status: 502 });
    await assert.rejects(
      () => fetchJson("https://example.com/x", { fetchImpl, retries: 1 }),
      (err) => err instanceof HttpJsonError && /non-JSON/i.test(err.message),
    );
  });

  it("retries on 503 then succeeds", async () => {
    let calls = 0;
    const sleeps = [];
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ err: "busy" }), { status: 503 });
      }
      return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
    };
    const result = await fetchJson("https://example.com/x", {
      fetchImpl,
      retries: 3,
      retryDelayMs: 1,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    assert.equal(calls, 2);
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { ok: 1 });
    assert.ok(sleeps.length >= 1);
  });

  it("retries on 429", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls < 3) {
        return new Response("{}", { status: 429 });
      }
      return new Response(JSON.stringify({ done: true }), { status: 200 });
    };
    const result = await fetchJson("https://example.com/x", {
      fetchImpl,
      retries: 3,
      retryDelayMs: 1,
      sleep: async () => {},
    });
    assert.equal(calls, 3);
    assert.equal(result.data.done, true);
  });
});
