# Editable Network Check for Photographed Network Questions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a student photographs a network/graph-theory question, show them an editable
version of the graph MathWISE read from the photo (vertices, edges, weights) so they can fix any
misread value before the question is answered.

**Architecture:** Extend the existing single OCR call's JSON schema with an optional `network`
field; add a small editable vertex/edge list UI to the existing photo-intake review screen, reusing
the existing `FIG.network` renderer for the live preview; at submit time, convert the (possibly
edited) network into a short authoritative text block sent to Claude via the existing
`apiText`-vs-`text` split, so the student's own confirmation overrides anything Claude might
otherwise re-read from the photo.

**Tech Stack:** Plain JS in a single `<script>` block inside `mathwise.html` (no framework, no
build step, hand-rolled `innerHTML` templates). Verification is `node --check` for syntax plus
ad hoc Node harness scripts (extract the `<script>` body, stub `window`/`document` with a `Proxy`,
`module.exports` the functions under test) — this repo has no pytest/jest-style test runner.

**Spec:** `docs/superpowers/specs/2026-09-15-editable-network-intake-design.md`

## Global Constraints

- Never mention or suggest a Casio ClassPad, or use anything CAS-specific outside this feature's
  own scope — not touched by this plan, noted only because it's a standing rule for this file.
- No new external dependencies (CDN or otherwise) — everything here is built from the app's own
  existing helpers (`esc`, `markup`, `renderFigure`, `FIG.network`).
- `S.intake.tx.network` is mutated in place (never a separate draft copy), matching how
  `S.intake.tx.full_question` already works.
- A vertex's stable `id` (assigned once, `v0`/`v1`/...) is never shown to the student and never
  edited; only its `label` is user-facing and editable. Edges always reference vertices by `id`.
- The new panel must not appear, and must not change existing behaviour at all, for a non-network
  question (`tx.is_network` falsy) or when `tx.network` has no vertices.
- This is a real interactive browser feature and this environment has no working browser-automation
  tool this session — say so plainly when reporting on Task 3's manual-check step rather than
  implying it was clicked through.

---

### Task 1: Extend `OCR_SYSTEM`'s JSON schema with a `network` field

**Files:**
- Modify: `mathwise.html:1457-1474` (`OCR_SYSTEM` constant)

**Interfaces:**
- Produces: the OCR JSON reply gains an optional `network` field, shape
  `{ vertices: [{id, label}], edges: [{from, to, weight, directed}] }`, populated only when
  `is_network` is true. Task 2 and Task 3 consume this exact shape.

- [x] **Step 1: Read the current constant for exact context**

`mathwise.html:1457-1474` currently reads:

```js
const OCR_SYSTEM = `You transcribe photographs of mathematics for a school study app. You do not solve anything. You read what is on the page.

Return one JSON object and nothing else. No commentary, no code fences.

{
  "full_question": "the complete question with the mathematics inline in LaTeX, using $...$ delimiters",
  "has_diagram": true or false,
  "diagram_description": "what the diagram shows, or an empty string",
  "is_network": true or false,
  "confidence": "high" or "medium" or "low",
  "unclear": ["anything you could not read with certainty"]
}

Rules:
- Transcribe exactly what is written. Do not correct the mathematics, tidy it up, or fill in anything that is missing.
- If a character is ambiguous, transcribe your best reading and list it in "unclear". Ambiguous digits, signs and indices matter more than anything else here.
- Set "is_network" to true only for a graph of vertices joined by edges.
- Set "confidence" to low if the image is blurred, cropped, at a steep angle, or if handwriting is hard to read. Say so rather than guessing.`;
```

- [x] **Step 2: Add the `network` field and its rule**

Edit it to:

```js
const OCR_SYSTEM = `You transcribe photographs of mathematics for a school study app. You do not solve anything. You read what is on the page.

Return one JSON object and nothing else. No commentary, no code fences.

{
  "full_question": "the complete question with the mathematics inline in LaTeX, using $...$ delimiters",
  "has_diagram": true or false,
  "diagram_description": "what the diagram shows, or an empty string",
  "is_network": true or false,
  "network": { "vertices": [{"id":"v0","label":"A"}], "edges": [{"from":"v0","to":"v1","weight":5,"directed":false}] },
  "confidence": "high" or "medium" or "low",
  "unclear": ["anything you could not read with certainty"]
}

