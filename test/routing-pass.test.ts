/**
 * Tests for the relative-position-aware port selection and the
 * Visio-style line-jump post-pass.
 *
 * These tests construct minimal positioned FlowDocuments by hand so the
 * geometry assertions don't depend on dagre's specific output (which can
 * shift across versions). They exercise the router directly.
 */

import { describe, it, expect } from 'bun:test';
import { routeEdges, findRoute } from '../src/layout/router.js';
import { parse } from '../src/parser/parser.js';
import { layoutDocument } from '../src/layout/dagre-layout.js';
import type { FlowDocument, FlowNode, FlowEdge } from '../src/parser/ast.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function node(
  id: string, shape: FlowNode['shape'],
  x: number, y: number,
  width = 180, height = 44,
): FlowNode {
  return { id, label: id, shape, x, y, width, height };
}

function decisionNode(id: string, x: number, y: number): FlowNode {
  return { id, label: id, shape: 'decision', x, y, width: 160, height: 100 };
}

function makeDoc(nodes: FlowNode[], edges: FlowEdge[]): FlowDocument {
  const m = new Map<string, FlowNode>();
  for (const n of nodes) m.set(n.id, n);
  return {
    meta: {},
    directives: [],
    nodes: m,
    edges,
    groups: [],
    lanes: [],
  };
}

describe('scored port selection — decision target above-right of source', () => {
  it('source above-and-left of decision exits LEFT and enters TOP', () => {
    // Source at (300, 100), decision at (150, 250) — i.e. decision is
    // below-and-left. The clean route exits W of source, runs through
    // open space, and enters N of the decision.
    const src = node('clarify', 'process', 300, 100);
    const dec = decisionNode('detail', 150, 250);
    const edge: FlowEdge = { from: 'clarify', to: 'detail' };
    const doc = makeDoc([src, dec], [edge]);
    const routes = routeEdges(doc);
    const r = findRoute(routes, doc, edge)!;
    expect(r).toBeDefined();
    expect(r.waypoints).toBeDefined();
    const wp = r.waypoints!;
    const start = wp[0];
    const end = wp[wp.length - 1];

    // Exit on the LEFT side of the source rect (x = src.x - w/2)
    expect(start.x).toBeCloseTo(src.x! - src.width! / 2, 1);
    // Enter on the TOP of the decision (y = dec.y - h/2)
    expect(end.y).toBeCloseTo(dec.y! - dec.height! / 2, 1);
    expect(end.x).toBeCloseTo(dec.x!, 1); // diamond N tip
  });

  it('source above-and-right of decision exits RIGHT and enters TOP', () => {
    const src = node('clarify', 'process', 100, 100);
    const dec = decisionNode('detail', 350, 250);
    const edge: FlowEdge = { from: 'clarify', to: 'detail' };
    const doc = makeDoc([src, dec], [edge]);
    const routes = routeEdges(doc);
    const r = findRoute(routes, doc, edge)!;
    const wp = r.waypoints!;
    const start = wp[0];
    const end = wp[wp.length - 1];

    expect(start.x).toBeCloseTo(src.x! + src.width! / 2, 1); // right side
    expect(end.y).toBeCloseTo(dec.y! - dec.height! / 2, 1); // top of decision
    expect(end.x).toBeCloseTo(dec.x!, 1);
  });

  it('source directly above decision still uses bottom→top straight', () => {
    const src = node('clarify', 'process', 200, 100);
    const dec = decisionNode('detail', 200, 260);
    const edge: FlowEdge = { from: 'clarify', to: 'detail' };
    const doc = makeDoc([src, dec], [edge]);
    const routes = routeEdges(doc);
    const r = findRoute(routes, doc, edge)!;
    const wp = r.waypoints!;
    const start = wp[0];
    const end = wp[wp.length - 1];

    // exit S, enter N — both on the centerline
    expect(start.y).toBeCloseTo(src.y! + src.height! / 2, 1);
    expect(end.y).toBeCloseTo(dec.y! - dec.height! / 2, 1);
  });
});

