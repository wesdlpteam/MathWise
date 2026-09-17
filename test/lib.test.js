import test from "node:test";
import assert from "node:assert/strict";
import { safeEqual, requireAdmin, rateLimit, __setNowForTests, __resetRateLimit } from "../api/_lib.js";
import { mockReqRes, TEST_ADMIN_PW } from "./_helpers.js";

test("safeEqual fails closed on an empty secret", () => {
  assert.equal(safeEqual("", ""), false);
  assert.equal(safeEqual(TEST_ADMIN_PW, ""), false);
  assert.equal(safeEqual("", TEST_ADMIN_PW), false);
});

test("safeEqual matches identical strings and rejects different ones", () => {
  assert.equal(safeEqual(TEST_ADMIN_PW, TEST_ADMIN_PW), true);
  assert.equal(safeEqual(TEST_ADMIN_PW, TEST_ADMIN_PW.toUpperCase()), false);
  assert.equal(safeEqual(TEST_ADMIN_PW, TEST_ADMIN_PW + "2"), false);
});

test("requireAdmin rejects a wrong password with 401", () => {
  process.env.ADMIN_PASSWORD = TEST_ADMIN_PW;
  const { req, res } = mockReqRes({ headers: { "x-mw-admin": "nope" } });
  assert.equal(requireAdmin(req, res), false);
  assert.equal(res.statusCode, 401);
});

test("requireAdmin accepts the right password", () => {
  process.env.ADMIN_PASSWORD = TEST_ADMIN_PW;
  const { req, res } = mockReqRes({ headers: { "x-mw-admin": TEST_ADMIN_PW } });
  assert.equal(requireAdmin(req, res), true);
});

test("requireAdmin refuses everyone when no password is configured", () => {
  delete process.env.ADMIN_PASSWORD;
  const { req, res } = mockReqRes({ headers: { "x-mw-admin": "anything" } });
  assert.equal(requireAdmin(req, res), false);
  assert.equal(res.statusCode, 401);
});

test("rateLimit opens, then closes, then reopens after the window", () => {
  __resetRateLimit();
  let now = 0;
  __setNowForTests(() => now);
  const call = () => {
    const { req, res } = mockReqRes({ headers: { "x-forwarded-for": "1.2.3.4" } });
    return rateLimit(req, res, { max: 2, windowMs: 1000, name: "t" });
  };
  assert.equal(call(), true);
  assert.equal(call(), true);
  assert.equal(call(), false);
  now = 1001;
  assert.equal(call(), true);
  __setNowForTests(null);
});
