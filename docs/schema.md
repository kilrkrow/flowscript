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

## Integrating with an LLM

### Why LLMs can't call /compile directly

Most hosted LLMs (Grok, Gemini, GPT, etc.) run in sandboxed environments that block outbound HTTP. Telling the model to POST to `/compile` will fail with "connection refused" — this is a network restriction, not an instruction problem.

**MCP-native tools** (Claude in Cursor, etc.) already work because the MCP server handles the network hop on the client side. The LLM never touches the network directly.

### The correct pattern — function/tool calling

Register `compile_flow` as a tool in your LLM's function-calling interface. Your backend makes the HTTP call; the LLM just produces the arguments.

```
LLM → calls compile_flow(JsonGraph) → your backend POSTs to /compile → returns { flow, svg }
```

**Tool definition (OpenAI / xAI / Gemini compatible):**

```json
{
  "name": "compile_flow",
  "description": "Compile a process graph into a FlowScript diagram and return the rendered SVG.",
  "parameters": {
    "type": "object",
    "properties": {
      "title":     { "type": "string" },
      "subtitle":  { "type": "string" },
      "theme":     { "type": "string" },
      "direction": { "type": "string", "enum": ["TB", "BT", "LR", "RL"] },
      "nodes": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id":    { "type": "string" },
            "label": { "type": "string" },
            "shape": { "type": "string" }
          },
          "required": ["id", "label"]
        }
      },
      "edges": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "from":      { "type": "string" },
            "to":        { "type": "string" },
            "condition": { "type": "string" },
            "label":     { "type": "string" },
            "retry":     { "type": "boolean" }
          },
          "required": ["from", "to"]
        }
      }
    },
    "required": ["nodes", "edges"]
  }
}
```

Your tool implementation performs the POST:

```typescript
async function compile_flow(graph: JsonGraph): Promise<{ flow: string; svg: string }> {
  const res = await fetch('https://flowscript.foxanddoveconsulting.com/compile', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(graph),
  });
  return res.json();
}
```

### System prompt

```
You are a process analysis assistant. When asked to diagram a process, call the
compile_flow tool with a JsonGraph describing the process as nodes and edges.

Schema reference: https://raw.githubusercontent.com/kilrkrow/flowscript/master/docs/schema.md
```

### MCP (Claude / Cursor)

Point your MCP client at the FlowScript MCP server and call `compile_flow` directly — no extra setup needed.

```json
{ "tool": "compile_flow", "input": { ...JsonGraph... } }
```

---

## Validation rules

FlowScript will reject a `JsonGraph` that:
- Has no nodes
- Has a node missing `id` or `label`
- Has duplicate node `id` values
- Has an edge referencing an unknown node `id`

All other fields are optional and have safe defaults.
