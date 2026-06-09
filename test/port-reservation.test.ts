/**
 * Cardinal port reservation tests.
 *
 * The router reserves ports in a pre-pass before any waypoint geometry
 * is computed. The four invariants in this file pin the user-facing
 * rules:
 *   1. Inbound and outbound traffic on the same node should not share a
 *      cardinal side when another cardinal is free (no opposite-direction
 *      reuse).
 *   2. Two outbound (or two inbound) edges should not share a cardinal
 *      side when another cardinal is free (no same-direction reuse).
 *   3. The semi-cardinal corner ports are only used after every
 *      cardinal has at least one same-role occupant.
 *   4. A specific incident-response regression: the yes-branch of "Have
 *      they arrived?" must NOT enter Monitor on Monitor's already-used
 *      N (inbound) port.
 *
 * Plus the rendered-SVG colour fix: arrowhead markers per semantic edge
 * class fill in the same colour as the edge stroke.
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from '../src/parser/parser.js';
import { layoutDocument } from '../src/layout/dagre-layout.js';
import { routeEdges, findRoute } from '../src/layout/router.js';
import {
  reservePorts, type EdgePreferences,
} from '../src/layout/port-reservation.js';
import { render } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8');
}

function nodeByLabel(doc: ReturnType<typeof parse>, label: string) {
  for (const [, n] of doc.nodes) if (n.label === label) return n;
  throw new Error(`No node with label: ${label}`);
}

/** Classify which cardinal side of `node` `point` lies on. */
function classifySide(
  node: ReturnType<typeof nodeByLabel>,
  point: { x: number; y: number },
): 'N' | 'S' | 'E' | 'W' | '?' {
  const dx = point.x - (node.x ?? 0);
  const dy = point.y - (node.y ?? 0);
  const hw = (node.width ?? 180) / 2;
  const hh = (node.height ?? 44) / 2;
  if (Math.abs(dy + hh) < 1.5) return 'N';
  if (Math.abs(dy - hh) < 1.5) return 'S';
  if (Math.abs(dx - hw) < 1.5) return 'E';
  if (Math.abs(dx + hw) < 1.5) return 'W';
  return '?';
}

// ── Reservation primitive (tested directly, no router) ──────────────

describe('reservePorts — primitive availability rules', () => {
  function makeNode(id: string) {
    return {
      id,
      label: id,
      shape: 'process' as const,
      x: 0,
      y: 0,
      width: 100,
      height: 40,
    };
  }

  function makeEdge(from: string, to: string) {
    return { from, to };
  }

  function buildPrefs(args: Array<{
    edgeKey: string;
    fromId: string;
    toId: string;
    exitPrefs: Array<'N' | 'S' | 'E' | 'W'>;
    entryPrefs: Array<'N' | 'S' | 'E' | 'W'>;
  }>): EdgePreferences[] {
    return args.map(a => ({
      edgeKey: a.edgeKey,
      edge: makeEdge(a.fromId, a.toId),
      fromNode: makeNode(a.fromId),
      toNode: makeNode(a.toId),
      exitPrefs: a.exitPrefs,
      entryPrefs: a.entryPrefs,
    }));
  }

  it('does not place inbound and outbound on the same cardinal side when other cardinals are free', () => {
    // `hub` has one outbound (b, preferring N) and one inbound (a,
    // preferring N). The two-pass reserver claims hub's exit first, so
    // a's entry must avoid N (it's now opposite-role-occupied) — the
    // core "no opposite-direction reuse" rule. b's exit gets the
    // preferred N. The asymmetric outcome is fine: what matters is that
    // the two roles do NOT both land on the same side when alternatives
    // exist.
    const prefs = buildPrefs([
      { edgeKey: 'a', fromId: 'src', toId: 'hub',
        exitPrefs: ['S'], entryPrefs: ['N'] },
      { edgeKey: 'b', fromId: 'hub', toId: 'dst',
        exitPrefs: ['N'], entryPrefs: ['S'] },
    ]);
    const doc = { nodes: new Map(), edges: [], lanes: [], groups: [],
      directives: [], meta: {} } as any;
    const r = reservePorts(doc, prefs);

    const a = r.byEdgeKey.get('a')!;
    const b = r.byEdgeKey.get('b')!;
    // Same-side both-roles attachment is the forbidden state.
    expect(a.entryDir).not.toBe(b.exitDir);
    // The hub gains traffic on at least two different cardinals, since
    // semi-cardinal fallback should NOT trigger when we have only two
    // edges touching the hub.
    expect(a.entryIsSemi).toBe(false);
    expect(b.exitIsSemi).toBe(false);
  });

  it('does not reuse a same-role port when another cardinal is free', () => {
    // Two outbounds from the same node, both naturally pulled to S.
    // The first claims S; the second must NOT also pick S.
    const prefs = buildPrefs([
      { edgeKey: 'a', fromId: 'hub', toId: 'd1',
        exitPrefs: ['S'], entryPrefs: ['N'] },
      { edgeKey: 'b', fromId: 'hub', toId: 'd2',
        exitPrefs: ['S'], entryPrefs: ['N'] },
    ]);
    const doc = { nodes: new Map(), edges: [], lanes: [], groups: [],
      directives: [], meta: {} } as any;
    const r = reservePorts(doc, prefs);

    const a = r.byEdgeKey.get('a')!;
    const b = r.byEdgeKey.get('b')!;
    expect(a.exitDir).toBe('S');
    expect(b.exitDir).not.toBe('S');
    // And b must still land on a cardinal — semi-cardinal fallback only
    // kicks in when every cardinal is taken.
    expect(['N', 'E', 'W']).toContain(b.exitDir);
    expect(b.exitIsSemi).toBe(false);
  });

  it('falls back to a semi-cardinal only after every cardinal has same-role traffic', () => {
    // Five outbound edges from one node. First four take N/E/S/W; the
    // fifth has no free cardinal and must land on a semi-cardinal corner.
    const prefs = buildPrefs([
      { edgeKey: 'a', fromId: 'hub', toId: 'd1',
        exitPrefs: ['N'], entryPrefs: ['S'] },
      { edgeKey: 'b', fromId: 'hub', toId: 'd2',
        exitPrefs: ['E'], entryPrefs: ['W'] },
      { edgeKey: 'c', fromId: 'hub', toId: 'd3',
        exitPrefs: ['S'], entryPrefs: ['N'] },
      { edgeKey: 'd', fromId: 'hub', toId: 'd4',
        exitPrefs: ['W'], entryPrefs: ['E'] },
      { edgeKey: 'e', fromId: 'hub', toId: 'd5',
        exitPrefs: ['N'], entryPrefs: ['S'] },
    ]);
    const doc = { nodes: new Map(), edges: [], lanes: [], groups: [],
      directives: [], meta: {} } as any;
    const r = reservePorts(doc, prefs);

    // First four are cardinals, distinct.
    const dirs = ['a', 'b', 'c', 'd'].map(k => r.byEdgeKey.get(k)!);
    expect(new Set(dirs.map(d => d.exitDir)).size).toBe(4);
    for (const d of dirs) expect(d.exitIsSemi).toBe(false);

    // Fifth lands on a semi-cardinal.
    const fifth = r.byEdgeKey.get('e')!;
    expect(fifth.exitIsSemi).toBe(true);
    expect(['NE', 'SE', 'SW', 'NW']).toContain(fifth.exitDir);
  });
});

