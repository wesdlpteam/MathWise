# MathWISE Analytics and Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record one anonymous record per question a student works on, send it to a central database, and show it back to staff as a password-protected visual dashboard with a weekly scorecard.

**Architecture:** An analytics module inside the existing single-file app watches each question session and writes a record when it ends, keeping an outbox in `localStorage` so nothing is lost offline. Vercel serverless functions accept those records into a Neon Postgres table behind a strict category allow-list, and serve aggregates back only to a caller holding the server-side admin password. A separate `stats.html` page renders those aggregates.

**Tech Stack:** Vanilla JavaScript (no framework, no build step) in `mathwise.html`; Node 24 ESM serverless functions on Vercel; Neon Postgres via `@neondatabase/serverless`; `node --test` for tests; inline SVG for charts.

**Spec:** `docs/superpowers/specs/2026-09-17-analytics-admin-design.md`

## Global Constraints

- **No student text ever leaves the device.** No question text, no photographs, no free text of any kind. Only allow-listed category labels and numbers.
- **The allow-list is the control, not a promise.** `api/_analytics.js` maps any unrecognised value to `Other` and drops any field it does not name.
- **The admin password appears in no file in this repository.** Not in tests, not in shell commands, not in the dashboard. It is set once in the Vercel project's environment variables and read there as `ADMIN_PASSWORD`. Tests use their own throwaway value. Where a step needs the real one, the operator types it at a prompt or exports it into their own shell as `$MW_ADMIN` for that session only.
- **`mathwise.html` has no build step.** Plain JavaScript inside the existing `<script>` block, matching the surrounding style: `/* --- Section --- */` markers, `S` for state, explicit `render()` after every mutation.
- **Analytics must never break tutoring.** Every analytics entry point is wrapped in `try/catch`, exactly as `logUsage()` already is.
- **Course keys** (copy verbatim, 15 of them): `myp7`, `myp8`, `myp9`, `myp10a`, `myp10s`, `myp10x`, `gen12`, `gen34`, `meth12`, `meth34`, `spec12`, `spec34`, `aa_sl`, `aa_hl`, `ai_sl`. The empty string is a real, valid state (no course chosen) and maps to `none`.
- **Bands** (copy verbatim): `MYP`, `VCE`, `IB Diploma`. No course chosen maps to `none`.
- **Outcomes** (copy verbatim): `solved`, `shown`, `switched`, `closed`, `timeout`.
- **Ratings** (copy verbatim): `up`, `down`, `none`.
- **`TOPICS` has no entries for `aa_sl`, `aa_hl` or `ai_sl`.** The classifier must fall back to a shared keyword map for those courses instead of returning nothing.
- **Inactivity timeout is 20 minutes** (1,200,000 ms), defined once as `IDLE_MS`.
- **Prose style:** no em dashes in any user-facing text, straight quotes, plain language.

## One deliberate departure from the spec

The spec proposed adding an optional `topic` field to the OCR schema so photographed
questions could be classified by the model that is already reading them. This plan does not
do that, because it turned out to be unnecessary: a photographed question already reaches
`submit()` as the OCR'd text in its first argument, so `classifyTopic()` sees it and
classifies it exactly as it does a typed question. Adding the field would mean editing a
prompt, widening a schema and trusting a model's label, for no gain. If topic accuracy on
photo questions proves poor once there is real data, revisit it then.

## File Structure

| File | Responsibility |
| --- | --- |
| `mathwise.html` (modified) | New `/* --- Analytics --- */` section: device id, topic classifier, record builder, local store, outbox, idle timer. Lifecycle calls wired into the existing question flow. Rating strip. Cost tab removed from `TABS`. |
| `db/schema.sql` (new) | The `mw_events` table and its indexes. `CREATE TABLE IF NOT EXISTS` only, never `DROP`. |
| `api/_db.js` (new) | Neon client with a test seam. Copied unchanged from Springboard. |
| `api/_lib.js` (new) | CORS allow-list, timing-safe compare, `requireAdmin`, rate limit. Copied from Springboard with MathWISE header names. |
| `api/_analytics.js` (new) | `CATEGORIES`, `category()`, `sanitiseEvent()`, `safeCounts()`. The privacy boundary. |
| `api/_scorecard.js` (new) | Pure week-over-week arithmetic, medians, percentages. No database, no HTTP, so it is trivially testable. |
| `api/log.js` (new) | POST write endpoint. Open to students, rate limited. |
| `api/stats.js` (new) | POST read endpoint. Admin password required. |
| `stats.html` (new) | The dashboard: password gate, four sections, inline SVG charts. |
| `test/*.test.js` (new) | `node --test` coverage for the allow-list, both endpoints, the shared library and the scorecard maths. |
| `package.json` (new) | `npm test` script and the one dependency. |
| `vercel.json` (new) | Security headers, matching Springboard. |

---

### Task 1: Analytics core inside the app

**Files:**
- Modify: `mathwise.html` (insert a new section immediately after the `/* --- Cost analysis --- */` block ends, just before `/* --- Expressions --- */`)
- Test: `mathwise.html` self-check, reachable at `mathwise.html?selftest=1`

**Interfaces:**
- Consumes: `COURSES`, `courseOf(key)`, `TOPICS`, `Y10_CORE`, `topicsFor(courseKey)` (all already defined above this point in the file).
- Produces: `deviceId()`, `classifyTopic(text, courseKey)`, `buildRecord(session)`, `loadLocalEvents()`, `saveLocalEvents(list)`, `IDLE_MS`, and the constant `TOPIC_KEYWORDS`.

- [ ] **Step 1: Write the failing self-check**

Add this at the very end of the `<script>` block, just above the existing `/* --- Go --- */` section:

```javascript
/* --- Self-check ------------------------------------------------------- *
 * Runs only with ?selftest=1 in the address. Pure functions only: no
 * network, no timers, no storage writes. Prints a pass/fail list into the
 * page instead of rendering the app.
 * ------------------------------------------------------------------ */

function runSelfTest(){
  const results = [];
  const check = (name, actual, expected) => {
    const pass = JSON.stringify(actual) === JSON.stringify(expected);
    results.push({ name, pass, actual, expected });
  };

  check("classify: quadratic question in Year 10 Standard",
    classifyTopic("How do I factorise x^2 + 5x + 6?", "myp10s"),
    "Expanding and factorising quadratics");
  check("classify: gradient question falls to the keyword map",
    classifyTopic("what is the gradient of this line", "aa_sl"),
    "Linear relationships");
  check("classify: nonsense is Unclassified",
    classifyTopic("zzzz qqqq", "myp7"),
    "Unclassified");
  check("classify: empty text is Unclassified",
    classifyTopic("", "myp7"),
    "Unclassified");

  const rec = buildRecord({
    course: "gen34", startedAt: 1000, endedAt: 121000, turns: 4,
    outcome: "solved", rating: "up", tokensIn: 120, tokensOut: 340, cost: 0.0123,
    topic: "Matrices"
  });
  check("record: band derived from course", rec.band, "VCE");
  check("record: seconds from timestamps", rec.seconds, 120);
  check("record: outcome carried", rec.outcome, "solved");
  check("record: no course means none", buildRecord({ course:"", startedAt:0, endedAt:0 }).band, "none");
  check("record: carries no free text", Object.keys(rec).includes("text"), false);

  const pass = results.filter(r => r.pass).length;
  document.getElementById("root").innerHTML =
    `<div style="font:14px/1.6 Figtree,system-ui;padding:24px;max-width:760px">
      <h2>MathWISE self-check</h2>
      <p><strong>${pass} of ${results.length} passed.</strong></p>
      <ul>${results.map(r => `<li style="color:${r.pass ? "#2b7a3f" : "#b3261e"}">
        ${r.pass ? "PASS" : "FAIL"} — ${esc(r.name)}
        ${r.pass ? "" : `<br><small>got ${esc(JSON.stringify(r.actual))},
          expected ${esc(JSON.stringify(r.expected))}</small>`}</li>`).join("")}</ul>
    </div>`;
}
```

