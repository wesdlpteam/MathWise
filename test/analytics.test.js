import test from "node:test";
import assert from "node:assert/strict";
import { category, sanitiseEvent, safeCounts } from "../api/_analytics.js";

test("category passes a known value through", () => {
  assert.equal(category("outcome", "solved"), "solved");
  assert.equal(category("course", "meth34"), "meth34");
  assert.equal(category("band", "IB Diploma"), "IB Diploma");
});

test("category maps an unknown value to Other", () => {
  assert.equal(category("outcome", "exploded"), "Other");
  assert.equal(category("course", "physics"), "Other");
});

test("category treats empty as null", () => {
  assert.equal(category("course", ""), null);
  assert.equal(category("course", null), null);
});

test("sanitiseEvent keeps only allow-listed fields", () => {
  const out = sanitiseEvent({
    device: "7f3a9c", course: "gen34", band: "VCE", topic: "Matrices",
    outcome: "solved", turns: 4, seconds: 120, rating: "up",
    tokensIn: 100, tokensOut: 200, cost: 0.01,
    questionText: "my name is Jane and I am stuck",
    photo: "data:image/png;base64,AAAA", email: "jane@example.com"
  });
  assert.deepEqual(Object.keys(out).sort(), [
    "band", "cost_usd", "course", "device", "outcome", "rating",
    "seconds", "tokens_in", "tokens_out", "topic", "turns"
  ]);
  assert.equal(JSON.stringify(out).includes("Jane"), false);
  assert.equal(JSON.stringify(out).includes("base64"), false);
});

test("sanitiseEvent clamps the numbers and truncates the device id", () => {
  const out = sanitiseEvent({
    device: "x".repeat(200), outcome: "solved",
    turns: -5, seconds: 99999999, tokensIn: "abc", cost: "1e400"
  });
  assert.equal(out.device.length <= 16, true);
  assert.equal(out.turns, 0);
  assert.equal(out.seconds <= 86400, true);
  assert.equal(out.tokens_in, 0);
  assert.equal(Number.isFinite(out.cost_usd), true);
});

test("sanitiseEvent refuses a free-text topic", () => {
  const out = sanitiseEvent({ device: "a1", outcome: "solved", topic: "I am stuck on my homework about Jane" });
  assert.equal(out.topic, "Other");
});

test("safeCounts folds unknown labels together", () => {
  const rows = [
    { outcome: "solved", n: 3 },
    { outcome: "weird", n: 2 },
    { outcome: "alsoweird", n: 1 },
  ];
  const out = safeCounts(rows, "outcome");
  assert.equal(out.length, 2);
  assert.equal(out.find(r => r.outcome === "solved").n, 3);
  assert.equal(out.find(r => r.outcome === "Other").n, 3);
});
