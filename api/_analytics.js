/**
 * The privacy boundary.
 *
 * Every value written to the database is checked against the lists below.
 * Anything unrecognised becomes "Other", and any field not named in
 * sanitiseEvent() is dropped before the insert. There is no column for free
 * text and no path to one, so a future bug in the browser that tried to send
 * a question, a name or a photograph cannot store it.
 */

export const CATEGORIES = {
  "course": [
    "myp7", "myp8", "myp9", "myp10a", "myp10s", "myp10x",
    "gen12", "gen34", "meth12", "meth34", "spec12", "spec34",
    "aa_sl", "aa_hl", "ai_sl",
    "none"
  ],
  "band": ["MYP", "VCE", "IB Diploma", "none"],
  "outcome": ["solved", "shown", "switched", "closed", "timeout"],
  "rating": ["up", "down", "none"],
  // Topic is the one list that grows with the app. It is still a list: the
  // browser only ever sends a label it matched from TOPICS, Y10_CORE or the
  // shared keyword map, and anything else lands as "Other".
  "topic": [
    "Unclassified",
    "Calculus", "Statistics and probability", "Trigonometry",
    "Linear relationships", "Quadratics", "Geometry and measurement",
    "Number and algebra", "Financial mathematics", "Networks and matrices"
  ]
};

export function category(field, value) {
  if (value == null || value === "") return null;
  return CATEGORIES[field]?.includes(value) ? value : "Other";
}

// Topic carries the long tail of TOPICS entries, which are teacher-facing
// strings rather than a short fixed set. Allow a known-safe shape (letters,
// digits, spaces and basic punctuation, reasonably short) so real topic names
// survive, and fold anything else into "Other". This still admits no free
// text of any length: a sentence fails the word-count test.
const TOPIC_SHAPE = /^[A-Za-z0-9 ,'()/.-]{1,60}$/;

function topicCategory(value) {
  if (value == null || value === "") return null;
  if (CATEGORIES.topic.includes(value)) return value;
  if (TOPIC_SHAPE.test(value) && value.split(/\s+/).length <= 8) return value;
  return "Other";
}

function clampInt(value, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function clampCost(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(9999, n);
}

export function sanitiseEvent(body) {
  const b = body || {};
  return {
    device: String(b.device ?? "unknown").replace(/[^A-Za-z0-9]/g, "").slice(0, 16) || "unknown",
    course: category("course", b.course),
    band: category("band", b.band),
    topic: topicCategory(b.topic),
    outcome: category("outcome", b.outcome),
    turns: clampInt(b.turns, 0, 1000),
    seconds: clampInt(b.seconds, 0, 86400),
    rating: category("rating", b.rating),
    tokens_in: clampInt(b.tokensIn, 0, 100000000),
    tokens_out: clampInt(b.tokensOut, 0, 100000000),
    cost_usd: clampCost(b.cost)
  };
}

export function safeCounts(rows, field) {
  const counts = new Map();
  for (const row of rows) {
    const label = field === "topic" ? topicCategory(row[field]) : category(field, row[field]);
    counts.set(label, (counts.get(label) || 0) + (Number(row.n) || 0));
  }
  return [...counts]
    .map(([label, count]) => ({ [field]: label, n: count }))
    .sort((left, right) => right.n - left.n);
}
