# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MathWISE is a mathematics tutoring web app built for students at Wesley College, Glen Waverley
(motto: "Dare to be wise" / app tagline: "Dare to solve"). It covers MYP (Years 7–10), VCE
(General/Methods/Specialist), and IB Diploma (AA/AI, SL/HL) courses.

The entire application is one self-contained file: [mathwise.html](mathwise.html) (~4000 lines:
CSS in `<style>`, JS in one `<script>`). There is no build step, no package manager, no test
runner, and no git repository in this directory — just this HTML file.

## Running it

Open [mathwise.html](mathwise.html) directly in a browser, or serve the directory with any static
file server. There is nothing to install or compile.

**Important caveat:** `callClaude()` (around [mathwise.html:1154](mathwise.html#L1154)) sends the
API key from `localStorage` (prompted once via `getApiKey()`, never written into this file or
committed) using Anthropic's `anthropic-dangerous-direct-browser-access` header. This is a
**personal-testing setup only** — it exists so the single teacher developing this file can test it
locally. It is not safe to hand to students: anyone sharing that browser profile could reuse the
stored key. Before any real classroom rollout, this needs a small server-side proxy that holds the
key privately instead of a direct browser call — do not treat the current setup as production-ready,
and don't remove the warning comment above `callClaude()` without replacing it with that proxy.

## External dependencies (all via CDN, no local install)

- KaTeX (`cdnjs`) — renders LaTeX math in answers and the on-screen keyboard.
- Google Fonts (Figtree) — the only typeface used.
- No JS framework: the UI is hand-rolled `innerHTML` string templates plus a manual `render()` on
  a single global state object (see below). There is no virtual DOM/diffing.

## Architecture

Everything lives under one `<script>` block, organized into clearly commented sections (search for
`/* --- Section --- */` markers). Reading order that mirrors how the app actually works:

1. **Course/content data** (`COURSES`, `TOPICS`, `STUDY_SKILLS`, `TEACHING`, `Y10_CORE`, etc.,
   roughly lines 359–815) — static data describing every course offered, its curriculum body, topic
   lists, and per-band teaching/pitch notes. `courseOf(key)` / `courseContext(key)` /
   `topicsFor(courseKey)` are the accessors used everywhere else.

2. **Prompts** (~lines 817–1090) — every system prompt sent to Claude is a JS template string
   constant here: `HOUSE_RULES`, `FIGURE_SPEC`, `TABLE_SPEC`, `ANSWER_SHAPE`, `SPOKEN_SYSTEM`,
   `OCR_SYSTEM`, `MINDMAP_SYSTEM`, `FEEDBACK_SYSTEM`, `COLOUR_PLAN_SYSTEM`. These compose with
   `courseContext()` output when a request is built. This is the "business logic" of the tutor's
   behaviour — most content/tone changes happen here, not in the render code.

3. **State** — a single mutable object `S` (line ~1092) holds all UI state (current screen/tab,
   chat messages, busy/error flags, mind-map builder state, colour-therapy reflection state, etc.).
   There is no framework: every state mutation is followed by an explicit `render()` call.

4. **API** (`callClaude`, `parseJsonReply`, ~line 1132) — the single wrapper around the Anthropic
   Messages API (`MODEL` constant near line 357, currently `claude-sonnet-4-6`). Callers pass a
   system prompt + messages array; JSON-shaped replies go through `parseJsonReply`, which strips
   code fences and falls back to regex-extracting the first `{...}` block.

5. **Expression engine** (~lines 1156–1255) — a small hand-written shunting-yard tokenizer/parser
   (`tokenise`, `toRpn`, `compile`) that evaluates `y = f(x)`-style strings the model returns, so
   the model sends a formula rather than hundreds of plotted points.

6. **Figures** (~lines 1255–2190) — hand-drawn SVG renderers, one function per diagram type
   (function graphs, bar/histogram, box plot, scatter/line-of-best-fit, cumulative frequency,
   networks, probability trees, Venn diagrams, coordinate geometry). `renderFigure(spec)`
   dispatches on `spec.type` to the right renderer. `FIG` is the type→function map. All figures are
   built from raw SVG string concatenation (`svg()`, `axes()`, `txt()` helpers) — no charting
   library.

7. **Pictorial models** (~line 2016) — SVG bar models / part-whole diagrams for younger years.

8. **Maths keyboard** (~lines 2192–2770) — a custom on-screen LaTeX input widget: cursor movement
   through a token tree, deletion, and rendering, used so students can type maths notation without
   a physical LaTeX-aware keyboard.

9. **Text/markup helpers** (~lines 2771–2950) — converts the model's semi-structured answer text
   into HTML (headings, rules, ordered lists) and builds `<table class="mw-table">` markup for
   frequency/two-way/grouped-data tables.

10. **Speech** (~line 2951) — wraps the browser `SpeechSynthesis` API to read worked solutions
    aloud, using `SPOKEN_SYSTEM` to first turn written working into a spoken script.

11. **Screens** (~line 3035 onward) — the render layer: `render()` dispatches on `S.screen`
    (`welcome` | `app`) to `renderWelcome()` / `renderApp()`; `renderApp()` dispatches on `S.tab`
    (`questions` | `skills` | `tools`) to `renderQuestions()`, `renderSkills()`, `renderTools()`.
    Each render function rebuilds a DOM subtree's `innerHTML` from scratch and then rewires event
    handlers (`onclick`/`onchange`) — there is no event delegation or persistent DOM diffing.
    - **Questions tab**: chat-style Q&A, including photo intake (`renderIntake`, OCR via
      `OCR_SYSTEM`) so a student can photograph a question instead of typing it.
    - **Skills tab**: per-band study skills content and a mind-map builder
      (`renderMindMap`, `MINDMAP_SYSTEM`).
    - **Tools tab**: "Feedback on marked work" (photograph corrected work, `FEEDBACK_SYSTEM`
      reads the marking) and "Colour Therapy reflection" (a structured self-review exercise,
      `COLOUR_PLAN_SYSTEM` turns the student's inputs into a study plan).
    - Answers/plans can be exported via `saveAsPdf()` (~line 3477, uses the browser print dialog)
      or copied as plain text via `offerCopy()`/the copy panel (~line 3516).

12. **Bootstrap** — the file ends with a single `render();` call (line 4042) that draws the
    initial screen against `root` (`#root` div in the `<body>`).

## Making changes

- There's no linter, formatter, or test suite configured — verify changes by opening the file in a
  browser and exercising the affected tab/flow manually.
- Because everything is inline string templates, prefer `Edit` with enough surrounding context to
  disambiguate — many small helper functions (`esc`, `markup`, `svg`, `txt`) are reused across
  dozens of call sites.
- Curriculum/tone changes (what MathWISE is allowed to say, how it should explain something for a
  given course) almost always belong in the prompt constants (section 2 above) or `COURSES`
  /`TEACHING`, not in the render functions.
- New diagram types go in the Figures section: add a renderer function, then wire it into the
  `FIG` dispatch table and document its `spec.type` in `FIGURE_SPEC`/`FIGURE_TYPES` so the model
  knows how to request it.
