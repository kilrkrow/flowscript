/**
 * SVG shape renderers — one function per shape type.
 * Each returns a virtual SVG element positioned at (cx, cy) with given dimensions.
 * 
 * All shapes include:
 * - class="fs-node" data-node-id="..." (for animation readiness)
 * - The shape background
 * - Centered text label (with wrapping for long labels)
 */

import { el, type SvgElement } from '../svg-tree.js';
import type { Theme } from '../../themes/clean.js';
import type { FlowNode } from '../../parser/ast.js';

/**
 * Render a node as a virtual SVG element.
 */
export function renderNode(node: FlowNode, theme: Theme): SvgElement {
  const shapeStyle = theme.shapes[node.shape] ?? theme.shapes.process;
  const fill = node.style?.fill ?? shapeStyle.fill;
  const stroke = node.style?.stroke ?? shapeStyle.stroke;
  const textColor = node.style?.text ?? shapeStyle.textColor ?? theme.node.font.color;
  const cx = node.x ?? 0;
  const cy = node.y ?? 0;
  const w = node.width ?? 180;
  const h = node.height ?? 44;

  const shapeEl = renderShapeBackground(node.shape, cx, cy, w, h, fill, stroke, theme);
  const textEl = renderLabel(node.label, cx, cy, w, textColor, theme);

  return el('g', {
    class: 'fs-node',
    'data-node-id': node.id,
    'data-shape': node.shape,
  },
    ...(theme.node.shadow ? [wrapWithShadow(shapeEl)] : [shapeEl]),
    textEl,
  );
}

function renderShapeBackground(
  shape: string, cx: number, cy: number, w: number, h: number,
  fill: string, stroke: string, theme: Theme,
): SvgElement {
  const sw = theme.node.strokeWidth;
  const r = theme.node.borderRadius;

  switch (shape) {
    case 'start':
    case 'end':
      // Rounded pill / stadium shape
      return el('rect', {
        x: cx - w / 2, y: cy - h / 2, width: w, height: h,
        rx: h / 2, fill, stroke, 'stroke-width': sw,
      });

    case 'decision':
      // Diamond
      return el('polygon', {
        points: `${cx},${cy - h / 2} ${cx + w / 2},${cy} ${cx},${cy + h / 2} ${cx - w / 2},${cy}`,
        fill, stroke, 'stroke-width': sw,
      });

    case 'io':
      // Parallelogram
      {
        const skew = 15;
        const points = [
          `${cx - w / 2 + skew},${cy - h / 2}`,
          `${cx + w / 2 + skew},${cy - h / 2}`,
          `${cx + w / 2 - skew},${cy + h / 2}`,
          `${cx - w / 2 - skew},${cy + h / 2}`,
        ].join(' ');
        return el('polygon', { points, fill, stroke, 'stroke-width': sw });
      }

    case 'data':
      // Cylinder (simplified as rect with rounded top)
      return el('rect', {
        x: cx - w / 2, y: cy - h / 2, width: w, height: h,
        rx: 4, fill, stroke, 'stroke-width': sw,
      });

    case 'circle':
      {
        const radius = Math.min(w, h) / 2;
        return el('circle', {
          cx, cy, r: radius, fill, stroke, 'stroke-width': sw,
        });
      }

    case 'subprocess':
      // Double-bordered rectangle
      return el('g', {},
        el('rect', {
          x: cx - w / 2, y: cy - h / 2, width: w, height: h,
          rx: r, fill, stroke, 'stroke-width': sw,
        }),
        el('line', {
          x1: cx - w / 2 + 8, y1: cy - h / 2,
          x2: cx - w / 2 + 8, y2: cy + h / 2,
          stroke, 'stroke-width': 0.8,
        }),
        el('line', {
          x1: cx + w / 2 - 8, y1: cy - h / 2,
          x2: cx + w / 2 - 8, y2: cy + h / 2,
          stroke, 'stroke-width': 0.8,
        }),
      );

    case 'manual':
      // Trapezoid (wider at top)
      {
        const inset = 12;
        const points = [
          `${cx - w / 2},${cy - h / 2}`,
          `${cx + w / 2},${cy - h / 2}`,
          `${cx + w / 2 - inset},${cy + h / 2}`,
          `${cx - w / 2 + inset},${cy + h / 2}`,
        ].join(' ');
        return el('polygon', { points, fill, stroke, 'stroke-width': sw });
      }

    case 'delay':
      // Half-rounded rectangle (rounded on right side)
      {
        const x = cx - w / 2;
        const y = cy - h / 2;
        const rr = h / 2;
        const d = `M${x},${y} L${x + w - rr},${y} A${rr},${rr} 0 0 1 ${x + w - rr},${y + h} L${x},${y + h} Z`;
        return el('path', { d, fill, stroke, 'stroke-width': sw });
      }

    case 'note':
      // Sticky note with folded corner
      {
        const x = cx - w / 2;
        const y = cy - h / 2;
        const fold = 12;
        const d = `M${x},${y} L${x + w - fold},${y} L${x + w},${y + fold} L${x + w},${y + h} L${x},${y + h} Z`;
        return el('g', {},
          el('path', { d, fill, stroke, 'stroke-width': sw }),
          el('path', {
            d: `M${x + w - fold},${y} L${x + w - fold},${y + fold} L${x + w},${y + fold}`,
            fill: 'none', stroke, 'stroke-width': 0.8,
          }),
        );
      }

    case 'process':
    default:
      // Standard rounded rectangle
      return el('rect', {
        x: cx - w / 2, y: cy - h / 2, width: w, height: h,
        rx: r, fill, stroke, 'stroke-width': sw,
      });
  }
}

/**
 * Render a text label centered in a node.
 * Handles basic wrapping for long text using tspan elements.
 */
function renderLabel(label: string, cx: number, cy: number, maxWidth: number, color: string, theme: Theme): SvgElement {
  const font = theme.node.font;
  const charWidth = font.size * 0.58;
  const maxChars = Math.floor((maxWidth - 20) / charWidth);

  if (label.length <= maxChars) {
    return el('text', {
      x: cx, y: cy,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-family': font.family,
      'font-size': font.size,
      'font-weight': font.weight,
      fill: color,
      class: 'fs-label',
    }, label);
  }

  // Wrap text
  const words = label.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current && (current + ' ' + word).length > maxChars) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + ' ' + word : word;
    }
  }
  if (current) lines.push(current);

  const lineHeight = font.size * 1.3;
  const totalHeight = lines.length * lineHeight;
  const startY = cy - totalHeight / 2 + lineHeight / 2;

  const tspans = lines.map((line, i) =>
    el('tspan', {
      x: cx,
      dy: i === 0 ? 0 : lineHeight,
    }, line)
  );

  return el('text', {
    x: cx, y: startY,
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    'font-family': font.family,
    'font-size': font.size,
    'font-weight': font.weight,
    fill: color,
    class: 'fs-label',
  }, ...tspans);
}

function wrapWithShadow(child: SvgElement): SvgElement {
  // We'll apply the shadow via a filter reference
  return el('g', { filter: 'url(#fs-shadow)' }, child);
}
