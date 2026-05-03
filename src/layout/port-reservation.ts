/**
 * Cardinal port reservation pre-pass.
 *
 * The router used to pick exit/entry sides per edge from raw geometry,
 * then patch up collisions afterward (port-pressure spread, alternate-
 * side swap). That gave the right *spatial* answer most of the time but
 * routinely produced visually wrong choices like:
 *   - re-using an inbound port for an outbound edge,
 *   - stacking multiple edges on the same cardinal when an adjacent
 *     side was free,
 *   - sending a `yes` branch back into the inbound `N` of its target.
 *
 * This module flips the order: ports get *reserved* per-edge before any
 * waypoint geometry is computed, using simple, prioritised rules:
 *
 *   1. The strongest penalty is *opposite-direction reuse*: if a side
 *      already holds inbound traffic, do not place outbound on the same
 *      side (and vice-versa) unless every other cardinal is unavailable.
 *   2. Same-direction reuse is allowed, but only if no other cardinal is
 *      free for that role.
 *   3. Geometry alignment is the *tie-breaker* — it shapes the
 *      preference order, not the final decision.
 *   4. Once all four cardinals on a node are exhausted for the requested
 *      role, the edge falls back to a semi-cardinal (NE/SE/SW/NW), which
 *      is represented as a sub-cardinal offset on the closest cardinal
 *      side. Tests pin this fallback ordering.
 *
 * The reservation is a pure function of the document (after layout)
 * and the geometry preferences emitted by the router's existing
 * `predict*Dirs` helpers. The router consumes the result via
 * {@link getReservation}.
 */

import type { FlowDocument, FlowEdge, FlowNode } from '../parser/ast.js';

export type CardinalDir = 'N' | 'S' | 'E' | 'W';
export type SemiCardinalDir = 'NE' | 'SE' | 'SW' | 'NW';
export type AnyDir = CardinalDir | SemiCardinalDir;

export type Role = 'exit' | 'entry';

/** Per-edge reservation: what side, on which node, for which role. */
export interface EdgePortReservation {
  exitDir: AnyDir;
  entryDir: AnyDir;
  /** Per-role index inside its (node, dir, role) bucket — used for spread. */
  exitIndex: number;
  entryIndex: number;
  /** Total count in that bucket. */
  exitTotal: number;
  entryTotal: number;
  /** True when the dir is a semi-cardinal — router renders via offset. */
  exitIsSemi: boolean;
  entryIsSemi: boolean;
}

export interface PortReservationResult {
  byEdgeKey: Map<string, EdgePortReservation>;
}

/**
 * Caller-supplied geometry preference for a single edge. Lists cardinals
 * in descending order of how well they match the natural flow direction.
 * The reservation walks this list, pruning sides that violate availability
 * rules.
 */
export interface EdgePreferences {
  /** Stable key, must match what the router queries with later. */
  edgeKey: string;
  edge: FlowEdge;
  fromNode: FlowNode;
  toNode: FlowNode;
  /** Ranked candidate exits, best first. */
  exitPrefs: CardinalDir[];
  /** Ranked candidate entries, best first. */
  entryPrefs: CardinalDir[];
  /**
   * Hard pin for exit dir (e.g. multi-branch decision pre-pass already
   * locked this edge to a tip). When set, the reserver still tracks the
   * port as occupied but skips the availability search for the exit.
   */
  exitPin?: CardinalDir;
  /** Hard pin for entry dir, used analogously. */
  entryPin?: CardinalDir;
}

/**
 * Run the reservation. Edges are processed in document order so the
 * earlier-defined edge wins ties — this preserves the long-standing
 * "primary path keeps the natural port" behaviour and pushes follow-up
 * edges (retries, secondary branches) to free sides.
 */