Then change the last line of the `/* --- Go --- */` section so the self-check can take over. Find the existing call to `render()` at the very bottom of the file and replace it with:

```javascript
if (new URLSearchParams(location.search).get("selftest") === "1") runSelfTest();
else render();
```

- [ ] **Step 2: Run it to make sure it fails**

Open `mathwise.html?selftest=1` in a browser.
Expected: the page is blank or the browser console shows `ReferenceError: classifyTopic is not defined`. That is the failure we want, because the functions do not exist yet.

- [ ] **Step 3: Write the analytics core**

Insert this new section directly after the cost-analysis block closes and before `/* --- Expressions --- */`:

```javascript
/* --- Analytics -------------------------------------------------------- *
 * One anonymous record per question a student works on. What leaves this
 * device is a set of category labels and numbers: course, band, topic,
 * outcome, turns, seconds, rating, tokens, cost. Never the question text,
 * never a photo, never a name. The server re-checks every value against
 * its own allow-list, so this file is the convenience, not the control.
 *
 * Every entry point is wrapped so that an analytics fault can never break
 * a tutoring request, exactly as logUsage() already behaves.
 * ------------------------------------------------------------------ */

const IDLE_MS = 20 * 60 * 1000;   // 20 minutes with no interaction ends a session

// Courses whose TOPICS list is empty (the three IB Diploma courses) fall back
// to this. Order matters: the first match wins, so put the specific phrases
// above the general ones.
const TOPIC_KEYWORDS = [
  ["Calculus", ["differentiate", "derivative", "integral", "integrate", "dy/dx", "antiderivative", "limit"]],
  ["Statistics and probability", ["probability", "normal distribution", "standard deviation", "binomial", "median", "quartile", "box plot", "histogram"]],
  ["Trigonometry", ["sine", "cosine", "tangent", "sin(", "cos(", "tan(", "bearing", "radian"]],
  ["Linear relationships", ["gradient", "y-intercept", "straight line", "y = mx", "simultaneous"]],
  ["Quadratics", ["quadratic", "parabola", "factorise", "discriminant", "complete the square"]],
  ["Geometry and measurement", ["area", "perimeter", "volume", "surface area", "pythagoras", "congruent", "similar"]],
  ["Number and algebra", ["simplify", "expand", "solve for", "index", "indices", "surd", "fraction", "percentage"]],
  ["Financial mathematics", ["interest", "loan", "depreciation", "annuity", "investment"]],
  ["Networks and matrices", ["matrix", "matrices", "network", "vertex", "spanning tree", "shortest path"]],
];

function deviceId(){
  try {
    let id = localStorage.getItem("mw_device");
    if (!id){
      const rnd = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2);
      id = rnd.replace(/-/g, "").slice(0, 8);
      localStorage.setItem("mw_device", id);
    }
    return id;
  } catch (e){ return "nostore"; }
}

// Matches the question against this course's own topic list first, because
// those are the words the student's teacher actually uses. Falls back to the
// shared keyword map, which is the only option for the IB courses since
// TOPICS has no entries for them.
function classifyTopic(text, courseKey){
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return "Unclassified";

  const key = courseKey || "";
  const listed = (topicsFor(key) || []).concat(key.startsWith("myp10") ? Y10_CORE : []);
  let best = "", bestScore = 0;
  listed.forEach(topic => {
    // Score a topic by how many of its own significant words appear in the
    // question. "Expanding and factorising quadratics" matches on both
    // "factorise" and "quadratic" and so beats a single-word coincidence.
    const words = topic.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 4);
    const score = words.filter(w => t.includes(w.replace(/(ing|ies|es|s)$/, ""))).length;
    if (score > bestScore){ bestScore = score; best = topic; }
  });
  if (bestScore > 0) return best;

  for (const [label, keys] of TOPIC_KEYWORDS){
    if (keys.some(k => t.includes(k))) return label;
  }
  return "Unclassified";
}

function buildRecord(session){
  const s = session || {};
  const course = s.course || "";
  const band = course ? (courseOf(course).band || "none") : "none";
  const started = Number(s.startedAt) || 0;
  const ended = Number(s.endedAt) || 0;
  return {
    device: deviceId(),
    course: course || "none",
    band: band || "none",
    topic: s.topic || "Unclassified",
    outcome: s.outcome || "switched",
    turns: Number(s.turns) || 0,
    seconds: Math.max(0, Math.round((ended - started) / 1000)),
    rating: s.rating || "none",
    tokensIn: Number(s.tokensIn) || 0,
    tokensOut: Number(s.tokensOut) || 0,
    cost: Number(s.cost) || 0
  };
}

function loadLocalEvents(){
  try { return JSON.parse(localStorage.getItem("mw_events") || "[]"); }
  catch (e){ return []; }
}

function saveLocalEvents(list){
  try { localStorage.setItem("mw_events", JSON.stringify(list.slice(-2000))); }
  catch (e){ /* storage full or unavailable — logging is best-effort only */ }
}
```

- [ ] **Step 4: Run the self-check to verify it passes**

Reload `mathwise.html?selftest=1`.
Expected: "9 of 9 passed." If the gradient case fails, check that `aa_sl` really has no `TOPICS` entry, because the fallback map is what should be answering it.

- [ ] **Step 5: Commit**

```bash
git add mathwise.html
git commit -m "Add analytics core: device id, topic classifier, record builder

Classifies a question against the course's own topic list, falling back to
a shared keyword map for the three IB courses, which have no TOPICS entry.
Only the resulting label is ever stored; the question text stays here.

Adds a ?selftest=1 self-check covering the pure functions, since this
project has no test runner for the browser code."
```

---

### Task 2: Question session lifecycle

**Files:**
- Modify: `mathwise.html` — the `/* --- Analytics --- */` section (add lifecycle functions), `submit()`, the `clear` handler, the `another` handler, the `restart` handler in `renderApp()`, the MST completion block, and the `/* --- Go --- */` section.

