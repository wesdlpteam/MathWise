# MathWISE analytics and admin panel: design

Date: 2026-09-17
Status: approved for planning

## Why

Teachers and the developer need to see whether MathWISE is actually helping: who uses
it, at what year level, on which areas of maths, for how long, whether the student
reached an answer, and whether they found it useful. Today the app records nothing
except a local cost log, and that log sits behind a tab any student can open.

## Scope

In scope:

- An analytics module inside `mathwise.html` that records one anonymous record per
  question a student works on.
- Central collection of those records so one dashboard covers every device.
- A password-protected dashboard with visual charts and a weekly scorecard.
- Moving the existing cost analysis out of the student app and into that dashboard,
  with daily, weekly and monthly totals added.

Out of scope:

- Identifying individual students, classes, or teachers.
- Storing question text, photographs, or any free text a student typed.
- Replacing the direct-to-Anthropic API key arrangement. That remains a separate,
  known problem documented in `CLAUDE.md`.

## Prior art: Springboard

This design deliberately copies the structure already proven in the Springboard app
(`Apps/Springboard`), so there is one pattern to maintain across both projects:

| Springboard | MathWISE equivalent |
| --- | --- |
| `db/schema.sql`, `events` table | `db/schema.sql`, `mw_events` table |
| `api/_db.js` Neon client with test seam | same, unchanged |
| `api/_lib.js` CORS, `safeEqual`, `requireAdmin`, `rateLimit` | same, with MathWISE header names |
| `api/_analytics.js` category allow-list and sanitiser | same shape, MathWISE categories |
| `api/log.js` write endpoint | `api/log.js` |
| `api/stats.js` admin-only read endpoint | `api/stats.js` |
| `stats.html` separate gated dashboard | `stats.html` |
| `test/*.test.js` run by `node --test` | same |

Frontend stays on GitHub Pages. Server files run on Vercel. The database is the Neon
instance the Vercel team already has, with a separate table.

## Privacy stance

The strongest control is the allow-list, not a promise. `api/_analytics.js` defines the
permitted values for every column. Anything not on the list is stored as `Other`, and
any field not named in the sanitiser is dropped before the insert. A future bug that
tried to send question text therefore cannot write it: there is no column for it and no
path to one.

Collected per record: random device id, course, year level band, topic area, outcome,
turn count, duration in seconds, rating, token counts, estimated cost, timestamp.

Never collected: names, class or group, question text, photographs, or free text of any
kind. IP addresses are used transiently by Vercel for rate limiting and are not stored.

The student app carries one visible line of text saying usage is recorded anonymously,
with no names, questions or photos stored.

## Data model

```sql
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

`device` is a random eight-character id generated once per browser and kept in
`localStorage` under `mw_device`. It identifies a browser, not a person, and it is never
linked to anything else.

Allowed values:

- `course`: the keys already in `COURSES` (`myp7`, `gen34`, `aahl` and so on), or `Other`.
- `band`: `MYP`, `VCE`, `IB`, or `Other`.
- `topic`: any string already present in `TOPICS` or `Y10_CORE`, or `Unclassified`.
- `outcome`: `solved`, `shown`, `switched`, `closed`, `timeout`.
- `rating`: `up`, `down`, `none`.

## The question session

A session begins when a student sends a first message about a question, either typed or
from a photo. It ends exactly once, on the first of these:

| Outcome | Trigger |
| --- | --- |
| `solved` | a reply beginning `## Full solution` arrives, or the MST exercise completes |
| `shown` | the student presses "Just show me the solution" |
| `switched` | the student asks a new question, changes course, or presses "Start over" while a question is open |
| `closed` | `pagehide` fires, meaning the tab or browser is being closed or navigated away |
| `timeout` | twenty minutes pass with no interaction while a question is open |

`solved` and `shown` are both completions. `switched`, `closed` and `timeout` are
abandonments, and the dashboard reports them separately because they mean different
things: `switched` is usually a student moving on, while `closed` and `timeout` are a
student walking away.

The twenty-minute rule uses a timer reset by any send, any click inside the app, or the
tab regaining focus. It fires even if the tab stays open, which is the common case on a
school laptop left on a desk. A tab merely being hidden does not end a session and does
not pause the timer, so a student who switches to another tab and never comes back is
recorded as `timeout` at twenty minutes rather than as `closed`. This keeps the two
outcomes from overlapping: `closed` means the page was actually torn down.

On `closed`, the record is sent with `fetch(..., { keepalive: true })`, the same
approach Springboard uses, so the browser completes the request while the page unloads.

## Topic classification

Runs entirely on the device. The question text is matched, case-insensitively, against
the topic names for the student's course in `TOPICS`, plus a small keyword map for
common phrasings ("solve for x" to equations, "gradient" to linear graphs, and so on).
Best match wins. No match gives `Unclassified`. For photo questions the OCR schema gains
an optional `topic` field, which costs nothing extra because that call is already being
made, and its answer is checked against the same list before use.

Only the resulting label leaves the device. The question text never does.

## Rating

When a full solution is displayed, a single line appears beneath it: "Did this help?"
with a thumbs up and a thumbs down. One click records the rating, replaces the line with
a short thank you, and collapses it. It never blocks input and never reappears for the
same question. No answer is recorded as `none`, which is itself a signal.

## Client module

One new section in `mathwise.html`, `/* --- Analytics --- */`, holding:

- `deviceId()`, get or create the id in `localStorage`.
- `analyticsStart(source)`, called when a question session opens.
- `analyticsTouch()`, resets the inactivity timer.
- `analyticsEnd(outcome)`, closes the session, builds the record, stores it locally and
  queues it for sending. Safe to call twice; the second call does nothing.
