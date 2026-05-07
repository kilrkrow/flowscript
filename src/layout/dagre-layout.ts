/**
 * Layout engine using dagre for hierarchical/layered node positioning.
 * 
 * Takes a FlowDocument AST and assigns (x, y, width, height) to every node and group.
 * Does NOT handle edge routing — that's the router's job.
 */

import * as dagre from '@dagrejs/dagre';
const { Graph } = dagre;
import type { FlowDocument, FlowNode, FlowLane, Direction } from '../parser/ast.js';
import { getDirection, getDirective } from '../parser/ast.js';
import { gridLayout, shouldUseGridLayout, type GridLayoutMeta } from './grid-layout.js';

/**
 * Last grid layout metadata from the most recent call to layoutDocument
 * for which grid mode was active. The router consults this to enable
 * channel routing for skip edges. Stored as a doc-keyed weak map so
 * concurrent renders don't trample each other.
 */
const gridMetaForDoc: WeakMap<FlowDocument, GridLayoutMeta> = new WeakMap();

/** Public accessor — used by the router. */
export function getGridMeta(doc: FlowDocument): GridLayoutMeta | undefined {
  return gridMetaForDoc.get(doc);
}

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
  // Structured grid layout is the default for plain TB flows. It does
  // its own footprint sizing and placement; dagre is bypassed.
  if (shouldUseGridLayout(doc)) {
    const meta = gridLayout(doc);

    // Auto-fallback: if the grid engine needed more than one level of side
    // columns (i.e., W2/E2 or beyond were created), the canvas becomes
    // excessively wide (column explosion). Re-run with dagre in that case.
    // Authors can pin to grid with `@layout grid` to override.
    const hasColumnExplosion = getDirective(doc, 'layout', '') !== 'grid' &&
      [...meta.columns.values()].some(c => c.level > 1);

    if (!hasColumnExplosion) {
      gridMetaForDoc.set(doc, meta);
      return;
    }
    // Column explosion detected — fall through to dagre.
  }
  // Otherwise, fall back to dagre.
  gridMetaForDoc.delete(doc);

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

  // If we have lanes, reposition nodes into swimlane columns
  if (doc.lanes.length > 0) {
    applySwimlaneLayout(doc, spacing);
  }
}

// ── Swimlane post-layout ──────────────────────────────────────────────

/**
 * After dagre assigns y positions (ranks), reposition nodes into
 * horizontally stacked lane columns. The y position from dagre is
 * preserved so that cross-lane edges line up vertically.
 *
 * Layout strategy:
 * 1. Use dagre's y positions as the row (rank) assignment.
 * 2. Assign each lane a column of fixed width.
 * 3. Center each node horizontally within its lane column.
 * 4. Nodes without a lane get placed in an "unassigned" overflow column.
 */
function applySwimlaneLayout(doc: FlowDocument, spacing: number): void {
  const LANE_PAD = 40;        // Internal horizontal padding per lane
  const LANE_GAP = 8;         // Gap between lane columns
  const HEADER_WIDTH = 120;   // Lane header left strip

  // 1. Determine the max width needed per lane
  const laneNodeWidths = new Map<string, number>();
  for (const lane of doc.lanes) {
    let maxW = 180;
    for (const nid of lane.children) {
      const node = doc.nodes.get(nid);
      if (node) maxW = Math.max(maxW, node.width ?? 180);
    }
    laneNodeWidths.set(lane.id, maxW);
  }

  // 2. Compute lane column X positions (left-to-right)
  const laneX = new Map<string, { left: number; center: number; width: number }>();
  let xCursor = HEADER_WIDTH;
  for (const lane of doc.lanes) {
    const nodeW = laneNodeWidths.get(lane.id) ?? 180;
    const colWidth = nodeW + LANE_PAD * 2;
    laneX.set(lane.id, {
      left: xCursor,
      center: xCursor + colWidth / 2,
      width: colWidth,
    });
    xCursor += colWidth + LANE_GAP;
  }

  // 3. Collect all unique y-ranks from dagre (these are the rows)
  const yValues = new Set<number>();
  for (const [_, node] of doc.nodes) {
    if (node.y !== undefined) yValues.add(Math.round(node.y));
  }

  // 4. Reposition nodes into their lane columns
  for (const [_, node] of doc.nodes) {
    if (node.lane) {
      const col = laneX.get(node.lane);
      if (col) {
        node.x = col.center;
      }
    }
  }

  // 5. Handle multiple nodes in the same lane at the same rank.
  //    Stack them vertically with spacing if they collide.
  const rankBuckets = new Map<string, FlowNode[]>();
  for (const [_, node] of doc.nodes) {
    if (!node.lane) continue;
    const key = `${node.lane}::${Math.round(node.y ?? 0)}`;
    if (!rankBuckets.has(key)) rankBuckets.set(key, []);
    rankBuckets.get(key)!.push(node);
  }
  for (const [_, bucket] of rankBuckets) {
    if (bucket.length <= 1) continue;
    const totalH = bucket.reduce((sum, n) => sum + (n.height ?? 44), 0) + (bucket.length - 1) * 20;
    let yOff = (bucket[0].y ?? 0) - totalH / 2 + (bucket[0].height ?? 44) / 2;
    for (const n of bucket) {
      n.y = yOff + (n.height ?? 44) / 2;
      yOff += (n.height ?? 44) + 20;
    }
  }

  // 6. Compute overall y bounds (top/bottom extent of all nodes)
  let minY = Infinity, maxY = -Infinity;
  for (const [_, node] of doc.nodes) {
    if (node.y === undefined) continue;
    const hh = (node.height ?? 44) / 2;
    minY = Math.min(minY, node.y - hh);
    maxY = Math.max(maxY, node.y + hh);
  }
  if (minY === Infinity) { minY = 0; maxY = 400; }

  const topPad = 40;
  const bottomPad = 40;

  // 7. Write lane geometry back to AST
  for (const lane of doc.lanes) {
    const col = laneX.get(lane.id);
    if (!col) continue;
    lane.width = col.width;
    lane.height = (maxY - minY) + topPad + bottomPad;
    lane.x = col.left + col.width / 2;
    lane.y = minY - topPad + lane.height / 2;
  }
}
