/**
 * Structured grid layout for top-down (TB) FlowScript flowcharts.
 *
 * Methodology — paper-cutout / infinite-grid:
 *   1. Compute every node's footprint (with text wrapping) before
 *      placement. Nodes never resize after they're cut out.
 *   2. Walk the document in declaration order, building a chain of
 *      grid rows. Each row holds one main-flow node; side branches
 *      (decision alternates that aren't the natural fall-through) are
 *      placed in their own column to the East or West of the main
 *      column.
 *   3. Reserve vertical "channels" between columns for edge routing.
 *      The router places long-skip edges (e.g., a `No` branch that
 *      bypasses several downstream rows) into these channels rather
 *      than threading them through nodes.
 *   4. Convergence: when a branch column drops down and the flow
 *      re-merges with the main column, the branch column is reclaimed
 *      from that row onward.
 *
 * Limitations (intentional, for this pass):
 *   - Two-level branch nesting at most. A decision inside a side
 *     branch falls back to placing its sub-branch one column further
 *     out, but doesn't reflow the parent grid.
 *   - Multi-way (>3 branch) decisions get one E and one W column;
 *     surplus branches stack onto the W column.
 *   - The grid layout runs only for `@direction TB` and only when no
 *     swimlanes are declared. Other directions / swimlanes still use
 *     dagre.
 *   - This is a flow-aware *node placer*, not a constraint solver.
 *     Pathological flows may still produce overlap; the router uses
 *     line-jumps as a final fallback.
 */

import type {
  FlowDocument, FlowNode, FlowEdge,
} from '../parser/ast.js';
import { getDirection, getDirective } from '../parser/ast.js';

/** Default cell sizes — wide enough to avoid wrapping for typical labels. */
const DEFAULT_NODE_WIDTH = 200;
const DEFAULT_NODE_HEIGHT = 56;
const DECISION_WIDTH = 200;
const DECISION_HEIGHT = 110;
const CIRCLE_DIAM = 64;
const ROW_GAP = 60;          // vertical space between successive rows
const COLUMN_GAP = 80;       // horizontal space between adjacent columns
const SIDE_CHANNEL = 40;     // half-channel reserved for branch routing
const TEXT_PAD_X = 24;       // horizontal text padding inside a node
const FONT_SIZE = 13;
const CHAR_WIDTH = FONT_SIZE * 0.58;
const LINE_HEIGHT = FONT_SIZE * 1.3;

/** Decide whether grid layout should run for this document. */
export function shouldUseGridLayout(doc: FlowDocument): boolean {
  // Explicit directive overrides everything.
  const directive = getDirective(doc, 'layout', '').toLowerCase();
  if (directive === 'grid') return true;
  if (directive === 'dagre') return false;

  // Default heuristic: top-down, no swimlanes, no compound groups.
  if (getDirection(doc) !== 'TB') return false;
  if (doc.lanes.length > 0) return false;
  if (doc.groups.length > 0) return false;
  return true;
}

interface GridRow {
  /** y-coordinate of the row's center. */
  y: number;
  /** Tallest node in this row — drives row height. */
  height: number;
  /** Nodes placed in this row, keyed by column id. */
  nodes: Map<string, FlowNode>;
}

interface Column {
  /** Column identifier: 'main', 'E1', 'W1', 'E2', etc. */
  id: string;
  /** Center x-coordinate. */
  x: number;
  /** Width reserved for nodes in this column. */
  width: number;
  /** Lateral side: -1 (W), 0 (main), +1 (E). */
  side: -1 | 0 | 1;
  /** Distance from the main column (0 for main, 1 for first side, ...). */
  level: number;
}