- `classifyTopic(text, courseKey)`, the local classifier.
- `queueSend(record)` and `flushQueue()`, the outbox. Records live in `localStorage`
  under `mw_outbox` until the server confirms receipt. `flushQueue()` runs on load and
  after each new record.
- `loadLocalEvents()` and `saveLocalEvents()`, a device-local copy under `mw_events`
  capped at the most recent 2000 records, so the dashboard still works offline and so
  export keeps working.

Every function is wrapped so that an analytics failure can never break a tutoring
request, matching how `logUsage()` already behaves.

## Server files

`api/log.js`: POST only. CORS allow-list. Rate limit of 60 per minute per address. No
passcode, because students call it. Body passed through `sanitiseEvent()` and inserted.
Returns `{ ok: true }`.

`api/stats.js`: POST only. Requires header `x-mw-admin` matching the `ADMIN_PASSWORD`
environment variable, compared with the timing-safe helper. Rate limit of 30 per minute.
Returns aggregates: totals by outcome, chats per day for 90 days, counts by band, by
course, by topic, rating counts, median turns, median seconds, and cost summed by day,
by ISO week and by month.

`api/_lib.js` and `api/_db.js` are copied from Springboard with the header names
changed. `api/_analytics.js` holds the MathWISE categories and sanitiser.

## Dashboard

`stats.html`, a separate page, `noindex`, Wesley purple and gold, built with the same
plain-JavaScript approach as Springboard's. A password gate covers the page; the
password is held in `sessionStorage` for that tab only and is verified by the server,
never by the page.

Four sections:

1. **Overview.** Chats per day as a line chart. Bars by year level. Bars for the ten
   busiest topics. A divided bar of outcomes. A large thumbs-up percentage.
2. **Weekly scorecard.** The last seven days beside the seven before, each with a
   direction arrow: chats, devices, completion rate, abandonment rate, helpful rate,
   median turns to a solution, median minutes, busiest topic, busiest year level, and
   cost for the week.
3. **Cost.** Daily, weekly and monthly totals across every device from the database,
   plus the existing per-call table and context-growth chart for the current device,
   read from this browser's `localStorage`. Both pages share an origin, so the dashboard
   can read what the app stored.
4. **Data.** Export to CSV, clear this device's local log, and a plain statement of what
   is and is not collected.

Charts are drawn with small self-contained SVG helpers in `stats.html`, in the same
spirit as Springboard's dashboard. The app's own `FIG` library stays in the app.

## Cost analysis move

The `cost` entry is removed from `TABS` and from the `renderApp()` dispatch, so students
no longer see it. `logUsage()` stays, because the dashboard's device-local cost view
still reads `mw_cost_log`, and because token and cost totals per question are rolled
into each analytics record.

## Authentication

The admin password Nathan chose is stored as `ADMIN_PASSWORD` in the MathWISE Vercel
project's environment variables, entered once by hand at a prompt. It is written into no
file in this repository, no test and no shell command; tests use their own throwaway value.
The dashboard sends what the user typed to `api/stats.js`; the server decides. A wrong
password returns 401 and no data. Reading the published page source reveals no password and
no data.

## Hosting

A new Vercel project, `mathwise`, under the existing `dlp-s-projects` team, deployed
from this repository's `api/` directory. `DATABASE_URL` is copied from the Springboard
project so both share one Neon instance with separate tables. `ADMIN_PASSWORD` is set on
the new project. Neither value is written into the repository at any point.

`https://wesdlpteam.github.io` is already on Springboard's CORS allow-list and will be
on MathWISE's.

## Testing

A `package.json` is added with `"test": "node --test test/**/*.test.js"`, matching
Springboard.

- `test/analytics.test.js`: the sanitiser drops unknown fields, maps unknown values to
  `Other`, and refuses free text.
- `test/log.test.js`: rejects non-POST, rejects an unknown outcome, inserts only
  allow-listed values.
- `test/stats.test.js`: rejects a wrong or empty admin password, returns the expected
  shape.
- `test/lib.test.js`: timing-safe compare fails closed on an empty secret; rate limit
  opens and closes as expected.
- `test/scorecard.test.js`: week-over-week arithmetic, medians, and percentage
  calculations against fixed sample data, including empty and single-record cases.

The parts of the client module that are pure, `classifyTopic` and the record builder,
are exercised by a hidden self-check reachable at `mathwise.html?selftest=1`, which runs
assertions against synthetic data and prints a pass or fail summary. The
browser-dependent parts, the timer and the unload handler, are verified by driving the
real page in Chrome.

## Build order

1. Client analytics module, the rating strip, the inactivity timer, and the self-check.
   Works with local storage only. Verified in a browser.
2. Schema, `api/` files and their tests. Verified with `npm test` and against a preview
   deployment.
3. `stats.html`, charts and scorecard, first against sample data, then against the
   preview deployment.
4. Production deploy, then real sessions driven in a browser and screenshots taken.

Each step is independently useful, and a failure in a later step leaves the earlier ones
working.

## Risks and open items

- **Shared database.** MathWISE and Springboard will use one Neon instance. Tables are
  separate and no code touches the other's table, but a mistaken migration could. The
  schema file only ever uses `CREATE TABLE IF NOT EXISTS` and never `DROP`.
- **Open write endpoint.** `api/log.js` takes anonymous writes from any student browser,
  so it can be sent junk by someone determined. The allow-list bounds what can be stored
  and the rate limit bounds how much. Sustained abuse would show up as an implausible
  spike in the dashboard rather than as bad data in individual records.
- **Device id is not a student.** One student on three devices counts as three, and a
  shared classroom laptop counts as one. The dashboard labels this count "devices", not
  "students", so nobody reads it as a headcount.
- **Estimated cost.** `COST_RATES` in the app are approximate and hand-maintained. The
  dashboard repeats that caveat wherever a dollar figure appears.
