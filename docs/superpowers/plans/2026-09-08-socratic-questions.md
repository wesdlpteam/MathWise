# Socratic Questions Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Questions tab from "answer in one shot" into a Socratic back-and-forth: MathWISE
gives one hint or guiding question per turn (with a diagram where that helps), reveals the full
worked solution only once the student reaches it (or asks to be shown), and each new question
starts a clean dialogue.

**Architecture:** No new plumbing. The app already resends the full message history to Claude on
every turn and renders whatever markdown text comes back. This plan changes the system prompt sent
to Claude, adds two small pieces of client-side state (a hint-turn counter and a "solved" flag
detected from a fixed heading in the reply), and adds/rewords a few buttons and copy strings — all
inside the single existing file, [mathwise.html](../../../mathwise.html).

**Tech Stack:** Plain HTML/CSS/JS in one file. No build step, no package manager, no test runner.
KaTeX and Google Fonts via CDN (unchanged). Verification is manual/browser-driven, described in
each task.

**Spec:** [docs/superpowers/specs/2026-09-08-socratic-questions-design.md](../specs/2026-09-08-socratic-questions-design.md)

## Global Constraints

- Single file only: all changes land in `mathwise.html`. No new source files.
- No renaming of existing constants/functions that other code references (`ANSWER_SHAPE`,
  `FOLLOW_UPS`, `S`, `submit`, `renderQuestions`, `backToAsk`) — only their contents/behaviour
  change, so every existing call site keeps working untouched.
- `FIGURE_SPEC`, `TABLE_SPEC`, `HOUSE_RULES`, the expression engine, figure renderers, maths
  keyboard, Study Skills tab, Study Tools tab, speech, PDF export, and copy-as-text are all
  out of scope — do not modify them.
- The project has no test runner. "Run the tests" in each task means: a Node syntax check on the
  extracted script, plus a manual/browser-driven check described in that task. Where the browser
  check would otherwise require a real Claude API call (which this file cannot make — see
  [CLAUDE.md](../../../CLAUDE.md) — no auth header is sent), simulate the assistant's reply by
  setting `S` directly and calling `render()`, rather than waiting on a live network call.
- This directory has no git history yet. Task 1 initializes it. Commit after every task.

---

## File Structure

Only one file changes: `mathwise.html`. No files are created. The touched regions, in the order
tasks hit them:

- `ANSWER_SHAPE` and `FOLLOW_UPS` constants (prompt text) — around line 945-960.
- The `S` state object — around line 1092.
- `submit()` — around line 3314.
- `backToAsk()` and the `renderQuestions()` button-wiring block — around lines 3181-3295.
- Three short copy strings inside `renderQuestions()` and `renderWelcome()`.

## Task 1: Set up git tracking

**Files:**
- Create: `.gitignore` (empty is fine, but having one is the natural first commit alongside the
  existing files)
- No code changes.

**Interfaces:** None — this task only sets up version control so every later task can commit.

- [ ] **Step 1: Check there's no existing repo and initialize one**

Run:
```bash
git status
```
Expected: `fatal: not a git repository...` (confirms we're not about to double-init or stomp on
something already there).

Run:
```bash
git init
```
Expected: `Initialized empty Git repository in .../Claude Mathwise/.git/`

- [ ] **Step 2: Commit the current state as a baseline**

```bash
git add mathwise.html CLAUDE.md docs
git commit -m "Baseline before Socratic Questions tab rework"
```

- [ ] **Step 3: Verify**

Run: `git log --oneline`
Expected: one commit, containing `mathwise.html`, `CLAUDE.md`, and the two `docs/superpowers/...`
files.

---

## Task 2: Rewrite the answer prompt for Socratic dialogue

**Files:**
- Modify: `mathwise.html:945-955` (the `ANSWER_SHAPE` constant)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ANSWER_SHAPE` — same constant name, same usage site (`submit()`,
  `[HOUSE_RULES, courseContext(S.courseKey), FIGURE_SPEC, TABLE_SPEC, ANSWER_SHAPE].join("\n\n")`),
  new content. Later tasks (3-7) rely on the fact that a fully-solved reply starts with the exact
  literal `## Full solution` as its first line — that contract is established here.

- [ ] **Step 1: Replace the constant**

Find this in `mathwise.html` (currently lines 945-955):