describe('line-jump post-pass — perpendicular crossings', () => {
  it('emits an arc bump where two perpendicular segments cross', () => {
    // Edge A: vertical line on x=200, y from 50 to 250.
    // Edge B: horizontal jog at y=150 that must cross A.
    //
    // Lay out four nodes so that the natural orthogonal routes
    // produce these segments deterministically.
    const a1 = node('a1', 'process', 200, 50);
    const a2 = node('a2', 'process', 200, 250);
    const b1 = node('b1', 'process', 60, 150);
    const b2 = node('b2', 'process', 340, 150);
    const edges: FlowEdge[] = [
      { from: 'a1', to: 'a2' }, // vertical
      { from: 'b1', to: 'b2' }, // horizontal — crosses the vertical
    ];
    const doc = makeDoc([a1, a2, b1, b2], edges);
    const routes = routeEdges(doc);
    const aPath = findRoute(routes, doc, edges[0])!.pathData;
    const bPath = findRoute(routes, doc, edges[1])!.pathData;
    // One of the two paths should contain an SVG arc command (the bump).
    const hasArc = (s: string) => /A\d/.test(s);
    expect(hasArc(aPath) || hasArc(bPath)).toBe(true);
  });

  it('no false jumps when two edges only share an endpoint (same node)', () => {
    // Two edges leave the same source — they share the exit port. The
    // router must not draw a hop at that shared endpoint.
    const src = node('S', 'process', 200, 100);
    const a = node('A', 'process', 60, 250);
    const b = node('B', 'process', 340, 250);
    const edges: FlowEdge[] = [
      { from: 'S', to: 'A' },
      { from: 'S', to: 'B' },
    ];
    const doc = makeDoc([src, a, b], edges);
    const routes = routeEdges(doc);
    const pa = findRoute(routes, doc, edges[0])!.pathData;
    const pb = findRoute(routes, doc, edges[1])!.pathData;
    expect(/A\d/.test(pa)).toBe(false);
    expect(/A\d/.test(pb)).toBe(false);
  });

  it('parallel collinear segments are not treated as crossings', () => {
    // Two horizontal edges on different y values — no crossing.
    const a1 = node('a1', 'process', 60, 100);
    const a2 = node('a2', 'process', 340, 100);
    const b1 = node('b1', 'process', 60, 200);
    const b2 = node('b2', 'process', 340, 200);
    const edges: FlowEdge[] = [
      { from: 'a1', to: 'a2' },
      { from: 'b1', to: 'b2' },
    ];
    const doc = makeDoc([a1, a2, b1, b2], edges);
    const routes = routeEdges(doc);
    expect(/A\d/.test(findRoute(routes, doc, edges[0])!.pathData)).toBe(false);
    expect(/A\d/.test(findRoute(routes, doc, edges[1])!.pathData)).toBe(false);
  });

  it('retry/dashed edge yields to non-retry edge when they cross', () => {
    // Two edges that *do* cross. The retry edge should be the one
    // re-emitting with the bump, never the normal edge.
    const a1 = node('a1', 'process', 200, 50);
    const a2 = node('a2', 'process', 200, 250);
    const b1 = node('b1', 'process', 60, 150);
    const b2 = node('b2', 'process', 340, 150);

    // First pass: order [normal, retry]
    {
      const edges: FlowEdge[] = [
        { from: 'a1', to: 'a2' },                  // normal (vertical)
        { from: 'b1', to: 'b2', retry: true },     // retry (horizontal)
      ];
      const doc = makeDoc([a1, a2, b1, b2], edges);
      const routes = routeEdges(doc);
      const norm = findRoute(routes, doc, edges[0])!.pathData;
      const retry = findRoute(routes, doc, edges[1])!.pathData;
      expect(/A\d/.test(norm)).toBe(false);
      expect(/A\d/.test(retry)).toBe(true);
    }

    // Second pass: order [retry, normal]. The retry edge still yields
    // — order shouldn't override priority.
    {
      const edges: FlowEdge[] = [
        { from: 'b1', to: 'b2', retry: true },
        { from: 'a1', to: 'a2' },
      ];
      const doc = makeDoc([a1, a2, b1, b2], edges);
      const routes = routeEdges(doc);
      const norm = findRoute(routes, doc, edges[1])!.pathData;
      const retry = findRoute(routes, doc, edges[0])!.pathData;
      expect(/A\d/.test(norm)).toBe(false);
      expect(/A\d/.test(retry)).toBe(true);
    }
  });

  it('user-request fixture: Clarify Goal exits side, decision enters top', () => {
    const src = readFileSync(
      join(__dirname, 'fixtures', 'user-request.flow'), 'utf8',
    );
    const doc = parse(src);
    layoutDocument(doc);
    const routes = routeEdges(doc);

    const clarify = [...doc.nodes.values()].find(n => n.label === 'Clarify Goal')!;
    const detail = [...doc.nodes.values()].find(n => n.label === 'Enough Detail?')!;
    expect(detail.shape).toBe('decision');

    // Forward edge Clarify Goal -> Enough Detail?
    const fwd = doc.edges.find(e => e.from === clarify.id && e.to === detail.id)!;
    const r = findRoute(routes, doc, fwd)!;
    const wp = r.waypoints!;
    const end = wp[wp.length - 1];
    // The forward edge should enter the decision from the top tip.
    expect(end.x).toBeCloseTo(detail.x ?? 0, 1);
    expect(end.y).toBeCloseTo((detail.y ?? 0) - (detail.height ?? 0) / 2, 1);
  });

  it('@line-jumps off disables the post-pass', () => {
    const a1 = node('a1', 'process', 200, 50);
    const a2 = node('a2', 'process', 200, 250);
    const b1 = node('b1', 'process', 60, 150);
    const b2 = node('b2', 'process', 340, 150);
    const edges: FlowEdge[] = [
      { from: 'a1', to: 'a2' },
      { from: 'b1', to: 'b2' },
    ];
    const doc = makeDoc([a1, a2, b1, b2], edges);
    doc.directives.push({ key: 'line-jumps', value: 'off' });
    const routes = routeEdges(doc);
    const aPath = findRoute(routes, doc, edges[0])!.pathData;
    const bPath = findRoute(routes, doc, edges[1])!.pathData;
    expect(/A\d/.test(aPath)).toBe(false);
    expect(/A\d/.test(bPath)).toBe(false);
  });
});
