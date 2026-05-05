/**
 * Edge Router — converts dagre's raw waypoints into clean paths.
 * 
 * Supports three routing styles:
 * - orthogonal: right-angle paths with rounded corners (Visio-style)
 * - bezier: smooth cubic Bezier curves
 * - polyline: straight line segments
 * 
 * This is behind a strategy interface so we can swap in elkjs or a
 * visibility-graph router later without touching the renderer.
 */

import type { FlowDocument, FlowNode, FlowEdge, RoutingStyle } from '../parser/ast.js';
import { getRouting, getDirective } from '../parser/ast.js';
import { getPortForNodeShape, type CardinalDir as ShapeDir } from './shape-ports.js';
import { getGridMeta } from './dagre-layout.js';
import type { GridLayoutMeta } from './grid-layout.js';
import {
  reservePorts, semiCardinalToCardinal,
  type EdgePreferences, type EdgePortReservation, type PortReservationResult,
} from './port-reservation.js';

export interface RouteResult {
  /** SVG path data string (M, L, Q, C commands) */
  pathData: string;
  /** Where to place the edge label (midpoint of the path) */
  labelPosition: { x: number; y: number };
  /**
   * Orthogonal waypoints (preserved when the route is orthogonal).
   * Used by the line-jump post-pass to detect segment crossings.
   * Bezier and polyline routes do not set this.
   */
  waypoints?: Array<{ x: number; y: number }>;
  /**
   * Whether this edge prefers to *yield* (be the one with arc bumps)
   * when crossings happen. Retry/dashed edges yield to normal edges.
   */
  yieldOnCross?: boolean;
}

export interface RouterStrategy {
  route(edge: FlowEdge, fromNode: FlowNode, toNode: FlowNode): RouteResult;
}

/**
 * Route all edges in the document using the configured routing style.
 */
export function routeEdges(doc: FlowDocument): Map<string, RouteResult> {
  const style = getRouting(doc);
  const cornerRadius = parseInt(getDirective(doc, 'corner-radius', '8'), 10);
  const routes = new Map<string, RouteResult>();
  const hasLanes = doc.lanes.length > 0;

  // Pre-pass: when a decision has multiple outgoing edges, distribute
  // them across distinct cardinal sides (S/E/W/N) so later branches
  // don't stack on top of the first. Without this, custom-condition
  // edges (or repeated yes/no) all picked the same side via the
  // independent geometry scorer, making them visually overlap — which
  // is the "decision lacks a branch beyond the first" bug.
  const decisionExitDir = assignDecisionExits(doc);

  // Pre-compute port spread offsets: count how many edges share the same
  // (node, cardinal direction) so we can spread them along the edge.
  const portUsage = new Map<string, number>(); // "nodeId:N" -> count
  const portIndex = new Map<string, number>(); // per-edge assigned index

  if (hasLanes) {
    // First pass: count
    for (let i = 0; i < doc.edges.length; i++) {
      const edge = doc.edges[i];
      const fromNode = doc.nodes.get(edge.from);
      const toNode = doc.nodes.get(edge.to);
      if (!fromNode || !toNode) continue;
      const { exitDir, entryDir } = chooseCardinalDirs(
        fromNode, toNode, edge, decisionExitDir.get(edgeId(i, edge)),
      );
      const exitKey = `${edge.from}:${exitDir}:exit`;
      const entryKey = `${edge.to}:${entryDir}:entry`;
      portUsage.set(exitKey, (portUsage.get(exitKey) ?? 0) + 1);
      portUsage.set(entryKey, (portUsage.get(entryKey) ?? 0) + 1);
    }
    // Second pass: assign indices
    const portCursor = new Map<string, number>();
    for (let i = 0; i < doc.edges.length; i++) {
      const edge = doc.edges[i];
      const fromNode = doc.nodes.get(edge.from);
      const toNode = doc.nodes.get(edge.to);
      if (!fromNode || !toNode) continue;
      const { exitDir, entryDir } = chooseCardinalDirs(
        fromNode, toNode, edge, decisionExitDir.get(edgeId(i, edge)),
      );
      const exitKey = `${edge.from}:${exitDir}:exit`;
      const entryKey = `${edge.to}:${entryDir}:entry`;
      const edgeKey = edgeId(i, edge);
      const ei = portCursor.get(exitKey) ?? 0;
      const ni = portCursor.get(entryKey) ?? 0;
      portIndex.set(`exit:${edgeKey}`, ei);
      portIndex.set(`entry:${edgeKey}`, ni);
      portCursor.set(exitKey, ei + 1);
      portCursor.set(entryKey, ni + 1);
    }
  }

  // Grid-aware routing: when grid layout is active, skip edges (those
  // that would otherwise pierce a column of nodes) get routed via an
  // outer channel — exit a side, drop down past every bypassed node,
  // approach the target horizontally. The router computes channel x
  // positions once per document.
  const gridMeta = getGridMeta(doc);
  const gridChannels = gridMeta ? buildGridChannels(doc, gridMeta) : null;

  // Grid-aware port reservation: pre-pass picks a cardinal port per edge
  // per role, applying the simple availability rules (no opposite-direction
  // reuse if any other cardinal is free; no same-direction reuse if any
  // other cardinal is free; semi-cardinal fallback only after all four
  // cardinals are exhausted). Geometry only ranks the candidates — the
  // actual choice is driven by occupancy. This replaces the older
  // pressure-then-swap logic with a single ordered pass.
  const gridReservation = gridMeta && gridChannels
    ? buildGridReservation(doc, gridMeta, gridChannels, decisionExitDir)
    : null;

  for (let i = 0; i < doc.edges.length; i++) {
    const edge = doc.edges[i];
    const fromNode = doc.nodes.get(edge.from);
    const toNode = doc.nodes.get(edge.to);
    if (!fromNode || !toNode) continue;

    const key = `${edge.from}->${edge.to}`;
    const overrideExit = decisionExitDir.get(edgeId(i, edge));
    let result: RouteResult;

    const isSkip = gridMeta?.skipEdges.has(edgeId(i, edge));

    if (edge.from === edge.to) {
      // Self-loop — same on both routing strategies.
      result = routeSelfLoop(edge, fromNode, cornerRadius, overrideExit);
    } else if (gridMeta && gridChannels && isSkip) {
      result = routeGridSkip(
        edge, fromNode, toNode, cornerRadius,
        gridMeta, gridChannels, doc, i,
        gridReservation,
      );
    } else if (gridMeta && gridChannels) {
      result = routeGridLocal(
        edge, fromNode, toNode, cornerRadius,
        gridMeta, gridChannels, overrideExit,
        gridReservation, i, edge,
      );
    } else if (hasLanes) {
      result = routeCardinal(
        edge, fromNode, toNode, cornerRadius,
        portUsage, portIndex, i, overrideExit,
      );
    } else {
      result = routeEdge(edge, fromNode, toNode, style, cornerRadius, overrideExit);
    }
    routes.set(key, result);
  }

  // Post-pass: insert Visio-style line jumps where orthogonal segments
  // cross. Only applies when line-jumps are enabled (default on).
  const enableJumps = getDirective(doc, 'line-jumps', 'on').toLowerCase() !== 'off';
  if (enableJumps) {
    applyLineJumps(doc, routes, cornerRadius);
  }

  return routes;
}

function routeEdge(
  edge: FlowEdge,
  from: FlowNode,
  to: FlowNode,
  style: RoutingStyle,
  cornerRadius: number,
  overrideExit?: CardinalDir,
): RouteResult {
  if (edge.from === edge.to) {
    return routeSelfLoop(edge, from, cornerRadius, overrideExit);
  }
  switch (style) {
    case 'orthogonal':
      return routeOrthogonal(edge, from, to, cornerRadius, overrideExit);
    case 'bezier':
      return routeBezier(from, to);
    case 'polyline':
      return routePolyline(from, to);
  }
}

/**
 * Build a visible orthogonal self-loop on a single node.
 *
 * A self-loop edge has from === to, so the standard port picker collapses
 * the route into a zero-length path. Instead, we exit the node on a side
 * (E by default, or the side chosen by the multi-branch decision pre-pass),
 * step out by a fixed margin, hop up around the top, then re-enter through
 * the N port. The path always has at least four waypoints, so the renderer
 * has real geometry to draw and label.
 *
 * The margin scales with corner radius so loops on the same node don't
 * overlap the rounded edge of an adjacent route.
 */
function routeSelfLoop(
  edge: FlowEdge,
  node: FlowNode,
  cornerRadius: number,
  overrideExit?: CardinalDir,
): RouteResult {
  const r = Math.max(cornerRadius, 8);
  const margin = 32 + r;

  const exitDir: CardinalDir =
    overrideExit ?? (node.shape === 'decision'
      ? (edge.condition === 'no' || edge.condition === 'false' ? 'E' : 'E')
      : 'E');

  const ports = getNodePorts(node);
  const exit = portForDir(ports, exitDir);
  const entry = ports.top;

  let waypoints: Port[];
  if (exitDir === 'E') {
    const x = exit.x + margin;
    const y = exit.y - margin;
    waypoints = [
      exit,
      { x, y: exit.y },
      { x, y },
      { x: entry.x, y },
      entry,
    ];
  } else if (exitDir === 'W') {
    const x = exit.x - margin;
    const y = exit.y - margin;
    waypoints = [
      exit,
      { x, y: exit.y },
      { x, y },
      { x: entry.x, y },
      entry,
    ];
  } else if (exitDir === 'S') {
    const y = exit.y + margin;
    const x = exit.x + margin;
    waypoints = [
      exit,
      { x: exit.x, y },
      { x, y },
      { x, y: entry.y - margin },
      { x: entry.x, y: entry.y - margin },
      entry,
    ];
  } else {
    // N exit — wrap right side
    const y = exit.y - margin;
    const x = exit.x + margin;
    waypoints = [
      exit,
      { x: exit.x, y },
      { x, y },
      { x, y: entry.y },
      entry,
    ];
  }

  const pathData = waypointsToRoundedPath(waypoints, cornerRadius);
  const labelPosition = getPathMidpoint(waypoints);

  return {
    pathData,
    labelPosition,
    waypoints: waypoints.map(p => ({ x: p.x, y: p.y })),
    yieldOnCross: edge.retry === true,
  };
}

