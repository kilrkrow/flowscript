/**
 * Layout engine using dagre for hierarchical/layered node positioning.
 * 
 * Takes a FlowDocument AST and assigns (x, y, width, height) to every node and group.
 * Does NOT handle edge routing — that's the router's job.
 */

import * as dagre from '@dagrejs/dagre';
const { Graph } = dagre;
import type { FlowDocument, FlowNode, Direction } from '../parser/ast.js';
import { getDirection, getDirective } from '../parser/ast.js';

/** Default node dimensions by shape type */
const SHAPE_SIZES: Record<string, { width: number; height: number }> = {
  start:      { width: 180, height: 44 },
  end:        { width: 180, height: 44 },
  decision:   { width: 160, height: 100 }, // diamond needs more vertical space
  process:    { width: 180, height: 44 },
  subprocess: { width: 180, height: 44 },
  io:         { width: 180, height: 44 },
  data:       { width: 160, height: 50 },
  circle:     { width: 60,  height: 60 },
  note:       { width: 180, height: 60 },
  manual:     { width: 180, height: 44 },
  delay:      { width: 180, height: 44 },
};

/**
 * Estimate text width based on character count.
 * This is a rough heuristic — will be replaced by opentype.js measurement.
 */
function estimateTextWidth(text: string, fontSize: number = 13): number {
  // Average character width for Inter at a given font size
  const avgCharWidth = fontSize * 0.58;
  return text.length * avgCharWidth + 32; // +32 for padding
}

/**
 * Run dagre layout on the document, assigning positions to all nodes.
 */
export function layoutDocument(doc: FlowDocument): void {
  const direction = getDirection(doc);
  const spacing = parseInt(getDirective(doc, 'spacing', '60'), 10);

  const g = new Graph({ compound: true });
  g.setGraph({
    rankdir: direction,
    nodesep: spacing,
    ranksep: spacing + 20,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Add group nodes (compound parents)
  for (const group of doc.groups) {
    g.setNode(group.id, {
      label: group.label,
      clusterLabelPos: 'top',
    });
  }

  // Add nodes
  for (const [id, node] of doc.nodes) {
    const defaults = SHAPE_SIZES[node.shape] ?? SHAPE_SIZES.process;
    const textWidth = estimateTextWidth(node.label);
    const width = Math.max(defaults.width, textWidth);
    const height = defaults.height;

    node.width = width;
    node.height = height;

    g.setNode(id, { width, height, label: node.label });

    // Assign to group if applicable
    if (node.group) {
      g.setParent(id, node.group);
    }
  }

  // Add edges
  for (const edge of doc.edges) {
    g.setEdge(edge.from, edge.to, {
      label: edge.label ?? '',
      minlen: 1,
      weight: edge.condition ? 1 : 2, // Give unconditional edges more weight
    });
  }

  // Run layout
  dagre.layout(g);

  // Write positions back to AST
  for (const [id, node] of doc.nodes) {
    const layoutNode = g.node(id);
    if (layoutNode) {
      node.x = layoutNode.x;
      node.y = layoutNode.y;
      node.width = layoutNode.width;
      node.height = layoutNode.height;
    }
  }

  // Write group positions
  for (const group of doc.groups) {
    const layoutNode = g.node(group.id);
    if (layoutNode) {
      group.x = layoutNode.x;
      group.y = layoutNode.y;
      group.width = layoutNode.width;
      group.height = layoutNode.height;
    }
  }

  // Store dagre's edge points for the router to refine
  for (const edge of doc.edges) {
    const dagreEdge = g.edge(edge.from, edge.to);
    if (dagreEdge?.points) {
      edge.points = dagreEdge.points.map((p: { x: number; y: number }) => ({
        x: Math.round(p.x),
        y: Math.round(p.y),
      }));
    }
  }
}
