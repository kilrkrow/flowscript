/**
 * jsonToFlow — deterministic JSON graph → FlowScript compiler.
 *
 * Takes a structured process graph (nodes + edges) and emits valid FlowScript
 * source text. The caller's LLM supplies the graph; this function handles all
 * FlowScript syntax. No FlowScript knowledge required of the caller.
 *
 * Design goals:
 * - Always produces parseable, renderable FlowScript output
 * - Back-edges (loops/retries) emitted as explicit `->` or `~>` at the bottom
 * - Implicit chaining used where safe; explicit `->` breaks used to prevent
 *   unwanted edges between unrelated parallel-branch nodes
 * - Convergence nodes pre-declared inline by the first predecessor's `->` line
 */

import type { ShapeType } from '../parser/ast.js';

// ─── Public types ────────────────────────────────────────────────────────────

export interface JsonNode {
  id:     string;
  label:  string;
  shape?: ShapeType | 'process';
}

export interface JsonEdge {
  from:       string;
  to:         string;
  condition?: string;   // 'yes' | 'no' | custom — for decision branches
  label?:     string;   // optional edge label
  retry?:     boolean;  // true → dashed ~> rendering (loop-back / retry)
}

export interface JsonGraph {
  title?:     string;
  subtitle?:  string;
  theme?:     string;
  direction?: 'TB' | 'BT' | 'LR' | 'RL';
  nodes:      JsonNode[];
  edges:      JsonEdge[];
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function jsonToFlow(graph: JsonGraph): string {
  validate(graph);

  // Build adjacency maps
  const nodeById = new Map<string, JsonNode>(graph.nodes.map(n => [n.id, n]));
  const outById  = new Map<string, JsonEdge[]>(graph.nodes.map(n => [n.id, []]));
  const inById   = new Map<string, JsonEdge[]>(graph.nodes.map(n => [n.id, []]));

  for (const e of graph.edges) {
    outById.get(e.from)!.push(e);
    inById.get(e.to)!.push(e);
  }

  // Topological sort (Kahn's algorithm)
  const inDeg = new Map<string, number>(
    graph.nodes.map(n => [n.id, inById.get(n.id)!.length])
  );
  const queue = graph.nodes.filter(n => inDeg.get(n.id) === 0).map(n => n.id);
  const topo: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    topo.push(id);
    for (const e of outById.get(id) ?? []) {
      const d = (inDeg.get(e.to) ?? 1) - 1;
      inDeg.set(e.to, d);
      if (d === 0) queue.push(e.to);
    }
  }

  // Nodes not reached by Kahn (part of a cycle) — append in original order
  const inTopo = new Set(topo);
  for (const n of graph.nodes) {
    if (!inTopo.has(n.id)) topo.push(n.id);
  }

  const topoIdx = new Map<string, number>(topo.map((id, i) => [id, i]));

  // Classify edges
  const isBack = (e: JsonEdge) =>
    (topoIdx.get(e.to) ?? 0) <= (topoIdx.get(e.from) ?? 0);

  const fwdEdges  = graph.edges.filter(e => !isBack(e));
  const backEdges = graph.edges.filter(e => isBack(e));

  // Helpers
  const lbl = (id: string) => sanitizeLabel(nodeById.get(id)!.label);
  const kw  = (shape: ShapeType | 'process' | undefined): string => {
    switch (shape) {
      case 'start':      return '#start';
      case 'end':        return '#end';
      case 'decision':   return '#decision';
      case 'subprocess': return '#subprocess';
      case 'io':         return '#io';
      case 'data':       return '#data';
      case 'circle':     return '#circle';
      case 'note':       return '#note';
      case 'manual':     return '#manual';
      case 'delay':      return '#delay';
      default:           return '';            // process → plain label
    }
  };
  const sanitizeLabel = (label: string) => label.replace(/\r?\n/g, ' ').trim();

  const decl = (id: string) => {
    const n = nodeById.get(id)!;
    const k = kw(n.shape);
    const l = sanitizeLabel(n.label);
    return k ? `${k} ${l}` : l;
  };
  const arrowStr = (e: JsonEdge, label?: string) => {
    const arr     = e.retry ? '~>' : '->';
    const rawLbl  = label ?? e.label;
    const lPart   = rawLbl ? `: "${sanitizeLabel(rawLbl)}"` : '';
    return `${arr}${lPart}`;
  };
  const edgeKey = (from: string, to: string) => `${from}::${to}`;

  // ── Emission ────────────────────────────────────────────────────────────────

  const lines: string[] = [];
  const declared   = new Set<string>(); // nodes whose decl line has been emitted
  const covered    = new Set<string>(); // edges captured by implicit or decision branches

  // simulated implicitPrev — mirrors parser's this.implicitPrev
  let simPrev: string | null = null;

  const markDecl = (id: string) => declared.add(id);