**Interfaces:**
- Consumes: `buildRecord()`, `classifyTopic()`, `IDLE_MS`, `saveLocalEvents()`, `loadLocalEvents()` from Task 1.
- Produces: `analyticsStart(text)`, `analyticsTouch()`, `analyticsEnd(outcome)`, `analyticsRate(rating)`, and the module-level variable `AS` (the open session, or `null`).

- [ ] **Step 1: Write the failing self-check additions**

Add these checks inside `runSelfTest()`, immediately before the `const pass = ...` line:

```javascript
  // Lifecycle: start, count turns, end once and once only.
  analyticsEnd("switched");                       // clear any stray open session
  const before = loadLocalEvents().length;
  analyticsStart("factorise x^2 + 5x + 6");
  check("lifecycle: session opens", AS !== null, true);
  AS.turns = 3;
  analyticsEnd("solved");
  const after = loadLocalEvents();
  check("lifecycle: one record written", after.length, before + 1);
  check("lifecycle: outcome recorded", after[after.length - 1].outcome, "solved");
  check("lifecycle: turns recorded", after[after.length - 1].turns, 3);
  check("lifecycle: session closed", AS, null);
  analyticsEnd("closed");
  check("lifecycle: second end is ignored", loadLocalEvents().length, before + 1);
```

- [ ] **Step 2: Run it to make sure it fails**

Open `mathwise.html?selftest=1`.
Expected: the console shows `ReferenceError: analyticsEnd is not defined` and the results list does not render.

- [ ] **Step 3: Write the lifecycle**

Append to the `/* --- Analytics --- */` section:

```javascript
// The open question session, or null when no question is in progress.
let AS = null;
let idleTimer = null;

function analyticsStart(text){
  try {
    if (AS) analyticsEnd("switched");
    AS = {
      course: S.courseKey || "",
      topic: classifyTopic(text, S.courseKey || ""),
      startedAt: Date.now(),
      endedAt: 0,
      turns: 0,
      rating: "none",
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
      askedToBeShown: false
    };
    analyticsTouch();
  } catch (e){ /* analytics must never break a tutoring request */ }
}

// Any sign of life resets the twenty-minute clock. A hidden tab does NOT
// pause it: a student who switches away and never comes back should be
// recorded as a timeout, not left open forever.
function analyticsTouch(){
  try {
    if (idleTimer) clearTimeout(idleTimer);
    if (!AS) return;
    idleTimer = setTimeout(() => analyticsEnd("timeout"), IDLE_MS);
  } catch (e){ /* best effort only */ }
}

function analyticsEnd(outcome){
  try {
    if (!AS) return;
    const session = AS;
    AS = null;                       // cleared first, so a re-entrant call is a no-op
    if (idleTimer){ clearTimeout(idleTimer); idleTimer = null; }
    session.endedAt = Date.now();
    session.outcome = session.askedToBeShown && outcome === "solved" ? "shown" : outcome;
    const record = buildRecord(session);
    const list = loadLocalEvents();
    list.push(Object.assign({ ts: new Date().toISOString() }, record));
    saveLocalEvents(list);
    queueSend(record);
  } catch (e){ /* analytics must never break a tutoring request */ }
}

function analyticsRate(rating){
  try {
    if (AS){ AS.rating = rating; return; }
    // The rating usually arrives after the solution closed the session, so
    // amend the most recent stored record instead of dropping the answer.
    const list = loadLocalEvents();
    if (!list.length) return;
    list[list.length - 1].rating = rating;
    saveLocalEvents(list);
    queueSend(list[list.length - 1]);
  } catch (e){ /* best effort only */ }
}

// Replaced with a real sender in Task 9. Defined now so the lifecycle can
// call it from the start and the self-check can run without a network.
function queueSend(record){ /* wired up in Task 9 */ }
```

- [ ] **Step 4: Run the self-check to verify it passes**

Reload `mathwise.html?selftest=1`.
Expected: "15 of 15 passed."

- [ ] **Step 5: Wire the lifecycle into the question flow**

Six edits, all in existing code.

In `submit()`, immediately after the line `if (visible) maybeNudgeCourse();`, add:

```javascript
  if (visible && !AS) analyticsStart(text);
  analyticsTouch();
```

In `submit()`, in the `try` block after the reply arrives, replace:

```javascript
    S.hintTurns += 1;
    S.solved = S.solved || /^##\s*full solution/i.test(reply.trim());
```

with:

```javascript
    S.hintTurns += 1;
    const nowSolved = /^##\s*full solution/i.test(reply.trim());
    S.solved = S.solved || nowSolved;
    if (AS) AS.turns += 1;
    if (nowSolved) analyticsEnd("solved");
```

In the `clear` button handler and in the `wire("another", ...)` handler, add `analyticsEnd("switched");` as the first statement inside each function, before `stopSpeech()`.

In the `restart` handler inside `renderApp()`, add `analyticsEnd("switched");` as the first statement, before `stopSpeech()`.

In the MST completion block, immediately after the existing line `S.solved = true;`, add:

```javascript
  analyticsEnd("solved");
```

In the `wire("justshow", ...)` handler, add `if (AS) AS.askedToBeShown = true;` as the first statement.

- [ ] **Step 6: Add the close and idle handlers**

In the `/* --- Go --- */` section, immediately above the `if (new URLSearchParams(...))` line added in Task 1:

```javascript
// A closing tab is the clearest abandonment signal there is. keepalive on the
// send (Task 9) is what lets the request finish while the page tears down.
window.addEventListener("pagehide", () => analyticsEnd("closed"));
// Any click anywhere in the app counts as a sign of life for the idle clock.
document.addEventListener("click", () => analyticsTouch(), true);
window.addEventListener("focus", () => analyticsTouch());
```

- [ ] **Step 7: Verify in a real browser**

Open `mathwise.html`, ask a question, let it reach a full solution, then open the browser console and run:

```javascript
JSON.parse(localStorage.getItem("mw_events")).slice(-1)
```

Expected: one record with `outcome: "solved"`, a `turns` count matching the number of replies, a sensible `seconds`, your course key, and a topic label. Confirm there is no question text anywhere in it.

- [ ] **Step 8: Commit**

```bash
git add mathwise.html
git commit -m "Record a question session from first message to its end

Ends on a full solution, on starting another question, on the tab closing,
or after twenty minutes with no interaction. A hidden tab does not pause the
clock, so switching away and never returning is recorded as a timeout rather
than staying open forever.

Pressing 'Just show me the solution' marks the outcome as shown rather than
solved, so completions that the student reached themselves stay separable."
```

---

### Task 3: The thumbs rating

**Files:**
- Modify: `mathwise.html` — the `S` object, `renderQuestions()` (the block that renders the follow-up buttons, where `justshow` lives), the `wire(...)` block below it, and the three reset handlers.

**Interfaces:**
- Consumes: `analyticsRate(rating)` from Task 2, `S.solved`, the existing `wire(id, fn)` helper.
- Produces: `S.rated` (boolean, added to the `S` object).

