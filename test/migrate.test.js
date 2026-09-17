import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/migrate.js";
import { setSqlForTests } from "../api/_db.js";
import { mockReqRes, TEST_ADMIN_PW } from "./_helpers.js";
import { __resetRateLimit } from "../api/_lib.js";

test("migrate rejects a GET", async () => {
  __resetRateLimit();
  process.env.ADMIN_PASSWORD = TEST_ADMIN_PW;
  const { req, res } = mockReqRes({ method: "GET", headers: { "x-mw-admin": TEST_ADMIN_PW } });
  await handler(req, res);
  assert.equal(res.statusCode, 405);
});

test("migrate refuses a wrong admin password", async () => {
  __resetRateLimit();
  process.env.ADMIN_PASSWORD = TEST_ADMIN_PW;
  const { req, res } = mockReqRes({ headers: { "x-mw-admin": "guess" } });
  await handler(req, res);
  assert.equal(res.statusCode, 401);
});

test("migrate only ever creates, never drops or alters", async () => {
  __resetRateLimit();
  process.env.ADMIN_PASSWORD = TEST_ADMIN_PW;
  const statements = [];
  setSqlForTests(async (strings) => {
    statements.push(strings.join(" "));
    return [{ n: 0 }];
  });
  const { req, res } = mockReqRes({ headers: { "x-mw-admin": TEST_ADMIN_PW } });
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.table, "mw_events");

  const all = statements.join(" ").toUpperCase();
  // This database is shared with the Springboard project, so a destructive
  // statement here would not only lose MathWISE data.
  for (const forbidden of ["DROP", "TRUNCATE", "DELETE", "ALTER"]) {
    assert.equal(all.includes(forbidden), false, `migrate must never issue ${forbidden}`);
  }
  assert.equal(all.includes("CREATE TABLE IF NOT EXISTS MW_EVENTS"), true);
  assert.equal(statements.length, 4, "three DDL statements plus the row count");
});

test("migrate touches no table but its own", async () => {
  __resetRateLimit();
  process.env.ADMIN_PASSWORD = TEST_ADMIN_PW;
  const statements = [];
  setSqlForTests(async (strings) => { statements.push(strings.join(" ")); return [{ n: 0 }]; });
  const { req, res } = mockReqRes({ headers: { "x-mw-admin": TEST_ADMIN_PW } });
  await handler(req, res);
  const named = statements.join(" ").match(/\b(?:TABLE|ON|FROM)\s+(?:IF NOT EXISTS\s+)?([a-z_]+)/gi) || [];
  const tables = named.map((m) => m.split(/\s+/).pop().toLowerCase())
    .filter((t) => t !== "if" && t !== "not" && t !== "exists");
  assert.deepEqual([...new Set(tables)], ["mw_events"]);
});
