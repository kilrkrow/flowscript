import { readFileSync, writeFileSync } from 'fs';
import { render } from '../src/index.ts';

import { parse } from '../src/parser/parser.ts';
const source = readFileSync('./test/fixtures/textografo-benchmark.flow', 'utf8');
const doc = parse(source);
console.log('Edges:', doc.edges.length);
console.log('Nodes:', doc.nodes.size);
const svg = render(source);
writeFileSync('./scratch/textografo-benchmark.svg', svg);
console.log('Saved benchmark SVG to artifacts/textografo-benchmark.svg');
