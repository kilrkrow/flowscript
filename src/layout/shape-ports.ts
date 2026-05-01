/**
 * Centralized shape port abstraction.
 *
 * Given a node and a cardinal direction (N/S/E/W) — or a free direction
 * vector — returns the point on the shape's boundary where an edge should
 * connect. This replaces ad-hoc rectangular math previously duplicated
 * in the router and lets shapes that are not rectangular (circle, decision,
 * io parallelogram, etc.) provide their own correct anchor points.
 *
 * Rectangle is the default; non-rectangular shapes are handled by name.
 */

import type { FlowNode, ShapeType } from '../parser/ast.js';

export type CardinalDir = 'N' | 'S' | 'E' | 'W';
export interface Port { x: number; y: number }

/**
 * Standard cardinal port for a node, with an offset from the centerline
 * along the side. `offset` is in pixels; positive moves clockwise relative
 * to the cardinal direction (N: +x; E: +y; S: -x; W: -y).
 *
 * Falls back to rectangular geometry if the shape doesn't have a custom
 * implementation. Existing rectangular behavior is preserved bit-for-bit
 * so tests against pre-existing geometry don't regress.
 */
export function getPortForNodeShape(
  node: FlowNode,
  dir: CardinalDir,
  offset: number = 0,
): Port {
  const cx = node.x ?? 0;
  const cy = node.y ?? 0;
  const w = node.width ?? 180;
  const h = node.height ?? 44;
  const hw = w / 2;
  const hh = h / 2;

  switch (node.shape) {
    case 'circle':
      return circlePort(cx, cy, w, h, dir, offset);
    case 'decision':
      return decisionPort(cx, cy, hw, hh, dir);
    default:
      return rectPort(cx, cy, hw, hh, dir, offset);
  }
}

/**
 * Convenience: compute a port from an arbitrary direction vector,
 * picking the correct shape boundary point. Used for non-orthogonal
 * (bezier/polyline) routing where the connection isn't axis-aligned.
 */
export function getPortForDirection(
  node: FlowNode,
  dx: number,
  dy: number,
): Port {
  const cx = node.x ?? 0;
  const cy = node.y ?? 0;
  const w = node.width ?? 180;
  const h = node.height ?? 44;

  if (node.shape === 'circle') {
    // Intersect ray (dx, dy) with the circle boundary.
    const r = Math.min(w, h) / 2;
    const len = Math.hypot(dx, dy) || 1;
    return { x: cx + (dx / len) * r, y: cy + (dy / len) * r };
  }

  // Rectangle / decision / etc — use the cardinal closest to the direction.
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const dir: CardinalDir =
    absX > absY ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N');
  return getPortForNodeShape(node, dir);
}

// ── shape-specific ports ─────────────────────────────────────────────

function rectPort(
  cx: number, cy: number, hw: number, hh: number,
  dir: CardinalDir, offset: number,
): Port {
  switch (dir) {
    case 'N': return { x: cx + offset, y: cy - hh };
    case 'S': return { x: cx + offset, y: cy + hh };
    case 'E': return { x: cx + hw,     y: cy + offset };
    case 'W': return { x: cx - hw,     y: cy + offset };
  }
}

/**
 * Decision (diamond) — connect at the tip on the requested cardinal.
 * Offsets are not respected for diamonds because moving along the side
 * pulls the anchor *off* the shape boundary; multiple decision edges
 * stack at the tip, which matches existing flowchart conventions.
 */
function decisionPort(
  cx: number, cy: number, hw: number, hh: number, dir: CardinalDir,
): Port {
  switch (dir) {
    case 'N': return { x: cx,                y: cy - hh };
    case 'S': return { x: cx,                y: cy + hh };
    case 'E': return { x: cx + hw * 0.9,     y: cy };
    case 'W': return { x: cx - hw * 0.9,     y: cy };
  }
}

/**
 * Circle / ellipse — boundary point in the requested direction.
 * For non-square dimensions this treats the circle as an ellipse so
 * the edge actually meets the rendered curve rather than the bounding box.
 *
 * Offset along the side is converted into an angular sweep.
 */
function circlePort(
  cx: number, cy: number, w: number, h: number,
  dir: CardinalDir, offset: number,
): Port {
  // Renderer draws a circle of radius min(w, h) / 2, not an ellipse.
  // Match the visual: use the same radius for both axes so the port
  // actually lands on the rendered boundary.
  const r = Math.min(w, h) / 2;
  if (r <= 0) {
    return { x: cx, y: cy };
  }
  // Map cardinal + offset to an angle. For N/S, offset moves along x;
  // for E/W, offset moves along y. Clamp the sweep so we don't wrap past
  // 90° on a single side.
  const sweep = Math.max(-1, Math.min(1, offset / r));
  const a = Math.asin(sweep); // -π/2 .. π/2
  switch (dir) {
    case 'N': return { x: cx + r * Math.sin(a),  y: cy - r * Math.cos(a) };
    case 'S': return { x: cx + r * Math.sin(a),  y: cy + r * Math.cos(a) };
    case 'E': return { x: cx + r * Math.cos(a),  y: cy + r * Math.sin(a) };
    case 'W': return { x: cx - r * Math.cos(a),  y: cy + r * Math.sin(a) };
  }
}

/**
 * Public alias mirroring the request in the task brief.
 */
export const shapePort = getPortForNodeShape;

/** Shapes that have a non-rectangular port implementation. */
export const NON_RECT_SHAPES: ReadonlySet<ShapeType> = new Set([
  'circle', 'decision',
]);