Rules:
- Transcribe exactly what is written. Do not correct the mathematics, tidy it up, or fill in anything that is missing.
- If a character is ambiguous, transcribe your best reading and list it in "unclear". Ambiguous digits, signs and indices matter more than anything else here.
- Set "is_network" to true only for a graph of vertices joined by edges.
- When "is_network" is true, also fill in "network": one entry in "vertices" per vertex shown (id is your own short internal label like "v0", "v1"; label is the letter/name written on the vertex in the photo), one entry in "edges" per edge drawn, "from"/"to" using those same ids. Give "weight" only if a number is actually written on that edge — omit it entirely for an unweighted edge, never invent one. Set "directed" to true only if that edge is drawn with an arrowhead. Leave "network" out entirely (or empty) when "is_network" is false.
- Set "confidence" to low if the image is blurred, cropped, at a steep angle, or if handwriting is hard to read. Say so rather than guessing.`;
```

- [x] **Step 3: Verify syntax**

Run:
```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('mathwise.html', 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
fs.writeFileSync('/tmp/mw_check.js', m[1]);
"
node --check /tmp/mw_check.js
```
Expected: no output (syntax OK).

- [x] **Step 4: Verify content**

Run (same extracted file, adding an export line first):
```bash
node -e "
const fs = require('fs');
let src = fs.readFileSync('/tmp/mw_check.js', 'utf8');
fs.writeFileSync('/tmp/mw_check2.js', src + '\nmodule.exports = { OCR_SYSTEM };');
const { OCR_SYSTEM } = require('/tmp/mw_check2.js');
console.log('mentions network field:', OCR_SYSTEM.includes('\"network\"'));
console.log('explains vertices/edges/weight/directed:', ['vertices','edges','weight','directed'].every(w => OCR_SYSTEM.includes(w)));
"
```
Expected: both lines print `true`.

- [x] **Step 5: Commit**