export interface GridLayoutMeta {
  rows: GridRow[];
  columns: Map<string, Column>;
  /** Map node id -> column id where it lives. */
  nodeColumn: Map<string, string>;
  /** Map node id -> row index. */
  nodeRow: Map<string, number>;
  /** Edges that have been classified as "long skip" → route via outer channel. */
  skipEdges: Set<string>;
  /** Bounding box for downstream consumers. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * Run grid layout. Returns metadata used by the grid-aware router.
 * Mutates `doc.nodes` in place with x/y/width/height.
 */
export function gridLayout(doc: FlowDocument): GridLayoutMeta {
  // ── Step 1: footprint pass ──────────────────────────────────────────
  // Wrap text first; node sizes are frozen before any placement.
  for (const [, node] of doc.nodes) {
    sizeNodeFootprint(node);
  }

  // ── Step 2: build adjacency from edges ──────────────────────────────
  const out = new Map<string, FlowEdge[]>();
  for (const edge of doc.edges) {
    const arr = out.get(edge.from) ?? [];
    arr.push(edge);
    out.set(edge.from, arr);
  }

  // ── Step 3: walk the flow in topological-ish order ──────────────────
  const placed = new Map<string, { row: number; column: string }>();
  const rows: GridRow[] = [];
  const columns = new Map<string, Column>();
  // Always have a main column.
  columns.set('main', { id: 'main', x: 0, width: 0, side: 0, level: 0 });

  // Choose the entry node: the first declared `start`, else the first
  // node in document order with no incoming edges, else the first node.
  const incoming = new Map<string, number>();
  for (const e of doc.edges) {
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  }

  const orderedIds = [...doc.nodes.keys()];
  const startId =
    orderedIds.find(id => doc.nodes.get(id)!.shape === 'start') ??
    orderedIds.find(id => (incoming.get(id) ?? 0) === 0) ??
    orderedIds[0];

  const queue: Array<{ id: string; column: string; rowHint: number }> = [
    { id: startId, column: 'main', rowHint: 0 },
  ];
  const visiting = new Set<string>([startId]);

  while (queue.length > 0) {
    const { id, column, rowHint } = queue.shift()!;
    const node = doc.nodes.get(id);
    if (!node) continue;

    // If already placed (re-reference / convergence), keep the earlier
    // placement — but ensure that rowHint advances past it for any
    // continuation downstream. Convergence is handled by the routing
    // pass, not by re-placement.
    if (placed.has(id)) continue;

    const row = nextFreeRow(rows, column, rowHint);
    placeNode(rows, columns, node, row, column);
    placed.set(id, { row, column });

    // Enqueue children. Decision: yes-branch stays in the source column
    // (continuing the main flow), no-branch and other alternates split
    // into side columns.
    const outs = out.get(id) ?? [];
    if (node.shape === 'decision' && outs.length >= 2) {
      enqueueDecisionBranches(outs, id, row, column, queue, visiting, doc, columns, rows);
    } else {
      // Linear chain: each child continues in this node's column.
      for (const e of outs) {
        if (visiting.has(e.to)) continue;
        visiting.add(e.to);
        queue.push({ id: e.to, column, rowHint: row + 1 });
      }
    }
  }

  // Place any remaining unvisited nodes in the main column.
  for (const id of orderedIds) {
    if (placed.has(id)) continue;
    const node = doc.nodes.get(id)!;
    const row = nextFreeRow(rows, 'main');
    placeNode(rows, columns, node, row, 'main');
    placed.set(id, { row, column: 'main' });
  }

  // ── Step 4: assign coordinates ──────────────────────────────────────
  finalizeColumns(columns, rows);
  finalizeRowYs(rows);
  for (const [id, where] of placed) {
    const node = doc.nodes.get(id);
    if (!node) continue;
    const col = columns.get(where.column)!;
    const r = rows[where.row];
    node.x = col.x;
    node.y = r.y;
  }

  // ── Step 5: classify skip edges ────────────────────────────────────
  const skip = classifySkipEdges(doc, placed, rows);

  const nodeColumn = new Map<string, string>();
  const nodeRow = new Map<string, number>();
  for (const [id, where] of placed) {
    nodeColumn.set(id, where.column);
    nodeRow.set(id, where.row);
  }

  return {
    rows,
    columns,
    nodeColumn,
    nodeRow,
    skipEdges: skip,
    bounds: computeBounds(doc),
  };
}

// ── Footprint sizing ────────────────────────────────────────────────

function sizeNodeFootprint(node: FlowNode): void {
  const baseDim = baseDimsFor(node.shape);
  const lines = wrapLabel(node.label, baseDim.width);
  const height = Math.max(
    baseDim.height,
    Math.round(lines.length * LINE_HEIGHT + 24),
  );
  node.width = baseDim.width;
  node.height = height;
}

function baseDimsFor(shape: FlowNode['shape']): { width: number; height: number } {
  switch (shape) {
    case 'decision': return { width: DECISION_WIDTH, height: DECISION_HEIGHT };
    case 'circle':   return { width: CIRCLE_DIAM,   height: CIRCLE_DIAM   };
    case 'data':     return { width: DEFAULT_NODE_WIDTH, height: 60 };
    case 'note':     return { width: DEFAULT_NODE_WIDTH, height: 60 };
    default:         return { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
  }
}

/** Wrap a label to fit width, returning the lines. */
function wrapLabel(label: string, nodeWidth: number): string[] {
  const inner = nodeWidth - TEXT_PAD_X * 2;
  const maxChars = Math.max(8, Math.floor(inner / CHAR_WIDTH));
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur + ' ' + w).length > maxChars) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur + ' ' + w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length === 0) lines.push('');
  return lines;
}

