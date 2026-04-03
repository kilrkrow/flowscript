# FlowScript

A diagram-as-code DSL that renders clean, Visio-quality flowcharts from human-readable text.

```
#start User Visits Signup Page
  Enter Email & Password
  #decision Email Already Exists?
    -> yes: Show Error Message
    -> no: Create Account
  Show Error Message -> Enter Email & Password: "try again"
  Create Account
    Send Verification Email
    #end Registration Complete
```

**[Try the Live Editor →](https://www.perplexity.ai/computer/a/flowscript-live-editor-rxkmC_zBQVOO5UnEU9dCRw)**

---

## Features

- **Readable DSL** — indentation-driven, keyword-heavy syntax anyone can write
- **11 shape types** — start, end, decision, process, subprocess, I/O, data, circle, note, manual, delay
- **Orthogonal edge routing** — right-angle connections with rounded corners
- **Automatic layout** — Dagre-powered node positioning, no manual coordinates
- **Themes** — clean default theme, extensible theme system
- **4 flow directions** — top-to-bottom, bottom-to-top, left-to-right, right-to-left
- **Edge labels** — named connections with quoted labels on any edge
- **Loop-backs** — re-reference any node to create cycles
- **Groups** — logical grouping with labeled containers
- **Comments** — `//` line comments anywhere
- **Frontmatter** — YAML-style metadata header (`title`, `author`, etc.)
- **Export** — SVG output (PNG/PDF planned)

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
  -> yes: Send Confirmation
  -> no: Send Rejection
```

**Multi-way branching:**

```
#decision Priority?
  -> P1: Page On-Call
  -> P2: Assign Team Lead
  -> P3: Add to Backlog
```

**Loop-backs** — reference an existing node by name:

```
#decision Retry?
  -> yes: Step One
  -> no: #end Done
```

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
│   │   ├── dagre-layout.ts   # Dagre layout adapter
│   │   └── router.ts         # Edge routing (orthogonal, bezier, polyline)
│   ├── render/
│   │   ├── svg.ts            # SVG renderer
│   │   ├── svg-tree.ts       # Virtual SVG tree
│   │   └── shapes/
│   │       └── index.ts      # Shape renderers (11 types)
│   └── themes/
│       └── clean.ts          # Default theme
├── editor/                   # Live browser editor (Monaco)
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
2. **Layout** — Dagre assigns x/y coordinates to every node
3. **Route** — Edge router computes connection paths (orthogonal with rounded corners by default)
4. **Render** — SVG renderer walks the AST + routes and produces a virtual SVG tree, then serializes to string

The virtual SVG tree (`{ tag, attrs, children }`) is designed to support both static string output and future DOM-based interactive rendering.

---

## Roadmap

- [ ] Swimlanes (`lane` keyword for actor/persona attribution)
- [ ] Cardinal port routing (N/S/E/W anchor points with port spreading)
- [ ] `opentype.js` text measurement (replacing character-width heuristic)
- [ ] Dark theme
- [ ] PNG and PDF export
- [ ] Pre-laid-out AST mode (lightweight ~15KB browser bundle)
- [ ] elkjs layout engine option (v2)
- [ ] Animation / step-through playback

---

## License

MIT
