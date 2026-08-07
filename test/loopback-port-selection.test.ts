/**
 * Regression tests for cross-column / loop-back exit-port selection.
 *
 * These pin the behavior fixed in the "geometry-aware decision pinning
 * + entry-aware exit reservation" change. Each scenario describes a
 * case where the previous router picked a port that produced a
 * U-turn or piggy-backed on an already-occupied port.
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parse } from '../src/parser/parser.js';
import { layoutDocument } from '../src/layout/dagre-layout.js';
import { routeEdges, findRoute } from '../src/layout/router.js';

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

describe('loop-back exit port selection', () => {
  it('learning-flow: "Ready to retake quiz?" yes loops back from the E tip', () => {
    // Adaptive layout places this decision in W1. The yes target
    // ("Take Practice Quiz") sits in the main column, upper-right of
    // the diamond. Pre-fix routers pinned yes to S, forcing a U-turn;
    // geometry-aware pinning picks the E tip toward main.
    const { doc, routes } = pipeline('learning-flow.flow');
    const decision = nodeByLabel(doc, 'Ready to retake quiz?');
    const target = nodeByLabel(doc, 'Take Practice Quiz');
    const edge = doc.edges.find(e => e.from === decision.id && e.to === target.id);
    expect(edge).toBeDefined();
    const r = findRoute(routes, doc, edge!);
    expect(r).toBeDefined();
    const start = r!.waypoints![0];
    const hw = (decision.width ?? 0) / 2;
    expect(start.x).toBeCloseTo((decision.x ?? 0) + hw * 0.9, 1);
    expect(start.y).toBeCloseTo(decision.y ?? 0, 1);
  });

  it('learning-flow: "Iterate On Project" iterate edge leaves the E side', () => {
    // n16's N and W sides are claimed by incoming edges. The dotted
    // iterate edge to "Build Capstone Project" used to grab N too —
    // port reuse. With entry-aware exit reservation it sees N as
    // opposite-role-occupied and the perpendicular-near tiebreaker in
    // rankAround picks E.
    const { doc, routes } = pipeline('learning-flow.flow');
    const iter = nodeByLabel(doc, 'Iterate On Project');
    const target = nodeByLabel(doc, 'Build Capstone Project');
    const edge = doc.edges.find(e => e.from === iter.id && e.to === target.id);
    expect(edge).toBeDefined();
    const r = findRoute(routes, doc, edge!);
    expect(r).toBeDefined();
    const start = r!.waypoints![0];
    expect(start.x).toBeCloseTo((iter.x ?? 0) + (iter.width ?? 0) / 2, 1);
    expect(start.y).toBeCloseTo(iter.y ?? 0, 1);
  });

  it('incident-response: yes from "Have they arrived?" exits the W tip', () => {
    // Adaptive layout places Monitor in W1 (west of the main-column
    // decision). Geometric pin chooses W instead of the legacy S
    // convention, and the self-loop "no" cascades to the E tip.
    const { doc, routes } = pipeline('incident-response.flow');
    const decision = nodeByLabel(doc, 'Have they arrived?');
    const monitor = nodeByLabel(doc, 'Monitor until resolved');
    const yesEdge = doc.edges.find(
      e => e.from === decision.id && e.to === monitor.id && e.condition === 'yes',
    );
    expect(yesEdge).toBeDefined();
    const r = findRoute(routes, doc, yesEdge!);
    expect(r).toBeDefined();
    const start = r!.waypoints![0];
    const hw = (decision.width ?? 0) / 2;
    expect(start.x).toBeCloseTo((decision.x ?? 0) - hw * 0.9, 1);
    expect(start.y).toBeCloseTo(decision.y ?? 0, 1);

    // Self-loop "no" wraps on the opposite side.
    const selfEdge = doc.edges.find(e => e.from === decision.id && e.to === decision.id);
    expect(selfEdge).toBeDefined();
    const selfR = findRoute(routes, doc, selfEdge!);
    expect(selfR).toBeDefined();
    const selfStart = selfR!.waypoints![0];
    expect(selfStart.x).toBeCloseTo((decision.x ?? 0) + hw * 0.9, 1);
  });

  it('learning-flow: "Did you understand the demo?" yes still drops to S', () => {
    // Negative regression — the geometry-aware pin must NOT change
    // the dominant case where yes continues straight down the main
    // column. This is the same-column-below path.
    const { doc, routes } = pipeline('learning-flow.flow');
    const decision = nodeByLabel(doc, 'Did you understand the demo?');
    const target = nodeByLabel(doc, 'Take Practice Quiz');
    const edge = doc.edges.find(e => e.from === decision.id && e.to === target.id);
    expect(edge).toBeDefined();
    const r = findRoute(routes, doc, edge!);
    expect(r).toBeDefined();
    const start = r!.waypoints![0];
    expect(start.x).toBeCloseTo(decision.x ?? 0, 1);
    expect(start.y).toBeCloseTo((decision.y ?? 0) + (decision.height ?? 0) / 2, 1);
  });
});
