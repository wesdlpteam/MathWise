# Interactive Kruskal's/Prim's algorithm exercise — Design

## Goal

For a photographed network question that asks the student to apply Kruskal's or Prim's algorithm
to find a minimum spanning tree, MathWISE currently answers the same way it answers everything
else: a text-based, back-and-forth Socratic chat. That's a poor match for an algorithm whose whole
point is a sequence of concrete, checkable choices ("which edge next?"). This adds an interactive
exercise, built on the same diagram the student already confirmed via the editable-network-check
feature: the student clicks the edge they think the algorithm should pick next, MathWISE validates
it against the actual algorithm's rule (accounting for ties — there is often more than one
correct next edge), highlights an accepted edge in red the way the source textbooks themselves do,
and keeps a running total weight, until the spanning tree is complete.

## Non-goals (this round)

- Dijkstra's shortest-path algorithm, or any other network algorithm. It has a materially
  different interaction (assign and update a running distance at each vertex, circle a vertex once
  its distance is finalised — no edge-by-edge picking), so it is a distinct exercise to design
  later, not an extension of this one.
- Typed (non-photographed) network questions. This only activates on the data already produced by
  the photo-intake → editable-network-check flow; a typed-only network question keeps getting
  today's normal chat answer. Extending this to typed questions would require teaching Claude's
  normal answer step to also emit structured network data, which is out of scope here.
- Directed graphs. Kruskal's and Prim's are minimum-spanning-tree algorithms over an undirected
  weighted graph — this exercise assumes every edge is undirected, matching how every such question
  in the source textbooks is actually posed. If OCR ever marks an edge `directed:true` on a graph
  otherwise flagged for this exercise, that's treated as bad input (see Fallback below), not
  something this exercise tries to make sense of.
- Any LLM call during the exercise itself. Every validity check and every piece of feedback text is
  plain, deterministic JavaScript — see "Why no Claude calls" below.

## Current relevant state (as of this design)

- `OCR_SYSTEM` (mathwise.html) already classifies a photographed network question via `is_network`
  and extracts its structure via `network: {vertices, edges}` (added in the editable-network-check
  feature this session). Nothing in the app yet reads the question's own instruction wording to
  detect WHICH algorithm, if any, it's asking about.
- `renderNetworkPanel()`/`renderIntake()`'s `useIt` button currently always ends the same way:
  build `apiText` from `networkConfirmText(...)` and call `submit(v, true, shot, image, apiText)`,
  which starts the normal Socratic chat flow (a Claude API call for the first hint).
- `S.messages` is the single source of truth for the whole visible conversation — `transcriptText()`/
  `transcriptHtml()` (used by PDF export and copy-as-text) just render whatever is in it. Anything
  this exercise produces needs to end up recorded there to stay consistent with every other part of
  the app that assumes `S.messages` is complete.
- The interactive canvas built for the editable-network-check (`renderNetworkPanel`, `netToDataCoords`,
  the `X`/`Y` coordinate helpers, the `foreignObject`-based label/weight rendering technique) is reused
  for its coordinate math and rendering technique, but not its code directly — that renderer is
  drag-and-edit; this exercise needs a distinct, simpler click-only, read-only-position renderer (see
  "UI" below).

## Why no Claude calls for validation

Kruskal's and Prim's both have an objectively computable correct answer (or set of tied-correct
answers) at every step. A hand-written checker is instant, free, and cannot be wrong the way a model
judgment call occasionally can be on a well-defined deterministic task — and, as a pure function of
plain data, it's directly unit-testable in a Node harness with no browser needed at all, unlike most
of this session's other UI work. This is the same reasoning that ruled out "Approach B" (ask Claude
to judge each click) and "Approach C" (deterministic pass/fail, but Claude phrases the feedback) when
presented to Ryan — a small, fixed set of canned feedback messages fully covers the possible reasons
a click is wrong, with no need to spend a round-trip generating prose for something this templated.

## Data model

### OCR schema addition

`OCR_SYSTEM`'s JSON gains one more optional field, read from the question's own wording, alongside
the existing `is_network`/`network`:

```
"network_algorithm": "kruskal" | "prim" | null
```

