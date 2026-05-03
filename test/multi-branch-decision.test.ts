/**
 * Regression: a decision with three or more outgoing branches must
 * render every branch as a visibly distinct path. Before the fix,
 * the per-edge port scorer ran independently for each branch, so
 * branches with similar target geometry (or non yes/no conditions)
 * collapsed onto the same cardinal tip of the diamond and visually
 * overlapped — the user observed "your decision shapes lack a branch
 * beyond the first."
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

function pipeline(source: string) {
  const doc = parse(source);
  layoutDocument(doc);
  const routes = routeEdges(doc);
  return { doc, routes };
}

/** Pull "M x,y" off the front of a path. */
function pathStart(d: string): { x: number; y: number } {
  const m = d.match(/^M([-\d.]+),([-\d.]+)/);
  if (!m) throw new Error(`No M start in path: ${d}`);
  return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
}

describe('multi-branch decision (3+ branches)', () => {
  const SOURCE = `
@theme clean
@direction TB

#start Begin
  Triage
  #decision Severity?
    -> high: Page Oncall
    -> medium: Open Ticket
    -> low: Log And Close
  #end Done
`;

  it('parses every declared branch into a separate edge', () => {
    const { doc } = pipeline(SOURCE);
    const decision = [...doc.nodes.values()].find(n => n.shape === 'decision')!;
    const out = doc.edges.filter(e => e.from === decision.id);
    const conds = out.map(e => e.condition).filter((c): c is string => !!c).sort();
    expect(conds).toEqual(['high', 'low', 'medium']);
  });

  it('routes each branch from a distinct point on the diamond boundary', () => {
    const { doc, routes } = pipeline(SOURCE);
    const decision = [...doc.nodes.values()].find(n => n.shape === 'decision')!;
    const branchEdges = doc.edges.filter(
      e => e.from === decision.id && e.condition,
    );
    expect(branchEdges.length).toBeGreaterThanOrEqual(3);

    const starts = branchEdges
      .map(e => routes.get(`${e.from}->${e.to}`)!)
      .map(r => pathStart(r.pathData));

    // Every branch must originate from a distinct (x, y) on the diamond
    // — i.e. no two branches share the same exit tip.
    for (let i = 0; i < starts.length; i++) {
      for (let j = i + 1; j < starts.length; j++) {
        const a = starts[i];
        const b = starts[j];
        const same = Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
        expect(same).toBe(false);
      }
    }
  });

  it('renders an SVG path with non-trivial geometry for every branch', () => {
    const { doc, routes } = pipeline(SOURCE);
    const decision = [...doc.nodes.values()].find(n => n.shape === 'decision')!;
    const branchEdges = doc.edges.filter(
      e => e.from === decision.id && e.condition,
    );
    for (const edge of branchEdges) {
      const r = routes.get(`${edge.from}->${edge.to}`);
      expect(r).toBeDefined();
      expect(r!.pathData).toMatch(/^M[-\d.]+,[-\d.]+/);
      // Path must have at least one drawn segment beyond the move.
      expect(r!.pathData).toMatch(/[LCQ]/);
    }
  });

  it('SVG output includes one fs-edge group per decision branch', () => {
    const svg = render(SOURCE);
    // Three condition labels must appear as edge labels.
    expect(svg).toContain('>high<');
    expect(svg).toContain('>medium<');
    expect(svg).toContain('>low<');
    // Each branch produces its own <g class="fs-edge"> with data-from
    // pointing at the decision node.
    const decId = (svg.match(/data-shape="decision">[\s\S]*?<\/g>/) ? 'n3' : 'n3'); // node id stable for this fixture
    const matches = svg.match(new RegExp(`<g class="fs-edge" data-from="${decId}"`, 'g'));
    expect(matches).toBeDefined();
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });

  it('preserves yes/no semantics: yes exits south, no exits side', () => {
    // Two-branch yes/no decision should still route yes→S and no→E/W
    // (existing convention) — the multi-branch fix must not change it.
    const { doc, routes } = pipeline(`
#start A
  #decision OK?
    -> yes: #end Done
    -> no: A
`);
    const decision = [...doc.nodes.values()].find(n => n.shape === 'decision')!;
    const yes = doc.edges.find(e => e.from === decision.id && e.condition === 'yes')!;
    const no = doc.edges.find(e => e.from === decision.id && e.condition === 'no')!;
    const yStart = pathStart(routes.get(`${yes.from}->${yes.to}`)!.pathData);
    const nStart = pathStart(routes.get(`${no.from}->${no.to}`)!.pathData);

    // Yes exits south (y at the bottom tip of the diamond)
    const tipY = (decision.y ?? 0) + (decision.height ?? 0) / 2;
    expect(yStart.y).toBeCloseTo(tipY, 1);
    expect(yStart.x).toBeCloseTo(decision.x ?? 0, 1);

    // No exits a side (x at the East/West tip; y at the centerline)
    expect(Math.abs(nStart.y - (decision.y ?? 0))).toBeLessThan(1);
    expect(Math.abs(nStart.x - (decision.x ?? 0))).toBeGreaterThan(10);
  });

  it('retry branches (~>) on a multi-branch decision still render visibly', () => {
    const { doc, routes } = pipeline(`
#start A
  Validate
  #decision Outcome?
    -> ok: B
    ~> retry: Validate
    -> abort: #end Stop
  B
`);
    const decision = [...doc.nodes.values()].find(n => n.shape === 'decision')!;
    const out = doc.edges.filter(e => e.from === decision.id && e.condition);
    expect(out).toHaveLength(3);

    const retry = out.find(e => e.condition === 'retry')!;
    expect(retry.retry).toBe(true);

    const starts = out
      .map(e => routes.get(`${e.from}->${e.to}`)!)
      .map(r => pathStart(r.pathData));

    // No two branches share the same exit point.
    for (let i = 0; i < starts.length; i++) {
      for (let j = i + 1; j < starts.length; j++) {
        const same =
          Math.abs(starts[i].x - starts[j].x) < 1 &&
          Math.abs(starts[i].y - starts[j].y) < 1;
        expect(same).toBe(false);
      }
    }
  });

  it('multi-branch fixture file renders without losing branches', () => {
    const src = readFileSync(
      join(__dirname, 'fixtures', 'multi-branch-decision.flow'), 'utf8',
    );
    const svg = render(src);
    expect(svg).toContain('>high<');
    expect(svg).toContain('>medium<');
    expect(svg).toContain('>low<');
  });
});
