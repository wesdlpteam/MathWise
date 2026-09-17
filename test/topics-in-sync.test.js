import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CATEGORIES } from "../api/_analytics.js";

/**
 * The browser picks a topic label from three lists inside mathwise.html and the
 * server accepts only labels it already knows. If someone adds a topic to the
 * app and forgets the server, that topic quietly lands in "Other" and shows up
 * as a gap in the dashboard rather than as an error. This test turns that
 * silent gap into a failing build.
 */

function labelsInApp() {
  const src = fs.readFileSync(new URL("../mathwise.html", import.meta.url), "utf8");
  const between = (start, end) => {
    const i = src.indexOf(start);
    assert.notEqual(i, -1, `could not find ${start} in mathwise.html`);
    return src.slice(i, src.indexOf(end, i));
  };
  const quoted = (text) =>
    Array.from(text.matchAll(/"([^"\\]{4,80})"/g)).map((m) => m[1]);

  const keywordBlock = between("const TOPIC_KEYWORDS = [", "\n];");
  const keywordLabels = Array.from(keywordBlock.matchAll(/\["([^"]+)",\s*\[/g)).map((m) => m[1]);

  return new Set([
    ...quoted(between("const TOPICS = {", "\n};")),
    ...quoted(between("const Y10_CORE = [", "\n];")),
    ...keywordLabels,
  ]);
}

test("every topic the app can send is on the server's allow-list", () => {
  const missing = [...labelsInApp()].filter((label) => !CATEGORIES.topic.includes(label));
  assert.deepEqual(
    missing,
    [],
    `these topics exist in mathwise.html but not in api/_analytics.js, so they would be stored as "Other": ${missing.join(", ")}`
  );
});

test("the allow-list has not filled up with labels the app never sends", () => {
  const inApp = labelsInApp();
  const stale = CATEGORIES.topic.filter((label) => label !== "Unclassified" && !inApp.has(label));
  assert.deepEqual(stale, [], `these are allow-listed but no longer exist in the app: ${stale.join(", ")}`);
});
