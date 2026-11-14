/**
 * Regression (issue #39): `#end` is terminal and must break implicit
 * chaining. Before the fix, a sibling line declared after an indented
 * `#end` received a bogus reverse edge End → sibling.
 */

import { describe, it, expect } from 'bun:test';

import { parse } from '../src/parser/parser.js';

function edgeLabels(source: string): string[] {
  const doc = parse(source);
  const label = (id: string) => doc.nodes.get(id)!.label;
  return doc.edges.map((e) => `${label(e.from)} -> ${label(e.to)}`);
}

describe('#end breaks implicit chaining (issue #39)', () => {
  it('does not chain End into the following sibling', () => {
    const edges = edgeLabels(`
#start Start
  #decision Proceed?
    -> 'yes' Hire Guy
    -> 'no' Thank Ruby for time
  Hire Guy
    #end End
  Thank Ruby for time
    #end End
`);
    expect(edges).toContain('Hire Guy -> End');
    expect(edges).toContain('Thank Ruby for time -> End');
    expect(edges).not.toContain('End -> Thank Ruby for time');
  });

  it('gives #end no outgoing implicit edges', () => {
    const edges = edgeLabels(`
#start Begin
  Step A
  #end Finish
Step B
`);
    expect(edges).toContain('Step A -> Finish');
    expect(edges.filter((e) => e.startsWith('Finish ->'))).toEqual([]);
  });

  it('applies to @id lines declared with #end', () => {
    const edges = edgeLabels(`
#start Begin
  Step A
  @done #end Finish
Step B
`);
    expect(edges).toContain('Step A -> Finish');
    expect(edges.filter((e) => e.startsWith('Finish ->'))).toEqual([]);
  });

  it('still allows an explicit edge out of an end node', () => {
    const edges = edgeLabels(`
#start Begin
  #end Finish -> Restart
Restart
`);
    expect(edges).toContain('Finish -> Restart');
  });
});