- [ ] **Step 1: Add the state flag**

In the `S` object, immediately after the line `solved: false,`, add:

```javascript
  rated: false,
```

Add `S.rated = false;` alongside the existing `S.solved = false;` in all three reset handlers (`clear`, `another`, `restart`).

- [ ] **Step 2: Render the strip**

In `renderQuestions()`, immediately after the line that renders the `justshow` button, add:

```javascript
        ${S.solved && !S.rated ? `<div class="mw-rate" style="margin-top:14px;display:flex;
          align-items:center;gap:10px;font-size:0.95rem">
          <span>Did this help?</span>
          <button class="btn-quiet" id="rateup" aria-label="Yes, this helped">Yes</button>
          <button class="btn-quiet" id="ratedown" aria-label="No, this did not help">Not really</button>
        </div>` : ""}
        ${S.solved && S.rated ? `<p class="muted" style="margin-top:14px">Thanks, that helps us improve MathWISE.</p>` : ""}
```

- [ ] **Step 3: Wire the buttons**

In the `wire(...)` block, beneath the existing `wire("justshow", ...)` line:

```javascript
  wire("rateup", () => { analyticsRate("up"); S.rated = true; render(); });
  wire("ratedown", () => { analyticsRate("down"); S.rated = true; render(); });
```

- [ ] **Step 4: Verify in a real browser**

Open `mathwise.html`, work a question to a full solution, click "Yes", then in the console run:

```javascript
JSON.parse(localStorage.getItem("mw_events")).slice(-1)[0].rating
```

Expected: `"up"`. The strip is replaced by the thank-you line and does not come back for that question. Start another question and confirm the strip does not appear until that one is solved.

- [ ] **Step 5: Commit**

```bash
git add mathwise.html
git commit -m "Ask once whether the solution helped

A single line under a full solution, one click, then a thank you. Never
blocks input and never reappears for the same question. Skipping it is
recorded as no rating, which is itself a signal worth having."
```

---

### Task 4: Take the cost tab out of the student app

**Files:**
- Modify: `mathwise.html` — `TABS`, the tab dispatch in `renderApp()`, the cost module's header comment, and the app header.

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new. `renderCostAnalysis()`, `logUsage()` and `loadCostLog()` all stay, because `stats.html` reads `mw_cost_log` from this same origin in Task 10.

- [ ] **Step 1: Remove the tab**

In `TABS`, delete this line entirely:

```javascript
  { key:"cost",      label:"Cost Analysis" }  // REMOVABLE — see the "Cost analysis" module
```

and remove the trailing comma from the `tools` line above it so the array still parses.

In `renderApp()`, delete this line:

```javascript
  else if (S.tab === "cost") renderCostAnalysis(body);  // REMOVABLE — see the "Cost analysis" module
```

- [ ] **Step 2: Stop the module comment lying**

Replace the first paragraph of the `/* --- Cost analysis --- */` header comment (the block starting "REMOVABLE MODULE.") with:

```javascript
/* --- Cost analysis ----------------------------------------------------- *
 * Staff-only. This no longer appears as a tab in the student app; the
 * dashboard at stats.html renders it, reading mw_cost_log from this same
 * origin. logUsage() still runs on every call to Claude, both for this view
 * and to roll token and cost totals into each analytics record.
 *
 * The rates below are approximate and hand-maintained. Treat the dollar
 * figures as relative comparison, not as a bill.
 * ------------------------------------------------------------------ */
```

- [ ] **Step 3: Add the transparency line**

In `renderApp()`, immediately before the closing `</div>` of the `app-head` block, add:

```javascript
      <p class="small muted" style="margin-top:10px">MathWISE records anonymous usage to help
        teachers improve it. No names, no questions and no photos are stored.</p>
```

- [ ] **Step 4: Verify in a real browser**

Open `mathwise.html`. Expected: three tabs (Questions, Study Skills, Study Tools), no Cost Analysis tab, and the privacy line visible under the masthead. Ask a question and confirm the app still works normally.

- [ ] **Step 5: Commit**

```bash
git add mathwise.html
git commit -m "Move cost analysis out of the student app

Students no longer see a Cost Analysis tab. The rendering code stays put:
stats.html reads the same localStorage log from the same origin, and
logUsage() still feeds token and cost totals into each analytics record.

Adds one plain line telling students usage is recorded anonymously."
```

---

### Task 5: Project scaffolding and the shared library

**Files:**
- Create: `package.json`, `vercel.json`, `api/_db.js`, `api/_lib.js`
- Test: `test/lib.test.js`, `test/_helpers.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `getSql()`, `setSqlForTests(fn)` from `api/_db.js`; `safeEqual(a, b)`, `applyCors(req, res, methods)`, `requireAdmin(req, res)`, `rateLimit(req, res, {max, windowMs, name})`, `__setNowForTests(fn)`, `__resetRateLimit()` from `api/_lib.js`; `mockReqRes({method, headers, body})` from `test/_helpers.js`.

- [ ] **Step 1: Create the scaffolding**

`package.json`:

```json
{
  "name": "mathwise",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/**/*.test.js"
  },
  "dependencies": {
    "@neondatabase/serverless": "0.10.4"
  }
}
```

`vercel.json`:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "X-Frame-Options", "value": "DENY" }
      ]
    }
  ]
}
```

`api/_db.js`:

```javascript
import { neon } from "@neondatabase/serverless";

let _sql = null;

export function getSql() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql;
}

// Tests inject a fake tagged-template function here.
export function setSqlForTests(fn) { _sql = fn; }
```

`test/_helpers.js`:

```javascript
// Every test uses this throwaway value. The real admin password lives only in
// the Vercel project's environment variables and appears in no file here.
export const TEST_ADMIN_PW = "test-admin-pw";

export function mockReqRes({ method = "POST", headers = {}, body = {} } = {}) {
  const req = { method, headers, body };
  const res = {
    statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    end() { return this; },
  };
  return { req, res };
}
```

- [ ] **Step 2: Write the failing tests**

`test/lib.test.js`:

```javascript
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
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npm install
npm test
```

Expected: FAIL with `Cannot find module '../api/_lib.js'`.

- [ ] **Step 4: Write `api/_lib.js`**

