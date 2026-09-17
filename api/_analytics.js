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
  // Every topic label the app can produce: the TOPICS lists, Y10_CORE, and the
  // labels in the shared keyword map, generated from mathwise.html. The browser
  // never sends anything else, so an exact match is the whole test and no
  // sentence, name or pasted question can pass itself off as a topic.
  //
  // When a topic is added to mathwise.html, add it here too. A missing entry is
  // not a leak, it just lands in "Other" and shows up as a gap in the chart.
  "topic": [
    "Unclassified",
    "Algebra and structure", "Algebra, number and structure", "Algebraic expressions",
    "Angles and parallel lines", "Area and perimeter",
    "Area and volume of prisms and cylinders", "Arithmetic and number",
    "Bivariate data and lines of best fit", "Box plots and comparing distributions",
    "Calculus", "Circle geometry", "Circles: circumference and area",
    "Collecting and displaying data", "Comparing data displays",
    "Compound interest and financial maths", "Conditional probability and independence",
    "Congruence and transformations", "Congruence, similarity and proof", "Data analysis",
    "Data analysis, probability and statistics", "Discrete mathematics",
    "Expanding and factorising", "Expanding and factorising quadratics",
    "Financial mathematics", "Fractions, decimals and percentages",
    "Functions, relations and graphs", "Geometry and measurement",
    "Geometry, measurement and trigonometry", "Graphs of linear and non-linear relations",
    "Histograms and comparing distributions", "Index laws", "Indices and prime factorisation",
    "Indices and scientific notation", "Indices and surds", "Integers and negative numbers",
    "Introducing non-linear graphs", "Linear and simultaneous equations", "Linear equations",
    "Linear equations and their graphs", "Linear relationships",
    "Linear relationships and gradient", "Logarithms", "Matrices",
    "Mean, median, mode and range", "Measures of centre and spread",
    "Networks and decision mathematics", "Networks and matrices", "Number and algebra",
    "Parabolas and non-linear graphs", "Percentages and financial calculations",
    "Polynomials", "Probability of single events", "Pythagoras' theorem",
    "Pythagoras' theorem in problems", "Quadratics", "Rates and ratios", "Ratios",
    "Recursion and financial modelling", "Relative frequency and two-step probability",
    "Right-angled trigonometry", "Similarity and scale factors",
    "Simple interest and financial maths", "Sine and cosine rules",
    "Solving quadratic equations", "Space and measurement", "Statistics",
    "Statistics and probability", "Surface area and volume",
    "Surface area and volume of composite solids",
    "The Cartesian plane and linear relationships", "Triangles and quadrilaterals",
    "Trigonometry", "Trigonometry and its applications", "Two-step chance experiments",
    "Volume of rectangular prisms"
  ]
};

export function category(field, value) {
  if (value == null || value === "") return null;
  return CATEGORIES[field]?.includes(value) ? value : "Other";
}

// An exact match against the list above, nothing else. An earlier version of
// this guard accepted anything of roughly the right shape and length, which
// would have let a short sentence through, and a student's sentence can contain
// their own name. Shape is not a privacy control; a list is.
function topicCategory(value) {
  if (value == null || value === "") return null;
  return CATEGORIES.topic.includes(value) ? value : "Other";
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
