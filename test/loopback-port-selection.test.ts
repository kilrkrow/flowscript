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
import { routeEdges } from '../src/layout/router.js';

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
  it('learning-flow: "Ready to retake quiz?" yes loops back from the W tip', () => {
    // The yes target ("Take Practice Quiz") sits in the main column,
    // upper-left of the decision (which lives in side column E1). The
    // pre-fix router pinned yes to S, forcing the path to drop out
    // the bottom and immediately U-turn upward. With geometry-aware
    // pinning, the W tip is the natural choice.
    const { doc, routes } = pipeline('learning-flow.flow');
    const decision = nodeByLabel(doc, 'Ready to retake quiz?');
    const target = nodeByLabel(doc, 'Take Practice Quiz');
    const r = routes.get(`${decision.id}->${target.id}`);
    expect(r).toBeDefined();
    const start = r!.waypoints![0];
    const hw = (decision.width ?? 0) / 2;
    expect(start.x).toBeCloseTo((decision.x ?? 0) - hw * 0.9, 1);
    expect(start.y).toBeCloseTo(decision.y ?? 0, 1);
  });

  it('learning-flow: "Iterate On Project" iterate edge leaves the E side', () => {
    // n16's N and W sides are claimed by incoming edges (n14 lands on
    // N, n17 lands on W). The dotted iterate edge to "Build Capstone
    // Project" used to grab N too — port reuse. With entry-aware
    // exit reservation it sees N as opposite-role-occupied and the
    // perpendicular-near tiebreaker in rankAround picks E.
    const { doc, routes } = pipeline('learning-flow.flow');
    const iter = nodeByLabel(doc, 'Iterate On Project');
    const target = nodeByLabel(doc, 'Build Capstone Project');
    const r = routes.get(`${iter.id}->${target.id}`);
    expect(r).toBeDefined();
    const start = r!.waypoints![0];
    expect(start.x).toBeCloseTo((iter.x ?? 0) + (iter.width ?? 0) / 2, 1);
    expect(start.y).toBeCloseTo(iter.y ?? 0, 1);
  });

  it('incident-response: yes from "Have they arrived?" exits the E tip', () => {
    // Cross-column yes target — Monitor lives in side column E1, east
    // of the decision in the main column. Geometric pin chooses E
    // instead of the legacy S convention, and the n6 self-loop
    // cascades to the W tip.
    const { doc, routes } = pipeline('incident-response.flow');
    const decision = nodeByLabel(doc, 'Have they arrived?');
    const monitor = nodeByLabel(doc, 'Monitor until resolved');
    const r = routes.get(`${decision.id}->${monitor.id}`);
    expect(r).toBeDefined();
    const start = r!.waypoints![0];
    const hw = (decision.width ?? 0) / 2;
    expect(start.x).toBeCloseTo((decision.x ?? 0) + hw * 0.9, 1);
    expect(start.y).toBeCloseTo(decision.y ?? 0, 1);

    // And the self-loop "no" should now wrap on the opposite side.
    const selfR = routes.get(`${decision.id}->${decision.id}`);
    expect(selfR).toBeDefined();
    const selfStart = selfR!.waypoints![0];
    expect(selfStart.x).toBeCloseTo((decision.x ?? 0) - hw * 0.9, 1);
  });

  it('learning-flow: "Did you understand the demo?" yes still drops to S', () => {
    // Negative regression — the geometry-aware pin must NOT change
    // the dominant case where yes continues straight down the main
    // column. This is the same-column-below path.
    const { doc, routes } = pipeline('learning-flow.flow');
    const decision = nodeByLabel(doc, 'Did you understand the demo?');
    const target = nodeByLabel(doc, 'Take Practice Quiz');
    const r = routes.get(`${decision.id}->${target.id}`);
    expect(r).toBeDefined();
    const start = r!.waypoints![0];
    expect(start.x).toBeCloseTo(decision.x ?? 0, 1);
    expect(start.y).toBeCloseTo((decision.y ?? 0) + (decision.height ?? 0) / 2, 1);
  });
});
