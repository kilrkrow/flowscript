/**
 * Regression for issue #29: cross-column "no" branches must enter the
 * side-column target from the face that faces the source column (E when
 * the target is west of the source), not from N.
 */

import { describe, it, expect } from 'bun:test';
import { parse } from '../src/parser/parser.js';
import { layoutDocument } from '../src/layout/dagre-layout.js';
import { routeEdges, findRoute } from '../src/layout/router.js';

const SOURCE = `---
title: FlowScript Ad
---

@theme clean
@direction TB
@layout grid

#start Start

#decision Do you use diagrams at work?
  -> Yes: Do you use FlowsScript?
  -> No: End

#decision Do you use FlowsScript?
  -> No: Get FlowsScript!
  -> Yes: Profit $$$

Get FlowsScript!
#end Profit $$$
`;

function side(
  node: { x?: number; y?: number },
  pt: { x: number; y: number },
): 'N' | 'S' | 'E' | 'W' {
  const dx = pt.x - (node.x ?? 0);
  const dy = pt.y - (node.y ?? 0);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'E' : 'W';
  return dy >= 0 ? 'S' : 'N';
}

function nodeByLabel(doc: ReturnType<typeof parse>, label: string) {
  for (const [, n] of doc.nodes) if (n.label === label) return n;
  throw new Error(`No node with label: ${label}`);
}

describe('issue #29 — cross-column no-branch entry face', () => {
  const doc = parse(SOURCE);
  layoutDocument(doc);
  const routes = routeEdges(doc);

  it('"No: End" enters End from the E face (facing main), not N', () => {
    const decision = nodeByLabel(doc, 'Do you use diagrams at work?');
    const end = nodeByLabel(doc, 'End');
    const edge = doc.edges.find(
      e => e.from === decision.id && e.to === end.id && e.condition === 'No',
    );
    expect(edge).toBeDefined();
    const r = findRoute(routes, doc, edge!);
    expect(r).toBeDefined();
    const endPt = r!.waypoints![r!.waypoints!.length - 1];
    expect(side(end, endPt)).toBe('E');
  });

  it('"No: Get FlowsScript!" enters from the E face, not N', () => {
    const decision = nodeByLabel(doc, 'Do you use FlowsScript?');
    const target = nodeByLabel(doc, 'Get FlowsScript!');
    const edge = doc.edges.find(
      e => e.from === decision.id && e.to === target.id && e.condition === 'No',
    );
    expect(edge).toBeDefined();
    const r = findRoute(routes, doc, edge!);
    expect(r).toBeDefined();
    const endPt = r!.waypoints![r!.waypoints!.length - 1];
    expect(side(target, endPt)).toBe('E');
  });

  it('forward Get FlowsScript! → Profit still exits S', () => {
    const from = nodeByLabel(doc, 'Get FlowsScript!');
    const to = nodeByLabel(doc, 'Profit $$$');
    const edge = doc.edges.find(e => e.from === from.id && e.to === to.id);
    expect(edge).toBeDefined();
    const r = findRoute(routes, doc, edge!);
    expect(r).toBeDefined();
    const start = r!.waypoints![0];
    expect(side(from, start)).toBe('S');
  });
});