export function reservePorts(
  _doc: FlowDocument,
  prefs: EdgePreferences[],
): PortReservationResult {
  // Per-(node, role) maps tracking which cardinals are taken and by how
  // many edges. We track *role-separated* counts so we can tell whether a
  // candidate cardinal is currently used for the *opposite* role.
  const used = new Map<string, number>(); // `${nodeId}:${dir}:${role}` -> count

  const result = new Map<string, EdgePortReservation>();

  // First pass: pick a cardinal per role per edge.
  // For each edge we record (dir, isSemi) without yet computing index/total.
  interface PartialReservation {
    exitDir: AnyDir;
    entryDir: AnyDir;
    exitIsSemi: boolean;
    entryIsSemi: boolean;
  }
  const partial = new Map<string, PartialReservation>();

  // Two role-separated passes:
  //   Pass A: reserve every edge's *exit* side in document order. This
  //           lets the natural outbound flow at a hub (the edge whose
  //           source IS the hub) claim its preferred cardinal before
  //           secondary inbounds get a chance to sit on the opposite
  //           role of the same side.
  //   Pass B: reserve every edge's *entry* side, also in document order.
  //           Entries see the exits already on the `used` map and treat
  //           them as opposite-role traffic — that is what implements
  //           "no opposite-direction reuse" in the cross-edge case.
  //
  // The trade-off versus a single doc-order pass: an inbound declared
  // before its hub's outbound no longer wins the natural side. In
  // practice, hub outbounds tend to appear early in flowchart sources
  // (the primary path is written first), so the two-pass order matches
  // intuition. The router still falls back to geometry as the tie
  // breaker via the per-edge preference lists.
  // Predicted-entry pre-pass. Each edge's *natural* entry side
  // (its pin, or the head of its entryPrefs list) is stamped onto the
  // target node's entry tally before any exit gets picked. This lets
  // the exit pass's "no opposite-direction reuse" rule see incoming
  // edges that haven't been formally reserved yet — without it, an
  // outbound edge can land on a side that an inbound edge declared
  // later in document order is about to claim.
  const predictedEntry = new Map<string, AnyDir>();
  for (const p of prefs) {
    const dir: AnyDir = p.entryPin
      ? (p.entryPin as AnyDir)
      : (p.entryPrefs[0] ?? 'N');
    predictedEntry.set(p.edgeKey, dir);
    bumpUsed(used, p.toNode.id, dir, 'entry');
  }

  const exitChoice = new Map<string, { dir: AnyDir; semi: boolean }>();
  for (const p of prefs) {
    const exit = p.exitPin
      ? { dir: p.exitPin as AnyDir, semi: false }
      : pickCardinal(used, p.fromNode.id, p.exitPrefs, 'exit');
    exitChoice.set(p.edgeKey, exit);
    bumpUsed(used, p.fromNode.id, exit.dir, 'exit');
  }

  // Drop the predicted-entry stamps before the real entry pass — we
  // want the entry pass to compute occupancy fresh, otherwise every
  // entry would see itself already counted.
  for (const p of prefs) {
    const dir = predictedEntry.get(p.edgeKey)!;
    decUsed(used, p.toNode.id, dir, 'entry');
  }

  for (const p of prefs) {
    const exit = exitChoice.get(p.edgeKey)!;
    const entry = p.entryPin
      ? { dir: p.entryPin as AnyDir, semi: false }
      : pickCardinal(used, p.toNode.id, p.entryPrefs, 'entry');
    partial.set(p.edgeKey, {
      exitDir: exit.dir,
      entryDir: entry.dir,
      exitIsSemi: exit.semi,
      entryIsSemi: entry.semi,
    });
    bumpUsed(used, p.toNode.id, entry.dir, 'entry');
  }

  // Second pass: assign per-bucket index/total so the router can spread
  // multiple edges that share a cardinal+role bucket.
  const cursor = new Map<string, number>();
  for (const p of prefs) {
    const part = partial.get(p.edgeKey);
    if (!part) continue;
    const { fromNode, toNode } = p;
    const exitKey = bucketKey(fromNode.id, part.exitDir, 'exit');
    const entryKey = bucketKey(toNode.id, part.entryDir, 'entry');
    const ei = cursor.get(exitKey) ?? 0;
    const ni = cursor.get(entryKey) ?? 0;
    cursor.set(exitKey, ei + 1);
    cursor.set(entryKey, ni + 1);
    result.set(p.edgeKey, {
      exitDir: part.exitDir,
      entryDir: part.entryDir,
      exitIsSemi: part.exitIsSemi,
      entryIsSemi: part.entryIsSemi,
      exitIndex: ei,
      entryIndex: ni,
      exitTotal: used.get(exitKey) ?? 1,
      entryTotal: used.get(entryKey) ?? 1,
    });
  }

  return { byEdgeKey: result };
}

