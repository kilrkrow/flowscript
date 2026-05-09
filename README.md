# FlowScript

A diagram-as-code DSL that renders clean, Visio-quality flowcharts from human-readable text.

```
#start User Visits Signup Page
  Enter Email & Password
  #decision Email Already Exists?
    -> yes: Show Error Message
    -> no: Create Account
  Show Error Message ~> Enter Email & Password: "try again"
  Create Account
    Send Verification Email
    #end Registration Complete
```

**[Try the Live Editor →](https://flowscript.foxanddoveconsulting)**

---

## Features

- **Readable DSL** — indentation-driven, keyword-heavy syntax anyone can write
- **11 shape types** — start, end, decision, process, subprocess, I/O, data, circle, note, manual, delay
- **Orthogonal edge routing** — right-angle connections with rounded corners
- **Automatic layout** — dual-engine positioning: structured grid (TB default) or Dagre, no manual coordinates
- **Themes** — clean default theme, extensible theme system
- **4 flow directions** — top-to-bottom, bottom-to-top, left-to-right, right-to-left
- **Edge labels** — named connections with quoted labels on any edge
- **Loop-backs** — re-reference any node to create cycles
- **Groups** — logical grouping with labeled containers
- **Comments** — `//` line comments anywhere
- **Frontmatter** — YAML-style metadata header (`title`, `author`, etc.)
- **Export** — SVG output, clipboard copy (PNG planned)
- **MCP server** — `compile_flow` and `render_flow` tools for AI agent integration
- **SOP generator** — self-hosted Docker service: paste/upload/URL → LLM extraction → diagram

---

## Quick Start

### CLI

```bash
# Install dependencies
bun install

# Render a diagram
bun run src/cli.ts render input.flow -o output.svg

# Read from stdin
echo '#start Hello
  World
  #end Done' | bun run src/cli.ts render --stdin -o output.svg

# Validate syntax
bun run src/cli.ts lint input.flow
```

### API

```typescript
import { render } from 'flowscript';

const svg = render(`
  #start Begin
    Process Data
    #decision Valid?
      -> yes: #end Save
      -> no: #end Reject
`);

// svg is a complete SVG string ready to embed or save
```

For more control over the pipeline:

```typescript
import { parse, layout, route, renderSVG, cleanTheme } from 'flowscript';

const doc = parse(source);
layout(doc);
const routes = route(doc);
const svg = renderSVG(doc, routes, { theme: cleanTheme, padding: 40 });
```

---

## Syntax Reference

### Frontmatter

Optional metadata block at the top of the file:

```
---
title: My Diagram
author: Your Name
---
```

### Directives

```
@theme clean          // Set the visual theme
@direction TB         // Flow direction: TB, BT, LR, RL
@routing orthogonal   // Edge routing: orthogonal, bezier, polyline
@line-jumps on        // Visio-style hops at edge crossings: on (default), off
@corner-radius 8      // Radius of orthogonal-edge corners
@spacing 60           // Dagre node spacing
@layout grid          // Layout engine: grid (default for TB) or dagre
```

### Shapes

Shapes are declared with `#keyword` followed by a label:

| Keyword       | Shape         | Typical Use               |
|---------------|---------------|---------------------------|
| `#start`      | Rounded rect  | Entry point               |
| `#end`        | Rounded rect  | Terminal                  |
| `#decision`   | Diamond       | Yes/no or multi-branch    |
| `#subprocess` | Double-border | Reusable sub-process      |
| `#io`         | Parallelogram | Input/output              |
| `#data`       | Cylinder      | Database or data store     |
| `#circle`     | Circle        | Connector                 |
| `#note`       | Folded corner | Annotation                |
| `#manual`     | Trapezoid     | Manual operation          |
| `#delay`      | Half-rounded  | Wait or timer             |

Plain text (no keyword) creates a **process** rectangle — the most common shape.

### Connections

**Implicit chaining** — indented steps auto-connect top to bottom:

```
#start Begin
  Step One
  Step Two
  #end Done
```

**Explicit connections** with `->`:

```
Step One -> Step Two
Step One -> Step Two: "label on edge"
```

**Decision branches:**

```
#decision Approved?
  -> 'Yes' Send Confirmation
  -> 'No'  Send Rejection
```

Single-quoted conditions are unambiguous — no colon, any length, any content. The legacy colon form (`-> yes: Target`) is still accepted for backward compatibility.

**Multi-way branching:**

```
#decision Priority?
  -> 'P1' Page On-Call
  -> 'P2' Assign Team Lead
  -> 'P3' Add to Backlog
```

**Loop-backs** — reference an existing node by name:

```
#decision Retry?
  -> yes: Step One
  -> no: #end Done
```

**Retry / dashed edges** — use `~>` instead of `->` to render the
connection with a dashed stroke. This is the explicit way to mark a
loop-back, retry, or "soft" edge:

```
#start Submit
  Validate
  #decision OK?
    -> yes: #end Done
    ~> no: Validate
```

`~>` works anywhere `->` does — inline, in decision branches, with
labels and conditions. Edges from `~>` are tagged in the SVG with
`class="fs-edge-path fs-edge-retry"` so you can style them further.

For backward compatibility, edges whose label is exactly `"try again"`
or `"resend"` are also rendered dashed even when written with `->`.
Prefer `~>` in new diagrams — it doesn't depend on a particular label.

### Groups

```
#group Frontend
  Show Loading
  Render Results

#group Backend
  Query Database
  Process Data

Show Loading -> Query Database: "API call"
Query Database -> Process Data
Process Data -> Render Results: "response"
```

### Swimlanes

Use `#lane` to assign nodes to horizontally stacked swimlane columns. Nodes inside a lane are implicitly chained. Cross-lane connections must be explicit (`->`).

```
#lane Customer
  #start Report Issue
  Provide Details

#lane Support
  Triage Ticket
  #decision Severity?
    -> high: Escalate
    -> low: Apply Fix

#lane Engineering
  Investigate Root Cause
  Deploy Fix

// Cross-lane edges
Provide Details -> Triage Ticket
Escalate -> Investigate Root Cause
Deploy Fix -> #end Resolved
```

Each lane gets a colored background with a rotated header label on the left. Cardinal port routing automatically selects N/S/E/W anchor points and spreads multiple connections along node edges to avoid overlap.

### Layout — Structured Grid (TB default)

Top-down (`@direction TB`) flowcharts use a **structured grid** layout
by default. The methodology is the "paper-cutout" / infinite-grid
approach:

1. **Footprint first.** Every node's text is wrapped to a fixed default
   width (200px), and the node's height grows to fit the wrapped lines
   *before* placement begins. Nodes never resize after they're cut out.
2. **Main column + side columns.** The main flow lives in a center
   column. When a `#decision` has multiple outgoing branches, the
   "natural" continuation (`yes` / unconditional / first-declared)
   stays in the source's column; alternate branches (`no`, custom
   labels) get their own side column to the East or West.