```javascript
import crypto from "node:crypto";

const ALLOWED_ORIGINS = [
  "https://wesdlpteam.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:3000",
];

export function safeEqual(a, b) {
  const rawA = String(a ?? "");
  const rawB = String(b ?? "");
  // empty always fails closed -- check BEFORE hash so an unset env var never matches
  if (rawA.length === 0 || rawB.length === 0) return false;
  // hash both to a fixed 32 bytes first, so a raw length difference never
  // reaches the compare and cannot leak through timing
  const A = crypto.createHash("sha256").update(rawA).digest();
  const B = crypto.createHash("sha256").update(rawB).digest();
  return crypto.timingSafeEqual(A, B);
}

export function applyCors(req, res, methods = "POST, OPTIONS") {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-mw-admin");
  if (req.method === "OPTIONS") { res.status(200).end(); return true; }
  return false;
}

export function requireAdmin(req, res) {
  if (!safeEqual(req.headers["x-mw-admin"], process.env.ADMIN_PASSWORD)) {
    res.status(401).json({ error: "Invalid admin password" });
    return false;
  }
  return true;
}

// Per-warm-instance in-memory throttle. Resets on a cold start, so it is
// best effort only: it bounds abuse, it does not eliminate it. The clock is
// injectable so tests can drive it.
let _now = () => Date.now();
const _hits = new Map(); // "name|ip" -> [timestamps]

function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  if (req.headers["x-real-ip"]) return String(req.headers["x-real-ip"]).trim();
  return "unknown";
}

export function rateLimit(req, res, { max, windowMs, name }) {
  const now = _now();
  const key = name + "|" + clientIp(req);
  const fresh = (_hits.get(key) || []).filter((t) => now - t < windowMs);
  if (fresh.length >= max) {
    res.status(429);
    res.setHeader("Retry-After", Math.ceil(windowMs / 1000));
    res.json({ error: "Too many requests, slow down." });
    _hits.set(key, fresh);
    return false;
  }
  fresh.push(now);
  _hits.set(key, fresh);
  return true;
}

// test seams
export function __setNowForTests(fn) { _now = fn || (() => Date.now()); }
export function __resetRateLimit() { _hits.clear(); }
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test
```

Expected: 6 passing, 0 failing.

- [ ] **Step 6: Commit**

```bash
git add package.json vercel.json api/_db.js api/_lib.js test/_helpers.js test/lib.test.js
git commit -m "Add serverless scaffolding and shared request guards

CORS allow-list, timing-safe password compare and a per-instance rate limit,
following the pattern already proven in the Springboard project. The compare
fails closed on an empty secret, so an unset ADMIN_PASSWORD locks everyone
out rather than letting everyone in.

Tests use a throwaway password; the real one lives only in Vercel."
```

---

### Task 6: The allow-list

**Files:**
- Create: `api/_analytics.js`
- Test: `test/analytics.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `CATEGORIES`, `category(field, value)`, `sanitiseEvent(body)`, `safeCounts(rows, field)`.

- [ ] **Step 1: Write the failing tests**

`test/analytics.test.js`:

```javascript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test
```

Expected: FAIL with `Cannot find module '../api/_analytics.js'`.

- [ ] **Step 3: Write `api/_analytics.js`**

```javascript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test
```

Expected: 13 passing, 0 failing. If "sanitiseEvent refuses a free-text topic" fails, check the word-count guard in `topicCategory`: the sentence in that test is nine words, which must exceed the limit.

- [ ] **Step 5: Commit**

```bash
git add api/_analytics.js test/analytics.test.js
git commit -m "Add the analytics allow-list, the privacy boundary

Every stored value is checked against a fixed list; anything unrecognised
becomes Other and any field not named here is dropped before the insert.
Numbers are clamped and the device id is stripped to letters and digits.