// --- Connection port helpers ---

interface Port { x: number; y: number }

function getNodeCenter(node: FlowNode): Port {
  return { x: node.x ?? 0, y: node.y ?? 0 };
}

function getNodePorts(node: FlowNode): { top: Port; bottom: Port; left: Port; right: Port } {
  return {
    top:    getPortForNodeShape(node, 'N'),
    bottom: getPortForNodeShape(node, 'S'),
    left:   getPortForNodeShape(node, 'W'),
    right:  getPortForNodeShape(node, 'E'),
  };
}

/**
 * Choose the best exit/entry ports based on relative node positions.
 *
 * Uses a scoring pass over candidate (exitDir, entryDir) pairs that rewards:
 *   - dirs aligned with the relative offset between centers
 *   - decision targets entered from the top when the source is above
 *   - exit/entry sides on opposite halves (avoids "doubling back")
 *   - fewer bends (straight or single-jog routes)
 * and penalizes:
 *   - paths that cut back across the source/target box
 *   - edges that exit toward the wrong side relative to the target
 */
function choosePorts(from: FlowNode, to: FlowNode, edge: FlowEdge): { exit: Port; entry: Port } {
  const { exitDir, entryDir } = chooseScoredDirs(from, to, edge);
  const fromPorts = getNodePorts(from);
  const toPorts = getNodePorts(to);
  return {
    exit: portForDir(fromPorts, exitDir),
    entry: portForDir(toPorts, entryDir),
  };
}

function portForDir(
  ports: { top: Port; bottom: Port; left: Port; right: Port },
  dir: CardinalDir,
): Port {
  switch (dir) {
    case 'N': return ports.top;
    case 'S': return ports.bottom;
    case 'E': return ports.right;
    case 'W': return ports.left;
  }
}

/**
 * Score-based selection of cardinal exit/entry directions for the
 * non-swimlane orthogonal router. Considers relative geometry between
 * the source and target, and prefers the natural top-entry into a
 * decision when the source is above the diamond (the case in the
 * "Clarify Goal → Enough Detail?" sketch).
 */