/**
 * Pick the best cardinal for the requested role given the preference
 * list and current occupancy. Fall back to a semi-cardinal once every
 * cardinal is occupied for the same role *and* opposite-direction reuse
 * is also impossible without a same-side double-up.
 *
 * Returns `{ dir, semi }`; when `semi` is true the dir is one of
 * NE/SE/SW/NW.
 */
function pickCardinal(
  used: Map<string, number>,
  nodeId: string,
  prefs: CardinalDir[],
  role: Role,
): { dir: AnyDir; semi: boolean } {
  const allCardinals: CardinalDir[] = ['N', 'E', 'S', 'W'];
  const ordered = orderByPreference(allCardinals, prefs);
  const opposite: Role = role === 'exit' ? 'entry' : 'exit';

  // Tier 1: a cardinal that is empty for *both* roles.
  for (const d of ordered) {
    const sameRole = used.get(bucketKey(nodeId, d, role)) ?? 0;
    const oppRole = used.get(bucketKey(nodeId, d, opposite)) ?? 0;
    if (sameRole === 0 && oppRole === 0) return { dir: d, semi: false };
  }

  // Tier 2: a cardinal empty for the same role (allows a side that
  // already has *same-direction* traffic to be skipped if a free side
  // exists). Specifically: prefer a side whose same-role count is zero.
  // This is the "no same-direction reuse if another cardinal is free"
  // rule. Opposite-role-occupied is fine here as long as same-role is 0.
  for (const d of ordered) {
    const sameRole = used.get(bucketKey(nodeId, d, role)) ?? 0;
    if (sameRole === 0) return { dir: d, semi: false };
  }

  // Tier 3: every cardinal already has same-role traffic. Fall back to a
  // semi-cardinal in the order NE → SE → SW → NW (closest to the most
  // preferred cardinal first).
  const semi = pickSemiCardinal(ordered);
  return { dir: semi, semi: true };
}

/**
 * Re-rank the cardinals so the most-preferred ones come first while
 * preserving the relative order of less-preferred cardinals. This lets
 * the reserver fall through to *some* answer even when `prefs` is short.
 */
function orderByPreference(
  all: CardinalDir[],
  prefs: CardinalDir[],
): CardinalDir[] {
  const seen = new Set<CardinalDir>();
  const out: CardinalDir[] = [];
  for (const d of prefs) {
    if (!seen.has(d)) { out.push(d); seen.add(d); }
  }
  for (const d of all) {
    if (!seen.has(d)) { out.push(d); seen.add(d); }
  }
  return out;
}

/**
 * Map an ordered cardinal preference list to the closest semi-cardinal.
 * The preference list is what we *wished* we could attach on; the
 * adjacent semi-cardinal is the next-best position when every cardinal
 * is taken. Falls back to NE if the list is somehow empty.
 */
function pickSemiCardinal(orderedCardinals: CardinalDir[]): SemiCardinalDir {
  const preferred = orderedCardinals[0] ?? 'N';
  // Adjacent cardinal preferred[1] determines which corner to pick.
  // If the preference list happens to contain orthogonal neighbours of
  // `preferred` adjacent to it, use the first one.
  const second = orderedCardinals.find(d => isAdjacentCardinal(preferred, d));
  return cornerOf(preferred, second ?? defaultAdjacent(preferred));
}