3. **Reserved channels.** Between every pair of adjacent columns sits a
   routing channel. Outer channels run beyond the leftmost and rightmost
   columns. Long-skip edges that would otherwise pierce a downstream
   node are routed through these channels rather than threaded through
   shapes.
4. **Convergence.** When a side branch re-references an existing node,
   the router uses an outer-channel skip: exit the source's side, drop
   (or rise) past every bypassed row, then re-enter the target from the
   side or top.

Override or disable explicitly:

```
@layout grid     // force grid layout (the default for TB)
@layout dagre    // fall back to the dagre-powered layout
```

Grid layout is automatically bypassed when `#lane` swimlanes or
`#group` containers are present, or when the direction is not TB —
those paths use dagre.

**Limitations (current pass):**
- Two-level branch nesting at most. A decision deep inside a side branch
  places sub-branches one column further out but doesn't reflow the
  parent grid.
- Multi-way (>3) decisions get side columns; the engine balances East/West
  adaptively but very wide fans can still crowd.
- This is a flow-aware *node placer*, not a constraint solver.
  Pathologically dense flows may still produce overlap; the existing
  Visio-style line-jumps post-pass is the final fallback.

### Edge Routing

The orthogonal router scores candidate (exit, entry) cardinal pairs
based on the relative geometry of the source and target nodes. The
selection rewards:

- exits and entries aligned with the source→target offset,
- top-entry into a `#decision` diamond when the source sits above it,
- side-exit from the source when the target is diagonally offset
  (avoids the awkward "out the bottom, then jog hard sideways" path),
- fewer bends and clean L-shapes over U-turns.

When two orthogonal edge segments must cross, the renderer draws a
small Visio-style **line jump** (an arc bump) on the lower-priority
edge so it visually steps over the other. Priority rules:

- Retry / dashed edges (`~>`) yield to plain edges.
- Otherwise, the later edge in document order yields.
- Shared endpoints (two edges leaving the same port) do **not** count
  as crossings; collinear / parallel overlap also doesn't trigger a
  hop.

Disable line jumps globally with `@line-jumps off`. There is currently
no per-edge override or theme-level styling for hops — those are listed
under the Roadmap.

### Comments

```
// This is a comment
#start Begin
  Step One    // inline comments are not supported — use a full line
  #end Done
```