  /**
   * Emit a chain-breaking explicit re-reference for `fromId`.
   * Used to reset simPrev before emitting an unrelated node.
   * E.g. emits "Step A -> Step B" using the first forward out-edge of fromId.
   */
  const breakChain = (fromId: string) => {
    const outs = fwdEdges.filter(e => e.from === fromId);
    if (outs.length === 0) {
      // fromId has no forward successors — emit it with an end-node pattern
      // to break the chain. Just emit its explicit label as a re-reference
      // that will be harmless (parser finds existing node).
      // Actually: just set simPrev=null; the line is already emitted.
      simPrev = null;
      return;
    }
    // Emit re-reference: "FromLabel -> ToLabel"
    const e = outs[0];
    const arr = e.retry ? '~>' : '->';
    const lPart = e.label ? `: "${e.label}"` : '';
    // Emit declaration first so the parser gets the #keyword before the edge reference
    if (!declared.has(e.to)) {
      lines.push(decl(e.to));
      markDecl(e.to);
    }
    lines.push(`${lbl(fromId)} ${arr} ${lbl(e.to)}${lPart}`);
    covered.add(edgeKey(fromId, e.to));
    simPrev = null;
  };

  // Frontmatter
  if (graph.title || graph.subtitle) {
    lines.push('---');
    if (graph.title)    lines.push(`title: ${graph.title}`);
    if (graph.subtitle) lines.push(`subtitle: ${graph.subtitle}`);
    lines.push('---');
    lines.push('');
  }

  // Directives
  const dirLines: string[] = [];
  if (graph.theme)                               dirLines.push(`@theme ${graph.theme}`);
  if (graph.direction && graph.direction !== 'TB') dirLines.push(`@direction ${graph.direction}`);
  if (dirLines.length > 0) {
    lines.push(...dirLines, '');
  }

  // Main topo walk
  for (const id of topo) {
    if (declared.has(id)) continue;
    markDecl(id);

    const node = nodeById.get(id)!;
    const fwdOuts = fwdEdges.filter(e => e.from === id);

    // ── Decisions ────────────────────────────────────────────────────────────
    if (node.shape === 'decision') {
      // Check if simPrev would wrongly chain into this decision node
      if (simPrev !== null) {
        const wantedFromPrev = fwdEdges.some(e => e.from === simPrev && e.to === id);
        if (!wantedFromPrev) breakChain(simPrev);
        // If wanted: the implicit edge IS correct; mark it covered
        else covered.add(edgeKey(simPrev, id));
      }

      lines.push(decl(id));
      for (const e of fwdOuts) {
        const cond = e.condition ? `'${e.condition}' ` : '';
        lines.push(`  -> ${cond}${lbl(e.to)}`);
        covered.add(edgeKey(e.from, e.to));
        // Pre-declare branch targets so their topo slot is a no-op
        markDecl(e.to);
      }
      simPrev = null; // mirrors parser: decision with branches clears implicit chain

      continue;
    }

    // ── Non-decision nodes ───────────────────────────────────────────────────
    if (simPrev !== null) {
      const wantedFromPrev = node.shape !== 'start' &&
        fwdEdges.some(e => e.from === simPrev && e.to === id);

      if (wantedFromPrev) {
        // Implicit chain gives us the correct edge — mark it covered
        covered.add(edgeKey(simPrev, id));
      } else if (node.shape !== 'start') {
        // simPrev would fire an unwanted implicit edge → break first
        breakChain(simPrev);
      }
    }

    lines.push(decl(id));
    simPrev = node.shape === 'start' ? id   // start sets implicit chain
            : node.shape === 'end'   ? null // end doesn't propagate
            : id;
  }

  // ── Explicit edges at the bottom ─────────────────────────────────────────
  // Forward edges not yet covered + all back-edges
  const explicit = [
    ...fwdEdges.filter(e => !covered.has(edgeKey(e.from, e.to))),
    ...backEdges,
  ];

  if (explicit.length > 0) {
    lines.push('');
    for (const e of explicit) {
      const arr   = e.retry ? '~>' : '->';
      const cond  = e.condition ? `'${e.condition}' ` : '';
      const lPart = e.label ? `: "${sanitizeLabel(e.label)}"` : '';
      lines.push(`${lbl(e.from)} ${arr} ${cond}${lbl(e.to)}${lPart}`);
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// ─── Validation ──────────────────────────────────────────────────────────────

function validate(graph: JsonGraph): void {
  if (!graph.nodes || graph.nodes.length === 0) {
    throw new Error('jsonToFlow: graph must have at least one node');
  }

  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (!n.id)    throw new Error(`jsonToFlow: node missing id: ${JSON.stringify(n)}`);
    if (!n.label) throw new Error(`jsonToFlow: node "${n.id}" missing label`);
    if (ids.has(n.id)) throw new Error(`jsonToFlow: duplicate node id "${n.id}"`);
    ids.add(n.id);
  }

  for (const e of graph.edges ?? []) {
    if (!ids.has(e.from)) throw new Error(`jsonToFlow: edge references unknown node "${e.from}"`);
    if (!ids.has(e.to))   throw new Error(`jsonToFlow: edge references unknown node "${e.to}"`);
  }

  const hasStart = graph.nodes.some(n => n.shape === 'start') ||
                   graph.edges.every(e => graph.nodes.some(n => n.id === e.to)) === false;
  if (!hasStart) {
    // Warn but don't throw — caller may have omitted shape hints
  }
}