```js
const ANSWER_SHAPE = `Answer in this shape, every time:

**A short heading naming what the question is about**

Hint:
- One to three lines that point at the method without doing it. Enough for a student to have another go on their own.

Answer:
The full working, one step per line, ending with the answer stated plainly.

Keep it tight. A student reads this in class, not at leisure. If the question is unclear or something is missing, ask for the missing piece instead of assuming it.`;
```

Replace it with:

```js
const ANSWER_SHAPE = `Work through this with the student. Do not give the full solution straight away.

Each turn:
- Look at what the student has just said (or, on the first turn, the question itself) and respond to it directly.
- Ask one guiding question, or give one small hint, that moves the student one step closer to the method — without doing that step for them. Keep it short: one to three lines.
- A diagram may replace or sit alongside the hint wherever a picture would carry the idea better than words, using the diagram rules below.
- Never give the worked answer, the final value, or the next algebraic step on a hint turn. If the student is heading the wrong way, say so gently and ask a question that points them back, rather than correcting the working for them.

Watch the conversation. The moment the student has clearly reached the method or the answer themselves — or if they directly ask to be shown — switch to the full solution:
- Start that message with the heading "## Full solution" on its own line, first thing in the message. Use this heading only on that message, never on a hint.
- Under it, write the complete working, one step per line, ending with the answer stated plainly. This is their record of the whole method, not just a recap of the hints.

If the question or a student's reply is unclear or missing something you need, ask for the missing piece instead of assuming it — that counts as a normal hint turn.`;
```

- [ ] **Step 2: Syntax check**

Run:
```bash
node --check <(sed -n '/<script>/,/<\/script>/p' mathwise.html | sed '1d;$d')
```
Expected: no output (a template literal with no unescaped backticks parses fine; this file's other
long template strings already do this, so this just confirms the new one does too).

- [ ] **Step 3: Commit**

```bash
git add mathwise.html
git commit -m "Rewrite ANSWER_SHAPE for Socratic hint-first dialogue"
```

---

## Task 3: Add the escape-hatch prompt and reword the follow-up prompts

**Files:**
- Modify: `mathwise.html:957-960` (the `FOLLOW_UPS` constant, plus a new `JUST_SHOW_ME` constant
  immediately after it)

**Interfaces:**
- Consumes: nothing new.
- Produces: `JUST_SHOW_ME` (a plain string) — Task 6 wires a button to
  `submit(JUST_SHOW_ME, false)`. `FOLLOW_UPS.explain` / `FOLLOW_UPS.simplify` keep their existing
  names and shape (a two-key object of strings) — only the wording changes.

- [ ] **Step 1: Replace `FOLLOW_UPS` and add `JUST_SHOW_ME`**

Find (currently lines 957-960):

```js
const FOLLOW_UPS = {
  explain: "Explain your last answer a different way. Change the approach, not the wording: if you were algebraic, try a picture, a table or a concrete example. Include a diagram if one would carry the idea better than words.",
  simplify: "Explain your last answer more simply. Shorter sentences, smaller steps, plainer words. Keep every step of the mathematics that matters, and do not skip to the answer."
};
```

Replace with:

```js
const FOLLOW_UPS = {
  explain: "Try that same hint a different way. Change the approach, not the wording: if you were algebraic, try a picture, a table or a concrete example. Include a diagram if one would carry the idea better than words. Keep it a hint, not the full solution, unless you have already reached the full-solution stage — in that case, re-explain the full solution a different way instead.",
  simplify: "Say that same hint more simply. Shorter sentences, smaller steps, plainer words. Keep it a hint, not the full solution, unless you have already reached the full-solution stage — in that case, re-explain the full solution more simply instead."
};

const JUST_SHOW_ME = "I'd like to see the full solution now, please, rather than another hint.";
```

- [ ] **Step 2: Syntax check**

Run the same command as Task 2 Step 2. Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add mathwise.html
git commit -m "Reword follow-up prompts for hint-based dialogue, add escape-hatch prompt"
```

---

## Task 4: Add turn-tracking state and update it in `submit()`

