import test from "node:test";
import assert from "node:assert/strict";
import { median, pct, delta, scorecard } from "../api/_scorecard.js";

test("median handles empty, odd and even counts", () => {
  assert.equal(median([]), 0);
  assert.equal(median([5]), 5);
  assert.equal(median([1, 3, 5]), 3);
  assert.equal(median([1, 3, 5, 7]), 4);
});

test("pct guards against dividing by zero", () => {
  assert.equal(pct(0, 0), 0);
  assert.equal(pct(1, 4), 25);
  assert.equal(pct(2, 3), 66.7);
});

test("delta reports direction and size, and copes with no history", () => {
  assert.deepEqual(delta(10, 5), { change: 5, direction: "up", pct: 100 });
  assert.deepEqual(delta(5, 10), { change: -5, direction: "down", pct: -50 });
  assert.deepEqual(delta(5, 5), { change: 0, direction: "flat", pct: 0 });
  assert.deepEqual(delta(5, 0), { change: 5, direction: "up", pct: null });
});

test("scorecard on no data returns zeros rather than NaN", () => {
  const s = scorecard([]);
  assert.equal(s.chats, 0);
  assert.equal(s.devices, 0);
  assert.equal(s.completionRate, 0);
  assert.equal(s.helpfulRate, 0);
  assert.equal(s.medianTurns, 0);
  assert.equal(s.topTopic, "None yet");
});

test("scorecard counts a single record correctly", () => {
  const s = scorecard([
    { device: "a", outcome: "solved", turns: 4, seconds: 120, rating: "up", topic: "Calculus", band: "VCE", cost_usd: 0.01 }
  ]);
  assert.equal(s.chats, 1);
  assert.equal(s.devices, 1);
  assert.equal(s.completionRate, 100);
  assert.equal(s.abandonRate, 0);
  assert.equal(s.helpfulRate, 100);
  assert.equal(s.medianTurns, 4);
  assert.equal(s.medianMinutes, 2);
  assert.equal(s.topTopic, "Calculus");
  assert.equal(s.topBand, "VCE");
});

test("scorecard separates completions from abandonments", () => {
  const s = scorecard([
    { device: "a", outcome: "solved", turns: 2, seconds: 60, rating: "up", topic: "Calculus", band: "VCE", cost_usd: 0.01 },
    { device: "a", outcome: "shown", turns: 6, seconds: 300, rating: "down", topic: "Calculus", band: "VCE", cost_usd: 0.02 },
    { device: "b", outcome: "timeout", turns: 1, seconds: 1200, rating: "none", topic: "Trigonometry", band: "MYP", cost_usd: 0.01 },
    { device: "c", outcome: "closed", turns: 1, seconds: 30, rating: "none", topic: "Trigonometry", band: "MYP", cost_usd: 0 }
  ]);
  assert.equal(s.chats, 4);
  assert.equal(s.devices, 3);
  assert.equal(s.completionRate, 50);
  assert.equal(s.abandonRate, 50);
  // Only the two that were rated count towards helpful.
  assert.equal(s.helpfulRate, 50);
  assert.equal(s.topTopic, "Calculus");
  assert.equal(s.cost, 0.04);
});
