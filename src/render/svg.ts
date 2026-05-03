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
    renderLanes(doc, theme),
    renderGroups(doc, theme),
    renderEdges(doc, routes, theme),
    renderNodes(doc, theme),
  );

  return serializeToSVG(root);
}

function renderDefs(theme: Theme): SvgElement {
  // Emit one arrow marker per stroke colour the renderer will use.
  // Browsers do not inherit `currentColor` reliably across <marker> in all
  // engines, so we register a dedicated marker per semantic stroke and the
  // edge picks the matching `marker-end` URL.
  const arrowSize = theme.edge.arrowSize;
  const markerPath = `M0,0 L${arrowSize},${arrowSize * 0.4} L0,${arrowSize * 0.8} Z`;
  const markers: SvgElement[] = [];
  const seenColors = new Set<string>();
  function pushMarker(id: string, color: string) {
    if (seenColors.has(`${id}|${color}`)) return;
    seenColors.add(`${id}|${color}`);
    markers.push(el('marker', {
      id,
      markerWidth: arrowSize,
      markerHeight: arrowSize * 0.8,
      refX: arrowSize - 1,
      refY: arrowSize * 0.4,
      orient: 'auto',
    },
      el('path', { d: markerPath, fill: color, class: 'fs-arrow-head' }),
    ));
  }
  pushMarker('fs-arrow', theme.edge.stroke);
  const semStrokes = theme.edge.semanticStrokes ?? {};
  for (const cls of ['fs-edge-yes', 'fs-edge-no', 'fs-edge-retry'] as const) {
    const color = semStrokes[cls] ?? theme.edge.stroke;
    pushMarker(`fs-arrow-${classSuffix(cls)}`, color);
  }
  return el('defs', {},
    ...markers,
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

/** Strip `fs-edge-` prefix to produce the marker-id suffix. */
function classSuffix(cls: 'fs-edge-yes' | 'fs-edge-no' | 'fs-edge-retry'): string {
  return cls.replace('fs-edge-', '');
}

function renderLanes(doc: FlowDocument, theme: Theme): SvgElement {
  if (doc.lanes.length === 0) return el('g', {});

  const laneEls: (SvgElement | string)[] = [];
  const headerWidth = theme.lane.headerWidth;
  const font = theme.lane.labelFont;
  const labelColors = ['#334155', '#854d0e', '#166534', '#5b21b6', '#9f1239'];

  // Compute overall Y extent from lane geometry
  let topY = Infinity, bottomY = -Infinity;
  for (const lane of doc.lanes) {
    if (lane.y === undefined || lane.height === undefined) continue;
    const lTop = lane.y - lane.height / 2;
    const lBot = lane.y + lane.height / 2;
    if (lTop < topY) topY = lTop;
    if (lBot > bottomY) bottomY = lBot;
  }
  if (topY === Infinity) return el('g', {});

  const totalHeight = bottomY - topY;

  for (let i = 0; i < doc.lanes.length; i++) {
    const lane = doc.lanes[i];
    if (lane.x === undefined || lane.y === undefined) continue;

    const lw = lane.width ?? 260;
    const lh = totalHeight; // all lanes same height
    const lx = lane.x - lw / 2;
    const ly = topY;

    const colorIdx = i % theme.lane.fills.length;
    const fill = lane.style?.fill ?? theme.lane.fills[colorIdx];
    const stroke = lane.style?.stroke ?? theme.lane.strokes[colorIdx];
    const headerFill = theme.lane.headerFills[colorIdx];
    const labelColor = labelColors[colorIdx % labelColors.length];

    // Lane background
    laneEls.push(el('rect', {
      x: lx - headerWidth, y: ly, width: lw + headerWidth, height: lh,
      rx: 6, fill, stroke, 'stroke-width': 1,
      class: 'fs-lane-bg',
    }));

    // Lane header (left strip)
    laneEls.push(el('rect', {
      x: lx - headerWidth, y: ly, width: headerWidth, height: lh,
      rx: 6, fill: headerFill, stroke: 'none',
      class: 'fs-lane-header',
    }));
    // Cover right corners of header
    laneEls.push(el('rect', {
      x: lx - headerWidth + headerWidth - 6, y: ly, width: 6, height: lh,
      fill: headerFill, stroke: 'none',
    }));

    // Lane label — rotated 90° in the header strip
    const labelCx = lx - headerWidth / 2;
    const labelCy = ly + lh / 2;
    laneEls.push(el('text', {
      x: labelCx, y: labelCy,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-family': font.family,
      'font-size': font.size,
      'font-weight': font.weight,
      'letter-spacing': '1',
      fill: labelColor,
      transform: `rotate(-90, ${labelCx}, ${labelCy})`,
      class: 'fs-lane-label',
    }, lane.label));

    // Divider line (right edge of this lane) — skip for last lane
    if (i < doc.lanes.length - 1) {
      const divX = lx + lw + 4; // midpoint of LANE_GAP (8px gap / 2)
      laneEls.push(el('line', {
        x1: divX, y1: ly + 4,
        x2: divX, y2: ly + lh - 4,
        stroke: theme.lane.dividerStroke,
        'stroke-width': 1,
        'stroke-dasharray': theme.lane.dividerDash,
        class: 'fs-lane-divider',
      }));
    }
  }

  return el('g', { class: 'fs-lanes', 'data-lane-count': doc.lanes.length }, ...laneEls);
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

    // Dashed for explicit retry edges (`~>`) or legacy magic labels
    // (`try again`, `resend`). The `retry` flag is set in the parser.
    const isDashed = edge.retry === true
      || edge.label === 'try again' || edge.label === 'resend';

    // Semantic class hint based on the condition / retry flag. Lets
    // theme overrides target yes/no/retry edges with CSS.
    const cond = (edge.condition ?? '').toLowerCase();
    const semanticClass =
      cond === 'no'  || cond === 'false'     ? 'fs-edge-no'
      : cond === 'yes' || cond === 'true'      ? 'fs-edge-yes'
      : isDashed                               ? 'fs-edge-retry'
      : '';

    // Theme color override for the path stroke when a semantic class
    // applies and the user hasn't set an explicit edge style.
    const semanticStroke =
      edge.style?.stroke ?? theme.edge.semanticStrokes?.[semanticClass] ?? theme.edge.stroke;

    const edgeGroup: (SvgElement | string)[] = [];

    // Path — pick a marker whose fill matches the chosen stroke so the
    // arrowhead colour stays in sync with the edge body. Custom per-edge
    // strokes still use the default marker (no per-stroke marker can be
    // synthesised at parse time); semantic classes get a dedicated marker.
    const markerId =
      edge.style?.stroke
        ? 'fs-arrow'
        : semanticClass === 'fs-edge-yes'   ? 'fs-arrow-yes'
        : semanticClass === 'fs-edge-no'    ? 'fs-arrow-no'
        : semanticClass === 'fs-edge-retry' ? 'fs-arrow-retry'
        : 'fs-arrow';
    edgeGroup.push(el('path', {
      d: route.pathData,
      fill: 'none',
      stroke: semanticStroke,
      'stroke-width': theme.edge.strokeWidth,
      'marker-end': `url(#${markerId})`,
      class: ['fs-edge-path', semanticClass].filter(Boolean).join(' '),
      ...(isDashed ? { 'stroke-dasharray': '6,3' } : {}),
    }));

    // Edge label
    const labelText = edge.label ?? edge.condition;
    if (labelText) {
      const lx = route.labelPosition.x;
      const ly = route.labelPosition.y;

      // Background rect for label readability
      const lblWidth = labelText.length * 7.5 + 12;
      edgeGroup.push(el('rect', {
        x: lx - lblWidth / 2, y: ly - 10,
        width: lblWidth, height: 20,
        rx: 4, fill: '#ffffff', stroke: 'none', opacity: 1,
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

  // Include lanes in bounds (they extend to the left with the header)
  for (const lane of doc.lanes) {
    if (lane.x === undefined || lane.y === undefined) continue;
    const lw = (lane.width ?? 260) / 2;
    const lh = (lane.height ?? 400) / 2;
    const headerW = 120; // matches theme.lane.headerWidth
    minX = Math.min(minX, lane.x - lw - headerW);
    minY = Math.min(minY, lane.y - lh);
    maxX = Math.max(maxX, lane.x + lw);
    maxY = Math.max(maxY, lane.y + lh);
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
