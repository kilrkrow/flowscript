/**
 * Tests for the structured grid layout (the paper-cutout / infinite-grid
 * methodology). These assert *visual / geometric* quality, not just
 * edge counts:
 *
 *  - Every edge's routed segments must not pierce any unrelated node.
 *  - Side branches go into dedicated columns so they don't overlap the
 *    main flow.
 *  - The "No → Monitor until resolved" skip in the incident-response
 *    fixture must route around `Call Police` and `Have they arrived?`,
 *    not through them.
 *  - Wrapped node sizes are computed before placement (no row collisions
 *    after the fact).
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from '../src/parser/parser.js';
import { layoutDocument, getGridMeta } from '../src/layout/dagre-layout.js';
import { routeEdges } from '../src/layout/router.js';
import type { FlowDocument, FlowNode } from '../src/parser/ast.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string) {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8');
}

function pipeline(source: string) {
  const doc = parse(source);
  layoutDocument(doc);
  const routes = routeEdges(doc);
  return { doc, routes };
}

function nodeByLabel(doc: FlowDocument, label: string): FlowNode {
  for (const [, n] of doc.nodes) if (n.label === label) return n;
  throw new Error(`No node with label: ${label}`);
}

/**
 * True if the axis-aligned segment (x1,y1)→(x2,y2) intrudes into the
 * interior of the rect (rx, ry, rw, rh). Boundary touching does not
 * count — we explicitly want to allow paths that hug a node's edge.
 */
function segmentPiercesRect(
  x1: number, y1: number, x2: number, y2: number,
  rx: number, ry: number, rw: number, rh: number,
): boolean {
  const left = rx, right = rx + rw, top = ry, bottom = ry + rh;
  if (Math.max(x1, x2) <= left)   return false;
  if (Math.min(x1, x2) >= right)  return false;
  if (Math.max(y1, y2) <= top)    return false;
  if (Math.min(y1, y2) >= bottom) return false;
  // An endpoint strictly inside the rect: pierces.
  if (x1 > left && x1 < right && y1 > top && y1 < bottom) return true;
  if (x2 > left && x2 < right && y2 > top && y2 < bottom) return true;
  // Axis-aligned check.
  if (x1 === x2) {
    if (x1 <= left || x1 >= right) return false;
    const ymin = Math.min(y1, y2), ymax = Math.max(y1, y2);
    return ymax > top && ymin < bottom;
  }
  if (y1 === y2) {
    if (y1 <= top || y1 >= bottom) return false;
    const xmin = Math.min(x1, x2), xmax = Math.max(x1, x2);
    return xmax > left && xmin < right;
  }
  return false;
}

/**
 * Walk every routed edge and report any segment that pierces a non-
 * endpoint node's bounding box. Return the offending list.
 *
 * Margin of 1px allows for rounded-corner tangents and grazing.
 */
function findNodePierceViolations(
  doc: FlowDocument,
  routes: ReturnType<typeof routeEdges>,
): Array<{ edge: string; node: string }> {
  const out: Array<{ edge: string; node: string }> = [];
  const margin = 1;
  for (const e of doc.edges) {
    const r = routes.get(`${e.from}->${e.to}`);
    if (!r?.waypoints) continue;
    for (let i = 0; i < r.waypoints.length - 1; i++) {
      const a = r.waypoints[i];
      const b = r.waypoints[i + 1];
      for (const [id, node] of doc.nodes) {
        if (id === e.from || id === e.to) continue;
        const rx = (node.x ?? 0) - (node.width ?? 180) / 2 + margin;
        const ry = (node.y ?? 0) - (node.height ?? 44) / 2 + margin;
        const rw = (node.width ?? 180) - margin * 2;
        const rh = (node.height ?? 44) - margin * 2;
        if (segmentPiercesRect(a.x, a.y, b.x, b.y, rx, ry, rw, rh)) {
          const fromLabel = doc.nodes.get(e.from)?.label;
          const toLabel = doc.nodes.get(e.to)?.label;
          out.push({
            edge: `${fromLabel} → ${toLabel}`,
            node: node.label,
          });
        }
      }
    }
  }
  return out;
}

describe('grid layout — paper-cutout placement', () => {
  it('runs by default for plain TB flows (no swimlanes, no groups)', () => {
    const { doc } = pipeline('#start A\n  B\n  #end C');
    expect(getGridMeta(doc)).toBeDefined();
  });

  it('falls back to dagre when swimlanes are present', () => {
    const { doc } = pipeline(`
#lane Customer
  #start A
  B
#lane Support
  C
A -> C
`);
    expect(getGridMeta(doc)).toBeUndefined();
  });

  it('falls back to dagre for non-TB direction', () => {
    const { doc } = pipeline('@direction LR\n#start A\n  B');
    expect(getGridMeta(doc)).toBeUndefined();
  });

  it('respects @layout dagre directive', () => {
    const { doc } = pipeline('@layout dagre\n#start A\n  B');
    expect(getGridMeta(doc)).toBeUndefined();
  });

  it('wraps long node labels and grows row height to fit', () => {
    const { doc } = pipeline(`
#start Begin
  A node label that is much much much longer than one line will fit
  #end Done
`);
    const long = [...doc.nodes.values()].find(n => n.label.startsWith('A node'))!;
    // Row should grow to accommodate the wrapped lines.
    expect(long.height).toBeGreaterThan(56);
  });
});

