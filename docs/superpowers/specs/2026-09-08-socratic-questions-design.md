# Socratic Questions tab — design

Date: 2026-09-08
Status: approved by user, ready for implementation plan

## Problem

Today, the Questions tab in [mathwise.html](../../../mathwise.html) answers every question in one
shot: a short hint line followed immediately by the full worked solution (`ANSWER_SHAPE`,
[mathwise.html:945](../../../mathwise.html#L945)). A student can read the hint and the answer in
the same breath, so in practice they just read the answer.

We want MathWISE to walk the student through the question instead — asking guiding questions and
offering hints (and, where useful, a diagram) one turn at a time — and only write up the full
worked solution once the student has actually reached it themselves, or has explicitly asked to be
shown.

## Decisions made during brainstorming

1. The full solution is revealed once the student demonstrably gets there through the dialogue —
   not on a fixed schedule, and not hidden forever.
2. A "Just show me the solution" escape hatch appears after a couple of hint-turns, so a stuck or
   time-pressed student isn't trapped.
3. MathWISE decides on its own when a diagram would help as a hint, the same way it already decides
   for full answers — no separate trigger needed from the student.
4. Each question is its own fresh dialogue. "Ask another question" clears the thread rather than
   appending to one long-running conversation.

## Approach

**Keep the existing chat plumbing; change the instructions and add a small amount of turn-tracking
state.** The app already sends the full message history to Claude on every turn
(`submit()`, [mathwise.html:3314](../../../mathwise.html#L3314)) and already renders whatever
markdown + inline figure/table blocks come back (`markup()`). A genuine back-and-forth dialogue
does not need new plumbing — a student typing a reply into the existing composer and hitting "Ask"
already appends to `S.messages` and gets a fresh reply with full context.

An alternative considered and rejected: have Claude return a structured JSON envelope per turn
(`{stage, message, figure}`) instead of markdown text, giving the client an authoritative turn type
instead of inferring it. Rejected because it would require reworking rendering, PDF/copy/transcript
generation, and figure embedding (all of which currently assume free-form markdown text with inline
` ```figure ` blocks) for a benefit — precise turn typing — that a single fixed heading marker gets
almost for free.

## Changes

### 1. Prompt — replace `ANSWER_SHAPE`

Location: [mathwise.html:945](../../../mathwise.html#L945).

Today `ANSWER_SHAPE` instructs Claude to always answer with a short hint followed immediately by
the full answer. It's replaced with instructions to:

- Never give the full worked solution up front.
- Each turn, respond to what the student has just said: ask one guiding question, or give one small
  hint, that moves them one step closer without doing the step for them. A diagram may replace or
  accompany the hint wherever it would carry the idea better than words (reusing the existing
  `FIGURE_SPEC` conventions unchanged).
- Watch the conversation for the student reaching the method or the answer themselves. When that
  happens — or when the student directly asks to be shown — respond with the full worked solution,
  written up cleanly (one step per line, ending with the answer stated plainly), and start that
  message with a fixed heading, exactly `## Full solution`, as the first line. This heading is the
  signal the app looks for (see State, below); it must appear only on this final message, never on
  a hint.
- Keep tone matching the rest of the app's `HOUSE_RULES` (a tutor who leaves the student able to do
  the next one themselves).

`FIGURE_SPEC`, `TABLE_SPEC`, and `HOUSE_RULES` are unchanged and continue to compose with this new
prompt exactly as they do today.

### 2. New canned message for the escape hatch

A new constant, alongside `FOLLOW_UPS` ([mathwise.html:957](../../../mathwise.html#L957)):

```js
const JUST_SHOW_ME = "I'd like to see the full solution now, please, rather than another hint.";
```

Sent the same way the existing `FOLLOW_UPS.explain`/`simplify` canned prompts are sent — as an
invisible user turn (`submit(JUST_SHOW_ME, false)`) so it doesn't clutter the visible transcript,
but the model still sees it and responds with the `## Full solution` wrap-up.

### 3. State — turn counter and solved flag

In `S` ([mathwise.html:1092](../../../mathwise.html#L1092)):

- `S.hintTurns` — number of assistant replies received for the current question's dialogue.
  Incremented each time an assistant reply arrives. The composer is used both to ask a first
  question and to send the student's replies within that dialogue — `submit()` cannot reliably
  tell those apart from the text alone — so the counter is reset only at explicit thread
  boundaries: the "Clear" button and the "Ask another question" button (see item 4), not inside
  `submit()` itself.
- `S.solved` — `true` once the most recent assistant reply starts with the `## Full solution`
  heading; `false` otherwise. Recomputed each time a reply is appended, by checking the reply text
  with a simple regex (`/^##\s*Full solution/i` against the trimmed reply) — no JSON parsing, no
  change to how replies are stored (`m.content` stays plain markdown text, exactly as today).

### 4. "Ask another question" clears the thread

`backToAsk()` ([mathwise.html:3286](../../../mathwise.html#L3286)) currently only scrolls/focuses
the input. The "another" button's handler changes to also reset the dialogue: clear `S.messages`,
`S.hintTurns`, `S.solved`, and the same error/intake fields `Clear` already resets
([mathwise.html:3249](../../../mathwise.html#L3249)), then scroll/focus as before. This matches
decision 4 above — each question starts clean.

### 5. UI — the escape hatch button

In `renderQuestions()` ([mathwise.html:3181](../../../mathwise.html#L3181)), alongside the existing
follow-up row (`another`/`explain`/`simplify`/`readit`/`pdf`/`save`,
[mathwise.html:3233](../../../mathwise.html#L3233)):

- Add a "Just show me the solution" button, shown when `canFollowUp && S.hintTurns >= 2 &&
  !S.solved`.
- Wire it to `submit(JUST_SHOW_ME, false)`.
- The `explain`/`simplify` buttons stay, but their canned prompt text
  ([mathwise.html:958-959](../../../mathwise.html#L958)) is reworded from "explain your last
  answer" to "explain that hint"/"say that hint more simply", since there may not be a full answer
  yet to refer to.
- Once `S.solved` is `true`, the escape-hatch button no longer shows (there's nothing left to skip
  to) — the row keeps `explain`/`simplify`/`readit`/`pdf`/`save` as before, since those remain
  useful against the final wrap-up.

### 6. Copy tweaks

- The muted helper line above the composer
  ([mathwise.html:3189-3191](../../../mathwise.html#L3189)) currently says answers "come back...
  hint first." It changes to something like "MathWISE will talk it through with you rather than
  hand over the answer — type back what you think and it'll take it from there."
- The empty-state card ([mathwise.html:3209-3214](../../../mathwise.html#L3209)) and the welcome
  screen's pitch paragraph ([mathwise.html:3088-3090](../../../mathwise.html#L3088)) both currently
  promise the working "set out properly" immediately; both get a small wording pass so they
  describe a back-and-forth rather than an instant full answer.

### Unchanged

- Photographed-question intake ([mathwise.html:3359](../../../mathwise.html#L3359) onward) — it
  feeds into the same `submit()` call, so it automatically becomes Socratic too, with no code
  changes needed there.
- Speech (`SPOKEN_SYSTEM`), PDF export (`saveAsPdf`/`printTranscript`), and copy-as-text
  (`copyTranscript`) — all operate on `S.messages` / the latest assistant message exactly as today;
  a hint-turn or a full solution are both just markdown text to them.
- The expression engine, figure renderers, maths keyboard, Study Skills tab, Study Tools tab.

## Testing plan

There is no automated test suite or build step for this project (see [CLAUDE.md](../../../CLAUDE.md)).
Verification is manual, in a browser, covering:

1. Ask a typed question → confirm the first reply is a hint/guiding question, not a full solution.
2. Reply a couple of times, working toward the answer → confirm the escape-hatch button appears
   after the second hint-turn, and confirm the final reply (once the student gets there) is a clean
   full solution and the escape-hatch button disappears.
3. Click "Just show me the solution" partway through → confirm the full solution is produced and
   the invisible prompt doesn't appear in the transcript, PDF, or copy-as-text output.
4. Ask a question that should trigger a diagram hint (e.g. a Year 8 linear equation) → confirm a
   diagram can appear on a hint turn, not just on the final solution.
5. Photograph a question via the camera/upload intake → confirm it also goes through the Socratic
   flow.
6. Finish a dialogue, click "Ask another question" → confirm the thread clears and a new question
   starts with a fresh hint-turn counter.
7. Read-aloud, Save as PDF, Copy as text → confirm each still works, both mid-dialogue and after the
   full solution.
8. Check the updated wording on the Questions tab empty state and the welcome screen pitch reads
   naturally and doesn't overpromise an instant answer.

## Open items for the implementation plan

None — this spec is self-contained and ready to hand to `writing-plans`.
