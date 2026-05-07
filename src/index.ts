/**
 * FlowScript — Public API
 * 
 * This is the main entry point. Consumers import from here.
 * All platform-specific I/O lives in the CLI or wrapper layers.
 * 
 * Usage:
 *   import { parse, layout, route, renderSVG } from 'flowscript';
 *   const doc = parse(sourceText);
 *   layout(doc);
 *   const routes = route(doc);
 *   const svg = renderSVG(doc, routes, { theme: cleanTheme });
 */

export { parse } from './parser/parser.js';
export type { FlowDocument, FlowNode, FlowEdge, FlowGroup, FlowLane, Directive, ShapeType } from './parser/ast.js';
export { layoutDocument as layout } from './layout/dagre-layout.js';
export { routeEdges as route } from './layout/router.js';
export type { RouteResult } from './layout/router.js';
export { renderSVG } from './render/svg.js';
export { cleanTheme } from './themes/clean.js';
export { cleanDarkTheme } from './themes/clean-dark.js';
export { resolveTheme, listThemes } from './themes/index.js';
export type { Theme } from './themes/clean.js';

// Convenience: full pipeline in one call
import { parse } from './parser/parser.js';
import { layoutDocument } from './layout/dagre-layout.js';
import { routeEdges } from './layout/router.js';
import { renderSVG } from './render/svg.js';
import { cleanTheme, type Theme } from './themes/clean.js';
import { resolveTheme } from './themes/index.js';
import { getDirective } from './parser/ast.js';

export interface RenderToSVGOptions {
  theme?: Theme;
  padding?: number;
}

/**
 * One-shot render: DSL text → SVG string.
 */
export function render(source: string, options: RenderToSVGOptions = {}): string {
  const doc = parse(source);
  layoutDocument(doc);
  const routes = routeEdges(doc);
  // Theme priority: explicit option → @theme directive → 'clean' default
  const theme = options.theme ?? resolveTheme(getDirective(doc, 'theme', 'clean'));
  return renderSVG(doc, routes, {
    theme,
    padding: options.padding ?? 40,
  });
}
