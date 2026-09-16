# Editable network check for photographed network questions — Design

> **Revision (2026-09-15, after real-world testing):** the first shipped version used a plain
> list-based editor (a `<select>` dropdown pair, weight input, and directed checkbox per edge row)
> and explicitly excluded vertex dragging as a non-goal — see below. Ryan tested it against a real
> photo and found the extraction noticeably inaccurate and the list editor "very clunky," and asked
> for direct manipulation on the diagram itself instead: drag a vertex to reposition it, click a
> label or weight to edit it in place, "+ Add vertex" then click-to-place, click-to-select with a
> small × badge to delete. This reverses the "no dragging" non-goal below — position now matters
> because it's how the student visually confirms the diagram matches their photo, and correcting a
> "vertex placed wrong" is exactly what dragging is for. The rest of this document describes the
> original (superseded) design; the actual shipped interaction model is the canvas-based one
> described in the commit that replaced it (`c2c3631`) and in
> `project_mathwise_editable_network_intake.md` (Claude's memory file for this feature) — kept here
> rather than rewritten, as the historical record of what changed and why.

## Goal

When a student photographs a network/graph-theory question, MathWISE's OCR step already
transcribes the question's text but has no way to represent the graph itself (vertices, edges,
weights) — any misread number or vertex only surfaces later, buried in a wrong final answer, with
no way for the student to fix it. This adds an editable diagram check, between the photo and the
answer, so the student can see the graph MathWISE extracted and correct any vertex label or edge
(including adding/removing a vertex or edge the photo-reading missed) before the question is
answered.

## Non-goals

- Dragging vertices to reposition them for a tidier layout. The existing `FIG.network` auto-layout
  (equally spaced around a circle when no `x`/`y` is given) is good enough for a correctness check —
  this feature is about fixing wrong *values*, not drawing a pretty picture.
- Editing anything about a non-network photographed question. This only activates when OCR itself
  flags the photo as a network question.
- A second, dedicated API call purely for graph extraction (Approach B, considered and rejected —
  see "Alternatives considered" below).

## Current relevant state (as of this design)

- `OCR_SYSTEM` (mathwise.html, ~line 1457) already returns `is_network: true|false` in its JSON
  reply, but nothing in the app currently reads that field — it's dead data today.
- `renderIntake()` (~line 6588) shows the photo, the transcribed `tx.full_question` (rendered via
  `markup()`), an optional "Correct the wording" textarea, and three buttons: "Yes, answer it"
  (`useIt`), "Something's wrong" (`fix`, toggles the textarea), "Another photo" (`again`).
- `useIt`'s click handler calls `submit(v, true, shot, image)` where `v` is the (possibly edited)
  question text and `shot`/`image` are the original photo, sent alongside so Claude can still see
  anything purely graphical.
- `submit(text, visible, shot, image, apiText)` (~line 6514) already supports an `apiText` parameter
  that lets what's actually sent to Claude differ from what's shown in the student's own chat
  transcript — used today so a typed "just check my working" attempt doesn't get a Claude-only
  instruction glued onto it, without cluttering the student's exported/copied transcript.
- `FIG.network` (~line 2618) takes `vertices:[{id,label,x,y}]` and `edges:[{from,to,weight,directed}]`
  — `x`/`y` are optional (defaults to an even circular spread), and edges reference vertices purely
  by `id` (`at(id) => vs.find(v => v.id === String(id))`), never by `label`, so a vertex's display
  label and its identity are already decoupled inside `FIG.network` itself.
- `renderFigure(spec)` (~line 5001) wraps `FIG[spec.type](spec)` in a try/catch and returns safe
  HTML, used everywhere a figure needs to be drawn from a spec object.

## Data model

`OCR_SYSTEM`'s JSON gains one new optional field, populated only when `is_network` is true:

```
"network": {
  "vertices": [{ "id": "v0", "label": "A" }, ...],
  "edges": [{ "from": "v0", "to": "v1", "weight": 5, "directed": false }, ...]
}
```

- `id` is a stable, OCR-assigned identifier (`v0`, `v1`, ...), never shown to the student and never
  edited. `label` is the human-readable name (normally a single letter, matching the photo) and is
  the only vertex field the student edits directly.
