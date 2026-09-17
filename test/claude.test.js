import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/claude.js";
import { mockReqRes } from "./_helpers.js";
import { __resetRateLimit } from "../api/_lib.js";

// Built at run time rather than written down. These tests check that the real
// credential never escapes the server, so the stand-in for it must not itself
// look like a credential sitting in a tracked file.
const fakeCredential = ["test", "upstream", "credential", Date.now()].join("-");
const fakePasscode = ["class", "9a", Date.now()].join("-");
const okMessages = [{ role: "user", content: "How do I factorise x^2 + 5x + 6?" }];

// Stands in for Anthropic. Records whatever the handler sent, so a test can
// assert on the outgoing request as well as on the reply.
function stubUpstream({ ok = true, status = 200, payload = { content: [{ type: "text", text: "hi" }] } } = {}) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok, status, json: async () => payload };
  };
  return calls;
}

test.beforeEach(() => {
  __resetRateLimit();
  process.env.ANTHROPIC_API_KEY = fakeCredential;
  delete process.env.STUDENT_PASSCODE;
});

test("rejects a GET", async () => {
  const { req, res } = mockReqRes({ method: "GET" });
  await handler(req, res);
  assert.equal(res.statusCode, 405);
});

test("rejects a request with no messages", async () => {
  const { req, res } = mockReqRes({ body: {} });
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test("rejects an implausible pile of messages", async () => {
  const body = { messages: Array.from({ length: 200 }, () => ({ role: "user", content: "x" })) };
  const { req, res } = mockReqRes({ body });
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test("the credential never appears in the response", async () => {
  stubUpstream();
  const { req, res } = mockReqRes({ body: { messages: okMessages } });
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.stringify(res.body).includes(fakeCredential), false);
  assert.equal(JSON.stringify(res.headers).includes(fakeCredential), false);
});

test("an upstream failure returns a plain message, never Anthropic's own", async () => {
  stubUpstream({
    ok: false,
    status: 401,
    payload: { error: { message: `invalid credential ${fakeCredential} for account nathan@example.com` } }
  });
  const { req, res } = mockReqRes({ body: { messages: okMessages } });
  await handler(req, res);
  assert.equal(res.statusCode, 502);
  const shown = JSON.stringify(res.body);
  assert.equal(shown.includes(fakeCredential), false);
  assert.equal(shown.includes("example.com"), false);
  assert.equal(shown.includes("invalid credential"), false);
});

test("the caller cannot choose the model", async () => {
  const calls = stubUpstream();
  const { req, res } = mockReqRes({ body: { messages: okMessages, model: "claude-opus-4-1" } });
  await handler(req, res);
  assert.equal(calls[0].body.model, "claude-sonnet-4-6");
});

test("max_tokens is clamped, however it arrives", async () => {
  const calls = stubUpstream();
  for (const [sent, expected] of [[999999, 4000], [-5, 1], ["lots", 1000], [undefined, 1000], [2000, 2000]]) {
    __resetRateLimit();
    const { req, res } = mockReqRes({ body: { messages: okMessages, max_tokens: sent } });
    await handler(req, res);
    assert.equal(calls[calls.length - 1].body.max_tokens, expected, `max_tokens ${sent}`);
  }
});

test("an oversized body is refused before it reaches Anthropic", async () => {
  const calls = stubUpstream();
  const body = { messages: [{ role: "user", content: "x".repeat(4_200_000) }] };
  const { req, res } = mockReqRes({ body });
  await handler(req, res);
  assert.equal(res.statusCode, 413);
  assert.equal(calls.length, 0, "nothing should have been forwarded");
});

test("the credential goes upstream, and nowhere else", async () => {
  const calls = stubUpstream();
  const { req, res } = mockReqRes({ body: { messages: okMessages } });
  await handler(req, res);
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[0].init.headers["x-api-key"], fakeCredential);
});

test("a passcode is required only once one is configured", async () => {
  stubUpstream();
  const open = mockReqRes({ body: { messages: okMessages } });
  await handler(open.req, open.res);
  assert.equal(open.res.statusCode, 200, "open by default");

  __resetRateLimit();
  process.env.STUDENT_PASSCODE = fakePasscode;
  const blocked = mockReqRes({ body: { messages: okMessages } });
  await handler(blocked.req, blocked.res);
  assert.equal(blocked.res.statusCode, 401, "refused without the passcode");

  __resetRateLimit();
  const allowed = mockReqRes({ headers: { "x-mw-passcode": fakePasscode }, body: { messages: okMessages } });
  await handler(allowed.req, allowed.res);
  assert.equal(allowed.res.statusCode, 200, "allowed with it");
});