// ── Placement ───────────────────────────────────────────────────────

function placeNode(
  rows: GridRow[], columns: Map<string, Column>,
  node: FlowNode, row: number, columnId: string,
): void {
  while (rows.length <= row) {
    rows.push({ y: 0, height: 0, nodes: new Map() });
  }
  rows[row].nodes.set(columnId, node);
  rows[row].height = Math.max(rows[row].height, node.height ?? DEFAULT_NODE_HEIGHT);
  // Update column width to accommodate this node.
  const col = columns.get(columnId);
  if (col) {
    col.width = Math.max(col.width, node.width ?? DEFAULT_NODE_WIDTH);
  }
}

/**
 * For a row, determine the next free row downstream of `from` for a
 * given column. In practice, returns `from + 1` unless that row is
 * already occupied in that column — then we walk further down.
 */
function nextFreeRow(
  rows: GridRow[],
  column: string,
  rowHint: number = 0,
): number {
  // Walk forward from rowHint, skipping any rows already occupied
  // in this column. This respects the caller's placement intent.
  let candidate = rowHint;
  while (candidate < rows.length && rows[candidate]?.nodes.has(column)) {
    candidate++;
  }
  return candidate;
}

/**
 * For a decision node, decide which branch stays in the source column
 * (the "main" continuation) and which branches go to side columns.
 *
 * Heuristic — driven by AST conditions:
 *   - `yes`/`true`/no condition  → main column
 *   - `no`/`false`               → first side column (E for now)
 *   - others (multi-way)         → alternate E/W in the order they appear
 *
 * If the target node is a re-reference (already placed), we don't
 * enqueue it; the router treats the edge as a skip and routes it via
 * the outer channel between the source and the existing target.
 */
/**
 * Count how many nodes are currently placed in columns on a given side
 * at or below `fromRow`. Used by the adaptive side-selection logic to
 * measure how loaded each half of the diagram already is.
 */
/** Count nodes already placed in all columns on a given side. */
function sideLoad(rows: GridRow[], side: 'E' | 'W'): number {
  let n = 0;
  for (const row of rows) {
    for (const colId of row.nodes.keys()) {
      if (side === 'E' ? colId.startsWith('E') : colId.startsWith('W')) n++;
    }
  }
  return n;
}

/**
 * Choose between two candidate sides, preferring `preferred` unless the
 * other side is substantially lighter (2× threshold with a small slack).
 * This keeps the no/false → West convention in balanced diagrams while
 * letting heavier flows balance across both sides.
 */
function adaptiveSide(
  preferred: 'E' | 'W',
  rows: GridRow[],
): 'E' | 'W' {
  const alt: 'E' | 'W' = preferred === 'W' ? 'E' : 'W';
  const prefLoad = sideLoad(rows, preferred);
  const altLoad  = sideLoad(rows, alt);
  // Switch only when preferred side is clearly heavier than the other.
  return prefLoad > altLoad * 2 + 2 ? alt : preferred;
}