- `weight` is optional — omitted or `null`/`""` for an unweighted graph/edge (e.g. a "is this graph
  connected" or "find an Eulerian trail" question that has no weights to read at all).
- `directed` is optional, defaults to falsy (undirected).
- This mirrors `FIG.network`'s own spec shape closely on purpose, so the editor's live preview is a
  direct `renderFigure({ type:"network", vertices, edges })` call with no translation layer.

`S.intake.tx.network` is mutated in place by the editor (same convention as the existing
`S.intake.tx.full_question` textarea), so no separate "draft" copy is kept alongside the OCR's own
answer — matching how the existing text-correction box already works.

## UI behaviour

A new panel appears inside the existing intake-review screen (`renderIntake()`'s third branch,
where `S.intake` is already set), directly below the current photo/text/buttons block, but only
when `tx.is_network` is true AND `tx.network` has at least one vertex (see "Fallback" below).

Panel contents, top to bottom:

1. A short static instruction: "Check this matches the graph in your photo — labels, connections
   and weights all matter. Fix, add or remove anything that's wrong before continuing."
2. The live diagram: `renderFigure({ type:"network", vertices: tx.network.vertices, edges:
   tx.network.edges })`, redrawn (only this sub-container's `innerHTML`, not the whole panel)
   whenever the underlying data changes.
3. A "Vertices" list: one row per vertex — a text `<input>` bound to `vertex.label`, plus a small
   "remove" button. Below the list, "+ Add vertex" appends a new vertex with the next unused letter
   (A, B, C, ... falling back to A2, B2, ... once past Z) and a freshly generated `id`.
4. An "Edges" list: one row per edge — two `<select>` dropdowns (options are every current vertex,
   value = `id`, display text = current `label`), a number `<input>` for weight (optional, can be
   left blank), a "directed" checkbox, and a "remove" button. Below the list, "+ Add edge" appends a
   new edge defaulting to the first two vertices (disabled/hidden if fewer than 2 vertices exist).

Editing behaviour, to avoid losing keyboard focus mid-edit (a real risk in this app's
rebuild-innerHTML-from-scratch rendering style):

- Typing in a vertex's label `<input>` or an edge's weight `<input>` only (a) writes the new value
  into `tx.network` and (b) repaints the diagram preview sub-container. It never rebuilds the input
  rows themselves, so the input never loses focus or cursor position while the student is typing —
  exactly the same pattern the existing "Correct the wording" textarea already uses (its `oninput`
  updates state and repaints only the separate `readout` div, never itself).
- Renaming a vertex additionally walks every edge `<select>`'s `<option>` elements for that vertex's
  `id` and updates their `textContent` directly (a plain DOM write, not an innerHTML rebuild) so the
  dropdowns reflect the new name immediately without disturbing the currently-open/focused control.
- Clicking "+ Add vertex", "+ Add edge", or a "remove" button is a deliberate discrete action, not a
  keystroke — these DO rebuild the full vertex/edge row lists (and the diagram), since the available
  dropdown options themselves have changed.
- Removing a vertex also removes any edge that references it (filtered out of `tx.network.edges`).

## Data flow to the answer

`useIt`'s click handler is extended: if `tx.is_network && tx.network` and it has at least one
vertex, build a plain-text "confirmed network" block from the (possibly edited) `tx.network`, e.g.:

```
Confirmed network — use exactly this, not the diagram in the photo:
Vertices: A, B, C, D.
Edges: A-B (weight 5), B-C (weight 3), A-D (weight 7, directed).
```

An edge with no weight is listed without a "(weight ...)" clause; a directed edge appends
", directed" before its closing bracket. This text is passed as the `apiText` parameter to
`submit(v, true, shot, image, apiText)`, where `apiText = v + "\n\n" + networkBlock` — the student's
own chat bubble and exported transcript still show only their normal question text (`v`), while
Claude additionally receives the confirmed graph as authoritative data. The original photo is still
attached exactly as it is today, so Claude can still read anything else it needs from it
(surrounding prose, a diagram style cue) — only the vertex/edge/weight values themselves are meant
to be taken from the confirmed block instead of re-read from the image.

If `tx.network` is missing, empty, or the panel never appeared, `useIt` behaves exactly as it does
today (no `apiText`, `submit(v, true, shot, image)`), so a non-network question is entirely
unaffected.

## Fallback / error handling

- If OCR sets `is_network: true` but returns no usable `network.vertices` (extraction failed even
  though it recognised the photo as a graph), the new panel does not render at all — the student
  falls back to the existing plain-text "Something's wrong" box, unchanged from today.
- A blank/duplicate vertex label is allowed without validation — this is a working, will-fix-before-
  submit editor, not a form with persisted constraints elsewhere; blocking on it would only add
  friction while the student is mid-edit.
- "+ Add edge" is disabled (with a title tooltip explaining why) whenever fewer than 2 vertices
  exist, since an edge needs two distinct endpoints.

## Alternatives considered

- **A second, dedicated API call for graph extraction (Approach B).** Rejected: doubles latency and
  API cost on every network photo, with no clear accuracy argument over extracting it in the same
  pass — the existing OCR call already has to look at and describe the same image today
  (`diagram_description`). Revisit only if real-world testing shows the combined extraction is
  meaningfully less accurate than a dedicated pass would be.
- **Extend the existing free-text box only, no diagram (Approach C).** Rejected: doesn't meet the
  actual need — visually cross-checking a diagram against a photographed diagram is what makes a
  misread number/vertex easy to spot; a text list of edges is much harder to verify at a glance.

## Testing

- `node --check` on the extracted `<script>` body, as with every other change to this file.
- A standalone, DOM-independent function (e.g. `networkConfirmText(network)`) builds the "confirmed
  network" text block from a `{vertices, edges}` object — tested directly in a Node harness with a
  handful of representative cases: a weighted undirected graph, a mix of weighted/unweighted edges,
  a directed edge, and the empty/degenerate case (no vertices → empty string, so `useIt` skips
  appending anything).
- Re-verify (already covered by this session's earlier `FIG.network` work, but re-check here) that
  `FIG.network` renders correctly when `id` and `label` differ, since the new editor always keeps
  them distinct — `FIG.network`'s own `at()` lookup already keys strictly off `id`, so this should
  need no change to `FIG.network` itself, only confirmation.
- This is a real interactive UI feature and this environment has no working browser-automation tool
  available this session (the `chrome-devtools` MCP server failed to connect) — the actual click-
  through (take/upload a photo of a network question, edit a label/weight, add/remove a vertex,
  confirm the diagram updates live, submit, and confirm the sent text carries the confirmed block)
  needs to be done by hand in a real browser before this is trusted, and that will be said plainly
  rather than implied as tested.