---

## Project Structure

```
flowscript/
├── src/
│   ├── index.ts              # Public API
│   ├── cli.ts                # CLI entry point
│   ├── parser/
│   │   ├── ast.ts            # AST type definitions
│   │   ├── lexer.ts          # Tokenizer
│   │   └── parser.ts         # Recursive descent parser
│   ├── layout/
│   │   ├── dagre-layout.ts   # Layout entry point; delegates to grid or dagre
│   │   ├── grid-layout.ts    # Structured grid engine (TB default)
│   │   ├── router.ts         # Edge routing (orthogonal, bezier, polyline)
│   │   ├── port-reservation.ts # Cardinal port assignment (N/S/E/W)
│   │   └── shape-ports.ts    # Port geometry per shape type
│   ├── render/
│   │   ├── svg.ts            # SVG renderer
│   │   ├── svg-tree.ts       # Virtual SVG tree
│   │   └── shapes/
│   │       └── index.ts      # Shape renderers (11 types)
│   └── themes/
│       └── clean.ts          # Default theme
├── src/
│   └── mcp-server.ts         # MCP server (compile_flow + render_flow tools)
│   └── compiler/
│       └── json-to-flow.ts   # JSON graph → .flow compiler (for LLM output)
├── server/                   # Self-hosted SOP generator (Bun HTTP + Docker)
│   ├── index.ts              # HTTP server (/generate, /status)
│   ├── llm.ts                # OpenAI-compatible LLM extraction
│   ├── extract.ts            # PDF/DOCX/URL/text extraction
│   └── ui/index.html         # Web UI
├── editor/                   # Browser bundle for live .flow editor
├── test/
│   └── fixtures/             # Example .flow files
├── package.json
└── tsconfig.json
```

---

## Architecture

FlowScript processes diagrams through a four-stage pipeline:

```
Source Text → Parse → Layout → Route → Render
```

1. **Parse** — Lexer tokenizes, recursive descent parser builds an AST (`FlowDocument` with nodes, edges, groups, directives)
2. **Layout** — Grid engine (TB default) or Dagre assigns x/y coordinates to every node; grid layout uses named columns and outer routing channels
3. **Route** — Edge router computes connection paths (orthogonal with rounded corners by default)
4. **Render** — SVG renderer walks the AST + routes and produces a virtual SVG tree, then serializes to string

The virtual SVG tree (`{ tag, attrs, children }`) is designed to support both static string output and future DOM-based interactive rendering.

---

## SVG Output Conventions

Every rendered SVG follows a consistent structure with CSS classes and data attributes designed for post-render manipulation — highlighting active steps, theming, or building interactive overlays.

### Document Structure

```xml
<svg class="fs-diagram" viewBox="0 0 W H" width="W" height="H">
  <defs>...</defs>          <!-- Arrow markers, drop shadow filter -->
  <g class="fs-edges">      <!-- All connections -->
    <g class="fs-edge">...</g>
  </g>
  <g class="fs-nodes">      <!-- All shapes -->
    <g class="fs-node">...</g>
  </g>
</svg>
```

Nodes render above edges (painters order). Groups render as background containers behind both.

### Node Attributes

Every node is a `<g>` element with:

| Attribute | Example | Description |
|---|---|---|
| `class` | `fs-node` | Always present on every node group |
| `data-node-id` | `n1`, `n2`, `n3` | Stable identifier, assigned in parse order |
| `data-shape` | `start`, `decision`, `process` | The shape type keyword |

Inside each node group:
- A shape element (`<rect>`, `<polygon>`, `<ellipse>`, etc.) with fill/stroke
- A `<text class="fs-label">` element containing the node label

```xml
<g class="fs-node" data-node-id="n3" data-shape="decision">
  <g filter="url(#fs-shadow)">
    <polygon points="..." fill="#fff8e1" stroke="#f9a825"/>
  </g>
  <text class="fs-label">Approved?</text>
</g>
```

### Edge Attributes

Every edge is a `<g>` element with:

| Attribute | Example | Description |
|---|---|---|
| `class` | `fs-edge` | Always present on every edge group |
| `data-from` | `n1` | Source node ID |
| `data-to` | `n3` | Target node ID |

Inside each edge group:
- A `<path class="fs-edge-path">` with the routed connection
  - Retry / dashed edges (written with `~>`, or with the legacy magic
    labels `try again` / `resend`) carry the additional class
    `fs-edge-retry` and a `stroke-dasharray`.
- An optional `<text class="fs-edge-label">` for labeled edges (e.g., "yes", "no", "try again")