function enqueueDecisionBranches(
  outs: FlowEdge[],
  sourceId: string,
  sourceRow: number,
  sourceColumn: string,
  queue: Array<{ id: string; column: string; rowHint: number }>,
  visiting: Set<string>,
  doc: FlowDocument,
  columns: Map<string, Column>,
  rows: GridRow[],
): void {
  // Categorize.
  type Bucket = { edge: FlowEdge; main: boolean; side: 'E' | 'W' | null };
  const buckets: Bucket[] = [];
  let mainAssigned = false;

  // First pass: pin yes/true to main.
  for (const e of outs) {
    const cond = (e.condition ?? '').toLowerCase();
    if (!mainAssigned && (cond === 'yes' || cond === 'true' || cond === '')) {
      buckets.push({ edge: e, main: true, side: null });
      mainAssigned = true;
    } else {
      buckets.push({ edge: e, main: false, side: null });
    }
  }
  // If no branch was main (e.g. all custom labels), promote the first.
  if (!mainAssigned && buckets.length > 0) {
    buckets[0].main = true;
  }

  // Second pass: assign side columns.
  // no/false → West by convention, but adaptiveSide() may flip to East if
  // the West side is already significantly more loaded below this row.
  // Multi-way branches alternate W/E, also subject to load balancing.
  let nextSideIdx = 0;
  for (const b of buckets) {
    if (b.main) continue;
    const cond = (b.edge.condition ?? '').toLowerCase();
    if (cond === 'no' || cond === 'false') {
      b.side = adaptiveSide('W', rows);
    } else {
      const preferred: 'E' | 'W' = (nextSideIdx % 2 === 0) ? 'W' : 'E';
      b.side = adaptiveSide(preferred, rows);
      nextSideIdx++;
    }
  }
  // Ensure at most one E and one W in this batch by re-balancing.
  const eUsed = buckets.filter(b => b.side === 'E').length;
  const wUsed = buckets.filter(b => b.side === 'W').length;
  if (wUsed > 1 && eUsed === 0) {
    // All side branches landed on W; move one non-no branch to E.
    let flipped = false;
    for (const b of buckets) {
      const c = (b.edge.condition ?? '').toLowerCase();
      if (b.side === 'W' && !flipped && c !== 'no' && c !== 'false') {
        b.side = 'E';
        flipped = true;
      }
    }
  }
  if (eUsed > 1 && wUsed === 0) {
    let flipped = false;
    for (const b of buckets) {
      if (b.side === 'E' && !flipped && (b.edge.condition ?? '').toLowerCase() !== 'no') {
        b.side = 'W';
        flipped = true;
      }
    }
  }

  // If the main branch is a back-edge (already visited) and there is exactly
  // one new side branch, that side branch IS the sub-flow continuation —
  // keep it in the source column rather than branching further out. This
  // avoids creating a W2/E2 column for patterns like:
  //   decision → yes: <already placed>
  //            → no:  NodeA → NodeB → <back-edge>
  const mainBucket = buckets.find(b => b.main);
  const mainIsBackEdge = !!mainBucket && visiting.has(mainBucket.edge.to);
  const newSideBranches = buckets.filter(b => !b.main && !visiting.has(b.edge.to));
  const continueInSameCol = mainIsBackEdge && newSideBranches.length === 1;

  // Enqueue each branch.
  for (const b of buckets) {
    if (visiting.has(b.edge.to)) {
      // Re-reference / loop — skip enqueueing, router handles the edge.
      continue;
    }
    visiting.add(b.edge.to);
    if (b.main || continueInSameCol) {
      queue.push({ id: b.edge.to, column: sourceColumn, rowHint: sourceRow + 1 });
    } else {
      const sideCol = ensureSideColumn(columns, sourceColumn, b.side ?? 'W');
      queue.push({ id: b.edge.to, column: sideCol, rowHint: sourceRow + 1 });
    }
  }
}

/**
 * Ensure that a side column adjacent to `baseColumn` exists on the
 * given side, creating it if necessary. Returns the column id.
 */
function ensureSideColumn(
  columns: Map<string, Column>, baseColumn: string, side: 'E' | 'W',
): string {
  const base = columns.get(baseColumn);
  const baseLevel = base?.level ?? 0;
  const baseSide = base?.side ?? 0;
  const newSide: -1 | 1 = side === 'E' ? 1 : -1;
  const newLevel = baseSide === newSide
    ? baseLevel + 1                  // extending further out same side
    : Math.max(1, baseLevel + 1);    // first hop off the main spine
  const id = (newSide === 1 ? 'E' : 'W') + newLevel;
  if (!columns.has(id)) {
    columns.set(id, { id, x: 0, width: 0, side: newSide, level: newLevel });
  }
  return id;
}

/**
 * Once all nodes are placed, compute each column's center x.
 * Lays columns out as: ...W2 W1 main E1 E2... centered on x = 0.
 */
