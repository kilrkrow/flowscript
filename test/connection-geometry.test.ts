/**
 * Tests for shape connection geometry — confirms that the router
 * picks ports on the correct shape boundary and that paths begin/end
 * at those ports.
 *
 * Geometry assertions are made via the public pipeline (parse → layout →
 * route → render). We assert *invariants* (path starts on the boundary,
 * not literal coordinates) so layout changes don't cause flaky failures.
 */

import { describe, it, expect } from 'bun:test';
import { parse } from '../src/parser/parser.js';
import { layoutDocument as layout } from '../src/layout/dagre-layout.js';
import { routeEdges as route, findRoute } from '../src/layout/router.js';

function pipeline(source: string) {
  const doc = parse(source);
  layout(doc);
  const routes = route(doc);
  return { doc, routes };
}

/** Parse the first move command "M x,y" out of an SVG path. */
function pathStart(d: string): { x: number; y: number } {
  const m = d.match(/^M([-\d.]+),([-\d.]+)/);
  if (!m) throw new Error(`No M start in path: ${d}`);
  return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
}

/** Parse the last L/Q endpoint in the path (end of path). */
function pathEnd(d: string): { x: number; y: number } {
  // Look for the final "x,y" pair anywhere in the string.
  const matches = [...d.matchAll(/([-\d.]+),([-\d.]+)/g)];
  if (matches.length === 0) throw new Error(`No coords in path: ${d}`);
  const last = matches[matches.length - 1];
  return { x: parseFloat(last[1]), y: parseFloat(last[2]) };
}

describe('connection geometry — rectangles', () => {
  it('orthogonal edge starts on the source rect boundary', () => {
    const { doc, routes } = pipeline(`
#start A
  B
  C
`);
    const edge = doc.edges[0];
    const from = doc.nodes.get(edge.from)!;
    const r = findRoute(routes, doc, edge)!;
    const start = pathStart(r.pathData);
    // A is above B; edge should exit from bottom of A.
    expect(Math.abs(start.y - ((from.y ?? 0) + (from.height ?? 0) / 2)))
      .toBeLessThan(0.5);
  });

  it('orthogonal edge ends on the target rect boundary', () => {
    const { doc, routes } = pipeline(`
#start A
  B
`);
    const edge = doc.edges[0];
    const to = doc.nodes.get(edge.to)!;
    const r = findRoute(routes, doc, edge)!;
    const end = pathEnd(r.pathData);
    expect(Math.abs(end.y - ((to.y ?? 0) - (to.height ?? 0) / 2)))
      .toBeLessThan(0.5);
  });
});

describe('connection geometry — circles', () => {
  it('edge endpoint lies on the rendered circle boundary, not bbox', () => {
    const { doc, routes } = pipeline(`
#start A
  #circle B
`);
    const edge = doc.edges[0];
    const to = doc.nodes.get(edge.to)!;
    expect(to.shape).toBe('circle');
    const r = findRoute(routes, doc, edge)!;
    const end = pathEnd(r.pathData);

    const cx = to.x ?? 0;
    const cy = to.y ?? 0;
    const radius = Math.min(to.width ?? 60, to.height ?? 60) / 2;
    const dist = Math.hypot(end.x - cx, end.y - cy);
    // Allow generous tolerance for orthogonal corner rounding,
    // but it must be much closer to the radius than the bbox half-width
    // (which would happen if we used rect ports).
    expect(Math.abs(dist - radius)).toBeLessThan(1);
  });

  it('circle start of edge also sits on the boundary', () => {
    const { doc, routes } = pipeline(`
#circle A
  B
`);
    const edge = doc.edges[0];
    const from = doc.nodes.get(edge.from)!;
    const r = findRoute(routes, doc, edge)!;
    const start = pathStart(r.pathData);
    const cx = from.x ?? 0;
    const cy = from.y ?? 0;
    const radius = Math.min(from.width ?? 60, from.height ?? 60) / 2;
    const dist = Math.hypot(start.x - cx, start.y - cy);
    expect(Math.abs(dist - radius)).toBeLessThan(1);
  });
});

