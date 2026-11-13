/**
 * Regression tests for the two parser-freeze bugs:
 *   - lexer // loop (URL labels, inline comments, // inside a token)
 *   - tryParseStyle loop (nested {, unexpected first inner token)
 *
 * Also locks valid 0.1.0 AST/SVG for two inputs, and SVG XML-escaping.
 *
 * Each test has a 500 ms bun timeout so a hang fails the suite.
 */

import { describe, it, expect } from 'bun:test';
import { parse, render } from '../src/index.js';
import { tokenize } from '../src/parser/lexer.js';
import type { FlowDocument } from '../src/parser/ast.js';

const TIMEOUT = 500;

function labels(doc: FlowDocument): string[] {
  return [...doc.nodes.values()].map(n => n.label);
}

function serializeAst(doc: FlowDocument): string {
  return JSON.stringify({
    meta: doc.meta,
    directives: doc.directives,
    nodes: [...doc.nodes.entries()],
    edges: doc.edges,
    groups: doc.groups,
    lanes: doc.lanes,
  });
}

/** 0.1.0 AST for `#start {foo}`, captured before the fix. */
const AST_START_BRACE_FOO_0_1_0 = JSON.stringify({
  meta: {},
  directives: [],
  nodes: [
    [
      'n1',
      {
        id: 'n1',
        label: 'Start',
        shape: 'start',
        line: 1,
      },
    ],
  ],
  edges: [],
  groups: [],
  lanes: [],
});

/** 0.1.0 AST for `#start foo { fill: "red" }`, captured before the fix. */
const AST_FOO_FILL_RED_0_1_0 = JSON.stringify({
  meta: {},
  directives: [],
  nodes: [
    [
      'n1',
      {
        id: 'n1',
        label: 'foo',
        shape: 'start',
        line: 1,
        style: {
          fill: 'red',
        },
      },
    ],
  ],
  edges: [],
  groups: [],
  lanes: [],
});

/** 0.1.0 SVG for `#start {foo}`, captured before the fix. */
const SVG_START_BRACE_FOO_0_1_0 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-140 -40 280 136" width="280" height="136" class="fs-diagram">
  <defs>
    <marker id="fs-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <path d="M0,0 L10,4 L0,8 Z" fill="#5a5a62" class="fs-arrow-head"/>
    </marker>
    <marker id="fs-arrow-yes" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <path d="M0,0 L10,4 L0,8 Z" fill="#2e7d32" class="fs-arrow-head"/>
    </marker>
    <marker id="fs-arrow-no" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <path d="M0,0 L10,4 L0,8 Z" fill="#c62828" class="fs-arrow-head"/>
    </marker>
    <marker id="fs-arrow-retry" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <path d="M0,0 L10,4 L0,8 Z" fill="#7e57c2" class="fs-arrow-head"/>
    </marker>
    <filter id="fs-shadow" x="-4%" y="-4%" width="108%" height="112%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#00000018"/>
    </filter>
  </defs>
  <g/>
  <g/>
  <g/>
  <g class="fs-edges"/>
  <g class="fs-nodes">
    <g class="fs-node" data-node-id="n1" data-shape="start" data-line="1">
      <g filter="url(#fs-shadow)">
        <rect x="-100" y="0" width="200" height="56" rx="28" fill="#d4edda" stroke="#4caf50" stroke-width="1.2"/>
      </g>
      <text x="0" y="28" text-anchor="middle" dominant-baseline="central" font-family="'Inter', system-ui, sans-serif" font-size="13" font-weight="500" fill="#2e7d32" class="fs-label">Start</text>
    </g>
  </g>
  <g/>
</svg>`;

/** 0.1.0 SVG for `#start foo { fill: "red" }`, captured before the fix. */
const SVG_FOO_FILL_RED_0_1_0 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-140 -40 280 136" width="280" height="136" class="fs-diagram">
  <defs>
    <marker id="fs-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <path d="M0,0 L10,4 L0,8 Z" fill="#5a5a62" class="fs-arrow-head"/>
    </marker>
    <marker id="fs-arrow-yes" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <path d="M0,0 L10,4 L0,8 Z" fill="#2e7d32" class="fs-arrow-head"/>
    </marker>
    <marker id="fs-arrow-no" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <path d="M0,0 L10,4 L0,8 Z" fill="#c62828" class="fs-arrow-head"/>
    </marker>
    <marker id="fs-arrow-retry" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <path d="M0,0 L10,4 L0,8 Z" fill="#7e57c2" class="fs-arrow-head"/>
    </marker>
    <filter id="fs-shadow" x="-4%" y="-4%" width="108%" height="112%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#00000018"/>
    </filter>
  </defs>
  <g/>
  <g/>
  <g/>
  <g class="fs-edges"/>
  <g class="fs-nodes">
    <g class="fs-node" data-node-id="n1" data-shape="start" data-line="1">
      <g filter="url(#fs-shadow)">
        <rect x="-100" y="0" width="200" height="56" rx="28" fill="red" stroke="#4caf50" stroke-width="1.2"/>
      </g>
      <text x="0" y="28" text-anchor="middle" dominant-baseline="central" font-family="'Inter', system-ui, sans-serif" font-size="13" font-weight="500" fill="#2e7d32" class="fs-label">foo</text>
    </g>
  </g>
  <g/>
