/**
 * Tests for jsonToFlow() — JSON graph → FlowScript compiler.
 *
 * Each test verifies that:
 * 1. jsonToFlow() produces output that parse() accepts without error
 * 2. The parsed document contains exactly the expected edges (no phantom edges,
 *    no missing edges)
 */

import { expect, test, describe } from 'bun:test';
import { jsonToFlow, type JsonGraph } from '../src/compiler/json-to-flow.js';
import { parse } from '../src/parser/parser.js';
import { render } from '../src/index.js';

// Helper: parse the emitted FlowScript and return edge pairs for comparison
function edgesOf(source: string): Array<{ from: string; to: string; condition?: string }> {
  const doc = parse(source);
  const nodeLabel = new Map<string, string>();
  for (const [id, node] of doc.nodes) nodeLabel.set(id, node.label);

  return doc.edges.map(e => ({
    from:      nodeLabel.get(e.from) ?? e.from,
    to:        nodeLabel.get(e.to)   ?? e.to,
    condition: e.condition,
  }));
}

function expectEdges(
  source: string,
  expected: Array<{ from: string; to: string; condition?: string }>,
) {
  const actual = edgesOf(source);
  // Sort both for stable comparison
  const sort = (arr: typeof expected) =>
    [...arr].sort((a, b) =>
      `${a.from}${a.to}${a.condition}`.localeCompare(`${b.from}${b.to}${b.condition}`)
    );
  expect(sort(actual)).toEqual(sort(expected));
}

// ─── Linear sequence ────────────────────────────────────────────────────────

describe('linear sequence', () => {
  const graph: JsonGraph = {
    title: 'Linear',
    nodes: [
      { id: 'n1', label: 'Start',  shape: 'start'   },
      { id: 'n2', label: 'Step A', shape: 'process'  },
      { id: 'n3', label: 'Step B', shape: 'process'  },
      { id: 'n4', label: 'Done',   shape: 'end'      },
    ],
    edges: [
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n3' },
      { from: 'n3', to: 'n4' },
    ],
  };

  test('emits parseable FlowScript', () => {
    const src = jsonToFlow(graph);
    expect(() => parse(src)).not.toThrow();
  });

  test('produces correct edges', () => {
    const src = jsonToFlow(graph);
    expectEdges(src, [
      { from: 'Start',  to: 'Step A' },
      { from: 'Step A', to: 'Step B' },
      { from: 'Step B', to: 'Done'   },
    ]);
  });

  test('is renderable end-to-end', () => {
    const src = jsonToFlow(graph);
    expect(() => render(src)).not.toThrow();
  });
});

// ─── Simple decision ────────────────────────────────────────────────────────

describe('simple yes/no decision', () => {
  const graph: JsonGraph = {
    nodes: [
      { id: 'n1', label: 'Start',   shape: 'start'    },
      { id: 'n2', label: 'Valid?',  shape: 'decision'  },
      { id: 'n3', label: 'Save',    shape: 'process'   },
      { id: 'n4', label: 'Retry',   shape: 'process'   },
      { id: 'n5', label: 'Done',    shape: 'end'       },
    ],
    edges: [
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n3', condition: 'yes' },
      { from: 'n2', to: 'n4', condition: 'no'  },
      { from: 'n3', to: 'n5' },
      { from: 'n4', to: 'n5' },
    ],
  };

  test('emits parseable FlowScript', () => {
    expect(() => parse(jsonToFlow(graph))).not.toThrow();
  });

  test('produces correct edges — no phantom n3→n4 implicit edge', () => {
    const src = jsonToFlow(graph);
    expectEdges(src, [
      { from: 'Start',  to: 'Valid?',              },
      { from: 'Valid?', to: 'Save',  condition: 'yes' },
      { from: 'Valid?', to: 'Retry', condition: 'no'  },
      { from: 'Save',   to: 'Done'                 },
      { from: 'Retry',  to: 'Done'                 },
    ]);
  });
});

// ─── Back-edge (loop) ───────────────────────────────────────────────────────