**Files:**
- Modify: `mathwise.html:1092-1130` (the `S` object)
- Modify: `mathwise.html:3314-3332` (`submit()`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `S.hintTurns` (number, starts at `0`, incremented by 1 every time `submit()`
  successfully appends an assistant reply) and `S.solved` (boolean, recomputed on every successful
  assistant reply by checking whether the reply's trimmed text starts with `## Full solution`,
  case-insensitively). Tasks 5 and 6 read and reset both fields.

- [ ] **Step 1: Add the two fields to `S`**

Find (currently inside the `S` object, right after `messages: [],`):

```js
  messages: [],
  busy: false,
```

Replace with:

```js
  messages: [],
  hintTurns: 0,
  solved: false,
  busy: false,
```

- [ ] **Step 2: Update `submit()` to track turns and detect the solved heading**

Find the current `submit()` (lines 3314-3332):

```js
async function submit(text, visible, shot){
  stopSpeech();
  S.messages.push({ role:"user", content:text, visible, shot });
  S.busy = true; S.error = ""; S.speechError = ""; S.showIntake = false;
  render();

  const system = [HOUSE_RULES, courseContext(S.courseKey), FIGURE_SPEC, TABLE_SPEC,
                  ANSWER_SHAPE].join("\n\n");
  const payload = S.messages.map(m => ({ role:m.role, content:m.content }));
  try {
    const reply = await callClaude(system, payload, 4000);
    S.messages.push({ role:"assistant", content:reply });
  } catch (err){
    S.error = err.message;
    S.messages.pop();
  }
  S.busy = false;
  render();
}
```

Replace with:

```js
async function submit(text, visible, shot){
  stopSpeech();
  S.messages.push({ role:"user", content:text, visible, shot });
  S.busy = true; S.error = ""; S.speechError = ""; S.showIntake = false;
  render();

  const system = [HOUSE_RULES, courseContext(S.courseKey), FIGURE_SPEC, TABLE_SPEC,
                  ANSWER_SHAPE].join("\n\n");
  const payload = S.messages.map(m => ({ role:m.role, content:m.content }));
  try {
    const reply = await callClaude(system, payload, 4000);
    S.messages.push({ role:"assistant", content:reply });
    S.hintTurns += 1;
    S.solved = /^##\s*full solution/i.test(reply.trim());
  } catch (err){
    S.error = err.message;
    S.messages.pop();
  }
  S.busy = false;
  render();
}
```

- [ ] **Step 3: Syntax check**

Run the same command as Task 2 Step 2. Expected: no output.

- [ ] **Step 4: Manual verification (simulated reply, no network call needed)**

This checks the counter/flag logic itself, without depending on a live Claude API call (which this
file can't make anyway — see Global Constraints).

1. Open `mathwise.html` in a browser (double-click it, or serve the folder).
2. Click "Get started", leave the course unset.
3. Open the browser's developer console.
4. Run:
   ```js
   S.messages.push({role:"user", content:"test", visible:true});
   S.messages.push({role:"assistant", content:"Have you thought about what operation undoes a multiplication?"});
   S.hintTurns += 1;
   S.solved = /^##\s*full solution/i.test(S.messages[S.messages.length-1].content.trim());
   console.log(S.hintTurns, S.solved);
   ```
   Expected: logs `1 false`.
5. Run:
   ```js
   S.messages.push({role:"assistant", content:"## Full solution\nDivide both sides by 3: x = 4."});
   S.hintTurns += 1;
   S.solved = /^##\s*full solution/i.test(S.messages[S.messages.length-1].content.trim());
   console.log(S.hintTurns, S.solved);
   ```
   Expected: logs `2 true`.

- [ ] **Step 5: Commit**

```bash
git add mathwise.html
git commit -m "Track hint-turn count and solved state from assistant replies"
```

---

## Task 5: Reset the dialogue when starting a new question

**Files:**
- Modify: `mathwise.html:3248-3252` (the `clear` button handler, inside `renderQuestions()`)
- Modify: `mathwise.html:3269` and `mathwise.html:3286-3295` (`another` button wiring and
  `backToAsk()`)

**Interfaces:**
- Consumes: `S.hintTurns`, `S.solved` (from Task 4).
- Produces: both fields reset to their initial values (`0` / `false`) whenever the thread is
  cleared, so Task 6's gating logic always starts from zero on a new question.

- [ ] **Step 1: Reset the two fields in the `Clear` handler**

Find (currently lines 3248-3252):

```js
  const clear = document.getElementById("clear");
  if (clear) clear.onclick = () => {
    stopSpeech(); S.messages = []; S.error = ""; S.speechError = "";
    S.intake = null; S.intakeEdit = false; render();
  };
```

Replace with:

```js
  const clear = document.getElementById("clear");
  if (clear) clear.onclick = () => {
    stopSpeech(); S.messages = []; S.error = ""; S.speechError = "";
    S.intake = null; S.intakeEdit = false; S.hintTurns = 0; S.solved = false; render();
  };
```

- [ ] **Step 2: Make "Ask another question" clear the thread too**

Find (currently line 3269):

```js
  wire("another", backToAsk);
```

Replace with:

```js
  wire("another", () => {
    stopSpeech(); S.messages = []; S.error = ""; S.speechError = "";
    S.intake = null; S.intakeEdit = false; S.hintTurns = 0; S.solved = false;
    render(); backToAsk();
  });
```

`render()` rebuilds `#body` and its children, so it must run before `backToAsk()` tries to find and
focus the `#ask` input in the freshly-rendered DOM — that ordering matters, keep `render()` first.

- [ ] **Step 3: Syntax check**

Run the same command as Task 2 Step 2. Expected: no output.

- [ ] **Step 4: Manual verification**

1. Open `mathwise.html` in a browser, get to the Questions tab.
2. In the console, simulate a finished dialogue:
   ```js
   S.messages.push({role:"user", content:"solve 3x=12", visible:true});
   S.messages.push({role:"assistant", content:"## Full solution\nDivide both sides by 3: x = 4."});
   S.hintTurns = 3; S.solved = true; render();
   ```
3. Confirm the answer bubble is visible on the page.
4. Click "Ask another question."
5. Confirm the thread/message bubbles disappear (back to the empty state), and in the console:
   ```js
   console.log(S.messages.length, S.hintTurns, S.solved);
   ```
   Expected: `0 0 false`.
6. Confirm the "Your question" input is focused (cursor visible in the box).

- [ ] **Step 5: Commit**

```bash
git add mathwise.html
git commit -m "Ask another question now starts a fresh dialogue"
```

---

## Task 6: Add the "Just show me the solution" button

**Files:**
- Modify: `mathwise.html:3233-3242` (the follow-up button row inside `renderQuestions()`)
- Modify: `mathwise.html:3268-3276` (the `wire(...)` calls in the same function)

**Interfaces:**
- Consumes: `S.hintTurns`, `S.solved` (Task 4), `JUST_SHOW_ME` (Task 3), `canFollowUp` (already
  computed at the top of `renderQuestions()`).
- Produces: a button with `id="justshow"`, present in the DOM only when
  `canFollowUp && S.hintTurns >= 2 && !S.solved`.

- [ ] **Step 1: Add the button to the row**

Find (currently lines 3233-3242):

```js
    ${canFollowUp ? `
      <div class="row" style="margin-bottom:16px">
        <button class="btn-primary" id="another">Ask another question</button>
        <button class="btn-secondary" id="explain">Explain differently</button>
        <button class="btn-secondary" id="simplify">Explain more simply</button>
        ${SPEECH_OK ? `<button class="btn-secondary" id="readit" ${S.speechBusy ? "disabled" : ""}>${
          S.speechBusy ? "Writing it out…" : (lastAnswer() && lastAnswer().spoken ? "Read it again" : "Read this to me")}</button>` : ""}
        <button class="btn-secondary" id="pdf">Save as PDF</button>
        <button class="btn-quiet" id="save">Copy as text</button>
      </div>` : ""}
```

Replace with:

```js
    ${canFollowUp ? `
      <div class="row" style="margin-bottom:16px">
        <button class="btn-primary" id="another">Ask another question</button>
        <button class="btn-secondary" id="explain">Explain differently</button>
        <button class="btn-secondary" id="simplify">Explain more simply</button>
        ${(S.hintTurns >= 2 && !S.solved) ? `<button class="btn-quiet" id="justshow">Just show me the solution</button>` : ""}
        ${SPEECH_OK ? `<button class="btn-secondary" id="readit" ${S.speechBusy ? "disabled" : ""}>${
          S.speechBusy ? "Writing it out…" : (lastAnswer() && lastAnswer().spoken ? "Read it again" : "Read this to me")}</button>` : ""}
        <button class="btn-secondary" id="pdf">Save as PDF</button>
        <button class="btn-quiet" id="save">Copy as text</button>
      </div>` : ""}
```

- [ ] **Step 2: Wire the button**

Find (currently lines 3269-3271):

```js
  wire("another", () => {
    stopSpeech(); S.messages = []; S.error = ""; S.speechError = "";
    S.intake = null; S.intakeEdit = false; S.hintTurns = 0; S.solved = false;
    render(); backToAsk();
  });
  wire("explain", () => submit(FOLLOW_UPS.explain, false));
  wire("simplify", () => submit(FOLLOW_UPS.simplify, false));
```

Replace with:

```js
  wire("another", () => {
    stopSpeech(); S.messages = []; S.error = ""; S.speechError = "";
    S.intake = null; S.intakeEdit = false; S.hintTurns = 0; S.solved = false;
    render(); backToAsk();
  });
  wire("explain", () => submit(FOLLOW_UPS.explain, false));
  wire("simplify", () => submit(FOLLOW_UPS.simplify, false));
  wire("justshow", () => submit(JUST_SHOW_ME, false));
```

- [ ] **Step 3: Syntax check**

Run the same command as Task 2 Step 2. Expected: no output.

- [ ] **Step 4: Manual verification**

1. Open `mathwise.html` in a browser, get to the Questions tab, ask any question so the thread is
   non-empty (typing something and hitting "Ask" is fine even though the live reply will fail
   without an API key — the button's visibility only depends on `S.hintTurns`/`S.solved`, not on a
   successful reply).
2. In the console:
   ```js
   S.messages.push({role:"assistant", content:"hint one"}); S.hintTurns = 1; S.solved = false; render();
   ```
   Confirm "Just show me the solution" is NOT present on the page.
3. ```js
   S.hintTurns = 2; render();
   ```
   Confirm "Just show me the solution" IS present.
4. ```js
   S.solved = true; render();
   ```
   Confirm it disappears again, and "Explain differently"/"Explain more simply"/"Read this to
   me"/"Save as PDF"/"Copy as text" are still present.
5. Click "Just show me the solution" while `S.hintTurns >= 2 && !S.solved` (repeat step 3's setup
   first) and confirm in the console that a new user message was appended:
   ```js
   console.log(S.messages[S.messages.length-1]);
   ```
   Expected: `{role:"user", content:"I'd like to see the full solution now, please, rather than another hint.", visible:false, shot:undefined}`
   (the actual reply will then fail with the "could not be reached" error, which is expected here —
   see Global Constraints — but the request being sent correctly is what this step confirms).
6. Confirm that message does NOT appear as a bubble in the visible thread (it's `visible:false`,
   same as the existing `explain`/`simplify` buttons).

- [ ] **Step 5: Commit**

```bash
git add mathwise.html
git commit -m "Add escape-hatch button to skip ahead to the full solution"
```

---

## Task 7: Update copy that promises an instant full answer

**Files:**
- Modify: `mathwise.html:3088-3090` (welcome screen pitch, inside `renderWelcome()`)
- Modify: `mathwise.html:3189-3191` (muted helper line, inside `renderQuestions()`)
- Modify: `mathwise.html:3211-3213` (empty-state card, inside `renderQuestions()`)

**Interfaces:** None — copy-only changes, no new state or functions.

- [ ] **Step 1: Update the welcome screen pitch**

Find (currently lines 3088-3090):

```js
        <p class="pitch">Stuck on a question? Type it, or take a photo of it. You get the
           working set out properly, a diagram when one helps, and the whole thing
           explained out loud — so you can listen while you write.</p>
```

Replace with:

```js
        <p class="pitch">Stuck on a question? Type it, or take a photo of it. MathWISE talks
           it through with you — a hint at a time, a diagram when one helps — until you've
           got there yourself, then sets out the full solution and reads it back to you.</p>
```

- [ ] **Step 2: Update the muted helper line above the composer**

Find (currently lines 3189-3191):

```js
      <p class="muted" style="margin:0">${c.key
        ? `Answers come back in ${esc(c.short)} notation, hint first.`
        : "Ask anything from Year 7 to Year 12. Set your course above if you want the notation to match it exactly."}</p>
```

Replace with:

```js
      <p class="muted" style="margin:0">${c.key
        ? `MathWISE will talk this through with you in ${esc(c.short)} notation, one hint at a time.`
        : "Ask anything from Year 7 to Year 12. Set your course above if you want the notation to match it exactly."}</p>
```

- [ ] **Step 3: Update the empty-state card**

Find (currently lines 3210-3213):

```js
      <div class="empty">
        <h4>What are you stuck on?</h4>
        <p style="margin:0">Type your question above, or upload a photo of it. Working,
           a diagram where one helps, and an explanation you can listen to.</p>
      </div>` : ""}
```

Replace with:

```js
      <div class="empty">
        <h4>What are you stuck on?</h4>
        <p style="margin:0">Type your question above, or upload a photo of it. MathWISE will
           ask you questions and give you hints — with a diagram where one helps — rather
           than just handing over the answer, until you've worked it out yourself.</p>
      </div>` : ""}
```

- [ ] **Step 4: Syntax check**

Run the same command as Task 2 Step 2. Expected: no output.

- [ ] **Step 5: Manual verification**

1. Open `mathwise.html` in a browser.
2. Confirm the welcome screen's pitch paragraph reads the new text.
3. Click "Get started," confirm the empty-state card under the composer reads the new text.
4. Pick a course from the dropdown, confirm the muted line above the composer updates to name
   that course and says "one hint at a time."
5. Clear the course selection, confirm the muted line falls back to the unchanged "Ask anything
   from Year 7 to Year 12..." text.

- [ ] **Step 6: Commit**

```bash
git add mathwise.html
git commit -m "Update Questions tab copy to describe the Socratic dialogue"
```

---

## Task 8: Full walkthrough against the spec's testing plan

**Files:** None modified — this task is verification only, using the browser and, where a real
reply is available (i.e. if the user has a working deployment with auth configured — see Global
Constraints), the live app.

**Interfaces:** None.

- [ ] **Step 1: Re-read the spec's testing checklist**

Open [docs/superpowers/specs/2026-09-08-socratic-questions-design.md](../specs/2026-09-08-socratic-questions-design.md)
and re-read the "Testing plan" section (8 items).

- [ ] **Step 2: Confirm items 1, 2, 3, 6 with simulated state**

These were already exercised individually in Tasks 4-6's manual verification steps. Re-run them
once more back-to-back in a single fresh page load to confirm nothing regressed when combined:
1. Load the page, start a question.
2. Simulate two hint turns (`S.hintTurns = 2`, push two assistant messages, `render()`), confirm
   the escape-hatch button appears.
3. Simulate a solved reply (`## Full solution` as the assistant content, `S.solved = true`,
   `render()`), confirm the button disappears.
4. Click "Ask another question," confirm the thread and counters reset.

- [ ] **Step 3: Confirm items 4, 5, 7 by reading the code path (no behavior changed there)**

- Item 4 (diagram on a hint turn): unchanged — `FIGURE_SPEC` and `markup()` render a ` ```figure `
  block anywhere in any assistant message, hint or solution alike. Confirm by reading
  `ANSWER_SHAPE` (Task 2) still says "using the diagram rules below" and `FIGURE_SPEC` is still
  joined into `system` in `submit()`.
- Item 5 (photographed questions): unchanged — confirm `renderIntake`'s submit path
  (`mathwise.html:3359` onward) still calls the same `submit()` function touched in Task 4.
- Item 7 (speech/PDF/copy still work): unchanged — confirm `speechPanel()`, `printTranscript()`,
  and `copyTranscript()` still read from `S.messages` / `lastAnswer()`, untouched by any task above.

- [ ] **Step 4: Confirm item 8 (copy)**

Already covered in Task 7 Step 5.

- [ ] **Step 5: Note what still needs a live check**

Record (in this session's summary to the user, not in a file) that everything above verifies the
client-side logic, wiring, and prompt content; it does not verify that Claude actually follows the
new `ANSWER_SHAPE` instructions turn-by-turn, since that requires a real API call this file cannot
make without the auth/proxy setup noted in `CLAUDE.md`. That last check can only happen once the
user tries it in whatever environment actually supplies credentials.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "Verify Socratic Questions tab end to end" --allow-empty
```

(`--allow-empty` is fine here since this task changes no files — it just marks the verification
pass in the history.)