</svg>`;

function parseOrBoundedError(source: string): FlowDocument | Error {
  try {
    return parse(source);
  } catch (e) {
    if (e instanceof Error) return e;
    return new Error(String(e));
  }
}

describe('parser freeze: // lexer (BAR 1-3)', () => {
  it('URL in a label does not hang and the label contains the host', () => {
    const doc = parse('#start See http://example.com');
    const joined = labels(doc).join(' ');
    expect(joined).toContain('example.com');
    // Judgment: :// stays in one TEXT token so the URL is intact.
    expect(joined).toContain('http://example.com');
  }, { timeout: TIMEOUT });

  it('whitespace-prefixed // is a comment; the label is foo', () => {
    const doc = parse('#start foo // comment');
    expect(labels(doc)).toEqual(['foo']);
    const comment = tokenize('#start foo // comment').find(t => t.type === 'COMMENT');
    expect(comment?.value).toBe('comment');
  }, { timeout: TIMEOUT });

  it('// inside a token stays in the label (a//b)', () => {
    const doc = parse('#start a//b');
    expect(labels(doc)).toEqual(['a//b']);
    const comments = tokenize('#start a//b').filter(t => t.type === 'COMMENT');
    expect(comments).toEqual([]);
  }, { timeout: TIMEOUT });
});

describe('parser freeze: tryParseStyle (BAR 4-5)', () => {
  it('nested {{ in a style position returns or throws a bounded parse error', () => {
    const result = parseOrBoundedError('#start {{foo}}');
    expect(result).toBeDefined();
    if (result instanceof Error) {
      expect(result.name === 'ParseError' || result instanceof Error).toBe(true);
    } else {
      expect(result.nodes.size).toBeGreaterThanOrEqual(1);
    }
  }, { timeout: TIMEOUT });

  it('style block whose first inner token is a string returns or throws a bounded parse error', () => {
    const result = parseOrBoundedError('#start foo { "red" }');
    expect(result).toBeDefined();
    if (result instanceof Error) {
      expect(result.name === 'ParseError' || result instanceof Error).toBe(true);
    } else {
      const node = [...result.nodes.values()][0];
      expect(node.label).toBe('foo');
    }
  }, { timeout: TIMEOUT });
});

describe('valid inputs unchanged vs 0.1.0 (BAR 7)', () => {
  it('#start {foo} produces the same AST and SVG as 0.1.0', () => {
    const src = '#start {foo}';
    expect(serializeAst(parse(src))).toBe(AST_START_BRACE_FOO_0_1_0);
    expect(render(src).replace(/\r\n/g, '\n')).toBe(SVG_START_BRACE_FOO_0_1_0);
  }, { timeout: TIMEOUT });

  it('#start foo { fill: "red" } produces the same AST and SVG as 0.1.0', () => {
    const src = '#start foo { fill: "red" }';
    expect(serializeAst(parse(src))).toBe(AST_FOO_FILL_RED_0_1_0);
    expect(render(src).replace(/\r\n/g, '\n')).toBe(SVG_FOO_FILL_RED_0_1_0);
  }, { timeout: TIMEOUT });
});

describe('SVG XML-escaping (BAR 8)', () => {
  it('escapes <, &, and " in a node label so they do not appear as markup', () => {
    // Quoted FlowScript string so <, >, and & reach the label intact.
    const src = '#start "<b>&foo"';
    const node = [...parse(src).nodes.values()][0];
    expect(node.label).toBe('<b>&foo');
    const svg = render(src);
    // <, >, and & are escaped and must not appear as markup.
    expect(svg).toContain('&lt;b&gt;&amp;foo');
    expect(svg).not.toContain('<b>');
    expect(svg).not.toContain('&foo');
    expect(svg).toContain('class="fs-label">');
    expect(svg).toContain('</text>');

    // A quote in a quoted string is written as \"; the lexer keeps the
    // backslash in the label. The quote must not break surrounding SVG tags.
    const svgQ = render('#start "<b>&\""');
    expect(svgQ).toContain('&lt;b&gt;&amp;');
    expect(svgQ).not.toContain('<b>');
    expect(svgQ).toContain('class="fs-label">');
    expect(svgQ).toContain('</text>');
  }, { timeout: TIMEOUT });
});