function isAdjacentCardinal(a: CardinalDir, b: CardinalDir): boolean {
  if (a === b) return false;
  if ((a === 'N' || a === 'S') && (b === 'E' || b === 'W')) return true;
  if ((a === 'E' || a === 'W') && (b === 'N' || b === 'S')) return true;
  return false;
}

function defaultAdjacent(d: CardinalDir): CardinalDir {
  return d === 'N' || d === 'S' ? 'E' : 'N';
}

function cornerOf(a: CardinalDir, b: CardinalDir): SemiCardinalDir {
  const set = new Set<CardinalDir>([a, b]);
  if (set.has('N') && set.has('E')) return 'NE';
  if (set.has('N') && set.has('W')) return 'NW';
  if (set.has('S') && set.has('E')) return 'SE';
  if (set.has('S') && set.has('W')) return 'SW';
  return 'NE';
}

function bumpUsed(
  used: Map<string, number>,
  nodeId: string,
  dir: AnyDir,
  role: Role,
): void {
  const key = bucketKey(nodeId, dir, role);
  used.set(key, (used.get(key) ?? 0) + 1);
}

function decUsed(
  used: Map<string, number>,
  nodeId: string,
  dir: AnyDir,
  role: Role,
): void {
  const key = bucketKey(nodeId, dir, role);
  const next = (used.get(key) ?? 0) - 1;
  if (next <= 0) used.delete(key);
  else used.set(key, next);
}

function bucketKey(nodeId: string, dir: AnyDir, role: Role): string {
  return `${nodeId}:${dir}:${role}`;
}

/**
 * Helper used by the router: convert a (possibly semi-cardinal) reserved
 * dir to the closest cardinal plus a side-offset suitable for
 * `getPortForNodeShape(node, dir, offset)`. Semi-cardinals are
 * represented as a side offset of 30% of the relevant dimension toward
 * the corner — a conservative compromise that preserves orthogonal
 * routing while still moving the anchor visibly off the cardinal tip.
 *
 * For a node of width w and height h:
 *   - NE → cardinal=N, offset=+0.3*w   (or cardinal=E, offset=-0.3*h)
 *   - SE → cardinal=S, offset=+0.3*w
 *   - SW → cardinal=S, offset=-0.3*w
 *   - NW → cardinal=N, offset=-0.3*w
 * The router picks whichever projection (along N/S vs E/W) better
 * matches its preferred axis.
 */
export function semiCardinalToCardinal(
  dir: AnyDir,
  preferAxis: 'V' | 'H',
  width: number,
  height: number,
): { cardinal: CardinalDir; offset: number } {
  if (dir === 'N' || dir === 'S' || dir === 'E' || dir === 'W') {
    return { cardinal: dir, offset: 0 };
  }
  const wOff = width * 0.3;
  const hOff = height * 0.3;
  // For a vertical preferred axis we project to N/S; otherwise to E/W.
  if (preferAxis === 'V') {
    if (dir === 'NE') return { cardinal: 'N', offset: wOff };
    if (dir === 'NW') return { cardinal: 'N', offset: -wOff };
    if (dir === 'SE') return { cardinal: 'S', offset: wOff };
    return { cardinal: 'S', offset: -wOff }; // SW
  }
  if (dir === 'NE') return { cardinal: 'E', offset: -hOff };
  if (dir === 'SE') return { cardinal: 'E', offset: hOff };
  if (dir === 'NW') return { cardinal: 'W', offset: -hOff };
  return { cardinal: 'W', offset: hOff }; // SW
}

/**
 * Look up an edge's reservation. Returns undefined for self-loops or
 * edges the caller didn't enrol.
 */
export function getReservation(
  reservations: PortReservationResult,
  edgeKey: string,
): EdgePortReservation | undefined {
  return reservations.byEdgeKey.get(edgeKey);
}