describe('grid layout — incident-response (north-star fixture)', () => {
  it('No-branch routes around Call Police and Have they arrived?', () => {
    const { doc, routes } = pipeline(loadFixture('incident-response.flow'));
    const decision = nodeByLabel(doc, 'Is there an event requiring police?');
    const monitor = nodeByLabel(doc, 'Monitor until resolved');
    const callPolice = nodeByLabel(doc, 'Call Police');
    const arrived = nodeByLabel(doc, 'Have they arrived?');

    const noEdge = doc.edges.find(
      e => e.from === decision.id && e.to === monitor.id && e.condition === 'no',
    )!;
    expect(noEdge).toBeDefined();
    const r = routes.get(`${noEdge.from}->${noEdge.to}`)!;
    expect(r.waypoints).toBeDefined();
    const wp = r.waypoints!;

    // Each segment of the No → Monitor route must avoid Call Police
    // and Have they arrived? bounding boxes.
    for (let i = 0; i < wp.length - 1; i++) {
      const a = wp[i], b = wp[i + 1];
      for (const intermediate of [callPolice, arrived]) {
        const m = 1;
        const rx = (intermediate.x ?? 0) - (intermediate.width ?? 180) / 2 + m;
        const ry = (intermediate.y ?? 0) - (intermediate.height ?? 44) / 2 + m;
        const rw = (intermediate.width ?? 180) - m * 2;
        const rh = (intermediate.height ?? 44) - m * 2;
        const pierces = segmentPiercesRect(a.x, a.y, b.x, b.y, rx, ry, rw, rh);
        if (pierces) {
          throw new Error(
            `No-branch segment (${a.x},${a.y})→(${b.x},${b.y}) pierces "${intermediate.label}"`,
          );
        }
        expect(pierces).toBe(false);
      }
    }
  });

  it('every edge avoids piercing every other node bounding box', () => {
    const { doc, routes } = pipeline(loadFixture('incident-response.flow'));
    const violations = findNodePierceViolations(doc, routes);
    if (violations.length > 0) {
      console.error('Pierce violations:', violations);
    }
    expect(violations).toHaveLength(0);
  });

  it('the no-branch target lives in a side column, not the main column', () => {
    const { doc } = pipeline(loadFixture('incident-response.flow'));
    const meta = getGridMeta(doc)!;
    const monitor = nodeByLabel(doc, 'Monitor until resolved');
    const col = meta.nodeColumn.get(monitor.id);
    // It went into the East side column because of the `no` branch placement.
    expect(col).not.toBe('main');
  });

  it('no NaN in any rendered path', () => {
    const { routes } = pipeline(loadFixture('incident-response.flow'));
    for (const [, r] of routes) {
      expect(r.pathData).not.toMatch(/NaN/);
    }
  });
});

describe('grid layout — learning-flow (structural stress fixture)', () => {
  it('parses 18 nodes and renders without NaN', () => {
    const { doc, routes } = pipeline(loadFixture('learning-flow.flow'));
    expect(doc.nodes.size).toBe(18);
    for (const [, r] of routes) {
      expect(r.pathData).not.toMatch(/NaN/);
    }
  });

  it('every edge avoids piercing every other node bounding box', () => {
    const { doc, routes } = pipeline(loadFixture('learning-flow.flow'));
    const violations = findNodePierceViolations(doc, routes);
    if (violations.length > 0) {
      console.error('Pierce violations:', violations);
    }
    expect(violations).toHaveLength(0);
  });

  it('decision side branches go into separate columns from the main flow', () => {
    const { doc } = pipeline(loadFixture('learning-flow.flow'));
    const meta = getGridMeta(doc)!;
    // "Re-watch Demo Video" is the no-branch from the first decision.
    const reWatch = nodeByLabel(doc, 'Re-watch Demo Video');
    const reWatchCol = meta.nodeColumn.get(reWatch.id);
    expect(reWatchCol).not.toBe('main');
    // "Take Practice Quiz" is the yes-branch from the same decision —
    // stays on main as the natural continuation.
    const quiz = nodeByLabel(doc, 'Take Practice Quiz');
    expect(meta.nodeColumn.get(quiz.id)).toBe('main');
  });

  it('retry edges (~>) preserve their dashed semantics', () => {
    const { doc } = pipeline(loadFixture('learning-flow.flow'));
    const retryEdges = doc.edges.filter(e => e.retry);
    expect(retryEdges.length).toBeGreaterThanOrEqual(2);
  });
});

describe('grid layout — multi-branch decision still works', () => {
  it('three-way decision branches all render visibly under grid layout', () => {
    const { doc, routes } = pipeline(loadFixture('multi-branch-decision.flow'));
    const decision = [...doc.nodes.values()].find(n => n.shape === 'decision')!;
    const branches = doc.edges.filter(e => e.from === decision.id && e.condition);
    expect(branches.length).toBe(3);
    // Every branch has non-degenerate path data.
    for (const e of branches) {
      const r = routes.get(`${e.from}->${e.to}`)!;
      expect(r.pathData).not.toMatch(/NaN/);
      expect(r.pathData.length).toBeGreaterThan(10);
    }
  });
});