Rule added to the prompt: set this to `"kruskal"` or `"prim"` only when the question's own text
explicitly asks to apply that named algorithm (e.g. "Apply Kruskal's algorithm..."); leave it `null`
for every other network question (shortest path by inspection, Euler's formula, walks/trails,
Hamiltonian paths, Dijkstra's, or a network question with no named-algorithm instruction at all).

### Exercise state

A new top-level state object, set up when the exercise starts and cleared when it ends:

```
S.mst = {
  algorithm: "kruskal" | "prim",
  network: { vertices, edges },   // the SAME (already-confirmed, already-positioned) object
  startVertex: "v0" | null,        // Prim's only — the alphabetically-first vertex's id
  chosen: [edgeIndex, ...],        // accepted edges, in the order they were accepted
  feedback: { kind:"error"|"hint"|"step", text } | null,
  done: false
}
```

`S.mst.network` is the exact same object reference that came out of the editable-network-check
step — by this point it's already been confirmed by the student, so this exercise never edits it
further, only reads vertex positions (for drawing) and edge weights (for validation).

## The algorithm engine

Two pure functions, each taking the network and the edges chosen so far, and returning which edge
indices are currently valid to click plus (for the eventual "show me this step" / hint path) a short
plain-language reason for why:

```
kruskalValidChoices(network, chosenIdx) → { valid: Set<edgeIdx>, reasonFor(edgeIdx) → string|null }
primValidChoices(network, chosenIdx, startVertexId) → { valid: Set<edgeIdx>, reasonFor(edgeIdx) → string|null }
```

**Kruskal's rule.** Track connectivity of the chosen edges so far with a union-find (disjoint-set)
structure over the vertices. An edge is a legal next choice if and only if: (a) it is not already
chosen, (b) its two endpoints are in different components (adding it would not close a cycle), and
(c) no OTHER edge satisfying (a) and (b) has a strictly smaller weight. Ties (multiple edges sharing
the minimum weight among non-cycle-forming, unchosen edges) are all simultaneously valid.

For a clicked edge that fails this: if it would close a cycle (same component as both endpoints),
the reason is "That edge would create a cycle — its two vertices are already connected through
edges you've already chosen." Otherwise (it's a legal, non-cycle edge, just not the cheapest one
available), the reason is "There's a cheaper edge available that doesn't create a cycle — look for
the smallest weight you haven't used yet."

**Prim's rule.** Track the growing tree's vertex set, starting as `{startVertex}` (see below). An
edge is a legal next choice if and only if: (a) it is not already chosen, (b) exactly one of its two
endpoints is already in the tree (a "frontier" edge), and (c) no other frontier edge has a strictly
smaller weight. Ties are all simultaneously valid, same as Kruskal's.

For a clicked edge that fails this: if NEITHER endpoint is in the tree yet, the reason is "That edge
doesn't connect to your tree yet — pick one with at least one end already included." If BOTH
endpoints are already in the tree, the reason is "Both ends of that edge are already in your tree —
adding it would create a cycle." Otherwise (a legal frontier edge, just not the cheapest), the
reason is the same "there's a cheaper edge available" message as Kruskal's.

**Choosing Prim's start vertex.** The textbooks' own worked examples don't ask the student to pick a
start vertex — they always just begin from one (conventionally the first one shown). This exercise
does the same: `startVertex` is the alphabetically-first vertex's id (`net.vertices` sorted by
`label`, take the first) unless the transcribed question text names a specific starting vertex, in
which case that one is used instead. (Detecting a named starting vertex from `full_question` is a
simple substring check — "starting at C", "start from vertex C", etc. — good enough for how these
questions are actually phrased; it doesn't need to be exhaustive, since defaulting to the
alphabetically-first vertex is a reasonable fallback either way.)

**Completion.** The tree is complete once `chosen.length === network.vertices.length - 1` — a
spanning tree on `n` vertices always has exactly `n-1` edges, and since every accepted edge was, by
construction, never cycle-forming, reaching that count guarantees every vertex is connected.

## UI

A new render function, `renderMstExercise()`, replaces the normal chat composer for as long as
`S.mst` is set (checked at the top of `renderQuestions()`, the same way it already checks
`S.intake`/`S.attemptPrompt` for other alternate screens).

Layout: a heading naming the algorithm ("Applying Kruskal's algorithm"), the diagram, a running
"Total weight so far: N" line, the feedback line (error/hint/step message, or blank), and a small
button row ("Hint", "I'm stuck — show me this step").

The diagram itself is a new, simpler renderer than `renderNetworkPanel`'s editable one — vertices
and edges are drawn at their already-confirmed positions (read from `network.vertices[].x/y`, no
auto-layout needed since this only ever runs after the network has already been through the
edit-and-confirm step), nothing is draggable or editable, and:
- An edge not yet chosen is a plain line with its weight as plain (non-editable) text.
- An accepted edge (`chosen.includes(i)`) is drawn thicker and in red, matching the textbook's own
  "draw it in red" convention, with its weight text also in red.