describe('back-edge loop', () => {
  const graph: JsonGraph = {
    nodes: [
      { id: 'n1', label: 'Start',    shape: 'start'   },
      { id: 'n2', label: 'Validate', shape: 'process'  },
      { id: 'n3', label: 'Valid?',   shape: 'decision' },
      { id: 'n4', label: 'Save',     shape: 'process'  },
      { id: 'n5', label: 'Done',     shape: 'end'      },
    ],
    edges: [
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n3' },
      { from: 'n3', to: 'n4', condition: 'yes' },
      { from: 'n3', to: 'n2', condition: 'no', retry: true }, // back-edge
      { from: 'n4', to: 'n5' },
    ],
  };

  test('emits parseable FlowScript', () => {
    expect(() => parse(jsonToFlow(graph))).not.toThrow();
  });

  test('back-edge appears as explicit ~> line', () => {
    const src = jsonToFlow(graph);
    expect(src).toContain('~>');
  });

  test('produces correct edges including back-edge', () => {
    const src = jsonToFlow(graph);
    expectEdges(src, [
      { from: 'Start',    to: 'Validate'                   },
      { from: 'Validate', to: 'Valid?'                     },
      { from: 'Valid?',   to: 'Save',     condition: 'yes' },
      { from: 'Valid?',   to: 'Validate', condition: 'no'  },
      { from: 'Save',     to: 'Done'                       },
    ]);
  });
});

// ─── Multi-way decision ─────────────────────────────────────────────────────

describe('multi-way decision (3 branches)', () => {
  const graph: JsonGraph = {
    nodes: [
      { id: 'n1', label: 'Start',    shape: 'start'   },
      { id: 'n2', label: 'Priority?',shape: 'decision' },
      { id: 'n3', label: 'Page Oncall',  shape: 'process' },
      { id: 'n4', label: 'Open Ticket',  shape: 'process' },
      { id: 'n5', label: 'Log and Close',shape: 'process' },
      { id: 'n6', label: 'Done',     shape: 'end'     },
    ],
    edges: [
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n3', condition: 'P1' },
      { from: 'n2', to: 'n4', condition: 'P2' },
      { from: 'n2', to: 'n5', condition: 'P3' },
      { from: 'n3', to: 'n6' },
      { from: 'n4', to: 'n6' },
      { from: 'n5', to: 'n6' },
    ],
  };

  test('emits parseable FlowScript', () => {
    expect(() => parse(jsonToFlow(graph))).not.toThrow();
  });

  test('no phantom edges between parallel branches', () => {
    const src = jsonToFlow(graph);
    const edges = edgesOf(src);
    // n3→n4, n4→n5 should NOT exist
    expect(edges.some(e => e.from === 'Page Oncall'  && e.to === 'Open Ticket'  )).toBe(false);
    expect(edges.some(e => e.from === 'Open Ticket'  && e.to === 'Log and Close')).toBe(false);
  });

  test('all three branches converge at Done', () => {
    const src = jsonToFlow(graph);
    const edges = edgesOf(src);
    expect(edges.some(e => e.from === 'Page Oncall'   && e.to === 'Done')).toBe(true);
    expect(edges.some(e => e.from === 'Open Ticket'   && e.to === 'Done')).toBe(true);
    expect(edges.some(e => e.from === 'Log and Close' && e.to === 'Done')).toBe(true);
  });
});

// ─── All shape types ─────────────────────────────────────────────────────────

describe('all shape types', () => {
  const graph: JsonGraph = {
    nodes: [
      { id: 'n1',  label: 'Begin',    shape: 'start'      },
      { id: 'n2',  label: 'SubProc',  shape: 'subprocess' },
      { id: 'n3',  label: 'InOut',    shape: 'io'         },
      { id: 'n4',  label: 'DB',       shape: 'data'       },
      { id: 'n5',  label: 'Junction', shape: 'circle'     },
      { id: 'n6',  label: 'Note',     shape: 'note'       },
      { id: 'n7',  label: 'Manual',   shape: 'manual'     },
      { id: 'n8',  label: 'Wait',     shape: 'delay'      },
      { id: 'n9',  label: 'Check?',   shape: 'decision'   },
      { id: 'n10', label: 'Pass',     shape: 'process'    },
      { id: 'n11', label: 'Fail',     shape: 'process'    },
      { id: 'n12', label: 'End',      shape: 'end'        },
    ],
    edges: [
      { from: 'n1',  to: 'n2' },
      { from: 'n2',  to: 'n3' },
      { from: 'n3',  to: 'n4' },
      { from: 'n4',  to: 'n5' },
      { from: 'n5',  to: 'n6' },
      { from: 'n6',  to: 'n7' },
      { from: 'n7',  to: 'n8' },
      { from: 'n8',  to: 'n9' },
      { from: 'n9',  to: 'n10', condition: 'yes' },
      { from: 'n9',  to: 'n11', condition: 'no'  },
      { from: 'n10', to: 'n12' },
      { from: 'n11', to: 'n12' },
    ],
  };

  test('emits parseable FlowScript with all shape keywords', () => {
    const src = jsonToFlow(graph);
    expect(() => parse(src)).not.toThrow();
    expect(src).toContain('#start');
    expect(src).toContain('#end');
    expect(src).toContain('#decision');
    expect(src).toContain('#subprocess');
    expect(src).toContain('#io');
    expect(src).toContain('#data');
    expect(src).toContain('#circle');
    expect(src).toContain('#note');
    expect(src).toContain('#manual');
    expect(src).toContain('#delay');
  });
});

