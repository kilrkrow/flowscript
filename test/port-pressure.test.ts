/**
 * Port-pressure tests for the grid router.
 *
 * Two scenarios from the reviewed examples:
 *   1. incident-response: when a decision says `yes`, the routed path
 *      should start at the south tip of the diamond (the natural
 *      continuation), not collapse onto another side.
 *   2. learning-flow: when multiple skip / cross-column edges all
 *      converge on the same target side, they should be spread along
 *      that side rather than stacking on a single point.
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from '../src/parser/parser.js';
import { layoutDocument } from '../src/layout/dagre-layout.js';
import { routeEdges, findRoute } from '../src/layout/router.js';
import { render } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function pipeline(file: string) {
  const source = readFileSync(join(__dirname, 'fixtures', file), 'utf8');
  const doc = parse(source);
  layoutDocument(doc);
  const routes = routeEdges(doc);
  return { doc, routes };
}

function nodeByLabel(doc: ReturnType<typeof parse>, label: string) {
  for (const [, n] of doc.nodes) if (n.label === label) return n;
  throw new Error(`No node with label: ${label}`);
}

describe('grid port pressure — incident response', () => {
  it('"Yes" from `Have they arrived?` exits the south tip of the diamond', () => {
    const { doc, routes } = pipeline('incident-response.flow');
    const decision = nodeByLabel(doc, 'Have they arrived?');
    const monitor = nodeByLabel(doc, 'Monitor until resolved');

    // The yes-branch from this decision targets Monitor.
    const yesEdge = doc.edges.find(
      e => e.from === decision.id && e.to === monitor.id && e.condition === 'yes',
    );
    expect(yesEdge).toBeDefined();

    const r = findRoute(routes, doc, yesEdge!);
    expect(r).toBeDefined();
    const start = r!.waypoints![0];

    // South tip of a decision diamond: x = center, y = center + height/2.
    const expectedY = (decision.y ?? 0) + (decision.height ?? 0) / 2;
    expect(start.y).toBeCloseTo(expectedY, 1);
    expect(start.x).toBeCloseTo(decision.x ?? 0, 1);
  });
});

describe('grid port pressure — learning flow', () => {
  it('multiple back-edges into "Take Practice Quiz" are spread along the side', () => {
    const { doc, routes } = pipeline('learning-flow.flow');
    const target = nodeByLabel(doc, 'Take Practice Quiz');

    // Collect every edge whose target is Take Practice Quiz, capture
    // entry point and side.
    const entries: Array<{ from: string; x: number; y: number; side: string }> = [];
    for (const e of doc.edges) {
      if (e.to !== target.id) continue;
      const r = findRoute(routes, doc, e);
      if (!r?.waypoints) continue;
      const end = r.waypoints[r.waypoints.length - 1];
      const dx = end.x - (target.x ?? 0);
      const dy = end.y - (target.y ?? 0);
      const hw = (target.width ?? 180) / 2;
      const hh = (target.height ?? 44) / 2;
      let side = '?';
      if (Math.abs(dy + hh) < 1) side = 'N';
      else if (Math.abs(dy - hh) < 1) side = 'S';
      else if (Math.abs(dx - hw) < 1) side = 'E';
      else if (Math.abs(dx + hw) < 1) side = 'W';
      entries.push({ from: e.from, x: end.x, y: end.y, side });
    }

    // The fixture has at least three edges targeting this node.
    expect(entries.length).toBeGreaterThanOrEqual(3);

    // Group by side.
    const bySide = new Map<string, typeof entries>();
    for (const e of entries) {
      const list = bySide.get(e.side) ?? [];
      list.push(e);
      bySide.set(e.side, list);
    }

    // For any side that hosts ≥2 entries, the entry points must NOT
    // all share the same coordinate. This is the core "no stacking"
    // invariant.
    for (const [side, list] of bySide) {
      if (list.length < 2) continue;
      const coords = new Set(list.map(e => `${Math.round(e.x)},${Math.round(e.y)}`));
      expect(coords.size).toBe(list.length);
      // And they must actually be spread by a non-trivial amount along
      // the relevant axis.
      const axis = side === 'N' || side === 'S' ? 'x' : 'y';
      const values = list.map(e => (axis === 'x' ? e.x : e.y));
      const span = Math.max(...values) - Math.min(...values);
      expect(span).toBeGreaterThan(8);
    }
  });

  it('back-edge into "Build Capstone Project" does not stack on the natural-flow N port', () => {
    // Build Capstone has a forward edge (Advance to Project → it) entering
    // from the top, AND a retry edge from Iterate On Project. The retry
    // should not land on the same coord as the forward edge.
    const { doc, routes } = pipeline('learning-flow.flow');
    const target = nodeByLabel(doc, 'Build Capstone Project');

    const incoming = doc.edges
      .filter(e => e.to === target.id)
      .map(e => {
        const r = findRoute(routes, doc, e)!;
        const end = r.waypoints![r.waypoints!.length - 1];
        return { from: e.from, end };
      });

    expect(incoming.length).toBeGreaterThanOrEqual(2);

    const seen = new Set<string>();
    for (const e of incoming) {
      const k = `${Math.round(e.end.x)},${Math.round(e.end.y)}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  it('skip edges back into "Watch Demo Video" land on a side different from the natural inbound port', () => {
    // The natural forward edge "Read Introduction → Watch Demo Video"
    // enters the top of Watch Demo. The retry edge "Re-watch Demo Video
    // → Watch Demo Video" should not land at the exact same point.
    const { doc, routes } = pipeline('learning-flow.flow');
    const watch = nodeByLabel(doc, 'Watch Demo Video');
    const read = nodeByLabel(doc, 'Read Introduction');
    const reWatch = nodeByLabel(doc, 'Re-watch Demo Video');

    const fwdEdge = doc.edges.find(e => e.from === read.id && e.to === watch.id)!;
    const backEdge = doc.edges.find(e => e.from === reWatch.id && e.to === watch.id)!;
    const fwd = findRoute(routes, doc, fwdEdge)!;
    const back = findRoute(routes, doc, backEdge)!;
    expect(fwd).toBeDefined();
    expect(back).toBeDefined();

    const fwdEnd = fwd.waypoints![fwd.waypoints!.length - 1];
    const backEnd = back.waypoints![back.waypoints!.length - 1];

    // The two endpoints must be visibly distinct.
    const dist = Math.hypot(fwdEnd.x - backEnd.x, fwdEnd.y - backEnd.y);
    expect(dist).toBeGreaterThan(8);
  });
});

describe('semantic edge classes', () => {
  it('renders fs-edge-yes / fs-edge-no / fs-edge-retry classes from the parsed condition', () => {
    const SOURCE = `
@direction TB

#start Begin
  Step
  #decision Continue?
    -> yes: Done
    -> no: Step
  Step ~> Begin: "loop back"
  #end Done
`;
    const svg = render(SOURCE);
    expect(svg).toContain('fs-edge-yes');
    expect(svg).toContain('fs-edge-no');
    expect(svg).toContain('fs-edge-retry');
  });
});

describe('grid port pressure — synthetic stacking', () => {
  it('three retry edges into the same node spread along the East side', () => {
    // Construct a fixture where the natural router would stack three
    // skip edges onto the same East-side port of the target. The new
    // pressure-aware router must spread them.
    const SOURCE = `
@direction TB

#start Begin
  Step
  #decision Repeat?
    -> yes: Step
    -> no: Continue
  Continue
  #decision Again?
    -> yes: Step
    -> no: More
  More
  #decision Once more?
    -> yes: Step
    -> no: #end Done
`;

    const doc = parse(SOURCE);
    layoutDocument(doc);
    const routes = routeEdges(doc);
    const step = [...doc.nodes.values()].find(n => n.label === 'Step')!;

    // Collect entry points into Step.
    const entries = doc.edges
      .filter(e => e.to === step.id && e.from !== step.id)
      .map(e => {
        const r = findRoute(routes, doc, e);
        return r?.waypoints?.[r.waypoints.length - 1];
      })
      .filter((p): p is { x: number; y: number } => !!p);

    expect(entries.length).toBeGreaterThanOrEqual(3);

    const coords = new Set(entries.map(p => `${Math.round(p.x)},${Math.round(p.y)}`));
    // No two edges share the exact same entry point.
    expect(coords.size).toBe(entries.length);
  });
});
