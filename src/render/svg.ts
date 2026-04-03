/**
 * SVG Renderer — takes a positioned FlowDocument and produces a complete SVG.
 * 
 * Uses the virtual SVG tree for construction, then serializes to string.
 * Every element gets fs-* classes and data-* attributes for animation readiness.
 */

import { el, serializeToSVG, type SvgElement } from './svg-tree.js';
import { renderNode } from './shapes/index.js';
import type { FlowDocument, FlowEdge } from '../parser/ast.js';
import type { Theme } from '../themes/clean.js';
import type { RouteResult } from '../layout/router.js';

export interface RenderOptions {
  theme: Theme;
  padding?: number;
}

/**
 * Render a positioned FlowDocument to an SVG string.
 */
export function renderSVG(doc: FlowDocument, routes: Map<string, RouteResult>, options: RenderOptions): string {
  const { theme, padding = 40 } = options;

  // Calculate viewBox from node positions
  const bounds = calculateBounds(doc, padding);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  // Build the SVG tree
  const root = el('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: `${bounds.minX} ${bounds.minY} ${width} ${height}`,
    width,
    height,
    class: 'fs-diagram',
  },
    renderDefs(theme),
    renderGroups(doc, theme),
    renderEdges(doc, routes, theme),
    renderNodes(doc, theme),
  );

  return serializeToSVG(root);
}

function renderDefs(theme: Theme): SvgElement {
  return el('defs', {},
    // Arrow marker
    el('marker', {
      id: 'fs-arrow',
      markerWidth: theme.edge.arrowSize,
      markerHeight: theme.edge.arrowSize * 0.8,
      refX: theme.edge.arrowSize - 1,
      refY: theme.edge.arrowSize * 0.4,
      orient: 'auto',
    },
      el('path', {
        d: `M0,0 L${theme.edge.arrowSize},${theme.edge.arrowSize * 0.4} L0,${theme.edge.arrowSize * 0.8} Z`,
        fill: theme.edge.stroke,
      }),
    ),
    // Drop shadow filter
    el('filter', {
      id: 'fs-shadow',
      x: '-4%', y: '-4%',
      width: '108%', height: '112%',
    },
      el('feDropShadow', {
        dx: 0, dy: 2, stdDeviation: 3,
        'flood-color': '#00000018',
      }),
    ),
  );
}

function renderGroups(doc: FlowDocument, theme: Theme): SvgElement {
  if (doc.groups.length === 0) return el('g', {});

  const groupEls = doc.groups.map((group, index) => {
    if (group.x === undefined || group.y === undefined) return el('g', {});

    const gx = group.x - (group.width ?? 200) / 2;
    const gy = group.y - (group.height ?? 300) / 2;
    const gw = group.width ?? 200;
    const gh = group.height ?? 300;

    const colorIdx = index % theme.group.fills.length;
    const fill = group.style?.fill ?? theme.group.fills[colorIdx];
    const stroke = group.style?.stroke ?? theme.group.strokes[colorIdx];
    const headerFill = theme.group.headerFills[colorIdx];
    const font = theme.group.labelFont;
    // Cycle through a set of group label colors
    const labelColors = ['#1e40af', '#166534', '#5b21b6', '#92400e'];
    const labelColor = labelColors[colorIdx % labelColors.length];

    const headerHeight = 32;

    return el('g', {
      class: 'fs-group',
      'data-group-id': group.id,
    },
      // Background
      el('rect', {
        x: gx, y: gy, width: gw, height: gh,
        rx: 8, fill, stroke, 'stroke-width': 1.2,
      }),
      // Header
      el('rect', {
        x: gx, y: gy, width: gw, height: headerHeight,
        rx: 8, fill: headerFill, stroke: 'none',
      }),
      // Header bottom cover (to make the header meet the body cleanly)
      el('rect', {
        x: gx, y: gy + headerHeight - 8, width: gw, height: 8,
        fill: headerFill, stroke: 'none',
      }),
      // Label
      el('text', {
        x: gx + gw / 2, y: gy + headerHeight / 2 + 2,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'font-family': font.family,
        'font-size': font.size,
        'font-weight': font.weight,
        'text-transform': 'uppercase',
        'letter-spacing': '1',
        fill: labelColor,
        class: 'fs-group-label',
      }, group.label),
    );
  });

  return el('g', { class: 'fs-groups' }, ...groupEls);
}