// ─── Frontmatter and directives ─────────────────────────────────────────────

describe('frontmatter and directives', () => {
  const graph: JsonGraph = {
    title:     'My Process',
    subtitle:  'Security SOP',
    theme:     'clean-dark',
    direction: 'LR',
    nodes: [
      { id: 'n1', label: 'Start', shape: 'start' },
      { id: 'n2', label: 'End',   shape: 'end'   },
    ],
    edges: [{ from: 'n1', to: 'n2' }],
  };

  test('emits frontmatter and directives', () => {
    const src = jsonToFlow(graph);
    expect(src).toContain('title: My Process');
    expect(src).toContain('subtitle: Security SOP');
    expect(src).toContain('@theme clean-dark');
    expect(src).toContain('@direction LR');
  });

  test('omits @direction when TB (default)', () => {
    const src = jsonToFlow({ ...graph, direction: 'TB' });
    expect(src).not.toContain('@direction');
  });
});

// ─── Validation errors ───────────────────────────────────────────────────────

describe('validation', () => {
  test('throws on empty nodes', () => {
    expect(() => jsonToFlow({ nodes: [], edges: [] })).toThrow('at least one node');
  });

  test('throws on duplicate node ids', () => {
    expect(() => jsonToFlow({
      nodes: [
        { id: 'n1', label: 'A', shape: 'start' },
        { id: 'n1', label: 'B', shape: 'end'   },
      ],
      edges: [],
    })).toThrow('duplicate');
  });

  test('throws on dangling edge reference', () => {
    expect(() => jsonToFlow({
      nodes: [{ id: 'n1', label: 'A', shape: 'start' }],
      edges: [{ from: 'n1', to: 'n99' }],
    })).toThrow('unknown node');
  });

  test('throws on missing node label', () => {
    expect(() => jsonToFlow({
      nodes: [{ id: 'n1', label: '', shape: 'start' }],
      edges: [],
    })).toThrow('missing label');
  });
});

// ─── MCP-style realistic SOP ─────────────────────────────────────────────────

describe('realistic SOP — security incident', () => {
  const graph: JsonGraph = {
    title: 'Security Incident Response',
    nodes: [
      { id: 'n1',  label: 'Alert Received',         shape: 'start'    },
      { id: 'n2',  label: 'Review CCTV',             shape: 'process'  },
      { id: 'n3',  label: 'Security incident?',      shape: 'decision' },
      { id: 'n4',  label: 'Call Police',             shape: 'process'  },
      { id: 'n5',  label: 'Document and Close',      shape: 'process'  },
      { id: 'n6',  label: 'Observe until arrival',   shape: 'process'  },
      { id: 'n7',  label: 'Police arrived?',         shape: 'decision' },
      { id: 'n8',  label: 'Monitor until resolved',  shape: 'process'  },
      { id: 'n9',  label: 'Resolved?',               shape: 'decision' },
      { id: 'n10', label: 'Incident closed',         shape: 'end'      },
    ],
    edges: [
      { from: 'n1',  to: 'n2' },
      { from: 'n2',  to: 'n3' },
      { from: 'n3',  to: 'n4',  condition: 'yes' },
      { from: 'n3',  to: 'n5',  condition: 'no'  },
      { from: 'n4',  to: 'n6' },
      { from: 'n6',  to: 'n7' },
      { from: 'n7',  to: 'n8',  condition: 'yes' },
      { from: 'n7',  to: 'n6',  condition: 'no', retry: true },   // back-edge
      { from: 'n8',  to: 'n9' },
      { from: 'n9',  to: 'n10', condition: 'yes' },
      { from: 'n9',  to: 'n8',  condition: 'no', retry: true },   // back-edge
      { from: 'n5',  to: 'n10' },
    ],
  };

  test('parses without error', () => {
    expect(() => parse(jsonToFlow(graph))).not.toThrow();
  });

  test('renders without error', () => {
    expect(() => render(jsonToFlow(graph))).not.toThrow();
  });

  test('has correct edge count', () => {
    const edges = edgesOf(jsonToFlow(graph));
    expect(edges.length).toBe(graph.edges.length);
  });
});
