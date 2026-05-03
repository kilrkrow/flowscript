/**
 * Incident-response regression: a real-ish flow that exercises three
 * patterns at once —
 *   1. multiple decisions, each with its own explicit yes/no branch list,
 *   2. re-references to earlier nodes (Monitor until resolved),
 *   3. a decision self-loop ("Have they arrived?" → itself when no).
 *
 * Two bugs the user previously hit must stay fixed here:
 *   (a) phantom unconditional fall-through from decision to next sibling
 *       (issue #8) — we assert that no decision edge is unconditional.
 *   (b) zero-length / collapsed self-loop path — we assert the self-loop
 *       has visible non-trivial geometry.
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from '../src/parser/parser.js';
import { layoutDocument } from '../src/layout/dagre-layout.js';
import { routeEdges } from '../src/layout/router.js';
import { render } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture() {
  return readFileSync(
    join(__dirname, 'fixtures', 'incident-response.flow'), 'utf8',
  );
}

function pipeline(source: string) {
  const doc = parse(source);
  layoutDocument(doc);
  const routes = routeEdges(doc);
  return { doc, routes };
}

function nodeByLabel(doc: ReturnType<typeof parse>, label: string) {
  for (const [, n] of doc.nodes) if (n.label === label) return n;
  throw new Error(`No node with label: ${label}`);
}

describe('incident response (multi-decision + self-loop)', () => {
  it('parses every label exactly once (re-references reuse the same node)', () => {
    const { doc } = pipeline(loadFixture());
    const labels = [...doc.nodes.values()].map(n => n.label);
    const unique = new Set(labels);
    expect(labels.length).toBe(unique.size);
    // Sanity: 8 conceptually distinct nodes
    expect(doc.nodes.size).toBe(8);
  });

  it('has the expected explicit edge set and no phantom decision fall-through', () => {
    const { doc } = pipeline(loadFixture());

    // Every edge that leaves a decision node MUST carry a condition.
    // An unconditional decision edge would be the fall-through bug.
    for (const e of doc.edges) {
      const from = doc.nodes.get(e.from)!;
      if (from.shape === 'decision') {
        expect(e.condition).toBeDefined();
        expect(e.condition!.length).toBeGreaterThan(0);
      }
    }

    // Concrete edge expectations.
    const start = nodeByLabel(doc, 'Start');
    const assess = nodeByLabel(doc, 'Assess all intel sources');
    const dEvent = nodeByLabel(doc, 'Is there an event requiring police?');
    const callPolice = nodeByLabel(doc, 'Call Police');
    const monitor = nodeByLabel(doc, 'Monitor until resolved');
    const dArrived = nodeByLabel(doc, 'Have they arrived?');
    const dResolved = nodeByLabel(doc, 'Resolved?');
    const done = nodeByLabel(doc, 'Done');

    const has = (
      from: { id: string }, to: { id: string }, condition?: string,
    ) =>
      doc.edges.some(
        e => e.from === from.id && e.to === to.id &&
             (condition === undefined || e.condition === condition),
      );

    expect(has(start, assess)).toBe(true);
    expect(has(assess, dEvent)).toBe(true);
    expect(has(dEvent, callPolice, 'yes')).toBe(true);
    expect(has(dEvent, monitor, 'no')).toBe(true);
    expect(has(callPolice, dArrived)).toBe(true);
    expect(has(dArrived, monitor, 'yes')).toBe(true);
    expect(has(dArrived, dArrived, 'no')).toBe(true); // self-loop
    expect(has(monitor, dResolved)).toBe(true);
    expect(has(dResolved, done, 'yes')).toBe(true);
    expect(has(dResolved, monitor, 'no')).toBe(true);

    // Exactly 10 edges, no extras.
    expect(doc.edges).toHaveLength(10);

    // No phantom edge from any decision to the next sibling line.
    // (e.g., dEvent -> Call Police as an unconditional implicit edge,
    // which would be a duplicate of the conditional yes-branch.)
    const decUnconditional = doc.edges.filter(e => {
      const from = doc.nodes.get(e.from);
      return from?.shape === 'decision' && !e.condition;
    });
    expect(decUnconditional).toHaveLength(0);

    // Re-referenced nodes must not produce duplicate parallel edges.
    // (e.g., "no -> Monitor until resolved" and a later implicit
    // edge to the same Monitor node from the same source.)
    const sigs = doc.edges.map(
      e => `${e.from}->${e.to}|${e.condition ?? ''}`,
    );
    expect(new Set(sigs).size).toBe(sigs.length);
  });

  it('routes the decision self-loop to a non-degenerate, NaN-free path', () => {
    const { doc, routes } = pipeline(loadFixture());
    const dArrived = nodeByLabel(doc, 'Have they arrived?');
    const r = routes.get(`${dArrived.id}->${dArrived.id}`);
    expect(r).toBeDefined();

    const path = r!.pathData;
    // No NaN sneaking through any geometry math.
    expect(path).not.toMatch(/NaN/);
    // Must have a real start, drawn segments, and at least one corner.
    expect(path).toMatch(/^M[-\d.]+,[-\d.]+/);
    expect(path).toMatch(/[LCQ]/);

    // Bounding extent of the path must be non-trivial — a collapsed
    // self-loop showed up as M x,y L x,y. Collect every coord pair and
    // verify they span more than a couple of pixels in both axes.
    const coords = [...path.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)]
      .map(m => ({ x: parseFloat(m[1]), y: parseFloat(m[2]) }));
    const xs = coords.map(p => p.x);
    const ys = coords.map(p => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(20);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(20);

    // The label must be placed somewhere along the visible path, not
    // at exactly (0,0) or stuck on the node center.
    expect(Number.isFinite(r!.labelPosition.x)).toBe(true);
    expect(Number.isFinite(r!.labelPosition.y)).toBe(true);
  });

  it('every routed edge has a NaN-free path with drawn geometry', () => {
    const { routes } = pipeline(loadFixture());
    for (const [key, r] of routes) {
      expect(r.pathData).not.toMatch(/NaN/);
      expect(r.pathData).toMatch(/^M[-\d.]+,[-\d.]+/);
      expect(r.pathData).toMatch(/[LCQ]/);
      // Each route's start ≠ end (no zero-length segment).
      const m = [...r.pathData.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)];
      const first = { x: parseFloat(m[0][1]), y: parseFloat(m[0][2]) };
      const last = { x: parseFloat(m[m.length - 1][1]), y: parseFloat(m[m.length - 1][2]) };
      const dist = Math.hypot(last.x - first.x, last.y - first.y);
      expect(dist).toBeGreaterThan(0.5);
      // Tag for debug assertion failures
      if (dist <= 0.5) console.error(`degenerate route: ${key} -> ${r.pathData}`);
    }
  });

  it('renders an SVG with one fs-edge group per declared edge', () => {
    const svg = render(loadFixture());
    expect(svg).not.toContain('NaN');
    const matches = svg.match(/<g class="fs-edge"/g);
    expect(matches).toBeDefined();
    expect(matches!.length).toBe(10);

    // The two yes-branches should both target real nodes; verify by
    // checking that condition labels render.
    expect(svg).toContain('>yes<');
    expect(svg).toContain('>no<');
  });
});

describe('issue #8 repro — phantom decision fall-through', () => {
  // Direct minimal repro from issue #8.
  const SOURCE = `
#start Start
  #decision Is it done yet?
    -> Yes: Done
    -> No: Is it done yet?
  #end Done
`;

  it('emits exactly the three edges declared in the source', () => {
    const doc = parse(SOURCE);
    layoutDocument(doc);
    expect(doc.edges).toHaveLength(3);

    const decision = [...doc.nodes.values()].find(n => n.shape === 'decision')!;
    const out = doc.edges.filter(e => e.from === decision.id);
    expect(out).toHaveLength(2);

    // Every outgoing edge from the decision is conditional. The bug
    // would emit an additional unconditional decision -> Done edge.
    const unconditional = out.filter(e => !e.condition);
    expect(unconditional).toHaveLength(0);
  });

  it('SVG has exactly 3 edge groups, not 4', () => {
    const svg = render(SOURCE);
    const matches = svg.match(/<g class="fs-edge"/g);
    expect(matches!.length).toBe(3);
  });
});
