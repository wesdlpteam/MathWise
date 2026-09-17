import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/log.js";
import { setSqlForTests } from "../api/_db.js";
import { mockReqRes } from "./_helpers.js";
import { __resetRateLimit } from "../api/_lib.js";

test("rejects a GET", async () => {
  __resetRateLimit();
  const { req, res } = mockReqRes({ method: "GET" });
  await handler(req, res);
  assert.equal(res.statusCode, 405);
});

test("rejects an unknown outcome", async () => {
  __resetRateLimit();
  const { req, res } = mockReqRes({ body: { device: "a1", outcome: "hacked" } });
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test("stores only allow-listed values for a valid record", async () => {
  __resetRateLimit();
  let captured = null;
  setSqlForTests(async (strings, ...values) => { captured = values; return []; });
  const { req, res } = mockReqRes({
    body: {
      device: "7f3a9c", course: "gen34", band: "VCE", topic: "Matrices",
      outcome: "solved", turns: 4, seconds: 120, rating: "up",
      tokensIn: 100, tokensOut: 200, cost: 0.0123,
      questionText: "my name is Jane", photo: "data:image/png;base64,AAAA"
    }
  });
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(captured[0], "7f3a9c");
  assert.equal(captured[1], "gen34");
  assert.equal(captured[4], "solved");
  assert.equal(JSON.stringify(captured).includes("Jane"), false);
  assert.equal(JSON.stringify(captured).includes("base64"), false);
});

test("a database failure returns 500 and says nothing else", async () => {
  __resetRateLimit();
  setSqlForTests(async () => { throw new Error("connection refused to db.internal"); });
  const { req, res } = mockReqRes({ body: { device: "a1", outcome: "solved" } });
  await handler(req, res);
  assert.equal(res.statusCode, 500);
  assert.equal(JSON.stringify(res.body).includes("db.internal"), false);
});