function renderEdges(doc: FlowDocument, routes: Map<string, RouteResult>, theme: Theme): SvgElement {
  const edgeEls = doc.edges.map(edge => {
    const key = `${edge.from}->${edge.to}`;
    const route = routes.get(key);
    if (!route) return el('g', {});

    const isDashed = edge.label === 'try again' || edge.label === 'resend';
    const edgeGroup: (SvgElement | string)[] = [];

    // Path
    edgeGroup.push(el('path', {
      d: route.pathData,
      fill: 'none',
      stroke: edge.style?.stroke ?? theme.edge.stroke,
      'stroke-width': theme.edge.strokeWidth,
      'marker-end': 'url(#fs-arrow)',
      class: 'fs-edge-path',
      ...(isDashed ? { 'stroke-dasharray': '6,3' } : {}),
    }));

    // Edge label
    const labelText = edge.label ?? edge.condition;
    if (labelText) {
      const lx = route.labelPosition.x;
      const ly = route.labelPosition.y;

      // Background rect for label readability
      const lblWidth = labelText.length * 7 + 12;
      edgeGroup.push(el('rect', {
        x: lx - lblWidth / 2, y: ly - 9,
        width: lblWidth, height: 18,
        rx: 4, fill: '#ffffff', stroke: 'none', opacity: 0.9,
      }));
      edgeGroup.push(el('text', {
        x: lx, y: ly,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'font-family': theme.edge.labelFont.family,
        'font-size': theme.edge.labelFont.size,
        'font-weight': edge.condition ? 600 : theme.edge.labelFont.weight,
        fill: edge.condition ? theme.shapes.decision.textColor ?? theme.edge.labelFont.color : theme.edge.labelFont.color,
        'font-style': !edge.condition && edge.label ? 'italic' : 'normal',
        class: 'fs-edge-label',
      }, labelText));
    }

    return el('g', {
      class: 'fs-edge',
      'data-from': edge.from,
      'data-to': edge.to,
    }, ...edgeGroup);
  });

  return el('g', { class: 'fs-edges' }, ...edgeEls);
}

function renderNodes(doc: FlowDocument, theme: Theme): SvgElement {
  const nodeEls: SvgElement[] = [];
  for (const [_, node] of doc.nodes) {
    nodeEls.push(renderNode(node, theme));
  }
  return el('g', { class: 'fs-nodes' }, ...nodeEls);
}

// --- Bounds calculation ---

function calculateBounds(doc: FlowDocument, padding: number) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const [_, node] of doc.nodes) {
    if (node.x === undefined || node.y === undefined) continue;
    const hw = (node.width ?? 180) / 2;
    const hh = (node.height ?? 44) / 2;
    minX = Math.min(minX, node.x - hw);
    minY = Math.min(minY, node.y - hh);
    maxX = Math.max(maxX, node.x + hw);
    maxY = Math.max(maxY, node.y + hh);
  }

  for (const group of doc.groups) {
    if (group.x === undefined || group.y === undefined) continue;
    const gw = (group.width ?? 200) / 2;
    const gh = (group.height ?? 300) / 2;
    minX = Math.min(minX, group.x - gw);
    minY = Math.min(minY, group.y - gh);
    maxX = Math.max(maxX, group.x + gw);
    maxY = Math.max(maxY, group.y + gh);
  }

  if (minX === Infinity) {
    minX = 0; minY = 0; maxX = 400; maxY = 300;
  }

  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
}
