/**
 * Tests for the explicit retry/dashed edge syntax (`~>`) and the
 * backward-compatible magic-label behavior (`try again`, `resend`).
 */

import { describe, it, expect } from 'bun:test';
import { parse } from '../src/parser/parser.js';
import { tokenize } from '../src/parser/lexer.js';
import { render } from '../src/index.js';

describe('lexer: ~> retry arrow', () => {
  it('emits a RETRY_ARROW token for ~>', () => {
    const tokens = tokenize('A ~> B');
    const types = tokens.map(t => t.type);
    expect(types).toContain('RETRY_ARROW');
    expect(types).not.toContain('ARROW');
  });

  it('still emits ARROW for ->', () => {
    const tokens = tokenize('A -> B');
    const types = tokens.map(t => t.type);
    expect(types).toContain('ARROW');
    expect(types).not.toContain('RETRY_ARROW');
  });

  it('does not consume `~` as part of node text', () => {
    const tokens = tokenize('A ~> B');
    const texts = tokens.filter(t => t.type === 'TEXT').map(t => t.value);
    // 'A' and 'B' should be separate, with no stray '~'
    expect(texts).toEqual(['A', 'B']);
  });
});

describe('parser: explicit ~> sets edge.retry', () => {
  it('marks edges from ~> as retry', () => {
    const doc = parse(`
#start Begin
  Validate
  #decision OK?
    -> yes: #end Done
    ~> no: Validate
`);
    const retryEdges = doc.edges.filter(e => e.retry);
    expect(retryEdges).toHaveLength(1);
    expect(retryEdges[0].condition).toBe('no');
  });

  it('does not set retry on plain -> edges', () => {
    const doc = parse(`
#start A
  B
  C
`);
    for (const e of doc.edges) {
      expect(e.retry).toBeFalsy();
    }
  });

  it('supports inline ~> on the same line', () => {
    const doc = parse(`
#start A
  B
  C ~> A: "again"
`);
    const retry = doc.edges.find(e => e.retry);
    expect(retry).toBeDefined();
    expect(retry?.label).toBe('again');
  });
});

describe('parser: backward-compatible magic labels', () => {
  it("marks edges labeled 'try again' as retry", () => {
    const doc = parse(`
#start A
  B
  C -> B: "try again"
`);
    const e = doc.edges.find(x => x.label === 'try again');
    expect(e).toBeDefined();
    expect(e?.retry).toBe(true);
  });

  it("marks edges labeled 'resend' as retry", () => {
    const doc = parse(`
#start A
  B
  B -> A: "resend"
`);
    const e = doc.edges.find(x => x.label === 'resend');
    expect(e?.retry).toBe(true);
  });

  it("leaves other labeled edges unmarked", () => {
    const doc = parse(`
#start A
  B
  B -> A: "loop"
`);
    const e = doc.edges.find(x => x.label === 'loop');
    expect(e?.retry).toBeFalsy();
  });
});

describe('renderer: retry edges render dashed', () => {
  it('emits stroke-dasharray and fs-edge-retry class for ~>', () => {
    const svg = render(`
#start A
  B
  B ~> A: "retry"
`);
    expect(svg).toContain('fs-edge-retry');
    expect(svg).toContain('stroke-dasharray="6,3"');
  });

  it('emits dashed for legacy magic labels', () => {
    const svg = render(`
#start A
  B
  B -> A: "try again"
`);
    expect(svg).toContain('fs-edge-retry');
    expect(svg).toContain('stroke-dasharray="6,3"');
  });

  it('plain edges are not dashed', () => {
    const svg = render(`
#start A
  B
  C
`);
    expect(svg).not.toContain('fs-edge-retry');
    expect(svg).not.toContain('stroke-dasharray="6,3"');
  });
});
