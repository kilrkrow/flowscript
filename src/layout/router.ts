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

export interface RouteResult {
  /** SVG path data string (M, L, Q, C commands) */
  pathData: string;
  /** Where to place the edge label (midpoint of the path) */
  labelPosition: { x: number; y: number };
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

  for (const edge of doc.edges) {
    const fromNode = doc.nodes.get(edge.from);
    const toNode = doc.nodes.get(edge.to);
    if (!fromNode || !toNode) continue;

    const key = `${edge.from}->${edge.to}`;
    const result = routeEdge(edge, fromNode, toNode, style, cornerRadius);
    routes.set(key, result);
  }

  return routes;
}

function routeEdge(
  edge: FlowEdge,
  from: FlowNode,
  to: FlowNode,
  style: RoutingStyle,
  cornerRadius: number,
): RouteResult {
  switch (style) {
    case 'orthogonal':
      return routeOrthogonal(edge, from, to, cornerRadius);
    case 'bezier':
      return routeBezier(from, to);
    case 'polyline':
      return routePolyline(from, to);
  }
}

// --- Connection port helpers ---

interface Port { x: number; y: number }

function getNodeCenter(node: FlowNode): Port {
  return { x: node.x ?? 0, y: node.y ?? 0 };
}

function getNodePorts(node: FlowNode): { top: Port; bottom: Port; left: Port; right: Port } {
  const cx = node.x ?? 0;
  const cy = node.y ?? 0;
  const hw = (node.width ?? 180) / 2;
  const hh = (node.height ?? 44) / 2;

  if (node.shape === 'decision') {
    // Diamond — ports at the tips
    return {
      top:    { x: cx, y: cy - hh },
      bottom: { x: cx, y: cy + hh },
      left:   { x: cx - hw * 0.9, y: cy },
      right:  { x: cx + hw * 0.9, y: cy },
    };
  }

  return {
    top:    { x: cx, y: cy - hh },
    bottom: { x: cx, y: cy + hh },
    left:   { x: cx - hw, y: cy },
    right:  { x: cx + hw, y: cy },
  };
}

/**
 * Choose the best exit/entry ports based on relative node positions.
 */
function choosePorts(from: FlowNode, to: FlowNode, edge: FlowEdge): { exit: Port; entry: Port } {
  const fromPorts = getNodePorts(from);
  const toPorts = getNodePorts(to);

  const fc = getNodeCenter(from);
  const tc = getNodeCenter(to);

  const dx = tc.x - fc.x;
  const dy = tc.y - fc.y;

  // Decision nodes: first condition exits bottom, second exits right
  if (from.shape === 'decision') {
    if (edge.condition === 'yes' || edge.condition === 'true' ||
        (!edge.condition && Math.abs(dy) > Math.abs(dx))) {
      return { exit: fromPorts.bottom, entry: toPorts.top };
    }
    if (edge.condition === 'no' || edge.condition === 'false') {
      if (dx >= 0) return { exit: fromPorts.right, entry: toPorts.left };
      return { exit: fromPorts.left, entry: toPorts.right };
    }
  }

  // General case: choose based on relative position
  if (Math.abs(dy) > Math.abs(dx)) {
    // Primarily vertical
    if (dy > 0) return { exit: fromPorts.bottom, entry: toPorts.top };
    return { exit: fromPorts.top, entry: toPorts.bottom };
  } else {
    // Primarily horizontal
    if (dx > 0) return { exit: fromPorts.right, entry: toPorts.left };
    return { exit: fromPorts.left, entry: toPorts.right };
  }
}

// --- Orthogonal Router ---

function routeOrthogonal(
  edge: FlowEdge,
  from: FlowNode,
  to: FlowNode,
  cornerRadius: number,
): RouteResult {
  const { exit, entry } = choosePorts(from, to, edge);
  const r = cornerRadius;

  // Build waypoints for an orthogonal path
  const waypoints: Port[] = [exit];

  const dx = entry.x - exit.x;
  const dy = entry.y - exit.y;

  // Determine if we need a bend
  const exitDir = getPortDirection(from, exit);
  const entryDir = getPortDirection(to, entry);

  if (exitDir === 'down' && entryDir === 'up') {
    if (Math.abs(dx) < 2) {
      // Straight down — no bend needed
    } else {
      // Need horizontal jog
      const midY = exit.y + dy / 2;
      waypoints.push({ x: exit.x, y: midY });
      waypoints.push({ x: entry.x, y: midY });
    }
  } else if (exitDir === 'right' && entryDir === 'up') {
    // Right then down
    waypoints.push({ x: entry.x, y: exit.y });
  } else if (exitDir === 'left' && entryDir === 'up') {
    // Left then down
    waypoints.push({ x: entry.x, y: exit.y });
  } else if (exitDir === 'right' && entryDir === 'left') {
    // Right to left with mid-point
    const midX = exit.x + dx / 2;
    waypoints.push({ x: midX, y: exit.y });
    waypoints.push({ x: midX, y: entry.y });
  } else if (exitDir === 'down' && entryDir === 'left') {
    // Down then right
    waypoints.push({ x: exit.x, y: entry.y });
  } else {
    // Fallback: midpoint routing
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

  // Convert waypoints to SVG path with rounded corners
  const pathData = waypointsToRoundedPath(waypoints, r);
  const labelPos = getPathMidpoint(waypoints);

  return { pathData, labelPosition: labelPos };
}

function getPortDirection(node: FlowNode, port: Port): 'up' | 'down' | 'left' | 'right' {
  const cx = node.x ?? 0;
  const cy = node.y ?? 0;
  const dx = port.x - cx;
  const dy = port.y - cy;

  if (Math.abs(dy) > Math.abs(dx)) {
    return dy > 0 ? 'down' : 'up';
  }
  return dx > 0 ? 'right' : 'left';
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