function chooseScoredDirs(
  from: FlowNode, to: FlowNode, edge: FlowEdge,
  overrideExit?: CardinalDir,
): { exitDir: CardinalDir; entryDir: CardinalDir } {
  const fc = getNodeCenter(from);
  const tc = getNodeCenter(to);
  const dx = tc.x - fc.x;
  const dy = tc.y - fc.y;

  // Multi-branch decision pre-pass already chose this edge's exit side.
  if (overrideExit && from.shape === 'decision') {
    return { exitDir: overrideExit, entryDir: pickDecisionEntry(to, dx, dy, overrideExit) };
  }

  // Decision-source convention: keep the long-standing "yes/no" semantics
  // so existing diagrams don't shift. Only the *generic* case is rescored.
  if (from.shape === 'decision') {
    const isNo = edge.condition === 'no' || edge.condition === 'false';
    const isYes = edge.condition === 'yes' || edge.condition === 'true';

    // Loop-back (upward) path: force side-exit/side-entry
    if (dy < -20) {
      const exitDir: CardinalDir = dx <= 0 ? 'W' : 'E';
      return { exitDir, entryDir: exitDir === 'W' ? 'W' : 'E' };
    }

    if (isYes || (!edge.condition && Math.abs(dy) > Math.abs(dx))) {
      return { exitDir: 'S', entryDir: pickDecisionEntry(to, dx, dy, 'S') };
    }
    if (isNo) {
      const exitDir: CardinalDir = dx >= 0 ? 'E' : 'W';
      return { exitDir, entryDir: pickDecisionEntry(to, dx, dy, exitDir) };
    }
  }

  // Generic loop-back for any node type: force side-routing
  if (dy < -20) {
    const exitDir: CardinalDir = dx <= 0 ? 'W' : 'E';
    return { exitDir, entryDir: exitDir === 'W' ? 'W' : 'E' };
  }

  const candidates: Array<{ exit: CardinalDir; entry: CardinalDir }> = [];
  for (const ex of ['N', 'S', 'E', 'W'] as const) {
    for (const en of ['N', 'S', 'E', 'W'] as const) {
      candidates.push({ exit: ex, entry: en });
    }
  }

  let best = candidates[0];
  let bestScore = -Infinity;
  for (const c of candidates) {
    const s = scoreDirPair(from, to, edge, c.exit, c.entry, dx, dy);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return { exitDir: best.exit, entryDir: best.entry };
}

/** Score a candidate (exit, entry) pair. Higher is better. */
function scoreDirPair(
  from: FlowNode, to: FlowNode, edge: FlowEdge,
  exit: CardinalDir, entry: CardinalDir, dx: number, dy: number,
): number {
  let score = 0;

  // 1. Exit direction should head toward the target half-plane.
  score += alignmentScore(exit, dx, dy);

  // 1b. Decision source constraint: NEVER exit North from a diamond.
  // The North point is reserved for entry flow.
  if (from.shape === 'decision' && exit === 'N') {
    score -= 30;
  }

  // 2. Entry direction should come *from* the side of the target nearest
  //    the source — i.e., the entry's outward normal should oppose the
  //    direction from source→target.
  score += alignmentScore(entry, -dx, -dy);

  // 3. Decision-target preference: prefer top entry when the source is
  //    above (dy > 0 in screen coordinates), and side entry when the
  //    source is roughly level. This is the core fix for diagonal
  //    source-above-side cases like Clarify Goal → Enough Detail?.
  if (to.shape === 'decision') {
    if (dy > 20 && entry === 'N') score += 8; // strongly prefer top
    if (dy < -20 && entry === 'S') score += 8;
    // Side entry on a diamond is OK only when truly side-on
    const sidePenalty = Math.abs(dy) > Math.abs(dx) * 0.6 ? 4 : 0;
    if ((entry === 'E' || entry === 'W') && sidePenalty) score -= sidePenalty;
  }

  // 3a. Diagonal-source bias: when the source is diagonally offset from
  //     the target (both |dx| and |dy| are non-trivial relative to the
  //     source size), prefer a side-exit so the path travels through
  //     open space rather than running parallel to the target. This
  //     matches the sketched "out left, then down into top" behaviour.
  const fromHalfW = (from.width ?? 180) / 2;
  const fromHalfH = (from.height ?? 44) / 2;
  const diagonal =
    Math.abs(dx) > fromHalfW * 0.6 && Math.abs(dy) > fromHalfH * 1.2;
  if (diagonal) {
    if ((dx > 0 && exit === 'E') || (dx < 0 && exit === 'W')) score += 4;
    // Penalize bottom/top exit when there's plenty of horizontal offset
    // *and* the entry is top/bottom — the resulting path otherwise hugs
    // the source's vertical centerline before jogging across.
    if (
      ((exit === 'S' || exit === 'N') && Math.abs(dx) > fromHalfW * 0.9) &&
      (entry === 'N' || entry === 'S')
    ) {
      score -= 3;
    }
  }

  // 4. Penalize "doubling back" — exit pointing away from the target
  //    or entry pointing toward the source's far side.
  if (alignmentScore(exit, dx, dy) < 0) score -= 6;
  if (alignmentScore(entry, -dx, -dy) < 0) score -= 6;

  // 5. Prefer same-axis routing (fewer bends): if exit and entry are on
  //    the same axis (both vertical or both horizontal) and dx/dy is
  //    well-aligned, that's a clean L or straight line.
  const exitAxis = (exit === 'N' || exit === 'S') ? 'V' : 'H';
  const entryAxis = (entry === 'N' || entry === 'S') ? 'V' : 'H';
  if (exitAxis === entryAxis) {
    // Opposite cardinals on the same axis → straight or single-jog
    if (
      (exit === 'N' && entry === 'S') ||
      (exit === 'S' && entry === 'N') ||
      (exit === 'E' && entry === 'W') ||
      (exit === 'W' && entry === 'E')
    ) {
      score += 2;
    } else {
      // Same direction (e.g. both 'N') usually means a U-turn
      score -= 3;
    }
  }

  // 6. Slight penalty for picking a port that points *away* from the
  //    other node's half-plane on the perpendicular axis. Keeps the
  //    selection stable for axis-aligned cases.
  return score;
}

/**
 * Returns +N if `dir` points toward (dx, dy), 0 if perpendicular,
 * negative if pointing away.
 */
function alignmentScore(dir: CardinalDir, dx: number, dy: number): number {
  // Magnitude of projection along the chosen cardinal axis, sign-checked.
  switch (dir) {
    case 'N': return dy < 0 ? Math.abs(dy) / 30 + 1 : -Math.abs(dy) / 30;
    case 'S': return dy > 0 ? Math.abs(dy) / 30 + 1 : -Math.abs(dy) / 30;
    case 'E': return dx > 0 ? Math.abs(dx) / 30 + 1 : -Math.abs(dx) / 30;
    case 'W': return dx < 0 ? Math.abs(dx) / 30 + 1 : -Math.abs(dx) / 30;
  }
}

/**
 * Choose how an edge enters a decision target given the exit direction
 * from a decision source. Top-entry is preferred when feasible.
 */
function pickDecisionEntry(
  to: FlowNode, dx: number, dy: number, exitDir: CardinalDir,
): CardinalDir {
  if (to.shape !== 'decision') {
    // Generic target: align entry with the dominant axis.
    if (Math.abs(dy) > Math.abs(dx)) return dy > 0 ? 'N' : 'S';
    return dx > 0 ? 'W' : 'E';
  }
  // Decision target: prefer top entry when source is above.
  if (dy > 20) return 'N';
  if (dy < -20) return 'S';
  return dx > 0 ? 'W' : 'E';
}

// --- Grid-aware Routing ---

type CardinalDir = 'N' | 'S' | 'E' | 'W';

interface GridChannels {
  /** x position of the routing channel on the East side of column id. */
  east: Map<string, number>;
  /** x position on the West side of column id. */
  west: Map<string, number>;
  /** Outer-east x — the channel beyond the rightmost column. */
  outerEast: number;
  /** Outer-west x — the channel beyond the leftmost column. */
  outerWest: number;
}

/**
 * Compute routing channel x-positions between/around the grid columns.
 * Each side-column has a channel on its outer edge; main has channels
 * on both sides. Far-skip routes use the outer channels so they
 * never cross a node-bearing column.
 */
function buildGridChannels(_doc: FlowDocument, meta: GridLayoutMeta): GridChannels {
  const cols = [...meta.columns.values()];
  const east = new Map<string, number>();
  const west = new Map<string, number>();
  // Sort columns left-to-right.
  const sortedByX = [...cols].sort((a, b) => a.x - b.x);
  for (let i = 0; i < sortedByX.length; i++) {
    const c = sortedByX[i];
    const right = sortedByX[i + 1];
    const left = sortedByX[i - 1];
    // East channel of c: midpoint between c's right edge and the
    // next column's left edge. If no next column, sit one half-gap out.
    if (right) {
      east.set(c.id, (c.x + c.width / 2 + (right.x - right.width / 2)) / 2);
    } else {
      east.set(c.id, c.x + c.width / 2 + 48);
    }
    // West channel of c: midpoint between c's left edge and the
    // previous column's right edge.
    if (left) {
      west.set(c.id, (c.x - c.width / 2 + (left.x + left.width / 2)) / 2);
    } else {
      west.set(c.id, c.x - c.width / 2 - 48);
    }
  }
  // Outer channels: one half-channel beyond the outermost columns.
  const leftmost = sortedByX[0];
  const rightmost = sortedByX[sortedByX.length - 1];
  const outerWest = leftmost.x - leftmost.width / 2 - 48;
  const outerEast = rightmost.x + rightmost.width / 2 + 48;
  return { east, west, outerEast, outerWest };
}

/**
 * Route an edge that lives entirely "near" the grid — same column or
 * adjacent column. Picks N/S for same-column, E/W for cross-column.
 */
function routeGridLocal(
  edge: FlowEdge,
  from: FlowNode, to: FlowNode,
  cornerRadius: number,
  meta: GridLayoutMeta,
  _channels: GridChannels,
  overrideExit?: CardinalDir,
  reservation?: PortReservationResult | null,
  edgeIdx?: number,
  _edgeRef?: FlowEdge,
): RouteResult {
  const dirs = predictLocalDirs(edge, from, to, meta, overrideExit);
  // Reservation, if available, supersedes the geometry prediction so the
  // simple "no opposite-direction reuse / no same-direction reuse if free"
  // rules win over local heuristics.
  const reservedKey = edgeIdx !== undefined ? edgeId(edgeIdx, edge) : '';
  const reserved = reservation && edgeIdx !== undefined
    ? reservation.byEdgeKey.get(reservedKey)
    : undefined;
  const exitDir = (reserved?.exitDir as CardinalDir | undefined) && !reserved!.exitIsSemi
    ? (reserved!.exitDir as CardinalDir)
    : dirs.exitDir;
  const entryDir = (reserved?.entryDir as CardinalDir | undefined) && !reserved!.entryIsSemi
    ? (reserved!.entryDir as CardinalDir)
    : dirs.entryDir;

  const exit = portForReserved(from, exitDir, reserved, 'exit', dirs.exitDir);
  const entry = portForReserved(to, entryDir, reserved, 'entry', dirs.entryDir);
  const exitFinal = applyReservationSpread(from, exitDir, reserved, 'exit');
  const entryFinal = applyReservationSpread(to, entryDir, reserved, 'entry');

  const exitPt = exitFinal ?? exit;
  const entryPt = entryFinal ?? entry;
  // When the L-bend that buildOrthogonalWaypoints would produce passes
  // through another node in the source row, force a row-gap detour: step
  // out vertically into the inter-row gap before crossing horizontally.
  // This catches the V→H case where the corner sits inside a sibling
  // node's bounding box.
  const fromRow = meta.nodeRow.get(edge.from) ?? 0;
  const exitVertical = (exitDir === 'N' || exitDir === 'S');
  const entryHorizontal = (entryDir === 'E' || entryDir === 'W');
  const horizontalDir: CardinalDir =
    entryPt.x > exitPt.x ? 'E' : 'W';
  const wouldCornerPierce =
    exitVertical && entryHorizontal &&
    cornerWouldPierceRow(meta, edge.from, fromRow, exitPt, entryPt, horizontalDir);
  let waypoints: Port[];
  if (wouldCornerPierce) {
    const goingUp = entryPt.y < exitPt.y;
    const gapY = goingUp
      ? (from.y ?? 0) - (from.height ?? 44) / 2 - 30
      : (from.y ?? 0) + (from.height ?? 44) / 2 + 30;
    waypoints = [
      exitPt,
      { x: exitPt.x, y: gapY },
      { x: entryPt.x, y: gapY },
      { x: entryPt.x, y: entryPt.y },
      entryPt,
    ];
  } else {
    waypoints = buildOrthogonalWaypoints(exitPt, entryPt, exitDir, entryDir);
  }
  const pathData = waypointsToRoundedPath(waypoints, cornerRadius);
  const labelPos = getPathMidpoint(waypoints);
  return {
    pathData,
    labelPosition: labelPos,
    waypoints: waypoints.map(p => ({ x: p.x, y: p.y })),
    yieldOnCross: edge.retry === true,
  };
}

/**
 * Resolve a reservation's per-edge dir to an actual port on the node.
 * Cardinal reservations get the standard tip / cardinal port; semi-cardinal
 * reservations get the closest cardinal with a 30%-of-side offset.
 */
function portForReserved(
  node: FlowNode,
  dir: CardinalDir,
  reserved: EdgePortReservation | undefined,
  role: 'exit' | 'entry',
  fallbackDir: CardinalDir,
): Port {
  if (!reserved) return getPortForNodeShape(node, dir);
  const isSemi = role === 'exit' ? reserved.exitIsSemi : reserved.entryIsSemi;
  if (!isSemi) return getPortForNodeShape(node, dir);
  // Semi-cardinal: use the originally preferred axis to decide projection.
  const axis: 'V' | 'H' = (fallbackDir === 'N' || fallbackDir === 'S') ? 'V' : 'H';
  const r = role === 'exit' ? reserved.exitDir : reserved.entryDir;
  const { cardinal, offset } = semiCardinalToCardinal(
    r, axis, node.width ?? 180, node.height ?? 44,
  );
  return getPortForNodeShape(node, cardinal, offset);
}

/**
 * If multiple edges share the same (node, dir, role) bucket, spread them
 * along the side using the index/total recorded in the reservation. Returns
 * undefined when no spread is required so callers can fall back to the
 * straight reserved port.
 */
function applyReservationSpread(
  node: FlowNode,
  dir: CardinalDir,
  reserved: EdgePortReservation | undefined,
  role: 'exit' | 'entry',
): Port | undefined {
  if (!reserved) return undefined;
  if (node.shape === 'decision') return undefined; // diamonds keep tip ports
  const total = role === 'exit' ? reserved.exitTotal : reserved.entryTotal;
  const idx = role === 'exit' ? reserved.exitIndex : reserved.entryIndex;
  const isSemi = role === 'exit' ? reserved.exitIsSemi : reserved.entryIsSemi;
  if (isSemi) {
    // Semi-cardinal already uses an offset; layer in a small spread to
    // separate co-occupants of the same corner.
    const w = node.width ?? 180;
    const h = node.height ?? 44;
    const axis: 'V' | 'H' = (dir === 'N' || dir === 'S') ? 'V' : 'H';
    const semiDir = role === 'exit' ? reserved.exitDir : reserved.entryDir;
    const { cardinal, offset } = semiCardinalToCardinal(semiDir, axis, w, h);
    if (total <= 1) return getPortForNodeShape(node, cardinal, offset);
    const span = (cardinal === 'N' || cardinal === 'S') ? w * 0.2 : h * 0.2;
    const tweak = (idx / Math.max(1, total - 1) - 0.5) * span;
    return getPortForNodeShape(node, cardinal, offset + tweak);
  }
  if (total <= 1) return undefined;
  const spreadH = (node.width ?? 180) * 0.6;
  const spreadV = (node.height ?? 44) * 0.6;
  const offsetH = (idx / (total - 1) - 0.5) * spreadH;
  const offsetV = (idx / (total - 1) - 0.5) * spreadV;
  const offset = (dir === 'N' || dir === 'S') ? offsetH : offsetV;
  return getPortForNodeShape(node, dir, offset);
}


/**
 * Route a "skip" edge — one that bypasses one or more rows of nodes
 * in its source column, or that exits a side column to re-enter the
 * main column far below. Uses an outer channel so the segment never
 * threads through any node's bounding box.
 *
 * Path shape: exit on the side that points toward the channel, run
 * horizontally to the channel, drop vertically past every bypassed
 * row, then jog horizontally into the target's side port.
 */
function routeGridSkip(
  edge: FlowEdge,
  from: FlowNode, to: FlowNode,
  cornerRadius: number,
  meta: GridLayoutMeta,
  channels: GridChannels,
  _doc: FlowDocument,
  edgeIndex: number,
  reservation?: PortReservationResult | null,
): RouteResult {
  const fromCol = meta.nodeColumn.get(edge.from) ?? 'main';
  const toCol = meta.nodeColumn.get(edge.to) ?? 'main';
  const fromColInfo = meta.columns.get(fromCol)!;
  const toColInfo = meta.columns.get(toCol)!;

  // Choose channel side. Prefer the side furthest from any node-bearing
  // column between source and target. If the source is already in a
  // side column, exit out away from main; otherwise pick the side
  // toward which the target lies (or the suggested exit direction
  // from a multi-branch decision pre-pass).
  const decisionExit = from.shape === 'decision'
    ? edge.condition === 'no' || edge.condition === 'false' ? 'E' : null
    : null;

  // Determine the channel x and exit/entry sides.
  //
  // Routing strategy:
  //   - If source is in a side column and target is on main: use the
  //     channel between them (on the *inner* side of the source column,
  //     toward main). This keeps the segment from running across other
  //     side columns.
  //   - If source is on main and target is on a side column: use the
  //     channel between main and that side column.
  //   - If both are on main: use the outer channel on the side toward
  //     which the route should bend (decision condition or default E).
  //   - If source and target are on different side columns of opposite
  //     side: exit toward main, then run in the channel between.
  let exitDir: CardinalDir;
  let channelX: number;

  const fromSide = fromColInfo.side;
  const toSide = toColInfo.side;

  if (fromSide !== 0 && toSide === 0) {
    // Side column → main. Exit toward main.
    exitDir = fromSide > 0 ? 'W' : 'E';
    // Channel sits between source's outer edge of main and source col.
    if (fromSide > 0) {
      // Source is East of main; channel just East of main.
      channelX = (channels.east.get('main') ?? channels.outerEast);
    } else {
      channelX = (channels.west.get('main') ?? channels.outerWest);
    }
  } else if (fromSide === 0 && toSide !== 0) {
    // Main → side column. Exit toward target side.
    exitDir = toSide > 0 ? 'E' : 'W';
    if (toSide > 0) {
      channelX = (channels.east.get('main') ?? channels.outerEast);
    } else {
      channelX = (channels.west.get('main') ?? channels.outerWest);
    }
  } else if (fromSide === 0 && toSide === 0) {
    // Main → main. Use outer channel; respect decision-condition hint.
    if (decisionExit === 'E') {
      exitDir = 'E';
      channelX = channels.outerEast;
    } else {
      exitDir = 'E';
      channelX = channels.outerEast;
    }
  } else {
    // Both side columns. Run via outer channel on the source's side.
    exitDir = fromSide > 0 ? 'E' : 'W';
    channelX = fromSide > 0 ? channels.outerEast : channels.outerWest;
  }

  // Per-edge spreading along the channel — different skip edges with
  // overlapping vertical ranges shouldn't share an x. We use the
  // edgeIndex to nudge the channel x apart by a small step.
  const SPREAD = 14;
  const spreadIdx = edgeIndex % 4;
  channelX = channelX + (exitDir === 'E' ? 1 : -1) * spreadIdx * SPREAD;

  // Pick entry side on target.
  // - If channel is between two columns, enter on whichever side of the
  //   target faces the channel.
  // - If route comes in from above (skip going downward to a node well
  //   below), prefer top entry on the target.
  const fromRow = meta.nodeRow.get(edge.from) ?? 0;
  const toRow = meta.nodeRow.get(edge.to) ?? 0;
  let entryDir: CardinalDir;
  if (channelX > (to.x ?? 0)) {
    entryDir = 'E';
  } else if (channelX < (to.x ?? 0)) {
    entryDir = 'W';
  } else {
    entryDir = exitDir === 'E' ? 'W' : 'E';
  }
  // goingDown is used by both south-entry and vertical-exit logic below.
  const goingDown = (to.y ?? 0) > (from.y ?? 0);

  // South-entry preference: back-edge (source below target) arriving via a
  // channel that is close to the target's center x → enter from the bottom
  // so the arrowhead is fully visible and the path doesn't wrap around the side.
  const usingSouthEntry =
    !goingDown &&
    to.shape !== 'decision' &&
    Math.abs((to.x ?? 0) - channelX) < (to.width ?? 180);
  if (usingSouthEntry) entryDir = 'S';

  // Top-entry preference: target is significantly below the source AND
  // the channel is well clear of the target. Helps the No → Monitor
  // pattern in the incident-response fixture look natural.
  const usingTopEntry =
    !usingSouthEntry &&
    toRow > fromRow + 1 &&
    Math.abs((to.x ?? 0) - channelX) > (to.width ?? 180) / 2 + 24;

  // For the source side: prefer exiting on S (or N if going up) so the
  // path enters the row gap before bending horizontally. This avoids
  // the horizontal segment running across other nodes that share the
  // source's row. We retain side-exit only if there's no other node in
  // the source row between source and channel.
  // Decision diamonds narrow to a point at their E/W extremes — a sibling
  // node in the same row does not block a side exit the way a rectangle would.
  const useVerticalExit = from.shape !== 'decision'
    && anyNodeInRowBetween(meta, edge.from, fromRow, exitDir);
  let exitFinalDir: CardinalDir = exitDir;
  if (useVerticalExit) {
    exitFinalDir = goingDown ? 'S' : 'N';
  }

  // Reservation supersedes the geometric pick when present, so the
  // higher-priority "no opposite-direction reuse" rule wins.
  const ek = edgeId(edgeIndex, edge);
  const reserved = reservation?.byEdgeKey.get(ek);
  let resolvedExitDir: CardinalDir = exitFinalDir;
  let resolvedEntryDir: CardinalDir = usingTopEntry ? 'N' : entryDir;
  if (reserved && !reserved.exitIsSemi) {
    resolvedExitDir = reserved.exitDir as CardinalDir;
  }
  if (reserved && !reserved.entryIsSemi) {
    resolvedEntryDir = reserved.entryDir as CardinalDir;
  }

  let exit = portForReserved(from, resolvedExitDir, reserved, 'exit', exitFinalDir);
  let entry = portForReserved(to, resolvedEntryDir, reserved, 'entry',
    usingTopEntry ? 'N' : entryDir);
  const exitSpread = applyReservationSpread(from, resolvedExitDir, reserved, 'exit');
  const entrySpread = applyReservationSpread(to, resolvedEntryDir, reserved, 'entry');
  if (exitSpread) exit = exitSpread;
  if (entrySpread) entry = entrySpread;
  // Update locals consumed by waypoint construction below.
  // exitFinalDir / finalEntryDir may have shifted to a new cardinal due to
  // reservation; update them so the path geometry matches.
  exitFinalDir = resolvedExitDir;
  const finalEntryDir: CardinalDir = resolvedEntryDir;


  // Build waypoints. When exiting on a side, jog out to channel at the
  // source row first. When exiting top/bottom — or when the row is
  // obstructed by another node between source and channel — drop into
  // the inter-row gap before going horizontal, so the segment doesn't
  // pierce a sibling.
  const wouldPierceHorizontal =
    (exitFinalDir === 'E' || exitFinalDir === 'W') &&
    anyNodeInRowBetween(meta, edge.from, fromRow, exitFinalDir);
  const waypoints: Port[] = [exit];
  if ((exitFinalDir === 'E' || exitFinalDir === 'W') && !wouldPierceHorizontal) {
    waypoints.push({ x: channelX, y: exit.y });
  } else {
    // Vertical exit (or forced detour): step into the gap before/after
    // the source row, then go horizontal toward the channel. Detours use
    // the half-row gap so they don't cross other nodes sharing the row.
    const gapY = goingDown
      ? (from.y ?? 0) + (from.height ?? 44) / 2 + 30
      : (from.y ?? 0) - (from.height ?? 44) / 2 - 30;
    waypoints.push({ x: exit.x, y: gapY });
    waypoints.push({ x: channelX, y: gapY });
  }
  // Top/bottom entry: drop into the side first, then jog into the port.
  // Side entry: come down the channel and slide horizontally to the port.
  if (finalEntryDir === 'N' || finalEntryDir === 'S') {
    waypoints.push({ x: channelX, y: entry.y });
    waypoints.push({ x: entry.x, y: entry.y });
    waypoints.push(entry);
  } else {
    waypoints.push({ x: channelX, y: entry.y });
    waypoints.push(entry);
  }

  const pathData = waypointsToRoundedPath(waypoints, cornerRadius);
  const labelPosition = getPathMidpoint(waypoints);

  return {
    pathData,
    labelPosition,
    waypoints: waypoints.map(p => ({ x: p.x, y: p.y })),
    yieldOnCross: edge.retry === true,
  };
}

// ── Grid port reservation ────────────────────────────────────────────

/**
 * Compute the per-edge port reservation for a grid-layout document.
 *
 * For each edge we build a *preference list* of cardinals (driven by the
 * existing geometry helpers `predictLocalDirs` / `predictSkipDirs`) and
 * hand it to {@link reservePorts}. The reservation pass runs the simple
 * availability rules — no opposite-direction reuse if any other cardinal
 * is free, no same-direction reuse if any other cardinal is free,
 * geometry only as the tie-breaker, and semi-cardinal (NE/SE/SW/NW)
 * fallback once all four cardinals are taken for the same role.
 *
 * Multi-branch decision exits get their pre-assigned tip pinned via
 * `exitPin`, so the reserver still tracks them as occupied (preventing
 * an inbound edge from later landing on the same diamond tip) without
 * the availability search rewriting the per-branch decisions.
 */
function buildGridReservation(
  doc: FlowDocument,
  meta: GridLayoutMeta,
  channels: GridChannels,
  decisionExitDir: Map<string, CardinalDir>,
): PortReservationResult {
  const prefs: EdgePreferences[] = [];
  for (let i = 0; i < doc.edges.length; i++) {
    const edge = doc.edges[i];
    if (edge.from === edge.to) continue;
    const fromNode = doc.nodes.get(edge.from);
    const toNode = doc.nodes.get(edge.to);
    if (!fromNode || !toNode) continue;

    const ek = edgeId(i, edge);
    const overrideExit = decisionExitDir.get(ek);
    const isSkip = meta.skipEdges.has(ek);
    const dirs = isSkip
      ? predictSkipDirs(edge, fromNode, toNode, meta, channels)
      : predictLocalDirs(edge, fromNode, toNode, meta, overrideExit);

    // Build ranked candidate lists. The first entry is the natural pick;
    // the same-axis opposite follows, then perpendiculars (with the side
    // facing the *other* node listed first so a forced detour lands on
    // the closer face). `nearExit`/`nearEntry` reflect "which
    // perpendicular faces the corresponding source/target".
    const dx = (toNode.x ?? 0) - (fromNode.x ?? 0);
    const dy = (toNode.y ?? 0) - (fromNode.y ?? 0);
    const nearExitH: CardinalDir = dx >= 0 ? 'E' : 'W';
    const nearExitV: CardinalDir = dy >= 0 ? 'S' : 'N';
    const nearEntryH: CardinalDir = dx >= 0 ? 'W' : 'E';
    const nearEntryV: CardinalDir = dy >= 0 ? 'N' : 'S';
    const exitNear =
      dirs.exitDir === 'N' || dirs.exitDir === 'S' ? nearExitH : nearExitV;
    const entryNear =
      dirs.entryDir === 'N' || dirs.entryDir === 'S' ? nearEntryH : nearEntryV;
    const exitPrefs = rankAround(dirs.exitDir, exitNear);
    const entryPrefs = rankAround(dirs.entryDir, entryNear);

    // Decisions: the multi-branch pre-pass already pinned a tip and we
    // must preserve it because diamonds attach at the tip itself.
    const exitPin = (overrideExit && fromNode.shape === 'decision')
      ? overrideExit
      : (fromNode.shape === 'decision' ? dirs.exitDir : undefined);
    // For skip back-edges where geometry predicts S entry, pin it.
    // S-entry (arriving from below) and S-exit (leaving downward) are
    // visually distinct and don't conflict — pinning bypasses the
    // opposite-role check that would otherwise block S and force a
    // piercing W entry.
    const entryPin = toNode.shape === 'decision'
      ? dirs.entryDir
      : (isSkip && dirs.entryDir === 'S' ? 'S' : undefined);

    prefs.push({
      edgeKey: ek,
      edge,
      fromNode,
      toNode,
      exitPrefs,
      entryPrefs,
      exitPin,
      entryPin,
    });
  }
  return reservePorts(doc, prefs);
}

/**
 * Build a candidate list around the geometry-preferred direction.
 *
 * Order: preferred → its same-axis opposite → near perpendicular →
 * far perpendicular. Keeping the same-axis opposite *second* means a
 * forced rerouting (e.g. when the preferred N is blocked by inbound
 * traffic) still falls onto the vertical axis (S) before crossing the
 * node sideways. The `nearPerpendicular` argument lets the reserver
 * pick the side of the target that faces the source's column — so a
 * blocked S falls to W when the source is west of the target, not E.
 */
function rankAround(
  preferred: CardinalDir,
  nearPerpendicular?: CardinalDir,
): CardinalDir[] {
  const opposite = oppositeCardinal(preferred);
  const perpendiculars: CardinalDir[] =
    preferred === 'N' || preferred === 'S' ? ['E', 'W'] : ['N', 'S'];
  const near = nearPerpendicular && perpendiculars.includes(nearPerpendicular)
    ? nearPerpendicular
    : perpendiculars[0];
  const far = near === perpendiculars[0] ? perpendiculars[1] : perpendiculars[0];
  return [preferred, opposite, near, far];
}

function oppositeCardinal(d: CardinalDir): CardinalDir {
  switch (d) {
    case 'N': return 'S';
    case 'S': return 'N';
    case 'E': return 'W';
    case 'W': return 'E';
  }
}

/** Predict the exit/entry direction for a non-skip grid edge. */
function predictLocalDirs(
  edge: FlowEdge,
  from: FlowNode, to: FlowNode,
  meta: GridLayoutMeta,
  overrideExit?: CardinalDir,
): { exitDir: CardinalDir; entryDir: CardinalDir } {
  const fromCol = meta.nodeColumn.get(edge.from) ?? 'main';
  const toCol = meta.nodeColumn.get(edge.to) ?? 'main';
  const fromRow = meta.nodeRow.get(edge.from) ?? 0;
  const toRow = meta.nodeRow.get(edge.to) ?? 0;

  let exitDir: CardinalDir;
  let entryDir: CardinalDir;

  if (overrideExit && from.shape === 'decision') {
    exitDir = overrideExit;
    if (overrideExit === 'S' || overrideExit === 'N') {
      entryDir = toRow > fromRow ? 'N' : 'S';
    } else {
      entryDir = toRow > fromRow ? 'N' : (overrideExit === 'E' ? 'W' : 'E');
    }
  } else if (fromCol === toCol) {
    if (toRow < fromRow) {
      // Upward loop: force side-exit and side-entry to avoid the vertical spine
      exitDir = 'W'; 
      entryDir = 'W';
    } else {
      exitDir = 'S';
      entryDir = 'N';
    }
  } else {
    const fromColInfo = meta.columns.get(fromCol)!;
    const toColInfo = meta.columns.get(toCol)!;
    const dx = toColInfo.x - fromColInfo.x;
    if (from.shape === 'decision') {
      exitDir = dx > 0 ? 'E' : 'W';
      entryDir = toRow > fromRow ? 'N' : 'S';
    } else {
      exitDir = 'S';
      entryDir = dx > 0 ? 'W' : 'E';
    }
  }
  return { exitDir, entryDir };
}

/** Predict the exit/entry direction for a grid skip edge. */
function predictSkipDirs(
  edge: FlowEdge,
  from: FlowNode, to: FlowNode,
  meta: GridLayoutMeta,
  channels: GridChannels,
): { exitDir: CardinalDir; entryDir: CardinalDir } {
  const fromCol = meta.nodeColumn.get(edge.from) ?? 'main';
  const toCol = meta.nodeColumn.get(edge.to) ?? 'main';
  const fromColInfo = meta.columns.get(fromCol)!;
  const toColInfo = meta.columns.get(toCol)!;
  const fromSide = fromColInfo.side;
  const toSide = toColInfo.side;

  let exitDir: CardinalDir;
  let channelX: number;

  if (fromSide !== 0 && toSide === 0) {
    exitDir = fromSide > 0 ? 'W' : 'E';
    channelX = fromSide > 0
      ? (channels.east.get('main') ?? channels.outerEast)
      : (channels.west.get('main') ?? channels.outerWest);
  } else if (fromSide === 0 && toSide !== 0) {
    exitDir = toSide > 0 ? 'E' : 'W';
    channelX = toSide > 0
      ? (channels.east.get('main') ?? channels.outerEast)
      : (channels.west.get('main') ?? channels.outerWest);
  } else if (fromSide === 0 && toSide === 0) {
    exitDir = 'E';
    channelX = channels.outerEast;
  } else {
    exitDir = fromSide > 0 ? 'E' : 'W';
    channelX = fromSide > 0 ? channels.outerEast : channels.outerWest;
  }

  // Match routeGridSkip: the actual exit may flip to S/N when a
  // horizontal cross-row sweep would pierce another node in the row.
  const fromRow = meta.nodeRow.get(edge.from) ?? 0;
  const toRow = meta.nodeRow.get(edge.to) ?? 0;
  const goingDown = toRow > fromRow;
  if (toRow < fromRow && fromSide === toSide) {
    // Upward skip loop within the same column-side: force outer side-ports
    // so the path loops around the outside of the column.
    // Cross-column upward edges (e.g. E1 → main) keep their natural exitDir.
    exitDir = fromSide > 0 ? 'E' : 'W';
  } else if (from.shape !== 'decision'
    && anyNodeInRowBetween(meta, edge.from, fromRow, exitDir)) {
    exitDir = goingDown ? 'S' : 'N';
  }

  let entryDir: CardinalDir;
  if (channelX > (to.x ?? 0)) entryDir = 'E';
  else if (channelX < (to.x ?? 0)) entryDir = 'W';
  else entryDir = exitDir === 'E' ? 'W' : 'E';

  // South-entry preference (mirrors routeGridSkip): back-edge arriving
  // via a channel close to the target center → enter from the bottom.
  const usingSouthEntry =
    !goingDown &&
    to.shape !== 'decision' &&
    Math.abs((to.x ?? 0) - channelX) < (to.width ?? 180);
  if (usingSouthEntry) entryDir = 'S';

  // Mirror the top-entry preference in routeGridSkip.
  const usingTopEntry =
    !usingSouthEntry &&
    toRow > fromRow + 1 &&
    Math.abs((to.x ?? 0) - channelX) > (to.width ?? 180) / 2 + 24;
  if (usingTopEntry) entryDir = 'N';

  return { exitDir, entryDir };
}

/**
 * Heuristic: would the corner of an L-shaped path between exit and entry
 * land inside a sibling node's bounding box? This catches grid-local
 * routes whose source-row contains another column-occupying node along
 * the corner's path. Used to upgrade the L into a Z that detours through
 * the inter-row gap.
 */
function cornerWouldPierceRow(
  meta: GridLayoutMeta,
  sourceId: string,
  sourceRow: number,
  exit: { x: number; y: number },
  entry: { x: number; y: number },
  horizontalDir: CardinalDir,
): boolean {
  const r = meta.rows[sourceRow];
  if (!r) return false;
  // The L-corner sits at (exit.x, entry.y). If the horizontal segment at
  // y=entry.y passes through any column-occupying node lying between
  // exit.x and entry.x, return true.
  const corners = meta.rows;
  for (const row of corners) {
    if (!row) continue;
    for (const [, n] of row.nodes) {
      if (n.id === sourceId) continue;
      const hw = (n.width ?? 180) / 2;
      const hh = (n.height ?? 44) / 2;
      const left = (n.x ?? 0) - hw;
      const right = (n.x ?? 0) + hw;
      const top = (n.y ?? 0) - hh;
      const bot = (n.y ?? 0) + hh;
      // Vertical leg of the L: x = exit.x, y range [min(exit.y, entry.y), max].
      const vyMin = Math.min(exit.y, entry.y);
      const vyMax = Math.max(exit.y, entry.y);
      const verticalCrosses =
        exit.x > left && exit.x < right && vyMax > top && vyMin < bot;
      // Horizontal leg of the L: y = entry.y, x range [min(exit.x, entry.x), max].
      const hxMin = Math.min(exit.x, entry.x);
      const hxMax = Math.max(exit.x, entry.x);
      const horizontalCrosses =
        entry.y > top && entry.y < bot && hxMax > left && hxMin < right;
      if ((verticalCrosses || horizontalCrosses) &&
        // If we move horizontally through a node, the route is corrupt.
        // Only flag when the offending node sits at a *different* row to
        // the source — otherwise the standard same-row detour handles it.
        (n.id !== sourceId)) {
        // Direction sanity: only count nodes in the half-plane the
        // horizontal leg actually traverses (e.g. going E means we only
        // care about nodes east of exit.x and west of entry.x).
        if (horizontalDir === 'E' && right < exit.x) continue;
        if (horizontalDir === 'W' && left > exit.x) continue;
        return true;
      }
    }
  }
  return false;
}

/**
 * Are there any other nodes in `row` lying between the source column
 * and the channel direction? If so, a horizontal segment at this row
 * would pierce them.
 */
function anyNodeInRowBetween(
  meta: GridLayoutMeta,
  sourceId: string,
  row: number,
  direction: CardinalDir,
): boolean {
  const r = meta.rows[row];
  if (!r) return false;
  const sourceCol = meta.nodeColumn.get(sourceId);
  const sourceColInfo = sourceCol ? meta.columns.get(sourceCol) : null;
  if (!sourceColInfo) return false;
  for (const [colId, _node] of r.nodes) {
    if (colId === sourceCol) continue;
    const col = meta.columns.get(colId);
    if (!col) continue;
    if (direction === 'E' && col.x > sourceColInfo.x) return true;
    if (direction === 'W' && col.x < sourceColInfo.x) return true;
  }
  return false;
}

// --- Cardinal Port Routing (for swimlanes) ---

/**
 * Stable edge key that includes the edge's document index, so duplicate
 * (from, to) edges (e.g. an explicit yes-branch plus an implicit
 * fall-through to the same target) don't share routing state.
 */
function edgeId(index: number, edge: FlowEdge): string {
  return `${index}:${edge.from}->${edge.to}`;
}

/**
 * For each decision source with multiple outgoing edges, assign each
 * edge a distinct cardinal exit direction (S/E/W/N). Without this,
 * the per-edge direction scorers picked the same side for every branch
 * with similar geometry — e.g. three custom-condition branches like
 * `high`/`medium`/`low` all stacking on the East tip.
 *
 * Allocation rules:
 *   - yes / true             → S (preserves the long-standing convention)
 *   - no / false             → opposite horizontal (E or W) of the
 *                               nearest non-yes branch's geometry
 *   - remaining branches      → assigned in document order, picking the
 *                               cardinal whose alignment with the
 *                               target's offset is best while still
 *                               unused.
 *
 * Diamonds have only four tips; if a decision has more than four
 * branches the surplus simply reuses the best-scoring side. (The
 * intent is to fix the common 3- to 4-branch case, not to invent a
 * full channel router.)
 */
function assignDecisionExits(doc: FlowDocument): Map<string, CardinalDir> {
  const out = new Map<string, CardinalDir>();

  // Group outgoing edges by decision source (with their original
  // document index, used as the edge's identity).
  const byDecision = new Map<string, Array<{ idx: number; edge: FlowEdge }>>();
  for (let i = 0; i < doc.edges.length; i++) {
    const edge = doc.edges[i];
    const fromNode = doc.nodes.get(edge.from);
    if (!fromNode || fromNode.shape !== 'decision') continue;
    const list = byDecision.get(edge.from) ?? [];
    list.push({ idx: i, edge });
    byDecision.set(edge.from, list);
  }

  for (const [decisionId, branches] of byDecision) {
    if (branches.length < 2) continue; // single branch: leave to scorer
    const from = doc.nodes.get(decisionId);
    if (!from) continue;

    const used = new Set<CardinalDir>();
    // Reserve N for the (likely) incoming edge so we don't conflict
    // with the natural "enter from top" routing into the diamond.
    const preferOrder: CardinalDir[] = ['S', 'E', 'W', 'N'];

    // Pass 1: honor yes/true by pinning to S for forward edges.
    // Back-edges (target above source) must not pin to S — instead
    // use the side that faces the target so the path routes correctly.
    for (const { idx, edge } of branches) {
      if (edge.condition === 'yes' || edge.condition === 'true') {
        const to = doc.nodes.get(edge.to);
        const dy = (to?.y ?? 0) - (from.y ?? 0);
        if (dy >= 0) {
          // Forward edge: standard S (continue straight down).
          out.set(edgeId(idx, edge), 'S');
          used.add('S');
        } else {
          // Back-edge: exit toward the target column.
          const dx = (to?.x ?? 0) - (from.x ?? 0);
          const pick: CardinalDir = dx <= 0 ? 'W' : 'E';
          out.set(edgeId(idx, edge), pick);
          used.add(pick);
        }
      }
    }

    // Pass 2: honor no/false by pinning to the side that points toward
    // the target.
    for (const { idx, edge } of branches) {
      if (out.has(edgeId(idx, edge))) continue;
      if (edge.condition === 'no' || edge.condition === 'false') {
        const to = doc.nodes.get(edge.to);
        const dx = (to?.x ?? 0) - (from.x ?? 0);
        let pick: CardinalDir = dx >= 0 ? 'E' : 'W';
        if (used.has(pick)) {
          pick = pick === 'E' ? 'W' : 'E';
        }
        if (used.has(pick)) {
          // Fall back to first unused.
          pick = preferOrder.find(d => !used.has(d)) ?? pick;
        }
        out.set(edgeId(idx, edge), pick);
        used.add(pick);
      }
    }

    // Pass 3: assign remaining branches in document order, preferring
    // the cardinal that best aligns with the branch target's geometry.
    // When all four sides are taken, recycle the preference order so
    // overflow branches still get *some* cardinal (and re-stack on it
    // — better than no override at all).
    for (const { idx, edge } of branches) {
      const key = edgeId(idx, edge);
      if (out.has(key)) continue;
      const to = doc.nodes.get(edge.to);
      const dx = (to?.x ?? 0) - (from.x ?? 0);
      const dy = (to?.y ?? 0) - (from.y ?? 0);

      const candidates = used.size >= 4
        ? preferOrder
        : preferOrder.filter(d => !used.has(d));
      let bestDir: CardinalDir = candidates[0] ?? 'S';
      let bestScore = -Infinity;
      for (const d of candidates) {
        let s = 0;
        if (d === 'S' && dy > 0) s += Math.abs(dy);
        if (d === 'N' && dy < 0) s += Math.abs(dy);
        if (d === 'E' && dx > 0) s += Math.abs(dx);
        if (d === 'W' && dx < 0) s += Math.abs(dx);
        if (s > bestScore) { bestScore = s; bestDir = d; }
      }
      out.set(key, bestDir);
      used.add(bestDir);
    }
  }

  return out;
}

/**
 * Choose cardinal exit/entry directions based on relative node positions.
 * Same-lane: vertical (N/S). Cross-lane: horizontal (E/W) + vertical approach.
 */
function chooseCardinalDirs(
  from: FlowNode, to: FlowNode, edge: FlowEdge,
  overrideExit?: CardinalDir,
): { exitDir: CardinalDir; entryDir: CardinalDir } {
  const dx = (to.x ?? 0) - (from.x ?? 0);
  const dy = (to.y ?? 0) - (from.y ?? 0);
  const sameLane = from.lane && from.lane === to.lane;

  // Multi-branch decision pre-pass takes precedence so each branch
  // gets its own diamond tip.
  if (overrideExit && from.shape === 'decision') {
    const entryDir: CardinalDir =
      overrideExit === 'S' || overrideExit === 'N'
        ? (dy >= 0 ? 'N' : 'S')
        : (dy > 30 ? 'N' : dy < -30 ? 'S' : (overrideExit === 'E' ? 'W' : 'E'));
    return { exitDir: overrideExit, entryDir };
  }

  if (sameLane || Math.abs(dx) < 10) {
    // Same lane or vertically aligned: use vertical ports
    if (from.shape === 'decision') {
      if (edge.condition === 'no' || edge.condition === 'false') {
        return { exitDir: dx >= 0 ? 'E' : 'W', entryDir: dy >= 0 ? 'N' : 'S' };
      }
    }
    return dy >= 0
      ? { exitDir: 'S', entryDir: 'N' }
      : { exitDir: 'N', entryDir: 'S' };
  }

  // Cross-lane: exit sideways, enter from top (or side if same rank)
  if (from.shape === 'decision') {
    if (edge.condition === 'yes' || edge.condition === 'true') {
      return { exitDir: 'S', entryDir: 'N' };
    }
  }

  const exitDir: CardinalDir = dx > 0 ? 'E' : 'W';
  // If target is significantly below/above, enter from top/bottom
  // If roughly same rank, enter from the side
  if (Math.abs(dy) > 30) {
    return { exitDir, entryDir: dy > 0 ? 'N' : 'S' };
  }
  return { exitDir, entryDir: dx > 0 ? 'W' : 'E' };
}

/**
 * Get a port position with spread offset for the given cardinal direction.
 * When multiple edges share the same side, they get evenly distributed.
 */
function getSpreadPort(
  node: FlowNode, dir: CardinalDir, index: number, total: number,
): Port {
  // Spread range: use 60% of the edge length, centered
  const spreadH = (node.width ?? 180) * 0.6;
  const spreadV = (node.height ?? 44) * 0.6;
  const offsetH = total <= 1 ? 0 : (index / (total - 1) - 0.5) * spreadH;
  const offsetV = total <= 1 ? 0 : (index / (total - 1) - 0.5) * spreadV;

  // Decisions (diamonds) keep edges at the tip — the shape port function
  // ignores the offset for decisions to preserve the existing visual.
  const offset =
    dir === 'N' || dir === 'S' ? offsetH : offsetV;
  return getPortForNodeShape(node, dir as ShapeDir, offset);
}

/**
 * Cardinal port router: used when swimlanes are active.
 * Produces orthogonal paths with proper N/S/E/W port selection and spreading.
 */
function routeCardinal(
  edge: FlowEdge,
  from: FlowNode,
  to: FlowNode,
  cornerRadius: number,
  portUsage: Map<string, number>,
  portIndex: Map<string, number>,
  edgeIndex: number,
  overrideExit?: CardinalDir,
): RouteResult {
  const { exitDir, entryDir } = chooseCardinalDirs(from, to, edge, overrideExit);
  const edgeKey = edgeId(edgeIndex, edge);

  const exitTotal = portUsage.get(`${edge.from}:${exitDir}:exit`) ?? 1;
  const exitIdx = portIndex.get(`exit:${edgeKey}`) ?? 0;
  const entryTotal = portUsage.get(`${edge.to}:${entryDir}:entry`) ?? 1;
  const entryIdx = portIndex.get(`entry:${edgeKey}`) ?? 0;

  const exit = getSpreadPort(from, exitDir, exitIdx, exitTotal);
  const entry = getSpreadPort(to, entryDir, entryIdx, entryTotal);

  const r = cornerRadius;
  const waypoints: Port[] = [exit];

  const dx = entry.x - exit.x;
  const dy = entry.y - exit.y;

  // Build orthogonal waypoints based on exit/entry directions
  if (exitDir === 'S' && entryDir === 'N') {
    if (Math.abs(dx) < 2) {
      // Straight down
    } else {
      const midY = exit.y + dy / 2;
      waypoints.push({ x: exit.x, y: midY });
      waypoints.push({ x: entry.x, y: midY });
    }
  } else if (exitDir === 'N' && entryDir === 'S') {
    if (Math.abs(dx) < 2) {
      // Straight up
    } else {
      const midY = exit.y + dy / 2;
      waypoints.push({ x: exit.x, y: midY });
      waypoints.push({ x: entry.x, y: midY });
    }
  } else if ((exitDir === 'E' || exitDir === 'W') && entryDir === 'N') {
    // Horizontal then down into top
    waypoints.push({ x: entry.x, y: exit.y });
  } else if ((exitDir === 'E' || exitDir === 'W') && entryDir === 'S') {
    // Horizontal then up into bottom
    waypoints.push({ x: entry.x, y: exit.y });
  } else if ((exitDir === 'E' || exitDir === 'W') && (entryDir === 'E' || entryDir === 'W')) {
    // Horizontal to horizontal — need mid-X bend
    const midX = exit.x + dx / 2;
    waypoints.push({ x: midX, y: exit.y });
    waypoints.push({ x: midX, y: entry.y });
  } else if (exitDir === 'S' && (entryDir === 'E' || entryDir === 'W')) {
    waypoints.push({ x: exit.x, y: entry.y });
  } else if (exitDir === 'N' && (entryDir === 'E' || entryDir === 'W')) {
    waypoints.push({ x: exit.x, y: entry.y });
  } else {
    // Fallback: midpoint
    if (Math.abs(dx) > Math.abs(dy)) {
      const midX = exit.x + dx / 2;
      waypoints.push({ x: midX, y: exit.y });
      waypoints.push({ x: midX, y: entry.y });
    } else {
      const midY = exit.y + dy / 2;
      waypoints.push({ x: exit.x, y: midY });
      waypoints.push({ x: entry.x, y: midY });
    }
  }

  waypoints.push(entry);

  const pathData = waypointsToRoundedPath(waypoints, r);
  const labelPos = getPathMidpoint(waypoints);

  return {
    pathData,
    labelPosition: labelPos,
    waypoints: waypoints.map(p => ({ x: p.x, y: p.y })),
    yieldOnCross: edge.retry === true,
  };
}

// --- Orthogonal Router ---

function routeOrthogonal(
  edge: FlowEdge,
  from: FlowNode,
  to: FlowNode,
  cornerRadius: number,
  overrideExit?: CardinalDir,
): RouteResult {
  const { exitDir, entryDir } = chooseScoredDirs(from, to, edge, overrideExit);
  const fromPorts = getNodePorts(from);
  const toPorts = getNodePorts(to);
  const exit = portForDir(fromPorts, exitDir);
  const entry = portForDir(toPorts, entryDir);

  const waypoints = buildOrthogonalWaypoints(exit, entry, exitDir, entryDir);
  const pathData = waypointsToRoundedPath(waypoints, cornerRadius);
  const labelPos = getPathMidpoint(waypoints);

  return {
    pathData,
    labelPosition: labelPos,
    waypoints: waypoints.map(p => ({ x: p.x, y: p.y })),
    yieldOnCross: edge.retry === true,
  };
}

/**
 * Build orthogonal waypoints between two ports given their cardinal
 * exit/entry directions. Handles all 16 combinations by emitting either
 * a straight line, an L-bend, or a Z-bend.
 *
 * The routing rule, in plain English:
 *   - If the exit direction is vertical and entry is vertical, jog at
 *     the midpoint Y (or go straight when X already aligns).
 *   - If both are horizontal, jog at the midpoint X.
 *   - Mixed (V↔H) — emit a single L: travel along the exit axis until
 *     we hit the entry's perpendicular line, then turn.
 *   - Same direction (e.g. exit=N, entry=N) — emit a U: step out along
 *     the exit, jog perpendicular at a clear-of-shapes offset, then in.
 */
function buildOrthogonalWaypoints(
  exit: Port,
  entry: Port,
  exitDir: CardinalDir,
  entryDir: CardinalDir,
): Port[] {
  const dx = entry.x - exit.x;
  const dy = entry.y - exit.y;
  const exitAxis = (exitDir === 'N' || exitDir === 'S') ? 'V' : 'H';
  const entryAxis = (entryDir === 'N' || entryDir === 'S') ? 'V' : 'H';
  const points: Port[] = [exit];

  // Both vertical
  if (exitAxis === 'V' && entryAxis === 'V') {
    if (Math.abs(dx) < 2) {
      // Straight line
    } else if (
      (exitDir === 'S' && entryDir === 'N') ||
      (exitDir === 'N' && entryDir === 'S')
    ) {
      const midY = exit.y + dy / 2;
      points.push({ x: exit.x, y: midY });
      points.push({ x: entry.x, y: midY });
    } else {
      // Same-side U: step further out along exit axis, then across, then in.
      const step = exitDir === 'N' ? -30 : 30;
      const midY = (exitDir === entryDir)
        ? Math.min(exit.y, entry.y) + step
        : exit.y + dy / 2;
      points.push({ x: exit.x, y: midY });
      points.push({ x: entry.x, y: midY });
    }
    points.push(entry);
    return points;
  }

  // Both horizontal
  if (exitAxis === 'H' && entryAxis === 'H') {
    if (Math.abs(dy) < 2) {
      // Straight line
    } else if (
      (exitDir === 'E' && entryDir === 'W') ||
      (exitDir === 'W' && entryDir === 'E')
    ) {
      const midX = exit.x + dx / 2;
      points.push({ x: midX, y: exit.y });
      points.push({ x: midX, y: entry.y });
    } else {
      const step = exitDir === 'W' ? -30 : 30;
      const midX = (exitDir === entryDir)
        ? Math.min(exit.x, entry.x) + step
        : exit.x + dx / 2;
      points.push({ x: midX, y: exit.y });
      points.push({ x: midX, y: entry.y });
    }
    points.push(entry);
    return points;
  }

  // Mixed: V → H or H → V — single L bend at the corner.
  if (exitAxis === 'V' && entryAxis === 'H') {
    points.push({ x: exit.x, y: entry.y });
  } else {
    points.push({ x: entry.x, y: exit.y });
  }
  points.push(entry);
  return points;
}

/**
 * Convert a series of waypoints into an SVG path with rounded corners
 * using quadratic Bezier curves at bends.
 */
function waypointsToRoundedPath(points: Port[], radius: number): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M${points[0].x},${points[0].y} L${points[1].x},${points[1].y}`;
  }

  let d = `M${points[0].x},${points[0].y}`;

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    // Vectors from curr to prev and curr to next
    const toPrev = { x: prev.x - curr.x, y: prev.y - curr.y };
    const toNext = { x: next.x - curr.x, y: next.y - curr.y };

    const lenPrev = Math.sqrt(toPrev.x ** 2 + toPrev.y ** 2);
    const lenNext = Math.sqrt(toNext.x ** 2 + toNext.y ** 2);

    // Clamp radius to half the shorter segment
    const r = Math.min(radius, lenPrev / 2, lenNext / 2);

    if (r < 1) {
      d += ` L${curr.x},${curr.y}`;
      continue;
    }

    // Points where the curve starts and ends
    const startX = curr.x + (toPrev.x / lenPrev) * r;
    const startY = curr.y + (toPrev.y / lenPrev) * r;
    const endX = curr.x + (toNext.x / lenNext) * r;
    const endY = curr.y + (toNext.y / lenNext) * r;

    d += ` L${startX},${startY}`;
    d += ` Q${curr.x},${curr.y} ${endX},${endY}`;
  }

  const last = points[points.length - 1];
  d += ` L${last.x},${last.y}`;

  return d;
}

// --- Bezier Router ---

function routeBezier(from: FlowNode, to: FlowNode): RouteResult {
  const fromPorts = getNodePorts(from);
  const toPorts = getNodePorts(to);

  const fc = getNodeCenter(from);
  const tc = getNodeCenter(to);
  const dy = tc.y - fc.y;

  // Primarily vertical: exit bottom, enter top
  const exit = dy >= 0 ? fromPorts.bottom : fromPorts.top;
  const entry = dy >= 0 ? toPorts.top : toPorts.bottom;

  // Control points — offset vertically
  const cpDist = Math.abs(dy) * 0.4 + 20;
  const cp1 = { x: exit.x, y: exit.y + (dy >= 0 ? cpDist : -cpDist) };
  const cp2 = { x: entry.x, y: entry.y - (dy >= 0 ? cpDist : -cpDist) };

  const pathData = `M${exit.x},${exit.y} C${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${entry.x},${entry.y}`;
  const labelPos = {
    x: (exit.x + entry.x) / 2,
    y: (exit.y + entry.y) / 2,
  };

  return { pathData, labelPosition: labelPos };
}

// --- Polyline Router ---

function routePolyline(from: FlowNode, to: FlowNode): RouteResult {
  const fromPorts = getNodePorts(from);
  const toPorts = getNodePorts(to);

  const fc = getNodeCenter(from);
  const tc = getNodeCenter(to);
  const dx = tc.x - fc.x;
  const dy = tc.y - fc.y;

  let exit: Port, entry: Port;
  if (Math.abs(dy) > Math.abs(dx)) {
    exit = dy > 0 ? fromPorts.bottom : fromPorts.top;
    entry = dy > 0 ? toPorts.top : toPorts.bottom;
  } else {
    exit = dx > 0 ? fromPorts.right : fromPorts.left;
    entry = dx > 0 ? toPorts.left : toPorts.right;
  }

  const pathData = `M${exit.x},${exit.y} L${entry.x},${entry.y}`;
  const labelPos = {
    x: (exit.x + entry.x) / 2,
    y: (exit.y + entry.y) / 2,
  };

  return { pathData, labelPosition: labelPos };
}

// --- Utility ---

function getPathMidpoint(points: Port[]): Port {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];

  // Find total path length
  let totalLen = 0;
  const segLens: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const len = Math.sqrt(dx * dx + dy * dy);
    segLens.push(len);
    totalLen += len;
  }

  // Walk to the midpoint
  let targetLen = totalLen / 2;
  for (let i = 0; i < segLens.length; i++) {
    if (targetLen <= segLens[i]) {
      const t = targetLen / segLens[i];
      return {
        x: Math.round(points[i].x + (points[i + 1].x - points[i].x) * t),
        y: Math.round(points[i].y + (points[i + 1].y - points[i].y) * t),
      };
    }
    targetLen -= segLens[i];
  }

  // Fallback
  const mid = Math.floor(points.length / 2);
  return points[mid];
}

// --- Line Jumps (Visio-style "hops" at unavoidable crossings) ---

/** Radius of the small bump rendered at a line-jump crossing. */
const JUMP_RADIUS = 4;

interface Segment {
  x1: number; y1: number;
  x2: number; y2: number;
  axis: 'H' | 'V';
  /** Endpoint coords as a Set for shared-endpoint detection */
  endpoints: Array<{ x: number; y: number }>;
}

/**
 * Detect orthogonal segment crossings between routes and rewrite the
 * lower-priority edge's path data to render a small arc bump where
 * its segment crosses a higher-priority edge's segment.
 *
 * Crossings are *only* counted between perpendicular segments (H × V).
 * Shared endpoints (e.g. two edges meeting at the same node port) and
 * collinear overlaps (parallel segments along the same axis) are
 * explicitly excluded so we don't draw spurious humps.
 *
 * Priority rule: retry/dashed edges (yieldOnCross=true) yield to
 * non-yielding edges. When two edges have the same yield-flag, the
 * later edge in the document yields. This keeps the visual deterministic
 * without requiring a full ranking pass.
 */
function applyLineJumps(
  doc: FlowDocument,
  routes: Map<string, RouteResult>,
  cornerRadius: number,
): void {
  // Build (edgeKey, segments) list in document order.
  const ordered: Array<{ key: string; route: RouteResult; segs: Segment[] }> = [];
  for (let i = 0; i < doc.edges.length; i++) {
    const edge = doc.edges[i];
    const key = `${edge.from}->${edge.to}`;
    const route = routes.get(key);
    if (!route?.waypoints || route.waypoints.length < 2) continue;
    ordered.push({ key, route, segs: waypointsToSegments(route.waypoints) });
  }

  // For each pair, compute crossings of (a × b). The yielding side
  // gets the bump.
  // edgeKey -> sorted list of crossings (point on its segment)
  const jumpsForEdge = new Map<string, Array<{ segIdx: number; t: number; x: number; y: number }>>();

  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const a = ordered[i];
      const b = ordered[j];
      // Determine which edge yields (gets the hop drawn on it).
      const aYields = !!a.route.yieldOnCross;
      const bYields = !!b.route.yieldOnCross;
      let yielder = b; // default: later edge yields
      if (aYields && !bYields) yielder = a;
      else if (!aYields && bYields) yielder = b;

      const crossings = findOrthogonalCrossings(a.segs, b.segs);
      if (crossings.length === 0) continue;

      const list = jumpsForEdge.get(yielder.key) ?? [];
      for (const c of crossings) {
        // Map crossing point onto the yielding edge's segments
        const segIdx = yielder === a ? c.aSegIdx : c.bSegIdx;
        const seg = yielder.segs[segIdx];
        const t = paramOnSegment(seg, c.x, c.y);
        // Skip jumps too close to segment endpoints — those would be
        // shared-port joins, not true crossings.
        if (t < 0.05 || t > 0.95) continue;
        list.push({ segIdx, t, x: c.x, y: c.y });
      }
      if (list.length > 0) jumpsForEdge.set(yielder.key, list);
    }
  }

  // Re-emit pathData for any edge that has jumps.
  for (const [key, jumps] of jumpsForEdge) {
    const route = routes.get(key);
    if (!route?.waypoints) continue;
    const newPath = waypointsToRoundedPathWithJumps(
      route.waypoints, cornerRadius, jumps,
    );
    route.pathData = newPath;
  }
}

function waypointsToSegments(points: Array<{ x: number; y: number }>): Segment[] {
  const segs: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue; // zero-length
    const axis: 'H' | 'V' = Math.abs(dx) > Math.abs(dy) ? 'H' : 'V';
    segs.push({
      x1: a.x, y1: a.y, x2: b.x, y2: b.y, axis,
      endpoints: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }],
    });
  }
  return segs;
}

/**
 * Return all (perpendicular) crossings between two edge segment lists.
 * Excludes shared endpoints and collinear overlaps.
 */
function findOrthogonalCrossings(
  aSegs: Segment[], bSegs: Segment[],
): Array<{ x: number; y: number; aSegIdx: number; bSegIdx: number }> {
  const out: Array<{ x: number; y: number; aSegIdx: number; bSegIdx: number }> = [];
  for (let ai = 0; ai < aSegs.length; ai++) {
    const a = aSegs[ai];
    for (let bi = 0; bi < bSegs.length; bi++) {
      const b = bSegs[bi];
      if (a.axis === b.axis) continue; // collinear or parallel — not a hop
      const h = a.axis === 'H' ? a : b;
      const v = a.axis === 'V' ? a : b;
      const y = h.y1; // horizontal seg's constant y
      const x = v.x1; // vertical seg's constant x
      // Strict interior crossing on both segments.
      const hMinX = Math.min(h.x1, h.x2);
      const hMaxX = Math.max(h.x1, h.x2);
      const vMinY = Math.min(v.y1, v.y2);
      const vMaxY = Math.max(v.y1, v.y2);
      const eps = 0.5;
      if (x <= hMinX + eps || x >= hMaxX - eps) continue;
      if (y <= vMinY + eps || y >= vMaxY - eps) continue;
      // Skip shared-endpoint crossings (same start/end node).
      if (sharesEndpoint(a, b, x, y)) continue;
      out.push({ x, y, aSegIdx: ai, bSegIdx: bi });
    }
  }
  return out;
}

function sharesEndpoint(a: Segment, b: Segment, x: number, y: number): boolean {
  for (const ea of a.endpoints) {
    for (const eb of b.endpoints) {
      if (Math.abs(ea.x - eb.x) < 1 && Math.abs(ea.y - eb.y) < 1) {
        // The two segments touch at an endpoint — likely a shared port.
        // If the crossing point coincides with that endpoint, it's not
        // a real crossing.
        if (Math.abs(x - ea.x) < 2 && Math.abs(y - ea.y) < 2) return true;
        // Even if the crossing isn't the shared endpoint itself, two
        // segments that share an endpoint cannot cross transversally
        // unless they're parallel — which we already filtered out.
        return true;
      }
    }
  }
  return false;
}

function paramOnSegment(seg: Segment, x: number, y: number): number {
  if (seg.axis === 'H') {
    const len = seg.x2 - seg.x1;
    if (Math.abs(len) < 0.5) return 0;
    return (x - seg.x1) / len;
  }
  const len = seg.y2 - seg.y1;
  if (Math.abs(len) < 0.5) return 0;
  return (y - seg.y1) / len;
}

/**
 * Same as waypointsToRoundedPath but inserts a small arc "bump" where
 * the path crosses another edge. Bumps render as a 180° arc above/right
 * of the crossing depending on segment orientation.
 */
function waypointsToRoundedPathWithJumps(
  points: Array<{ x: number; y: number }>,
  radius: number,
  jumps: Array<{ segIdx: number; t: number; x: number; y: number }>,
): string {
  if (points.length < 2) return '';

  // Group jumps by segment index, sorted by parameter t along the segment.
  const jumpsBySeg = new Map<number, Array<{ t: number; x: number; y: number }>>();
  for (const j of jumps) {
    const list = jumpsBySeg.get(j.segIdx) ?? [];
    list.push({ t: j.t, x: j.x, y: j.y });
    jumpsBySeg.set(j.segIdx, list);
  }
  for (const [, list] of jumpsBySeg) {
    list.sort((p, q) => p.t - q.t);
  }

  let d = `M${points[0].x},${points[0].y}`;

  // Walk segments. When we have a jump on segment i, draw a partial line
  // up to the bump-start, then an arc, then continue.
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const segJumps = jumpsBySeg.get(i) ?? [];
    const dxs = b.x - a.x;
    const dys = b.y - a.y;
    const len = Math.hypot(dxs, dys);
    const ux = len > 0 ? dxs / len : 0;
    const uy = len > 0 ? dys / len : 0;
    let cursor = { x: a.x, y: a.y };

    for (const jump of segJumps) {
      const r = JUMP_RADIUS;
      // Entry/exit points on the segment, r away from the crossing.
      const enter = { x: jump.x - ux * r, y: jump.y - uy * r };
      const exit = { x: jump.x + ux * r, y: jump.y + uy * r };
      // Draw line to the entry of the bump.
      d += ` L${enter.x},${enter.y}`;
      // Arc convention: sweep so the bump rises "above" (negative-y for
      // horizontal segs) or "right" (positive-x for vertical segs). The
      // sweep flag (1) renders a clockwise half-circle in SVG coords for
      // a horizontal segment moving in +x; flipping for −x stays visually
      // consistent because the arc encompasses the same crossing point.
      const sweep = 1;
      d += ` A${r},${r} 0 0 ${sweep} ${exit.x},${exit.y}`;
      cursor = exit;
    }

    // After bumps (if any), check if the next waypoint is a corner that
    // needs rounding.
    if (i < points.length - 2) {
      // Round the corner at b: emit the standard rounded-corner pattern.
      const next = points[i + 2];
      const toPrev = { x: cursor.x - b.x, y: cursor.y - b.y };
      const toNext = { x: next.x - b.x, y: next.y - b.y };
      const lenPrev = Math.hypot(toPrev.x, toPrev.y);
      const lenNext = Math.hypot(toNext.x, toNext.y);
      const r2 = Math.min(radius, lenPrev / 2, lenNext / 2);
      if (r2 < 1) {
        d += ` L${b.x},${b.y}`;
      } else {
        const sx = b.x + (toPrev.x / lenPrev) * r2;
        const sy = b.y + (toPrev.y / lenPrev) * r2;
        const ex = b.x + (toNext.x / lenNext) * r2;
        const ey = b.y + (toNext.y / lenNext) * r2;
        d += ` L${sx},${sy}`;
        d += ` Q${b.x},${b.y} ${ex},${ey}`;
      }
    } else {
      d += ` L${b.x},${b.y}`;
    }
  }

  return d;
}