```bash
git add mathwise.html
git commit -m "Add network field to OCR schema for photographed graph questions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Add `networkConfirmText()` — the confirmed-network text builder

**Files:**
- Modify: `mathwise.html`, add the new function immediately before `function renderIntake(box){`
  (currently `mathwise.html:6588`) — place it right after the
  `/* --- Question intake ------------------------------------------------- */` comment
  (`mathwise.html:6586-6587`) and before `renderIntake`.

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `networkConfirmText(network)` — a pure function, `network` is
  `{ vertices: [{id,label}], edges: [{from,to,weight,directed}] }` or `null`/`undefined`. Returns a
  string (empty string `""` when there are no vertices). Task 3 calls this directly.

- [x] **Step 1: Write the function**

Insert directly above `function renderIntake(box){`:

```js
// Turns the (possibly student-edited) network from a photographed graph question into a short,
// explicit text block sent to Claude alongside the photo — telling it to trust these confirmed
// values instead of re-reading (and possibly re-misreading) the same numbers from the image.
function networkConfirmText(network){
  const vs = (network && network.vertices) || [];
  const es = (network && network.edges) || [];
  if (!vs.length) return "";
  const labelOf = id => {
    const v = vs.find(v => v.id === id);
    return v ? v.label : id;
  };
  const vertexList = vs.map(v => v.label).join(", ");
  const edgeList = es.map(e => {
    const a = labelOf(e.from), b = labelOf(e.to);
    const bits = [];
    if (e.weight !== undefined && e.weight !== null && e.weight !== "") bits.push(`weight ${e.weight}`);
    if (e.directed) bits.push("directed");
    return bits.length ? `${a}-${b} (${bits.join(", ")})` : `${a}-${b}`;
  }).join(", ");
  return `Confirmed network — use exactly this, not the diagram in the photo:\nVertices: ${vertexList}.\n`
    + (edgeList ? `Edges: ${edgeList}.` : "Edges: none.");
}

```

- [x] **Step 2: Verify syntax**

Run the same extract-and-check as Task 1 Step 3.
Expected: no output (syntax OK).

- [x] **Step 3: Write and run the Node harness test**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('mathwise.html', 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
fs.writeFileSync('/tmp/mw_net.js', m[1] + '\nmodule.exports = { networkConfirmText };');
"
node -e "
global.window = { crypto: { randomUUID: () => 'x' } };
const handler = { get(t,p){ if(p==='innerHTML') return ''; return function(){return [];}; }, set(){return true;} };
const fakeEl = new Proxy({}, handler);
global.document = { addEventListener(){}, getElementById(){return fakeEl;}, createElement(){return fakeEl;}, querySelectorAll(){return [];}, querySelector(){return null;} };
global.localStorage = { getItem(){return null;}, setItem(){}, removeItem(){} };
global.fetch = () => Promise.reject(new Error('no fetch'));
global.navigator = { userAgent: 'node' };
const { networkConfirmText } = require('/tmp/mw_net.js');

// Case 1: weighted undirected graph
console.log(networkConfirmText({
  vertices: [{id:'v0',label:'A'},{id:'v1',label:'B'},{id:'v2',label:'C'}],
  edges: [{from:'v0',to:'v1',weight:5},{from:'v1',to:'v2',weight:3}]
}));
console.log('---');
// Case 2: mixed weighted/unweighted
console.log(networkConfirmText({
  vertices: [{id:'v0',label:'A'},{id:'v1',label:'B'}],
  edges: [{from:'v0',to:'v1',weight:''},{from:'v0',to:'v1',weight:7}]
}));
console.log('---');
// Case 3: directed edge
console.log(networkConfirmText({
  vertices: [{id:'v0',label:'A'},{id:'v1',label:'B'}],
  edges: [{from:'v0',to:'v1',weight:2,directed:true}]
}));
console.log('---');
// Case 4: degenerate (no vertices)
console.log(JSON.stringify(networkConfirmText({vertices:[],edges:[]})));
console.log(JSON.stringify(networkConfirmText(null)));
console.log(JSON.stringify(networkConfirmText(undefined)));
"
```

Expected output:
```
Confirmed network — use exactly this, not the diagram in the photo:
Vertices: A, B, C.
Edges: A-B (weight 5), B-C (weight 3).
---
Confirmed network — use exactly this, not the diagram in the photo:
Vertices: A, B.
Edges: A-B, A-B (weight 7).
---
Confirmed network — use exactly this, not the diagram in the photo:
Vertices: A, B.
Edges: A-B (weight 2, directed).
---
""
""
""
```

- [x] **Step 4: Commit**

```bash
git add mathwise.html
git commit -m "Add networkConfirmText() helper for confirmed-network answers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Build the editable network panel and wire it into `renderIntake()`

**Files:**
- Modify: `mathwise.html:6588-6681` (`renderIntake` function body — the third branch, where
  `S.intake` is already set)

**Interfaces:**
- Consumes: `networkConfirmText(network)` from Task 2; `renderFigure(spec)`
  (`mathwise.html:5001`, already exists, unchanged); `FIG.network` (`mathwise.html:2618`, already
  exists, unchanged — takes `vertices:[{id,label,x,y}]`, `edges:[{from,to,weight,directed}]`).
- Produces: `renderNetworkPanel()` (called from `renderIntake()`'s third branch), reading/writing
  `S.intake.tx.network` in place. `useIt`'s click handler is modified to call
  `networkConfirmText(tx.network)` and pass it as `apiText` to `submit()`.

- [x] **Step 1: Add the panel container to `renderIntake`'s HTML template**

In `mathwise.html`, inside `renderIntake(box)`'s third branch, the existing template is:

```js
  box.innerHTML = `
    <h3 style="font-size:1.03rem">Is this your question?</h3>
    <div class="review">
      <div><img src="${S.intake.dataUrl}" alt="The photo you took"></div>
      <div>
        <p class="conf-${conf}" style="font-size:.88rem">${note}</p>
        ${tx.unclear && tx.unclear.length ? `<div class="flag">Not certain about:
          <ul>${tx.unclear.map(u => `<li>${esc(u)}</li>`).join("")}</ul></div>` : ""}
        <div class="readout" id="readout"></div>
        ${S.intakeEdit ? `<div style="margin-top:10px">
          <label for="edit">Correct the wording</label>
          <textarea id="edit" rows="6">${esc(tx.full_question || "")}</textarea>
        </div>` : ""}
        <div class="row" style="margin-top:12px">
          <button class="btn-primary" id="useIt">Yes, answer it</button>
          <button class="btn-secondary" id="fix">${S.intakeEdit ? "Done editing" : "Something's wrong"}</button>
          <button class="btn-quiet" id="again">Another photo</button>
        </div>
      </div>
    </div>`;
```

Add a full-width panel container after `div.review` closes:

```js
  box.innerHTML = `
    <h3 style="font-size:1.03rem">Is this your question?</h3>
    <div class="review">
      <div><img src="${S.intake.dataUrl}" alt="The photo you took"></div>
      <div>
        <p class="conf-${conf}" style="font-size:.88rem">${note}</p>
        ${tx.unclear && tx.unclear.length ? `<div class="flag">Not certain about:
          <ul>${tx.unclear.map(u => `<li>${esc(u)}</li>`).join("")}</ul></div>` : ""}
        <div class="readout" id="readout"></div>
        ${S.intakeEdit ? `<div style="margin-top:10px">
          <label for="edit">Correct the wording</label>
          <textarea id="edit" rows="6">${esc(tx.full_question || "")}</textarea>
        </div>` : ""}
        <div class="row" style="margin-top:12px">
          <button class="btn-primary" id="useIt">Yes, answer it</button>
          <button class="btn-secondary" id="fix">${S.intakeEdit ? "Done editing" : "Something's wrong"}</button>
          <button class="btn-quiet" id="again">Another photo</button>
        </div>
      </div>
    </div>
    <div id="networkPanel"></div>`;
```

- [x] **Step 2: Call `renderNetworkPanel()` after the existing wiring**

Directly below the existing `document.getElementById("useIt").onclick = ...` block (still inside
`renderIntake`, before its own closing brace), add:

```js
  renderNetworkPanel();
```

- [x] **Step 3: Modify `useIt`'s handler to send the confirmed network**

The existing handler:

```js
  document.getElementById("useIt").onclick = () => {
    const v = (S.intake.tx.full_question || "").trim();
    if (!v) return;
    const shot = S.intake.dataUrl;
    // The OCR transcription is text-only, so anything purely graphical in
    // the photo — a dot plot, a diagram, a figure with no text equivalent —
    // has no way to survive into it. Sending the original photo alongside
    // the transcription (the same way sendAttemptPhoto() does) means Claude
    // can still see and read that graphic directly, not just the OCR'd text.
    const image = { mime: S.intake.mime, b64: S.intake.b64 };
    S.intake = null; S.intakeEdit = false; S.showIntake = false;
    submit(v, true, shot, image);
  };
```

becomes:

```js
  document.getElementById("useIt").onclick = () => {
    const v = (S.intake.tx.full_question || "").trim();
    if (!v) return;
    const shot = S.intake.dataUrl;
    // The OCR transcription is text-only, so anything purely graphical in
    // the photo — a dot plot, a diagram, a figure with no text equivalent —
    // has no way to survive into it. Sending the original photo alongside
    // the transcription (the same way sendAttemptPhoto() does) means Claude
    // can still see and read that graphic directly, not just the OCR'd text.
    const image = { mime: S.intake.mime, b64: S.intake.b64 };
    // For a network question, the student may have corrected a misread vertex
    // or edge weight in the panel below — that confirmed data overrides
    // whatever Claude would otherwise re-read from the photo.
    const networkBlock = networkConfirmText(S.intake.tx.network);
    const apiText = networkBlock ? v + "\n\n" + networkBlock : undefined;
    S.intake = null; S.intakeEdit = false; S.showIntake = false;
    submit(v, true, shot, image, apiText);
  };
```

- [x] **Step 4: Write `renderNetworkPanel()`**

Add this function directly after `renderIntake`'s closing brace (before `function takePhoto`):

```js
// Generates the next unused single-letter vertex label (A, B, ..., Z, then A2, B2, ...) so
// "+ Add vertex" never collides with an existing label.
function nextVertexLabel(vs){
  const used = new Set(vs.map(v => v.label));
  for (let round = 1; round < 30; round++){
    for (let i = 0; i < 26; i++){
      const candidate = round === 1 ? String.fromCharCode(65 + i) : String.fromCharCode(65 + i) + round;
      if (!used.has(candidate)) return candidate;
    }
  }
  return "V" + (vs.length + 1);
}

let networkIdSeq = 0;
function newVertexId(){ return "nv" + (networkIdSeq++); }

// Renders the editable vertex/edge check panel for a photographed network question, inside
// renderIntake()'s own #networkPanel container. Does nothing (clears the panel) when the current
// question isn't a network question or OCR returned no usable vertices — the existing text-only
// review flow is completely unaffected in that case.
function renderNetworkPanel(){
  const panel = document.getElementById("networkPanel");
  if (!panel) return;
  const tx = S.intake && S.intake.tx;
  const net = tx && tx.network;
  if (!tx || !tx.is_network || !net || !Array.isArray(net.vertices) || !net.vertices.length){
    panel.innerHTML = "";
    return;
  }
  if (!Array.isArray(net.edges)) net.edges = [];

  panel.innerHTML = `
    <h4 style="margin:16px 0 6px">Check the network</h4>
    <p class="small">Check this matches the graph in your photo — labels, connections and weights
      all matter. Fix, add or remove anything that's wrong before continuing.</p>
    <div id="netDiagram"></div>
    <div class="row" style="gap:24px;flex-wrap:wrap;margin-top:10px;align-items:flex-start">
      <div>
        <strong style="font-size:.85rem">Vertices</strong>
        <div id="vertexRows"></div>
        <button class="btn-quiet" id="addVertex" type="button" style="margin-top:6px">+ Add vertex</button>
      </div>
      <div>
        <strong style="font-size:.85rem">Edges</strong>
        <div id="edgeRows"></div>
        <button class="btn-quiet" id="addEdge" type="button" style="margin-top:6px">+ Add edge</button>
      </div>
    </div>`;

  const paintDiagram = () => {
    document.getElementById("netDiagram").innerHTML =
      renderFigure({ type:"network", vertices:net.vertices, edges:net.edges });
  };

  // Renaming a vertex must update every edge dropdown's OPTION TEXT for that vertex without
  // rebuilding the dropdowns themselves — rebuilding would drop whichever option was selected if
  // the browser re-created the <select> while it (or its containing row) had focus.
  const updateOptionLabels = (vid, label) => {
    document.querySelectorAll(`#edgeRows option[value="${vid}"]`).forEach(opt => { opt.textContent = label; });
  };

  const buildRows = () => {
    const vertexRows = document.getElementById("vertexRows");
    vertexRows.innerHTML = net.vertices.map(v => `
      <div class="row" data-vid="${esc(v.id)}" style="gap:6px;margin-top:4px;align-items:center">
        <input type="text" class="vlabel" value="${esc(v.label)}" style="width:64px">
        <button class="btn-quiet vremove" type="button" title="Remove vertex">&times;</button>
      </div>`).join("");

    const edgeRows = document.getElementById("edgeRows");
    const optionsHtml = () => net.vertices.map(v => `<option value="${esc(v.id)}">${esc(v.label)}</option>`).join("");
    edgeRows.innerHTML = net.edges.map((e, i) => `
      <div class="row" data-eidx="${i}" style="gap:6px;margin-top:4px;align-items:center">
        <select class="efrom">${optionsHtml()}</select>
        <select class="eto">${optionsHtml()}</select>
        <input type="number" class="eweight" placeholder="weight" value="${e.weight === undefined || e.weight === null ? "" : e.weight}" style="width:70px">
        <label style="font-size:.8rem"><input type="checkbox" class="edirected" ${e.directed ? "checked" : ""}> directed</label>
        <button class="btn-quiet eremove" type="button" title="Remove edge">&times;</button>
      </div>`).join("");
    // <select value="..."> in a template string doesn't select the option — set it explicitly.
    edgeRows.querySelectorAll("[data-eidx]").forEach(row => {
      const i = +row.dataset.eidx;
      row.querySelector(".efrom").value = net.edges[i].from;
      row.querySelector(".eto").value = net.edges[i].to;
    });

    const addEdgeBtn = document.getElementById("addEdge");
    addEdgeBtn.disabled = net.vertices.length < 2;
    addEdgeBtn.title = addEdgeBtn.disabled ? "Add at least 2 vertices first" : "";

    vertexRows.querySelectorAll(".vlabel").forEach(input => {
      const vid = input.closest("[data-vid]").dataset.vid;
      input.oninput = () => {
        const v = net.vertices.find(v => v.id === vid);
        v.label = input.value;
        updateOptionLabels(vid, input.value);
        paintDiagram();
      };
    });
    vertexRows.querySelectorAll(".vremove").forEach(btn => {
      btn.onclick = () => {
        const vid = btn.closest("[data-vid]").dataset.vid;
        net.vertices = net.vertices.filter(v => v.id !== vid);
        net.edges = net.edges.filter(e => e.from !== vid && e.to !== vid);
        buildRows(); paintDiagram();
      };
    });
    edgeRows.querySelectorAll("[data-eidx]").forEach(row => {
      const i = +row.dataset.eidx;
      row.querySelector(".efrom").onchange = e => { net.edges[i].from = e.target.value; paintDiagram(); };
      row.querySelector(".eto").onchange = e => { net.edges[i].to = e.target.value; paintDiagram(); };
      row.querySelector(".eweight").oninput = e => {
        net.edges[i].weight = e.target.value === "" ? "" : +e.target.value;
        paintDiagram();
      };
      row.querySelector(".edirected").onchange = e => { net.edges[i].directed = e.target.checked; paintDiagram(); };
      row.querySelector(".eremove").onclick = () => { net.edges.splice(i, 1); buildRows(); paintDiagram(); };
    });
  };

  buildRows();
  paintDiagram();

  document.getElementById("addVertex").onclick = () => {
    net.vertices.push({ id:newVertexId(), label:nextVertexLabel(net.vertices) });
    buildRows(); paintDiagram();
  };
  document.getElementById("addEdge").onclick = () => {
    if (net.vertices.length < 2) return;
    net.edges.push({ from:net.vertices[0].id, to:net.vertices[1].id, weight:"", directed:false });
    buildRows(); paintDiagram();
  };
}
```

- [x] **Step 5: Verify syntax**

Same extract-and-check as Task 1 Step 3. Expected: no output (syntax OK).

- [x] **Step 6: Verify with a Node harness (DOM-independent parts + fallback behaviour)**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('mathwise.html', 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
fs.writeFileSync('/tmp/mw_panel.js', m[1] + '\nmodule.exports = { FIG, networkConfirmText, nextVertexLabel };');
"
node -e "
global.window = { crypto: { randomUUID: () => 'x' } };
const handler = { get(t,p){ if(p==='innerHTML') return ''; if(p==='style') return new Proxy({},handler); return function(){return [];}; }, set(){return true;} };
const fakeEl = new Proxy({}, handler);
global.document = { addEventListener(){}, getElementById(){return fakeEl;}, createElement(){return fakeEl;}, querySelectorAll(){return [];}, querySelector(){return null;} };
global.localStorage = { getItem(){return null;}, setItem(){}, removeItem(){} };
global.fetch = () => Promise.reject(new Error('no fetch'));
global.navigator = { userAgent: 'node' };
const { FIG, nextVertexLabel } = require('/tmp/mw_panel.js');

// FIG.network still renders correctly when id !== label (the new editor's own convention)
const svg = FIG.network({
  vertices: [{id:'nv0',label:'A'},{id:'nv1',label:'B'}],
  edges: [{from:'nv0',to:'nv1',weight:5}]
});
console.log('renders with id!=label vertices:', svg.includes('<svg') && svg.includes('>A<') && svg.includes('>B<'));

// nextVertexLabel picks the first unused letter, then falls back past Z
console.log('first free letter is C:', nextVertexLabel([{label:'A'},{label:'B'}]) === 'C');
const full = Array.from({length:26}, (_,i) => ({label:String.fromCharCode(65+i)}));
console.log('wraps to A2 after Z:', nextVertexLabel(full) === 'A2');
"
```

Expected:
```
renders with id!=label vertices: true
first free letter is C: true
wraps to A2 after Z: true
```

- [ ] **Step 7: Manual UI check (cannot be automated in this environment)** — NOT DONE. Needs a
  hands-on browser test by Ryan; see the 8-point checklist below.

This step needs a real browser — there is no browser-automation tool available this session. Open
`mathwise.html` directly in a browser and:
1. Open a course, click "Take or upload a photo", upload a photo of a network/graph-theory question
   (a simple hand-drawn weighted graph is enough).
2. Confirm the "Check the network" panel appears below the existing text review, showing a diagram
   that matches the photo.
3. Type over a vertex's label — confirm the diagram redraws with the new label and the edge
   dropdowns' text updates too, without losing focus while typing.
4. Change an edge's weight — confirm the diagram's weight label updates.
5. Click "+ Add vertex", then "+ Add edge" and pick it as an endpoint — confirm both appear
   correctly in the diagram.
6. Remove a vertex that has an edge attached — confirm that edge disappears from both the list and
   the diagram.
7. Click "Yes, answer it" and confirm the question still gets answered normally (no console errors).
8. Upload a photo of an ordinary, non-network question and confirm no network panel appears at all.

Report the actual result of each of these 8 checks rather than assuming they pass — this cannot be
automated in this environment, so it needs Ryan's own hands-on test before the feature is trusted.

- [x] **Step 8: Commit**

```bash
git add mathwise.html
git commit -m "Add editable network check panel to photo-question intake

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