function finalizeColumns(columns: Map<string, Column>, _rows: GridRow[]): void {
  const sorted = [...columns.values()].sort((a, b) => {
    if (a.side !== b.side) return a.side - b.side;
    return a.level - b.level;
  });
  const main = sorted.find(c => c.id === 'main');
  if (!main) return;

  // Default column width (when unused, so spacing remains stable).
  for (const c of sorted) {
    if (c.width === 0) c.width = DEFAULT_NODE_WIDTH;
  }

  // Place main at x=0; lay E columns rightward and W columns leftward.
  main.x = 0;
  let cursorE = main.width / 2;
  let cursorW = -main.width / 2;
  for (const c of sorted) {
    if (c.id === 'main') continue;
    if (c.side === 1) {
      cursorE += SIDE_CHANNEL + COLUMN_GAP;
      c.x = cursorE + c.width / 2;
      cursorE = c.x + c.width / 2;
    } else if (c.side === -1) {
      cursorW -= SIDE_CHANNEL + COLUMN_GAP;
      c.x = cursorW - c.width / 2;
      cursorW = c.x - c.width / 2;
    }
  }
}

/** Stack rows top-to-bottom with row gaps. */
function finalizeRowYs(rows: GridRow[]): void {
  let y = 0;
  for (const r of rows) {
    y += r.height / 2;
    r.y = y;
    y += r.height / 2 + ROW_GAP;
  }
}

// ── Skip-edge classification ────────────────────────────────────────

/**
 * A skip edge connects two nodes that are more than one row apart
 * AND whose endpoints are in the main column (or whose source is in
 * a side column and target is back in main further down). The router
 * places these into outer channels so they don't pierce nodes between.
 */
function classifySkipEdges(
  doc: FlowDocument,
  placed: Map<string, { row: number; column: string }>,
  rows: GridRow[],
): Set<string> {
  const skip = new Set<string>();
  for (let i = 0; i < doc.edges.length; i++) {
    const e = doc.edges[i];
    const a = placed.get(e.from);
    const b = placed.get(e.to);
    if (!a || !b) continue;
    if (e.from === e.to) continue;          // self-loop handled separately

    // Back-edge: target is above source → always route via outer channel.
    if (b.row < a.row) {
      skip.add(`${i}:${e.from}->${e.to}`);
      continue;
    }

    const sameColumn = a.column === b.column;
    const rowGap = Math.abs(a.row - b.row);
    // Same column and >1 rows apart → must skip past intermediate nodes.
    if (sameColumn && rowGap >= 2) {
      // Are there intermediate nodes in the same column?
      const lo = Math.min(a.row, b.row);
      const hi = Math.max(a.row, b.row);
      for (let r = lo + 1; r < hi; r++) {
        if (rows[r]?.nodes.has(a.column)) {
          skip.add(`${i}:${e.from}->${e.to}`);
          break;
        }
      }
    }
    // Cross-column edges where the target is back in main: also a
    // candidate for outer-channel routing if the side column has any
    // node between source row and target row inclusive.
    if (!sameColumn) {
      const fromIsSide = a.column !== 'main';
      const toIsMain = b.column === 'main';
      if (fromIsSide && toIsMain) {
        // The source side-column may have nodes after this one;
        // routing through them would pierce the column.
        const lo = a.row;
        const hi = b.row;
        if (Math.abs(hi - lo) >= 2) {
          skip.add(`${i}:${e.from}->${e.to}`);
        }
      }

      // Any cross-column forward edge: if the *target* column already has a
      // node at the *source* row, a direct L-shaped path at that y-coordinate
      // would pierce that node. Route via the channel instead.
      if (b.row > a.row && rows[a.row]?.nodes.has(b.column)) {
        skip.add(`${i}:${e.from}->${e.to}`);
      }
    }
  }
  return skip;
}

function computeBounds(doc: FlowDocument) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [, node] of doc.nodes) {
    if (node.x === undefined || node.y === undefined) continue;
    const hw = (node.width ?? DEFAULT_NODE_WIDTH) / 2;
    const hh = (node.height ?? DEFAULT_NODE_HEIGHT) / 2;
    minX = Math.min(minX, node.x - hw);
    minY = Math.min(minY, node.y - hh);
    maxX = Math.max(maxX, node.x + hw);
    maxY = Math.max(maxY, node.y + hh);
  }
  if (minX === Infinity) { minX = 0; minY = 0; maxX = 400; maxY = 300; }
  return { minX, minY, maxX, maxY };
}
