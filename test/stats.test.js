import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/stats.js";
import { setSqlForTests } from "../api/_db.js";
import { mockReqRes, TEST_ADMIN_PW } from "./_helpers.js";
import { __resetRateLimit } from "../api/_lib.js";

test("rejects a GET", async () => {
  __resetRateLimit();
  process.env.ADMIN_PASSWORD = TEST_ADMIN_PW;
  const { req, res } = mockReqRes({ method: "GET", headers: { "x-mw-admin": TEST_ADMIN_PW } });
  await handler(req, res);
  assert.equal(res.statusCode, 405);
});

test("rejects a wrong password and returns no data", async () => {
  __resetRateLimit();
  process.env.ADMIN_PASSWORD = TEST_ADMIN_PW;
  const { req, res } = mockReqRes({ headers: { "x-mw-admin": "guess" } });
  await handler(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.totals, undefined);
});

test("rejects everyone when no password is configured", async () => {
  __resetRateLimit();
  delete process.env.ADMIN_PASSWORD;
  const { req, res } = mockReqRes({ headers: { "x-mw-admin": TEST_ADMIN_PW } });
  await handler(req, res);
  assert.equal(res.statusCode, 401);
});

test("returns the expected shape for the right password", async () => {
  __resetRateLimit();
  process.env.ADMIN_PASSWORD = TEST_ADMIN_PW;
  setSqlForTests(async (strings) => {
    const text = strings.join("?");
    if (text.includes("GROUP BY outcome")) return [{ outcome: "solved", n: 2 }];
    if (text.includes("ts::date")) return [{ day: "2026-09-16", n: 2 }];
    if (text.includes("GROUP BY band")) return [{ band: "VCE", n: 2 }];
    if (text.includes("GROUP BY course")) return [{ course: "gen34", n: 2 }];
    if (text.includes("GROUP BY topic")) return [{ topic: "Calculus", n: 2 }];
    if (text.includes("GROUP BY rating")) return [{ rating: "up", n: 1 }];
    // the two scorecard windows and the cost rollups
    return [{ device: "a", outcome: "solved", turns: 3, seconds: 90, rating: "up",
              topic: "Calculus", band: "VCE", cost_usd: 0.02 }];
  });
  const { req, res } = mockReqRes({ headers: { "x-mw-admin": TEST_ADMIN_PW } });
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body).sort(), [
    "byBand", "byCourse", "byDay", "byTopic", "cost", "ratings", "scorecard", "totals"
  ]);
  assert.equal(res.body.scorecard.thisWeek.chats, 1);
  assert.equal(typeof res.body.scorecard.lastWeek.chats, "number");
});
