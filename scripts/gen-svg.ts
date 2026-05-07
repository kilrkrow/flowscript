import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { parse } from '../src/parser/parser.js';
import { layoutDocument } from '../src/layout/dagre-layout.js';
import { routeEdges } from '../src/layout/router.js';
import { renderSVG } from '../src/render/svg.js';
import { cleanTheme } from '../src/themes/clean.js';

const fixture = process.argv[2] ?? 'learning-flow';
const src = readFileSync(`./test/fixtures/${fixture}.flow`, 'utf8');
const doc = parse(src);
layoutDocument(doc);
const routes = routeEdges(doc);
const svg = renderSVG(doc, routes, { theme: cleanTheme });

// Auto-increment version so existing files are never overwritten.
const existing = readdirSync('./test/output');
const versions = existing
  .map(f => f.match(new RegExp(`^${fixture}-v(\\d+)\\.svg$`)))
  .filter(Boolean)
  .map(m => parseInt(m![1], 10));
const next = versions.length > 0 ? Math.max(...versions) + 1 : 1;

const out = `./test/output/${fixture}-v${next}.svg`;
writeFileSync(out, svg);
console.log(`Written: ${out}`);
