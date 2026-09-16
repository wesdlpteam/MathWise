# Interactive Kruskal's/Prim's MST Exercise Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For a photographed network question that names Kruskal's or Prim's algorithm, replace the
normal text-based chat answer with a click-the-edge exercise on the diagram: the student picks the
next edge, MathWISE validates it against the real algorithm (accounting for ties) and highlights an
accepted edge in red, until the spanning tree is complete.

**Architecture:** A deterministic, framework-free algorithm engine (union-find for Kruskal's,
frontier-tracking for Prim's) decides which edges are currently valid — no Claude call, ever, during
the exercise. A new `S.mst` state object and `renderMstExercise()` render function replace the
normal chat screen while the exercise is active; on completion, a plain-text summary is appended to
`S.messages` (the same array PDF export/copy-as-text already read) and control returns to normal chat.

**Tech Stack:** Plain JS in `mathwise.html`'s single `<script>` block, no framework, no build step.
Verified with `node --check` plus ad hoc Node harness scripts (extract the `<script>` body, stub
`window`/`document`, `module.exports` the functions under test) — this repo has no test runner.

**Spec:** `docs/superpowers/specs/2026-09-16-interactive-mst-exercise-design.md`

## Global Constraints

- No Claude/API calls anywhere in the exercise's validation or feedback — every check and every
  message is plain deterministic JavaScript (per the spec's "Why no Claude calls" section).
- The exercise only starts for a photographed question (never a typed one) where OCR set
  `network_algorithm` to `"kruskal"` or `"prim"` AND the network is usable (every edge weighted,
  no directed edges, at least 2 vertices, actually connected) — otherwise fall back to the existing
  `submit(...)` chat path unchanged.
- On completion, append a user+assistant message pair to `S.messages` using the exact same shape
  the rest of the app already uses (`{role, content, visible}`), so PDF export/copy-as-text need no
  changes.
- Ties (multiple edges of equal minimum weight) are all simultaneously valid — never force a single
  "the" correct answer where the real algorithm allows more than one.

---

### Task 1: Extend `OCR_SYSTEM` with `network_algorithm`

**Files:**
- Modify: `mathwise.html:1457-1500ish` (`OCR_SYSTEM` constant — the exact block containing the
  `"network"` field added in the prior editable-network-check feature)

**Interfaces:**
- Produces: the OCR JSON reply gains an optional `network_algorithm: "kruskal" | "prim" | null`
  field. Task 3 reads `S.intake.tx.network_algorithm` directly.

- [x] **Step 1: Locate the current JSON schema block and rule list**

Read `mathwise.html` around the `OCR_SYSTEM` constant. It currently has this JSON template (exact
surrounding text may differ slightly by line, but this fragment is present verbatim):

```
  "is_network": true or false,
  "network": { "vertices": [{"id":"v0","label":"A"},{"id":"v1","label":"B"}], "edges": [{"from":"v0","to":"v1","weight":5,"directed":false}] },
  "confidence": "high" or "medium" or "low",
```

- [x] **Step 2: Add the field and its rule**

Change that fragment to:

```
  "is_network": true or false,
  "network": { "vertices": [{"id":"v0","label":"A"},{"id":"v1","label":"B"}], "edges": [{"from":"v0","to":"v1","weight":5,"directed":false}] },
  "network_algorithm": "kruskal" or "prim" or null,
  "confidence": "high" or "medium" or "low",
```

And add this rule to the `Rules:` list, immediately after the existing `"network"` rule:

```
- Set "network_algorithm" to "kruskal" or "prim" only when the question's own text explicitly asks
  to apply that named algorithm ("Apply Kruskal's algorithm...", "Use Prim's algorithm..."). Leave
  it null for every other network question, including ones about shortest paths, Euler's formula,
  walks/trails, Hamiltonian paths, Dijkstra's algorithm, or a network question with no named
  algorithm instruction at all.
```

- [x] **Step 3: Verify syntax**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('mathwise.html', 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
fs.writeFileSync('/tmp/mw1.js', m[1] + '\nmodule.exports = { OCR_SYSTEM };');
"
node --check /tmp/mw1.js
```
Expected: no output (syntax OK).

- [x] **Step 4: Verify content**

```bash
node -e "
global.window = { crypto: { randomUUID: () => 'x' } };
const h = { get(t,p){ if(p==='innerHTML') return ''; return function(){return [];}; }, set(){return true;} };
const fakeEl = new Proxy({}, h);
global.document = { addEventListener(){}, getElementById(){return fakeEl;}, createElement(){return fakeEl;}, querySelectorAll(){return [];}, querySelector(){return null;} };
global.localStorage = { getItem(){return null;}, setItem(){}, removeItem(){} };
global.fetch = () => Promise.reject(new Error('no fetch'));
global.navigator = { userAgent: 'node' };
const { OCR_SYSTEM } = require('/tmp/mw1.js');
console.log('mentions network_algorithm field:', OCR_SYSTEM.includes('network_algorithm'));
console.log('explains kruskal/prim trigger:', OCR_SYSTEM.includes('Kruskal') && OCR_SYSTEM.includes('Prim'));
console.log('explains null case:', OCR_SYSTEM.includes('Leave it null'));
"
```
Expected: all three lines print `true`.

- [x] **Step 5: Commit**

```bash
git add mathwise.html
git commit -m "Add network_algorithm field to OCR schema for Kruskal's/Prim's detection

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: The algorithm engine (pure functions, fully Node-testable)

**Files:**
- Modify: `mathwise.html`, add these functions immediately before `function renderIntake(box){`
  (in the "Question intake" section, alongside `networkConfirmText`).

**Interfaces:**
- Consumes: nothing from Task 1 directly (these are pure functions over plain `network` objects).
- Produces (consumed by Task 3):
  - `unionFind(vertexIds)` → `{ find(id), union(a,b) }`
  - `networkIsConnected(network)` → `boolean`
  - `kruskalValidChoices(network, chosenIdx)` → `{ valid: Set<number>, reasonFor(i) → string|null }`
  - `primStartVertex(network, fullQuestion)` → vertex id string
  - `primValidChoices(network, chosenIdx, startVertexId)` → `{ valid: Set<number>, reasonFor(i) → string|null }`
  - `mstSummaryText(network, chosenIdx, autoIdx)` → string

- [x] **Step 1: Write the functions**

Insert directly above `function renderIntake(box){`:

```js
// A tiny disjoint-set (union-find) structure over vertex ids, used by Kruskal's algorithm to test
// "would adding this edge close a cycle?" in O(~1) per check.
function unionFind(vertexIds){
  const parent = {};
  vertexIds.forEach(id => { parent[id] = id; });
  const find = x => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  return { find, union };
}

// True only if every vertex can be reached from every other, treating every edge as undirected —
// Kruskal's/Prim's only make sense (and can only ever finish) on a connected graph.
function networkIsConnected(network){
  const vs = network.vertices || [];
  if (!vs.length) return false;
  const adj = {};
  vs.forEach(v => { adj[v.id] = []; });
  (network.edges || []).forEach(e => {
    if (adj[e.from] && adj[e.to]){ adj[e.from].push(e.to); adj[e.to].push(e.from); }
  });
  const seen = new Set([vs[0].id]);
  const stack = [vs[0].id];
  while (stack.length){
    const cur = stack.pop();
    (adj[cur] || []).forEach(n => { if (!seen.has(n)){ seen.add(n); stack.push(n); } });
  }
  return seen.size === vs.length;
}

// Kruskal's algorithm: at every step, the valid next edges are whichever unchosen, non-cycle-
// forming edges share the smallest weight (there is often more than one — a genuine tie).
function kruskalValidChoices(network, chosenIdx){
  const uf = unionFind(network.vertices.map(v => v.id));
  const chosenSet = new Set(chosenIdx);
  chosenIdx.forEach(i => { const e = network.edges[i]; uf.union(e.from, e.to); });
  const candidates = network.edges
    .map((e, i) => ({ i, e }))
    .filter(({ i, e }) => !chosenSet.has(i) && uf.find(e.from) !== uf.find(e.to));
  const valid = new Set();
  if (candidates.length){
    const minWeight = Math.min(...candidates.map(c => +c.e.weight));
    candidates.forEach(c => { if (+c.e.weight === minWeight) valid.add(c.i); });
  }
  const reasonFor = i => {
    if (chosenSet.has(i) || valid.has(i)) return null;
    const e = network.edges[i];
    if (uf.find(e.from) === uf.find(e.to)){
      return "That edge would create a cycle — its two vertices are already connected through edges you've already chosen.";
    }
    return "There's a cheaper edge available that doesn't create a cycle — look for the smallest weight you haven't used yet.";
  };
  return { valid, reasonFor };
}

// Prim's algorithm's own starting vertex: the textbooks' worked examples never ask the student to
// pick one, they just begin from one — default to the alphabetically-first vertex, unless the
// question's own wording names a specific starting vertex.
function primStartVertex(network, fullQuestion){
  const text = String(fullQuestion || "").toLowerCase();
  for (const v of network.vertices){
    const label = String(v.label).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!label) continue;
    const re = new RegExp(`start(?:ing)?\\s*(?:at|from)?\\s*(?:vertex\\s*)?${label}\\b`);
    if (re.test(text)) return v.id;
  }
  const sorted = [...network.vertices].sort((a, b) => String(a.label).localeCompare(String(b.label)));
  return sorted[0].id;
}

// Prim's algorithm: the valid next edges are whichever unchosen "frontier" edges (exactly one
// endpoint already in the growing tree) share the smallest weight.
function primValidChoices(network, chosenIdx, startVertexId){
  const inTree = new Set([startVertexId]);
  chosenIdx.forEach(i => { const e = network.edges[i]; inTree.add(e.from); inTree.add(e.to); });
  const chosenSet = new Set(chosenIdx);
  const candidates = network.edges
    .map((e, i) => ({ i, e }))
    .filter(({ i, e }) => !chosenSet.has(i) && inTree.has(e.from) !== inTree.has(e.to));
  const valid = new Set();
  if (candidates.length){
    const minWeight = Math.min(...candidates.map(c => +c.e.weight));
    candidates.forEach(c => { if (+c.e.weight === minWeight) valid.add(c.i); });
  }
  const reasonFor = i => {
    if (chosenSet.has(i) || valid.has(i)) return null;
    const e = network.edges[i];
    const aIn = inTree.has(e.from), bIn = inTree.has(e.to);
    if (!aIn && !bIn) return "That edge doesn't connect to your tree yet — pick one with at least one end already included.";
    if (aIn && bIn) return "Both ends of that edge are already in your tree — adding it would create a cycle.";
    return "There's a cheaper edge available that doesn't create a cycle — look for the smallest weight you haven't used yet.";
  };
  return { valid, reasonFor };
}

// Builds the plain-text summary appended to the chat transcript once the tree is complete.
function mstSummaryText(network, chosenIdx, autoIdx){
  const labelOf = id => { const v = network.vertices.find(v => v.id === id); return v ? v.label : id; };
  const parts = chosenIdx.map(i => {
    const e = network.edges[i];
    return `${labelOf(e.from)}-${labelOf(e.to)} (${e.weight})`;
  });
  const total = chosenIdx.reduce((sum, i) => sum + (+network.edges[i].weight || 0), 0);
  let text = parts.join(", ") + ` — total weight ${total}.`;
  if (autoIdx.length){
    const manual = chosenIdx.length - autoIdx.length;
    text += ` You worked out ${manual} of these ${chosenIdx.length} edges yourself; MathWISE filled in the rest.`;
  }
  return text;
}

```

- [x] **Step 2: Verify syntax**

Same extract-and-check as Task 1 Step 3 (write to `/tmp/mw2.js` instead).

- [x] **Step 3: Write and run the Node harness test**

This is the highest-value test in the whole feature — an actual correctness bug here silently
accepts a wrong edge or rejects a right one. Use this exact worked graph, matching Ryan's own
Kruskal's photo: vertices A-F; edges A-B(2), A-D(5), A-F(6), B-C(8), B-D(6), C-D(3), C-E(5), D-E(6),
D-F(7), E-F(2). The known correct minimum spanning tree (by hand): A-B(2), E-F(2), C-D(3), A-D(5) or
C-E(5) [a genuine tie for the 4th edge — both have weight 5 and neither creates a cycle at that
point], total weight 17 either way.

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('mathwise.html', 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
fs.writeFileSync('/tmp/mw2.js', m[1] + '\nmodule.exports = { kruskalValidChoices, primValidChoices, primStartVertex, networkIsConnected, mstSummaryText };');
"
node -e "
global.window = { crypto: { randomUUID: () => 'x' } };
const h = { get(t,p){ if(p==='innerHTML') return ''; return function(){return [];}; }, set(){return true;} };
const fakeEl = new Proxy({}, h);
global.document = { addEventListener(){}, getElementById(){return fakeEl;}, createElement(){return fakeEl;}, querySelectorAll(){return [];}, querySelector(){return null;} };
global.localStorage = { getItem(){return null;}, setItem(){}, removeItem(){} };
global.fetch = () => Promise.reject(new Error('no fetch'));
global.navigator = { userAgent: 'node' };
const { kruskalValidChoices, primValidChoices, primStartVertex, networkIsConnected, mstSummaryText } = require('/tmp/mw2.js');

const network = {
  vertices: [{id:'v0',label:'A'},{id:'v1',label:'B'},{id:'v2',label:'C'},{id:'v3',label:'D'},{id:'v4',label:'E'},{id:'v5',label:'F'}],
  edges: [
    {from:'v0',to:'v1',weight:2},  // 0: A-B
    {from:'v0',to:'v3',weight:5},  // 1: A-D
    {from:'v0',to:'v5',weight:6},  // 2: A-F
    {from:'v1',to:'v2',weight:8},  // 3: B-C
    {from:'v1',to:'v3',weight:6},  // 4: B-D
    {from:'v2',to:'v3',weight:3},  // 5: C-D
    {from:'v2',to:'v4',weight:5},  // 6: C-E
    {from:'v3',to:'v4',weight:6},  // 7: D-E
    {from:'v3',to:'v5',weight:7},  // 8: D-F
    {from:'v4',to:'v5',weight:2}   // 9: E-F
  ]
};

console.log('graph is connected:', networkIsConnected(network) === true);

// --- Kruskal's: walk it step by step ---
let chosen = [];
let step = kruskalValidChoices(network, chosen);
console.log('step 1 valid = {0,9} (A-B and E-F, both weight 2 tie):', [...step.valid].sort().join(',') === '0,9');
console.log('step 1: edge 5 (C-D, weight 3) rejected as too expensive:', step.reasonFor(5).includes('cheaper edge'));
chosen.push(0); // accept A-B
step = kruskalValidChoices(network, chosen);
console.log('step 2 valid = {9} (E-F, weight 2):', [...step.valid].sort().join(',') === '9');
chosen.push(9); // accept E-F
step = kruskalValidChoices(network, chosen);
console.log('step 3 valid = {5} (C-D, weight 3):', [...step.valid].sort().join(',') === '5');
chosen.push(5); // accept C-D
step = kruskalValidChoices(network, chosen);
console.log('step 4 valid = {1,6} (A-D and C-E, both weight 5 tie):', [...step.valid].sort().join(',') === '1,6');
console.log('step 4: edge 4 (B-D, weight 6) would create a cycle (B-A-D already connects them):', step.reasonFor(4).includes('cycle'));
chosen.push(1); // accept A-D
step = kruskalValidChoices(network, chosen);
console.log('step 5 valid = {6} (C-E, weight 5 — the tied edge, still valid):', [...step.valid].sort().join(',') === '6');
chosen.push(6); // accept C-E — tree complete (5 edges, 6 vertices)
console.log('kruskal total weight is 17:', mstSummaryText(network, chosen, []).includes('total weight 17'));

// --- Prim's: same graph, default start vertex should be A (alphabetically first) ---
console.log('default start vertex is A:', primStartVertex(network, '') === 'v0');
console.log('named start vertex overrides default:', primStartVertex(network, 'starting at vertex C') === 'v2');

let pchosen = [];
let pstep = primValidChoices(network, pchosen, 'v0'); // start at A
console.log('prim step 1 valid = {0} (A-B, weight 2, only frontier edge tied-lowest):', [...pstep.valid].sort().join(',') === '0');
pchosen.push(0);
pstep = primValidChoices(network, pchosen, 'v0');
console.log('prim step 2: edge 3 (B-C, weight 8) too expensive vs A-D(5):', pstep.reasonFor(3).includes('cheaper edge'));
console.log('prim step 2 valid = {1} (A-D, weight 5):', [...pstep.valid].sort().join(',') === '1');
pchosen.push(1);
pstep = primValidChoices(network, pchosen, 'v0');
console.log('prim step 3: edge 0 (A-B) already chosen, both ends now in tree if re-queried elsewhere is moot — check C-D(3) valid:', [...pstep.valid].sort().join(',') === '5');
"
```

Expected: every printed line reads `true`.

- [x] **Step 4: Commit**

```bash
git add mathwise.html
git commit -m "Add Kruskal's/Prim's deterministic algorithm engine

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Exercise state, rendering, and wiring

**Files:**
- Modify: `mathwise.html:1609` area (`const S = {...}` state object) — add `mst: null,`
- Modify: `mathwise.html`, `renderQuestions(el)` (~line 6328) — add the early-return dispatch
- Modify: `mathwise.html`, `renderIntake`'s `useIt` click handler (~line 6728) — branch into the
  exercise instead of `submit(...)` when applicable
- Modify: `mathwise.html`, add `mstExerciseUsable`, `renderMstExercise`, `mstValidChoices`,
  `mstTryChoose`, `mstShowHint`, `mstAutoStep`, `mstCheckDone` — place these directly after the
  Task 2 functions (before `renderIntake`)

**Interfaces:**
- Consumes: `kruskalValidChoices`/`primValidChoices`/`primStartVertex`/`networkIsConnected`/
  `mstSummaryText` from Task 2; `S.intake.tx.network_algorithm` from Task 1; existing `X`/`Y`
  coordinate helpers (`PAD`, `W`, `H` module constants), `txt()`, `num()`, `esc()`, `render()`,
  `S.messages`.
- Produces: `S.mst` state shape (see spec); `renderMstExercise(el)` called from `renderQuestions`.

- [x] **Step 1: Add `mst: null,` to the `S` state object**

`mathwise.html`'s `const S = {` object currently includes (among many other fields):

```js
  intake: null,
  intakeBusy: false,
```

Add `mst: null,` on its own line right after `intake: null,`:

```js
  intake: null,
  mst: null,
  intakeBusy: false,
```

- [x] **Step 2: Add the exercise-usability check, exercise functions, and renderer**

Insert directly after the Task 2 functions (still before `function renderIntake(box){`):

```js
// Whether a confirmed network is actually usable for the Kruskal's/Prim's exercise: needs at
// least 2 vertices, at least one edge, every edge weighted (the algorithms are meaningless
// without complete weights), no directed edges (MST algorithms are for undirected graphs), and the
// graph must actually be connected (or the exercise could never reach a complete spanning tree).
function mstExerciseUsable(net){
  if (!net || !Array.isArray(net.vertices) || net.vertices.length < 2) return false;
  if (!Array.isArray(net.edges) || !net.edges.length) return false;
  if (net.edges.some(e => e.directed)) return false;
  if (net.edges.some(e => e.weight === undefined || e.weight === null || e.weight === "")) return false;
  return networkIsConnected(net);
}

function mstValidChoices(){
  const st = S.mst;
  return st.algorithm === "kruskal"
    ? kruskalValidChoices(st.network, st.chosen)
    : primValidChoices(st.network, st.chosen, st.startVertex);
}

function mstCheckDone(){
  const st = S.mst;
  if (st.chosen.length !== st.network.vertices.length - 1) return;
  st.done = true;
  const algoName = st.algorithm === "kruskal" ? "Kruskal's" : "Prim's";
  const summary = mstSummaryText(st.network, st.chosen, st.auto);
  S.messages.push({ role:"user", content: st.questionText, visible:true });
  S.messages.push({ role:"assistant", content: `## Full solution\n\nApplying ${algoName} algorithm: ${summary}` });
  S.solved = true;
  S.mst = null;
}

function mstTryChoose(i){
  const st = S.mst;
  if (!st || st.chosen.includes(i)) return;
  const { valid, reasonFor } = mstValidChoices();
  if (valid.has(i)){
    st.chosen.push(i);
    st.feedback = null;
    st.hinted = null;
    mstCheckDone();
  } else {
    st.feedback = { kind:"error", text: reasonFor(i) };
  }
  render();
}

function mstShowHint(){
  const st = S.mst;
  const { valid } = mstValidChoices();
  st.hinted = valid;
  st.feedback = { kind:"hint", text: "The highlighted edge(s) are valid choices right now." };
  render();
}

function mstAutoStep(){
  const st = S.mst;
  const { valid } = mstValidChoices();
  if (!valid.size) return;
  const i = Math.min(...valid);
  const e = st.network.edges[i];
  const labelOf = id => { const v = st.network.vertices.find(v => v.id === id); return v ? v.label : id; };
  st.chosen.push(i);
  st.auto.push(i);
  st.hinted = null;
  st.feedback = { kind:"step", text: `${labelOf(e.from)}-${labelOf(e.to)} has weight ${e.weight}, the smallest available that doesn't create a cycle, so it's added next.` };
  mstCheckDone();
  render();
}

// The exercise's own diagram renderer: read-only vertex positions (already fixed by the earlier
// editable-network-check step), click-only edges, no dragging or text editing — a deliberately
// simpler sibling of renderNetworkPanel's editable canvas, not a reuse of it.
function renderMstExercise(el){
  const st = S.mst;
  const net = st.network;
  const X = v => PAD + v / 100 * (W - PAD * 2);
  const Y = v => PAD + v / 100 * (H - PAD * 2);
  const totalWeight = st.chosen.reduce((sum, i) => sum + (+net.edges[i].weight || 0), 0);
  const algoName = st.algorithm === "kruskal" ? "Kruskal's" : "Prim's";

  let body = "";
  net.edges.forEach((e, i) => {
    const a = net.vertices.find(v => v.id === e.from), b = net.vertices.find(v => v.id === e.to);
    if (!a || !b) return;
    const x1 = X(a.x), y1 = Y(a.y), x2 = X(b.x), y2 = Y(b.y), mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const isChosen = st.chosen.includes(i);
    const isHinted = st.hinted && st.hinted.has(i);
    const stroke = isChosen ? "#c0392b" : (isHinted ? "#C59F40" : "#8a8a9a");
    const width = isChosen ? 4 : (isHinted ? 3 : 2);
    body += `<line data-eidx="${i}" x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}"
      stroke="${stroke}" stroke-width="${width}" style="cursor:${isChosen ? "default" : "pointer"}"/>`;
    body += txt(mx, my, String(e.weight), { size:13, weight:700, fill: isChosen ? "#c0392b" : C_AXIS, bg:"rgba(255,255,255,0.85)" });
  });
  net.vertices.forEach(v => {
    body += `<circle cx="${num(X(v.x))}" cy="${num(Y(v.y))}" r="20" fill="#fff" stroke="#4F2759" stroke-width="2"/>`;
    body += txt(X(v.x), Y(v.y) + 5, v.label, { size:14, weight:700, fill:"#4F2759" });
  });

  el.innerHTML = `
    <h3 style="font-size:1.05rem">Applying ${algoName} algorithm</h3>
    <p class="small">Click the edge you think ${algoName} should add next.</p>
    <svg id="mstSvg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:640px;height:auto">${body}</svg>
    <p style="font-weight:600">Total weight so far: ${totalWeight}</p>
    ${st.feedback ? `<p class="${st.feedback.kind === "error" ? "err" : "small"}">${esc(st.feedback.text)}</p>` : ""}
    <div class="row">
      <button class="btn-secondary" id="mstHint" type="button">Hint</button>
      <button class="btn-quiet" id="mstStep" type="button">I'm stuck — show me this step</button>
    </div>`;

  document.querySelectorAll("#mstSvg [data-eidx]").forEach(lineEl => {
    const i = +lineEl.dataset.eidx;
    lineEl.onclick = () => mstTryChoose(i);
  });
  document.getElementById("mstHint").onclick = mstShowHint;
  document.getElementById("mstStep").onclick = mstAutoStep;
}

```

- [x] **Step 3: Dispatch to the exercise at the top of `renderQuestions`**

`mathwise.html`'s `renderQuestions(el){` currently opens with:

```js
function renderQuestions(el){
  const c = courseOf(S.courseKey);
```

Change to:

```js
function renderQuestions(el){
  if (S.mst) { renderMstExercise(el); return; }
  const c = courseOf(S.courseKey);
```

- [x] **Step 4: Branch `useIt` into the exercise when applicable**

The current `useIt` handler (inside `renderIntake`) reads:

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

Change to:

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

    // Kruskal's/Prim's questions become a click-the-edge exercise instead of the usual chat
    // hints, whenever the confirmed network is actually usable for it (every edge weighted,
    // undirected, connected) — otherwise this falls through to the normal chat path unchanged.
    const algo = S.intake.tx.network_algorithm;
    const net = S.intake.tx.network;
    if ((algo === "kruskal" || algo === "prim") && mstExerciseUsable(net)){
      S.mst = {
        algorithm: algo,
        network: net,
        startVertex: algo === "prim" ? primStartVertex(net, v) : null,
        chosen: [], auto: [], hinted: null, feedback: null, done: false,
        questionText: v
      };
      S.intake = null; S.intakeEdit = false; S.showIntake = false;
      render();
      return;
    }

    S.intake = null; S.intakeEdit = false; S.showIntake = false;
    submit(v, true, shot, image, apiText);
  };
```

- [x] **Step 5: Verify syntax**

Same extract-and-check pattern as prior tasks.

- [x] **Step 6: Node harness — exercise usability + end-to-end state simulation**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('mathwise.html', 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
fs.writeFileSync('/tmp/mw3.js', m[1] + '\nmodule.exports = { S, mstExerciseUsable, mstTryChoose, mstShowHint, mstAutoStep };');
"
node -e "
global.window = { crypto: { randomUUID: () => 'x' } };
const h = { get(t,p){ if(p==='innerHTML') return ''; if(p==='style') return new Proxy({},h); return function(){return [];}; }, set(){return true;} };
const fakeEl = new Proxy({}, h);
global.document = { addEventListener(){}, getElementById(){return fakeEl;}, createElement(){return fakeEl;}, querySelectorAll(){return [];}, querySelector(){return null;} };
global.localStorage = { getItem(){return null;}, setItem(){}, removeItem(){} };
global.fetch = () => Promise.reject(new Error('no fetch'));
global.navigator = { userAgent: 'node' };
const mod = require('/tmp/mw3.js');

const network = {
  vertices: [{id:'v0',label:'A',x:10,y:10},{id:'v1',label:'B',x:50,y:10},{id:'v2',label:'C',x:90,y:50},{id:'v3',label:'D',x:50,y:50},{id:'v4',label:'E',x:50,y:90},{id:'v5',label:'F',x:10,y:90}],
  edges: [
    {from:'v0',to:'v1',weight:2},{from:'v0',to:'v3',weight:5},{from:'v0',to:'v5',weight:6},
    {from:'v1',to:'v2',weight:8},{from:'v1',to:'v3',weight:6},{from:'v2',to:'v3',weight:3},
    {from:'v2',to:'v4',weight:5},{from:'v3',to:'v4',weight:6},{from:'v3',to:'v5',weight:7},
    {from:'v4',to:'v5',weight:2}
  ]
};
console.log('usable (complete, undirected, connected):', mod.mstExerciseUsable(network) === true);

const missingWeight = JSON.parse(JSON.stringify(network));
missingWeight.edges[0].weight = '';
console.log('unusable with a blank weight:', mod.mstExerciseUsable(missingWeight) === false);

const directed = JSON.parse(JSON.stringify(network));
directed.edges[0].directed = true;
console.log('unusable with a directed edge:', mod.mstExerciseUsable(directed) === false);

const disconnected = { vertices: network.vertices, edges: [ {from:'v0',to:'v1',weight:1} ] };
console.log('unusable when disconnected:', mod.mstExerciseUsable(disconnected) === false);

// End-to-end simulation of a full correct Kruskal's run through the actual wired functions
mod.S.mst = { algorithm:'kruskal', network, startVertex:null, chosen:[], auto:[], hinted:null, feedback:null, done:false, questionText:'Find the MST.' };
mod.S.messages = [];
mod.mstTryChoose(5); // C-D (weight 3) is NOT valid yet (A-B/E-F at weight 2 come first)
console.log('wrong-first-click sets an error, does not advance:', mod.S.mst.chosen.length === 0 && mod.S.mst.feedback.kind === 'error');
mod.mstTryChoose(0); // A-B, weight 2 — valid
mod.mstTryChoose(9); // E-F, weight 2 — valid
mod.mstTryChoose(5); // C-D, weight 3 — valid
mod.mstAutoStep();   // auto-picks one of the tied weight-5 edges (A-D or C-E)
if (mod.S.mst){
  // finish with whichever of the weight-5 tie is still available
  const remaining = [1,6].find(i => !mod.S.mst.chosen.includes(i));
  mod.mstTryChoose(remaining);
}
console.log('exercise completed and cleared S.mst:', mod.S.mst === null);
console.log('two messages appended to S.messages:', mod.S.messages.length === 2);
console.log('assistant message reports total weight 17:', mod.S.messages[1].content.includes('total weight 17'));
console.log('assistant message credits partial manual work:', mod.S.messages[1].content.includes('MathWISE filled in the rest'));
"
```

Expected: every printed line reads `true`.

- [ ] **Step 7: Manual UI check (cannot be automated in this environment)** — NOT DONE. Needs a
  hands-on browser test by Ryan; see the checklist below.

There is no browser-automation tool available this session. Open `mathwise.html` in a real browser
and: photograph (or upload a saved photo of) a Kruskal's or Prim's algorithm question with a
connected, fully-weighted, undirected graph; confirm the network in the editable-check panel exactly
as before; click "Yes, answer it" and confirm the exercise screen appears (not the normal chat);
click a wrong edge and confirm the specific reason text appears without advancing; click a correct
edge and confirm it turns red and the running total updates; try "Hint" and "I'm stuck — show me
this step"; finish the tree and confirm the app returns to the normal chat with a summary message in
the transcript, and that a follow-up typed question still works normally afterward. Report the
actual result of each check rather than assuming it passes.

- [x] **Step 8: Commit**

```bash
git add mathwise.html
git commit -m "Add interactive click-the-edge Kruskal's/Prim's exercise

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