Topic accepts real teacher-facing names by shape and word count, so a
sentence, a name or a pasted question cannot pass as a topic label."
```

---

### Task 7: The table and the write endpoint

**Files:**
- Create: `db/schema.sql`, `api/log.js`
- Test: `test/log.test.js`

**Interfaces:**
- Consumes: `applyCors`, `rateLimit`, `__resetRateLimit` from `api/_lib.js`; `sanitiseEvent`, `CATEGORIES` from `api/_analytics.js`; `getSql`, `setSqlForTests` from `api/_db.js`.
- Produces: the `mw_events` table; a POST endpoint returning `{ ok: true }`.

- [ ] **Step 1: Write the failing tests**

`test/log.test.js`:

```javascript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test
```

Expected: FAIL with `Cannot find module '../api/log.js'`.

- [ ] **Step 3: Write the schema**

`db/schema.sql`:

```sql
-- MathWISE analytics. One row per question a student worked on.
-- Anonymous by construction: device is a random per-browser id, and there is
-- no column for question text, names, classes or images.
--
-- This file shares a Neon instance with the Springboard project's own tables.
-- CREATE TABLE IF NOT EXISTS only. Never add a DROP to this file.
CREATE TABLE IF NOT EXISTS mw_events (
  id          SERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  device      TEXT NOT NULL,
  course      TEXT,
  band        TEXT,
  topic       TEXT,
  outcome     TEXT NOT NULL,
  turns       INTEGER,
  seconds     INTEGER,
  rating      TEXT,
  tokens_in   INTEGER,
  tokens_out  INTEGER,
  cost_usd    NUMERIC(10,6)
);
CREATE INDEX IF NOT EXISTS mw_events_ts_idx ON mw_events (ts);
CREATE INDEX IF NOT EXISTS mw_events_outcome_idx ON mw_events (outcome);
```

- [ ] **Step 4: Write `api/log.js`**

```javascript
import { applyCors, rateLimit } from "./_lib.js";
import { getSql } from "./_db.js";
import { sanitiseEvent, CATEGORIES } from "./_analytics.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  // Students call this one, so there is no passcode. The allow-list bounds
  // what can be stored and this bounds how much.
  if (!rateLimit(req, res, { max: 60, windowMs: 60000, name: "log" })) return;

  const b = req.body || {};
  if (!CATEGORIES.outcome.includes(b.outcome)) {
    return res.status(400).json({ error: "Unknown outcome" });
  }

  const e = sanitiseEvent(b);
  try {
    const sql = getSql();
    await sql`
      INSERT INTO mw_events (device, course, band, topic, outcome, turns, seconds,
                             rating, tokens_in, tokens_out, cost_usd)
      VALUES (${e.device}, ${e.course}, ${e.band}, ${e.topic}, ${e.outcome}, ${e.turns},
              ${e.seconds}, ${e.rating}, ${e.tokens_in}, ${e.tokens_out}, ${e.cost_usd})`;
    return res.status(200).json({ ok: true });
  } catch (err) {
    // Log server side, tell the caller nothing about our internals.
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test
```

Expected: 17 passing, 0 failing.

- [ ] **Step 6: Commit**

```bash
git add db/schema.sql api/log.js test/log.test.js
git commit -m "Add the events table and the write endpoint

Open to student browsers, rate limited to 60 a minute per address, and
everything passes through the allow-list before the insert. An unknown
outcome is a 400 and a database failure is a bare 500 that leaks nothing
about the internals."
```

---

### Task 8: The scorecard maths and the read endpoint

**Files:**
- Create: `api/_scorecard.js`, `api/stats.js`
- Test: `test/scorecard.test.js`, `test/stats.test.js`

**Interfaces:**
- Consumes: `applyCors`, `requireAdmin`, `rateLimit` from `api/_lib.js`; `safeCounts` from `api/_analytics.js`; `getSql`, `setSqlForTests` from `api/_db.js`; `TEST_ADMIN_PW` from `test/_helpers.js`.
- Produces: `median(numbers)`, `pct(part, whole)`, `delta(now, before)`, `scorecard(rows)` from `api/_scorecard.js`; a POST endpoint returning `{ totals, byDay, byBand, byCourse, byTopic, ratings, scorecard, cost }`.

- [ ] **Step 1: Write the failing scorecard tests**

`test/scorecard.test.js`:

```javascript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test
```

Expected: FAIL with `Cannot find module '../api/_scorecard.js'`.

- [ ] **Step 3: Write `api/_scorecard.js`**

```javascript
/**
 * Pure arithmetic for the weekly scorecard. No database, no HTTP, no dates
 * beyond what the caller passes in, so every branch is directly testable.
 */

export function median(numbers) {
  const list = (numbers || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return 0;
  const mid = Math.floor(list.length / 2);
  const value = list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
  return Math.round(value * 10) / 10;
}

export function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

// A week with no history has no percentage change to report. Saying "up 100%"
// from a base of zero would overstate a single new chat, so pct is null there
// and the dashboard shows the raw change instead.
export function delta(now, before) {
  const change = Math.round((now - before) * 10) / 10;
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const percentage = before ? Math.round(((now - before) / before) * 1000) / 10 : null;
  return { change, direction, pct: percentage };
}

const COMPLETED = new Set(["solved", "shown"]);

function topLabel(rows, field) {
  const counts = new Map();
  rows.forEach(r => {
    const key = r[field];
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  if (!counts.size) return "None yet";
  return [...counts].sort((l, r) => r[1] - l[1])[0][0];
}

export function scorecard(rows) {
  const list = rows || [];
  const chats = list.length;
  const completed = list.filter(r => COMPLETED.has(r.outcome));
  const rated = list.filter(r => r.rating === "up" || r.rating === "down");
  const cost = list.reduce((sum, r) => sum + (Number(r.cost_usd) || 0), 0);
  return {
    chats,
    devices: new Set(list.map(r => r.device)).size,
    completionRate: pct(completed.length, chats),
    abandonRate: pct(chats - completed.length, chats),
    helpfulRate: pct(rated.filter(r => r.rating === "up").length, rated.length),
    ratedCount: rated.length,
    medianTurns: median(completed.map(r => r.turns)),
    medianMinutes: median(completed.map(r => (Number(r.seconds) || 0) / 60)),
    topTopic: topLabel(list, "topic"),
    topBand: topLabel(list, "band"),
    cost: Math.round(cost * 10000) / 10000
  };
}
```

- [ ] **Step 4: Run the scorecard tests to verify they pass**

```bash
npm test
```

Expected: 23 passing, 0 failing.

- [ ] **Step 5: Write the failing stats-endpoint tests**

`test/stats.test.js`:

```javascript
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
```

- [ ] **Step 6: Run the tests to verify they fail**

```bash
npm test
```

Expected: FAIL with `Cannot find module '../api/stats.js'`.

- [ ] **Step 7: Write `api/stats.js`**

```javascript
import { applyCors, requireAdmin, rateLimit } from "./_lib.js";
import { getSql } from "./_db.js";
import { safeCounts } from "./_analytics.js";
import { scorecard, delta } from "./_scorecard.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdmin(req, res)) return;
  // Ten aggregate queries per call, so a reloading dashboard cannot hammer Neon.
  if (!rateLimit(req, res, { max: 30, windowMs: 60000, name: "stats" })) return;

  try {
    const sql = getSql();
    const [totals, byDay, byBand, byCourse, byTopic, ratings,
           thisWeekRows, lastWeekRows, costByDay, costByMonth] = await Promise.all([
      sql`SELECT outcome, COUNT(*)::int AS n FROM mw_events GROUP BY outcome ORDER BY n DESC`,
      sql`SELECT to_char(ts::date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS n
          FROM mw_events WHERE ts > now() - interval '90 days'
          GROUP BY ts::date ORDER BY ts::date`,
      sql`SELECT band, COUNT(*)::int AS n FROM mw_events
          WHERE band IS NOT NULL GROUP BY band ORDER BY n DESC`,
      sql`SELECT course, COUNT(*)::int AS n FROM mw_events
          WHERE course IS NOT NULL GROUP BY course ORDER BY n DESC LIMIT 20`,
      sql`SELECT topic, COUNT(*)::int AS n FROM mw_events
          WHERE topic IS NOT NULL GROUP BY topic ORDER BY n DESC LIMIT 10`,
      sql`SELECT rating, COUNT(*)::int AS n FROM mw_events
          WHERE rating IS NOT NULL GROUP BY rating ORDER BY n DESC`,
      sql`SELECT device, outcome, turns, seconds, rating, topic, band, cost_usd
          FROM mw_events WHERE ts > now() - interval '7 days'`,
      sql`SELECT device, outcome, turns, seconds, rating, topic, band, cost_usd
          FROM mw_events WHERE ts > now() - interval '14 days' AND ts <= now() - interval '7 days'`,
      sql`SELECT to_char(ts::date, 'YYYY-MM-DD') AS period, SUM(cost_usd)::float AS total
          FROM mw_events WHERE ts > now() - interval '30 days'
          GROUP BY ts::date ORDER BY ts::date`,
      sql`SELECT to_char(ts, 'YYYY-MM') AS period, SUM(cost_usd)::float AS total
          FROM mw_events GROUP BY to_char(ts, 'YYYY-MM') ORDER BY period`,
    ]);

    const thisWeek = scorecard(thisWeekRows);
    const lastWeek = scorecard(lastWeekRows);
    const changes = {};
    ["chats", "devices", "completionRate", "abandonRate", "helpfulRate",
     "medianTurns", "medianMinutes", "cost"].forEach(key => {
      changes[key] = delta(thisWeek[key], lastWeek[key]);
    });

    return res.status(200).json({
      totals: safeCounts(totals, "outcome"),
      byDay: byDay.map(r => ({ day: r.day, n: Number(r.n) || 0 })),
      byBand: safeCounts(byBand, "band"),
      byCourse: safeCounts(byCourse, "course"),
      byTopic: safeCounts(byTopic, "topic"),
      ratings: safeCounts(ratings, "rating"),
      scorecard: { thisWeek, lastWeek, changes },
      cost: {
        byDay: costByDay.map(r => ({ period: r.period, total: Number(r.total) || 0 })),
        byMonth: costByMonth.map(r => ({ period: r.period, total: Number(r.total) || 0 })),
        thisWeek: thisWeek.cost,
        lastWeek: lastWeek.cost
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
npm test
```

Expected: 27 passing, 0 failing.

- [ ] **Step 9: Commit**

```bash
git add api/_scorecard.js api/stats.js test/scorecard.test.js test/stats.test.js
git commit -m "Add the scorecard maths and the admin-only read endpoint

The scorecard is pure arithmetic in its own module so every branch is
directly testable, including the empty and single-record cases that would
otherwise produce NaN on a fresh install.

A week with no history reports a null percentage rather than a misleading
'up 100%' from a base of zero. The endpoint returns nothing at all without
the admin password."
```

---

### Task 9: Send records to the server

**Files:**
- Modify: `mathwise.html` — replace the placeholder `queueSend()` in the `/* --- Analytics --- */` section, and add the flush call to `/* --- Go --- */`.

**Interfaces:**
- Consumes: `loadLocalEvents()` from Task 1, `POST /api/log` from Task 7.
- Produces: `API_BASE`, `loadOutbox()`, `saveOutbox(list)`, `queueSend(record)`, `flushOutbox()`.

- [ ] **Step 1: Replace the placeholder sender**

Replace the whole placeholder line `function queueSend(record){ /* wired up in Task 9 */ }` with:

```javascript
// The app is served from GitHub Pages; the endpoints live on Vercel. When
// opened as a local file there is no server to talk to, so sending is off and
// the records simply stay in this browser.
const API_BASE = (location.hostname === "localhost" || location.hostname === "127.0.0.1"
  || location.protocol === "file:") ? "" : "https://mathwise.vercel.app";

function loadOutbox(){
  try { return JSON.parse(localStorage.getItem("mw_outbox") || "[]"); }
  catch (e){ return []; }
}

function saveOutbox(list){
  try { localStorage.setItem("mw_outbox", JSON.stringify(list.slice(-200))); }
  catch (e){ /* best effort only */ }
}

function queueSend(record){
  try {
    if (!API_BASE) return;
    const box = loadOutbox();
    box.push(record);
    saveOutbox(box);
    flushOutbox();
  } catch (e){ /* analytics must never break a tutoring request */ }
}

// Sends the queue one record at a time and keeps whatever did not get through.
// keepalive lets a send started by a closing tab finish after the page is gone.
function flushOutbox(){
  try {
    if (!API_BASE) return;
    const box = loadOutbox();
    if (!box.length) return;
    saveOutbox([]);                    // taken out first, put back on failure
    box.forEach(record => {
      fetch(API_BASE + "/api/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
        keepalive: true
      }).then(res => {
        if (!res.ok) throw new Error("rejected");
      }).catch(() => {
        const back = loadOutbox();
        back.push(record);
        saveOutbox(back);
      });
    });
  } catch (e){ /* best effort only */ }
}
```

- [ ] **Step 2: Flush on load**

In the `/* --- Go --- */` section, alongside the `pagehide` listener added in Task 2, add:

```javascript
// Anything stranded by a closed laptop or a dropped connection goes now.
flushOutbox();
```

- [ ] **Step 3: Verify the offline path in a real browser**

Open the published app with the network disconnected, work a question to a solution, then run in the console:

```javascript
JSON.parse(localStorage.getItem("mw_outbox")).length
```

Expected: `1`. Reconnect, reload the page, run the same line again.
Expected: `0`, because the flush on load cleared it.

- [ ] **Step 4: Commit**

```bash
git add mathwise.html
git commit -m "Send finished question records to the analytics endpoint

Records queue in localStorage and are removed only once the server accepts
them, so a dropped connection or a closed laptop loses nothing. keepalive
lets a send started by a closing tab finish after the page has gone.

Opened as a local file the app sends nothing and keeps records on the device."
```

---

### Task 10: The dashboard

**Files:**
- Create: `stats.html`

**Interfaces:**
- Consumes: `POST /api/stats` from Task 8; `mw_cost_log` and `mw_events` from this same origin's `localStorage`.
- Produces: nothing other pieces depend on.

- [ ] **Step 1: Build the page shell**

Create `stats.html`. It is a standalone plain-JavaScript page, no framework, no CDN beyond the font already used by the app.

Structure, in order:

1. `<head>`: `<meta name="robots" content="noindex" />`, the Figtree font link copied from `mathwise.html`, and a `<style>` block using the app's colours: purple `#4F2759`, gold `#C59F40`, ink `#2B2430`, muted `#8A8291`, paper `#FDFCFD`.
2. A header with the MathWISE wordmark and the words "Staff dashboard".
3. A gate: a `<form id="gate">` with one password input and a submit button, shown until a successful fetch.
4. A `<div id="panels" hidden>` holding four sections: Overview, Weekly scorecard, Cost, Data.

- [ ] **Step 2: Write the gate**

The page holds no password of its own. It sends what was typed and lets the server decide, so reading the page source reveals neither a password nor any data.

```javascript
var API_BASE = (location.hostname === "localhost" || location.hostname === "127.0.0.1"
  || location.protocol === "file:") ? "" : "https://mathwise.vercel.app";
var STORE_KEY = "mw_admin_pw";

function fetchStats(password) {
  return fetch(API_BASE + "/api/stats", {
    method: "POST",
    headers: { "x-mw-admin": password }
  }).then(function (res) {
    if (res.status === 401) { var e = new Error("wrong-password"); e.code = 401; throw e; }
    if (!res.ok) throw new Error("server");
    return res.json();
  });
}

function loadStats(password) {
  return fetchStats(password).then(function (data) {
    // sessionStorage, not localStorage: closing the browser re-locks the page.
    sessionStorage.setItem(STORE_KEY, password);
    document.getElementById("gate").hidden = true;
    document.getElementById("panels").hidden = false;
    renderAll(data);
  }).catch(function (err) {
    sessionStorage.removeItem(STORE_KEY);
    showGateError(err.code === 401 ? "Wrong password." : "Could not reach the server.");
  });
}

// A reload inside the same tab should not ask again.
var stored = sessionStorage.getItem(STORE_KEY);
if (stored) loadStats(stored);
```

- [ ] **Step 3: Write the chart helpers**

Four functions, each taking plain data and returning a string of HTML. No library, no
canvas, no CDN. These are the only steps in this plan whose inner drawing code is specified
rather than written out, because the exact path arithmetic is not load-bearing. Everything
that another part of the page depends on is fixed here, so write them to this contract:

```javascript
// points: [{ day: "2026-09-16", n: 4 }, ...] already sorted oldest first.
// Returns: <svg viewBox="0 0 640 220"> with a gold (#C59F40) polyline, purple
// (#4F2759) dots, the first and last dates as x labels, and 0 and the maximum
// as y labels. No axis ticks in between: this is a shape, not a graph to read off.
function lineChart(points, label) { }

// rows: [{ <keyField>: "VCE", n: 12 }, ...]. Sorts longest first itself.
// Returns: one <div> per row, each a purple bar on a #EDE8F0 track, width
// proportional to the largest n, with the label on the left and the count at
// the right end of the bar.
function barChart(rows, keyField, label) { }

// rows: [{ outcome: "solved", n: 9 }, ...]. Returns one full-width stacked bar,
// purple for "solved" and "shown", gold for "switched", "closed" and "timeout",
// each segment carrying its label and percentage when it is wide enough to fit,
// plus a legend underneath so the narrow segments are still readable.
function dividedBar(rows, keyField) { }

// Returns a large number (about 44px, purple) with a small muted caption below.
function bigStat(value, caption) { }
```

Every one of them must return exactly `<p class="muted">Nothing recorded yet.</p>` when
given an empty array, a null, or rows that sum to zero. A fresh install has no data, so the
empty state is the first thing anyone will see and it must look deliberate rather than
broken. Check this before wiring any of them to real data: call each with `[]` and confirm
the page renders that sentence four times.

- [ ] **Step 4: Render the four sections**

- **Overview**: `lineChart(data.byDay)`, `barChart(data.byBand, "band")`, `barChart(data.byTopic, "topic")`, `dividedBar(data.totals, "outcome")`, and `bigStat(data.scorecard.thisWeek.helpfulRate, "found it helpful this week")`.
- **Weekly scorecard**: one card per metric from `data.scorecard.thisWeek`, each showing last week's value beside it and an arrow from `data.scorecard.changes`. Up is good for chats, devices, completion rate and helpful rate; down is good for abandon rate. Colour accordingly, and show the raw change rather than a percentage when `changes[key].pct` is `null`. Label the device count "devices, not students" so nobody reads it as a headcount.
- **Cost**: `data.cost.byDay` as a line, `data.cost.byMonth` as bars, this week against last week, and beneath them the per-call detail for this device read from `localStorage.getItem("mw_cost_log")`. Put one line above every dollar figure: "Estimated from hand-maintained rates. Treat as relative comparison, not a bill."
- **Data**: a button that turns `data` into CSV and offers it as a download, a button that clears this device's `mw_events` and `mw_cost_log` after a confirm, and a plain paragraph listing what is and is not collected, copied from the spec's privacy stance.

- [ ] **Step 5: Verify against the real endpoint**

Task 11 must be deployed first. Open `stats.html` and enter a wrong password.
Expected: "Wrong password." and no data on the page. Check the browser's network tab: the response body contains no analytics.

Enter the real admin password.
Expected: the four sections render. With an empty database every chart reads "Nothing recorded yet." rather than breaking.

- [ ] **Step 6: Commit**

```bash
git add stats.html
git commit -m "Add the staff dashboard

A separate no-index page behind a password the server checks, so the page
itself holds no secret and someone reading the source finds no data. The
password is kept for the tab only, so closing the browser re-locks it.

Charts are inline SVG in the app's own colours, with an explicit empty state
on every one, since a fresh install is the first thing anyone will see."
```

---

### Task 11: Deploy and verify end to end

**Files:**
- Modify: `README.md`, `.gitignore`

**Interfaces:**
- Consumes: everything above.
- Produces: a live deployment and a working dashboard.

- [ ] **Step 1: Create the Vercel project**

```bash
vercel link --yes --project mathwise
```

Expected: `.vercel/project.json` is written. Add `.vercel` and `node_modules` to `.gitignore` if they are not already there.

- [ ] **Step 2: Set the environment variables**

Two values, neither of which may be written into any file in this repository.

`DATABASE_URL` is copied from the Springboard project. Pull it into the session's scratchpad directory, never the repo, pipe it straight in, and delete the file immediately:

```bash
vercel env pull --environment=production "$SCRATCH/sb.env" --cwd "../../Springboard"
grep '^DATABASE_URL=' "$SCRATCH/sb.env" | cut -d= -f2- | vercel env add DATABASE_URL production
rm -f "$SCRATCH/sb.env"
```

`ADMIN_PASSWORD` is typed at the prompt by Nathan, so it never appears in a command, a history file or this plan:

```bash
vercel env add ADMIN_PASSWORD production
```

Verify with `vercel env ls`. Expected: both names listed as Encrypted. Confirm the pulled file is gone.

- [ ] **Step 3: Create the table**

Apply `db/schema.sql` once against the shared Neon instance, using a one-off Node script in the scratchpad that reads `DATABASE_URL` from the environment rather than from any file in the repo.

Expected: no error, and `SELECT COUNT(*) FROM mw_events` returns 0. Confirm Springboard's own `events` table is untouched.

- [ ] **Step 4: Deploy**

```bash
vercel deploy --prod
```

Expected: a production URL. If it is not `https://mathwise.vercel.app`, update `API_BASE` in both `mathwise.html` and `stats.html` to the real URL, commit that change, and redeploy.

- [ ] **Step 5: Verify the write path**

```bash
curl -s -X POST https://mathwise.vercel.app/api/log \
  -H "Content-Type: application/json" \
  -d '{"device":"testdev","course":"gen34","band":"VCE","topic":"Calculus","outcome":"solved","turns":3,"seconds":90,"rating":"up","tokensIn":100,"tokensOut":200,"cost":0.01}'
```

Expected: `{"ok":true}`.

Then confirm a bad record is refused:

```bash
curl -s -X POST https://mathwise.vercel.app/api/log \
  -H "Content-Type: application/json" -d '{"device":"x","outcome":"hacked"}'
```

Expected: `{"error":"Unknown outcome"}`.

- [ ] **Step 6: Verify the read path is actually locked**

Export the password into the shell for this check only, so it is passed by reference rather than written out:

```bash
read -rs MW_ADMIN && export MW_ADMIN
curl -s -X POST https://mathwise.vercel.app/api/stats -H "x-mw-admin: wrong"
curl -s -X POST https://mathwise.vercel.app/api/stats -H "x-mw-admin: $MW_ADMIN" | head -c 200
unset MW_ADMIN
```

Expected: the first returns `{"error":"Invalid admin password"}` and no data. The second returns JSON beginning with `{"totals":`.

- [ ] **Step 7: Verify the whole path in a real browser**

Push to GitHub so Pages updates, then open the live app, work a question through to a full solution, give it a thumbs up, and open `stats.html`. Enter the password.

Expected: the chat count has gone up by one, the topic appears in the topic bars, and the helpful rate reflects the thumbs up. Take a screenshot of the dashboard.

- [ ] **Step 8: Clean up the test row**

Delete the `testdev` row created in Step 5 so it does not distort the first week's numbers.

Expected: `SELECT COUNT(*) FROM mw_events WHERE device = 'testdev'` returns 0.

- [ ] **Step 9: Commit and push**

```bash
git add README.md .gitignore
git commit -m "Document the analytics endpoints and the staff dashboard

Records go to /api/log on Vercel and land in a Neon table shared with
Springboard. The dashboard at stats.html reads them back through /api/stats,
which requires an admin password held in Vercel's settings and in no file
here."
git push
```

---

## Notes for whoever executes this

- **Run the self-check after every change to `mathwise.html`**, not just in Task 1. It is the only automated coverage the browser code has.
- **The `?selftest=1` harness writes to `localStorage`** through `analyticsEnd`. That is deliberate, so the lifecycle is genuinely exercised, but it means running the self-check adds records to whatever browser you run it in. Use a private window if you care about the numbers on that machine.
- **Never add a `DROP` to `db/schema.sql`.** Springboard's tables live in the same database.
- **The admin password belongs in exactly one place:** the Vercel project's environment variables. If you ever find yourself typing it into a file, a test, or a command, stop: that is the mistake this plan is built to avoid.
- **If a task's tests will not pass, stop and say so.** Do not adjust an assertion to match the code. The assertion is the specification.