- Clicking an unchosen edge calls the current algorithm's validator:
  - Valid → push its index onto `chosen`, clear `feedback`, check completion, repaint.
  - Invalid → set `feedback = { kind:"error", text: <the specific reason> }`, repaint (nothing is
    added to `chosen`).
- Clicking an already-chosen edge, or clicking a vertex, does nothing.

**Hint button.** Computes the current valid set and highlights those specific edges (a subtle glow,
distinct from the red "already chosen" styling) without changing `chosen` — the student still has to
click one themselves.

**"I'm stuck — show me this step" button.** Picks one edge from the current valid set (the first, in
`network.edges` array order, for determinism), adds it to `chosen` exactly as a correct click would,
and sets `feedback = { kind:"step", text: <why this specific edge, e.g. "F-E has weight 2, the
smallest available that doesn't create a cycle, so it's added next."> }`. This is a per-step escape
valve, not a whole-exercise skip — a student who keeps pressing it simply gets the whole tree built
for them one explained step at a time, which is an acceptable way to "give up" without needing a
second, separate skip-everything control.

## Completion and hand-back to the normal chat

Once `chosen.length === network.vertices.length - 1`, the exercise ends: `S.mst.done = true`, and a
normal user/assistant message PAIR is appended to `S.messages` — the SAME array the rest of the app
already treats as the complete record — so PDF export and copy-as-text need no changes:

- **User message** (`visible: true`): the original confirmed question text, exactly as it would
  have been sent to `submit()` in the non-exercise path (this is what the student "asked").
- **Assistant message**: a plain-text summary built from `chosen`, e.g. "Applying Kruskal's
  algorithm: A-B (2), E-F (2), C-D (3), A-D (5), C-E (5) — total weight 17." in the order the edges
  were actually accepted (whether by the student's own correct clicks or the "show me this step"
  button), followed by a one-line reminder of which weren't chosen this way if any were auto-picked
  (e.g. "You worked out 3 of these 5 edges yourself; MathWISE filled in the rest.") — the honesty
  here matters: the transcript should not silently claim full-credit for steps the student didn't
  actually pick themselves.

After this, `S.mst = null` and `renderQuestions()` returns to its normal chat view, with the
completed exercise now sitting in the message history — a follow-up typed question continues the
conversation exactly as it would after any other answer.

## Fallback / error handling

- If OCR sets `network_algorithm` but the network is missing an edge weight (`weight` blank/absent
  on any edge) — Kruskal's/Prim's are meaningless without complete weights — the exercise does not
  start; `useIt` falls back to the existing `submit(...)` chat path exactly as it does today for
  every other network question. This check happens once, at the moment `useIt` is clicked.
- If OCR sets `network_algorithm` on a graph with any `directed:true` edge, or with fewer than 2
  vertices, or where (in the pathological case) no valid completion is reachable — same fallback:
  don't start the exercise, use the normal chat path. A minimum-spanning-tree exercise that can't
  actually be completed is worse than just answering the question normally.

## Testing

- `node --check` on the extracted `<script>` body, as with every change to this file.
- `kruskalValidChoices`/`primValidChoices` are pure functions — unit-tested directly in a Node
  harness against several small, worked example graphs (including at least one genuine tie, since
  that's the case most likely to have an off-by-one edge case): confirm the returned valid set
  matches hand-worked expectations at each step of a full run-through, confirm the specific
  wrong-reason text differs correctly between "would create a cycle" and "cheaper edge available"
  (and, for Prim's, "doesn't touch the tree yet"), and confirm the completed edge set's total weight
  matches the known correct MST weight for that test graph.
- The OCR schema addition is checked the same way `network`'s addition was: extract `OCR_SYSTEM` and
  assert it mentions `network_algorithm` and explains when to set it.
- As with the editable-network-check and its canvas rebuild, the actual click-through UI
  (`renderMstExercise`, the Hint/step buttons, the red-highlight styling) cannot be exercised without
  a real browser, which remains unavailable in this environment — this needs Ryan's own hands-on
  test on a real photographed Kruskal's/Prim's question before it's trusted end-to-end. What CAN and
  will be fully verified without a browser is the algorithm engine itself, which is where an actual
  correctness bug would be most damaging (silently accepting a wrong edge, or rejecting a correct one).