describe('connection geometry — decision (diamond)', () => {
  it('decision edges anchor at the tip on the chosen cardinal', () => {
    const { doc, routes } = pipeline(`
#start A
  #decision OK?
    -> yes: #end Done
    -> no: A
`);
    const edges = doc.edges;
    // Find the yes branch out of the decision.
    const decisionId = [...doc.nodes.values()].find(n => n.shape === 'decision')!.id;
    const yesEdge = edges.find(e => e.from === decisionId && e.condition === 'yes')!;
    const dec = doc.nodes.get(decisionId)!;
    const r = findRoute(routes, doc, yesEdge)!;
    const start = pathStart(r.pathData);
    // A "yes" condition exits south; tip is at (cx, cy + h/2).
    const tipY = (dec.y ?? 0) + (dec.height ?? 0) / 2;
    expect(start.x).toBeCloseTo(dec.x ?? 0, 1);
    expect(start.y).toBeCloseTo(tipY, 1);
  });
});

describe('duplicate edges between the same pair of nodes', () => {
  it('each edge has its own distinct route (no key collision)', () => {
    const { doc, routes } = pipeline(`
#start A
  #decision OK?
    -> Yes: B
    -> No: B
  B
`);
    const decision = [...doc.nodes.values()].find(n => n.shape === 'decision')!;
    const b = [...doc.nodes.values()].find(n => n.label === 'B')!;
    const dupEdges = doc.edges.filter(e => e.from === decision.id && e.to === b.id);
    expect(dupEdges).toHaveLength(2);

    const r0 = findRoute(routes, doc, dupEdges[0]);
    const r1 = findRoute(routes, doc, dupEdges[1]);
    // Both edges must be individually routable — key collision would make one undefined.
    expect(r0).toBeDefined();
    expect(r1).toBeDefined();
    // Each route has non-trivial path data.
    expect(r0!.pathData).toMatch(/^M/);
    expect(r1!.pathData).toMatch(/^M/);
    // Both edges carry a condition label; labels are stored as-is from the parser.
    expect(dupEdges[0].condition).toBeDefined();
    expect(dupEdges[1].condition).toBeDefined();
    // The two conditions must be distinct (one is Yes, one is No).
    expect(dupEdges[0].condition).not.toBe(dupEdges[1].condition);
  });

  it('self-loop produces valid non-degenerate, NaN-free geometry', () => {
    const { doc, routes } = pipeline(`
#start Start
  #decision Is it done yet?
    -> Yes: Done
    -> No: Is it done yet?
  #end Done
`);
    const decision = [...doc.nodes.values()].find(n => n.shape === 'decision')!;
    const selfEdge = doc.edges.find(e => e.from === decision.id && e.to === decision.id)!;
    expect(selfEdge).toBeDefined();
    const r = findRoute(routes, doc, selfEdge)!;
    expect(r).toBeDefined();
    expect(r.pathData).not.toMatch(/NaN/);
    expect(r.pathData).toMatch(/^M[-\d.]+,[-\d.]+/);
    expect(r.pathData).toMatch(/[LCQ]/);
    expect(Number.isFinite(r.labelPosition.x)).toBe(true);
    expect(Number.isFinite(r.labelPosition.y)).toBe(true);
  });
});

describe('explicit retry semantics', () => {
  it('parses ~> into edge.retry and survives the full pipeline', () => {
    const { doc, routes } = pipeline(`
#start A
  B
  B ~> A: "again"
`);
    const retry = doc.edges.find(e => e.retry)!;
    expect(retry).toBeDefined();
    // The route exists for the retry edge.
    const r = findRoute(routes, doc, retry);
    expect(r).toBeDefined();
    expect(r!.pathData.length).toBeGreaterThan(0);
  });

  it('decision-branch retry: ~> from a decision sets retry', () => {
    const { doc } = pipeline(`
#start A
  Validate
  #decision OK?
    -> yes: #end Done
    ~> no: Validate
`);
    const retryEdges = doc.edges.filter(e => e.retry);
    expect(retryEdges).toHaveLength(1);
    expect(retryEdges[0].condition).toBe('no');
  });

  it('magic labels (`try again`, `resend`) still set retry for backward compat', () => {
    const { doc } = pipeline(`
#start A
  B
  B -> A: "try again"
`);
    const e = doc.edges.find(x => x.label === 'try again')!;
    expect(e.retry).toBe(true);
  });
});