// ── End-to-end test: incident-response Monitor entry ────────────────

describe('incident-response — Monitor entry-side regression', () => {
  it('Have they arrived? -> Monitor does not reuse Monitor\'s N inbound port', () => {
    const source = loadFixture('incident-response.flow');
    const doc = parse(source);
    layoutDocument(doc);
    const routes = routeEdges(doc);
    const monitor = nodeByLabel(doc, 'Monitor until resolved');
    const arrived = nodeByLabel(doc, 'Have they arrived?');
    const event = nodeByLabel(doc, 'Is there an event requiring police?');

    // Sanity: the no-branch from "Is there an event requiring police?"
    // already reaches Monitor on its N port.
    const noEdgeObj = doc.edges.find(e => e.from === event.id && e.to === monitor.id && e.condition === 'no')!;
    const noEdge = findRoute(routes, doc, noEdgeObj)!;
    const noEnd = noEdge.waypoints![noEdge.waypoints!.length - 1];
    expect(classifySide(monitor, noEnd)).toBe('N');

    // The yes-branch from "Have they arrived?" must therefore enter on
    // a side OTHER than N. The geometry — arrived sits south-west of
    // Monitor and Monitor's S is opposite-role-occupied by the natural
    // outbound flow toward Resolved? — pins the choice to W (the
    // perpendicular cardinal facing the source's column).
    const yesEdgeObj = doc.edges.find(e => e.from === arrived.id && e.to === monitor.id && e.condition === 'yes')!;
    const yesEdge = findRoute(routes, doc, yesEdgeObj)!;
    const yesEnd = yesEdge.waypoints![yesEdge.waypoints!.length - 1];
    const side = classifySide(monitor, yesEnd);
    expect(side).not.toBe('N');
    expect(side).toBe('W');
  });
});

// ── Arrowhead marker colour parity ──────────────────────────────────

describe('arrowhead colour matches semantic edge stroke', () => {
  it('renders distinct fs-arrow-yes / fs-arrow-no / fs-arrow-retry markers with matching fills', () => {
    const SOURCE = `
@theme clean
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

    // Each of the three semantic markers must exist in <defs>.
    expect(svg).toContain('id="fs-arrow-yes"');
    expect(svg).toContain('id="fs-arrow-no"');
    expect(svg).toContain('id="fs-arrow-retry"');

    // Each marker's path fill must equal the matching semantic stroke
    // exposed by the clean theme.
    const expected = {
      'fs-arrow-yes': '#2e7d32',
      'fs-arrow-no': '#c62828',
      'fs-arrow-retry': '#7e57c2',
    };
    for (const [markerId, color] of Object.entries(expected)) {
      const re = new RegExp(
        `id="${markerId}"[\\s\\S]*?fill="${escapeRegExp(color)}"`,
        'm',
      );
      expect(svg).toMatch(re);
    }

    // And the edges that bear each semantic class actually reference
    // the corresponding marker (not the default fs-arrow). The class
    // attribute is emitted after `marker-end` in this renderer, so the
    // assertion just checks that both attributes are present on the
    // same <path>.
    const yesPath = svg.match(/<path [^>]*class="[^"]*fs-edge-yes[^"]*"[^>]*>/);
    expect(yesPath?.[0]).toContain('marker-end="url(#fs-arrow-yes)"');
    const noPath = svg.match(/<path [^>]*class="[^"]*fs-edge-no[^"]*"[^>]*>/);
    expect(noPath?.[0]).toContain('marker-end="url(#fs-arrow-no)"');
    const retryPath = svg.match(/<path [^>]*class="[^"]*fs-edge-retry[^"]*"[^>]*>/);
    expect(retryPath?.[0]).toContain('marker-end="url(#fs-arrow-retry)"');
  });
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
