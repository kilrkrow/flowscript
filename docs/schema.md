# FlowScript JsonGraph Schema

This document defines the JSON interface for generating FlowScript diagrams without knowing FlowScript syntax. Submit a `JsonGraph` object — FlowScript handles the rest.

**The contract:** you describe a process as nodes and edges. FlowScript compiles it to a clean, renderable diagram deterministically. No FlowScript syntax knowledge required.

---

## Integration options

### MCP (Claude, Cursor, and other MCP-native tools)

Point your MCP client at the FlowScript server and call `compile_flow` with a `JsonGraph`. Returns `{ flow, svg }`.

```json
{
  "tool": "compile_flow",
  "input": { ...JsonGraph... }
}
```

### REST API (any LLM, any language)

```
POST /compile
Content-Type: application/json

{ ...JsonGraph... }
```

Returns:
```json
{
  "flow": "...FlowScript source...",
  "svg": "...rendered SVG string..."
}
```

---

## JsonGraph

```typescript
{
  title?:     string;           // optional diagram title
  subtitle?:  string;           // optional subtitle
  theme?:     string;           // optional theme name (default: "clean")
  direction?: "TB"|"BT"|"LR"|"RL"; // layout direction (default: "TB")
  nodes:      JsonNode[];       // required
  edges:      JsonEdge[];       // required
}
```

---

## JsonNode

```typescript
{
  id:     string;     // unique identifier — never shown to users
  label:  string;     // text shown in the diagram
  shape?: ShapeType;  // optional — defaults to "process" (rectangle)
}
```

### Shape types

| `shape`       | Renders as                          | When to use                          |
|---------------|-------------------------------------|--------------------------------------|
| `start`       | Rounded pill (green)                | Entry point of the flow              |
| `end`         | Rounded pill (grey)                 | Terminal state                       |
| `process`     | Rectangle (default)                 | Any action or step                   |
| `decision`    | Diamond (yellow)                    | Branch point — yes/no or multi-path  |
| `subprocess`  | Rectangle with double border        | Step that expands into its own flow  |
| `io`          | Parallelogram                       | Input or output                      |
| `data`        | Parallelogram (data variant)        | Data store or data object            |
| `manual`      | Trapezoid                           | Manual/human step                    |
| `delay`       | Rounded rectangle (right only)      | Wait state or time delay             |
| `note`        | Rectangle (muted, no border)        | Annotation — not a process step      |
| `circle`      | Circle                              | Connector or junction                |

---

## JsonEdge

```typescript
{
  from:       string;   // node id
  to:         string;   // node id
  condition?: string;   // "yes" | "no" | any label — use on decision branches
  label?:     string;   // optional text on the edge
  retry?:     boolean;  // true → dashed arrow (loop-back / retry pattern)
}
```

**Rules:**
- Every `from` and `to` must reference a valid node `id`
- Decision nodes should have one edge per branch, each with a `condition`
- Back-edges (loops) render correctly — no special handling needed beyond `retry: true` for dashed styling

---

## Examples

### Linear flow

```json
{
  "title": "Password Reset",
  "nodes": [
    { "id": "start",   "label": "User requests reset",  "shape": "start" },
    { "id": "send",    "label": "Send reset email" },
    { "id": "click",   "label": "User clicks link" },
    { "id": "reset",   "label": "Enter new password" },
    { "id": "done",    "label": "Password updated",     "shape": "end" }
  ],
  "edges": [
    { "from": "start",  "to": "send"  },
    { "from": "send",   "to": "click" },
    { "from": "click",  "to": "reset" },
    { "from": "reset",  "to": "done"  }
  ]
}
```

---

### Decision branch with retry loop

```json
{
  "title": "Payment Processing",
  "nodes": [
    { "id": "start",   "label": "Checkout",             "shape": "start" },
    { "id": "charge",  "label": "Attempt charge" },
    { "id": "check",   "label": "Payment successful?",  "shape": "decision" },
    { "id": "confirm", "label": "Send confirmation",    },
    { "id": "retry",   "label": "Prompt retry" },
    { "id": "done",    "label": "Order complete",       "shape": "end" },
    { "id": "fail",    "label": "Order cancelled",      "shape": "end" }
  ],
  "edges": [
    { "from": "start",   "to": "charge"  },
    { "from": "charge",  "to": "check"   },
    { "from": "check",   "to": "confirm", "condition": "yes" },
    { "from": "check",   "to": "retry",   "condition": "no"  },
    { "from": "confirm", "to": "done"    },
    { "from": "retry",   "to": "charge",  "retry": true, "label": "try again" },
    { "from": "retry",   "to": "fail",    "condition": "give up" }
  ]
}
```

---

## Prompt template for LLMs

If you're wiring an LLM to FlowScript, include this in your system prompt:

```
You are a process analysis assistant. When asked to diagram a process, respond
with a JSON object matching this schema — nothing else:

{
  "title": "<short title>",
  "direction": "TB",
  "nodes": [
    { "id": "<unique_id>", "label": "<step text>", "shape": "<shape>" }
  ],
  "edges": [
    { "from": "<id>", "to": "<id>", "condition": "<optional>", "retry": false }
  ]
}

Shape values: start, end, process (default), decision, subprocess, io, manual, delay, note, circle.
Use "decision" for any branch or yes/no choice. Use "retry": true for loop-back edges.
Every node id must be unique. Every edge must reference valid node ids.
Submit this JSON to POST /compile to receive the rendered SVG.
```

---

## Validation rules

FlowScript will reject a `JsonGraph` that:
- Has no nodes
- Has a node missing `id` or `label`
- Has duplicate node `id` values
- Has an edge referencing an unknown node `id`

All other fields are optional and have safe defaults.
