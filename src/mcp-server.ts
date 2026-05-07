#!/usr/bin/env node
/**
 * FlowScript MCP Server
 *
 * Exposes two tools over the Model Context Protocol (stdio transport):
 *
 *   compile_flow  — JSON process graph → FlowScript + SVG (deterministic)
 *   render_flow   — FlowScript source  → SVG
 *
 * Usage (Claude Desktop / any MCP-capable agent):
 *   npx flowscript mcp
 *
 * The caller's LLM handles process understanding; this server handles
 * FlowScript syntax and SVG rendering. No LLM inside, no token burn.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { jsonToFlow, type JsonGraph } from './compiler/json-to-flow.js';
import { render } from './index.js';

// ─── Tool schemas ────────────────────────────────────────────────────────────

const COMPILE_FLOW_SCHEMA = {
  type: 'object',
  description: 'Process graph to compile into a FlowScript diagram.',
  properties: {
    title: {
      type: 'string',
      description: 'Diagram title (shown in frontmatter)',
    },
    subtitle: {
      type: 'string',
      description: 'Diagram subtitle (shown under title)',
    },
    theme: {
      type: 'string',
      description: 'Theme name — "clean" (light, default) or "clean-dark" (dark)',
      enum: ['clean', 'clean-dark'],
    },
    direction: {
      type: 'string',
      description: 'Layout direction. Default "TB" (top-to-bottom).',
      enum: ['TB', 'LR', 'BT', 'RL'],
    },
    nodes: {
      type: 'array',
      description: 'Process steps. Every node must have a unique id and a human-readable label.',
      items: {
        type: 'object',
        properties: {
          id:    { type: 'string', description: 'Unique node identifier (e.g. "n1")' },
          label: { type: 'string', description: 'Display text shown inside the shape' },
          shape: {
            type: 'string',
            description: 'Shape type. Use "start" for the first node, "end" for the last, "decision" for branches, "process" (default) for everything else.',
            enum: ['start', 'end', 'process', 'decision', 'subprocess', 'io', 'data', 'note', 'manual', 'delay', 'circle'],
          },
        },
        required: ['id', 'label'],
      },
      minItems: 1,
    },
    edges: {
      type: 'array',
      description: 'Connections between nodes.',
      items: {
        type: 'object',
        properties: {
          from:      { type: 'string', description: 'Source node id' },
          to:        { type: 'string', description: 'Target node id' },
          condition: { type: 'string', description: 'Branch condition label (e.g. "yes", "no", "P1"). Required for decision branches.' },
          label:     { type: 'string', description: 'Optional edge label (appears alongside the arrow)' },
          retry:     { type: 'boolean', description: 'Set true for loop-back / retry edges — renders as a dashed arrow' },
        },
        required: ['from', 'to'],
      },
    },
  },
  required: ['nodes', 'edges'],
} as const;

const RENDER_FLOW_SCHEMA = {
  type: 'object',
  properties: {
    source: {
      type: 'string',
      description: 'Valid FlowScript (.flow) source text to render',
    },
    theme: {
      type: 'string',
      description: 'Theme override — "clean" (light) or "clean-dark" (dark). If omitted, the @theme directive in source takes effect.',
      enum: ['clean', 'clean-dark'],
    },
  },
  required: ['source'],
} as const;

// ─── Server ──────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'flowscript', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'compile_flow',
      description:
        'Compile a process graph into a FlowScript diagram and SVG. ' +
        'Extract the process steps and connections from the source material ' +
        '(SOP, description, flowchart), then pass them as nodes and edges. ' +
        'You do not need to know FlowScript syntax — the tool handles that. ' +
        'Returns { flow, svg } where `flow` is the human-readable source and `svg` is the rendered diagram.',
      inputSchema: COMPILE_FLOW_SCHEMA,
    },
    {
      name: 'render_flow',
      description:
        'Render a FlowScript source string to SVG. ' +
        'Use this when you already have a .flow source (e.g. from compile_flow). ' +
        'Returns the SVG string.',
      inputSchema: RENDER_FLOW_SCHEMA,
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'compile_flow') {
    const graph = args as JsonGraph;
    try {
      const flow = jsonToFlow(graph);
      const svg  = render(flow);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ flow, svg }),
          },
        ],
      };
    } catch (err) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `compile_flow failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (name === 'render_flow') {
    const { source, theme } = args as { source: string; theme?: string };
    try {
      const svg = theme
        ? render(source, { theme: (await import('./themes/index.js')).resolveTheme(theme) })
        : render(source);
      return {
        content: [{ type: 'text' as const, text: svg }],
      };
    } catch (err) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `render_flow failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});

// ─── Entry point ─────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