```xml
<g class="fs-edge" data-from="n3" data-to="n4">
  <path class="fs-edge-path" d="M130,388 L130,468" .../>
  <text class="fs-edge-label">yes</text>
</g>
```

### Step-Through / State-Based Styling

The class and data-attribute conventions make it straightforward to implement step-through visualization — highlighting the current step, dimming visited steps, and fading upcoming ones. No AST traversal required; just target SVG elements by selector.

**Node states for SOP / runbook step-through:**

| State | Meaning | Suggested Style |
|---|---|---|
| Active | Current step | Teal border, filled background, checkmark icon |
| Visited | Completed steps | Muted teal tint, reduced opacity (0.7) |
| Upcoming | Next reachable steps | Dashed border, slightly faded |
| Out of scope | Unreachable from current path | Heavily faded (opacity 0.3) |

**Example CSS overlay:**

```css
/* Dim everything by default */
.fs-node { opacity: 0.3; transition: opacity 0.3s; }
.fs-edge { opacity: 0.3; transition: opacity 0.3s; }

/* Visited steps — muted but visible */
.fs-node.visited { opacity: 0.7; }
.fs-node.visited rect,
.fs-node.visited polygon { stroke: #4f98a3; fill: #e8f5f7; }

/* Active step — full emphasis */
.fs-node.active { opacity: 1; }
.fs-node.active rect,
.fs-node.active polygon { stroke: #01696f; stroke-width: 2.5; fill: #d4f0f2; }

/* Upcoming steps — dashed, slightly visible */
.fs-node.upcoming { opacity: 0.6; }
.fs-node.upcoming rect,
.fs-node.upcoming polygon { stroke-dasharray: 6 3; }

/* Edges along the active path */
.fs-edge.visited { opacity: 0.7; }
.fs-edge.active { opacity: 1; }
.fs-edge.active .fs-edge-path { stroke: #01696f; stroke-width: 2; }
```

**JavaScript targeting:**

```javascript
// Select a node by ID
const node = svg.querySelector('[data-node-id="n5"]');
node.classList.add('active');

// Select all edges leaving a node
const outgoing = svg.querySelectorAll('[data-from="n5"]');

// Select all edges arriving at a node
const incoming = svg.querySelectorAll('[data-to="n5"]');

// Select by shape type
const decisions = svg.querySelectorAll('[data-shape="decision"]');
```

### Node ID Mapping

Node IDs (`n1`, `n2`, ...) are assigned sequentially in parse order. To build a lookup from label to ID, use the AST or walk the SVG:

```javascript
// Build label → ID map from the rendered SVG
const labelMap = {};
svg.querySelectorAll('.fs-node').forEach(g => {
  const id = g.getAttribute('data-node-id');
  const label = g.querySelector('.fs-label')?.textContent;
  if (id && label) labelMap[label] = id;
});
// labelMap = { "Submit Request": "n1", "Validate": "n2", ... }
```

---

## Roadmap

- [x] Swimlanes (`#lane` keyword for actor/persona attribution with horizontal stacking)
- [x] Cardinal port routing (N/S/E/W anchor points with port spreading)
- [x] Centralized shape port abstraction with circle / decision support
- [x] Explicit retry / dashed edge syntax (`~>`)
- [x] Relative-position-aware port scoring (clean L-shapes for diagonal source→decision routes)
- [x] Visio-style line jumps for unavoidable orthogonal crossings (`@line-jumps off` to disable)
- [x] Structured grid layout for TB (paper-cutout footprints, side-column branch placement, outer-channel skip routing)
- [x] MCP server (`compile_flow` + `render_flow` tools over stdio)
- [x] JSON graph → `.flow` compiler (`jsonToFlow()`) for LLM-generated diagrams
- [x] Self-hosted SOP generator (Docker, OpenAI-compatible LLM, PDF/DOCX/URL/text ingestion)
- [x] Auto-fallback to Dagre when grid layout produces column explosion
- [ ] Generator + live editor unified into single app (one URL, "Edit .flow" button handoff)
- [ ] PNG export (client-side canvas, download + clipboard)
- [ ] CodeMirror editor with rename-all-instances (symbol rename) and syntax highlighting
- [ ] Swimlane v2: inline cross-lane edges + `@lane-direction TB` for row-based orientation
- [ ] Per-edge `jump` override / theme-level hop styling (radius, shape, color)
- [ ] `#io` parallelogram custom ports (currently falls back to rect)
- [ ] `opentype.js` text measurement (replacing character-width heuristic)
- [ ] Dark theme
- [ ] Pre-laid-out AST mode (lightweight ~15KB browser bundle)
- [ ] elkjs layout engine option (v2)
- [ ] Animation / step-through playback

---

## License

AGL
