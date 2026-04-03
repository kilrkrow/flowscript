/**
 * Virtual SVG Tree — the animation-ready decision.
 * 
 * A lightweight virtual node tree that can serialize to:
 * 1. Static SVG string (for file output)
 * 2. DOM-embedded HTML with data attributes (for interactive output)
 * 
 * Same tree, two serializers. ~100 lines, massive payoff.
 */

export interface SvgElement {
  tag: string;
  attrs: Record<string, string | number>;
  children: (SvgElement | string)[];
}

/** Create an SVG element node */
export function el(tag: string, attrs: Record<string, string | number> = {}, ...children: (SvgElement | string)[]): SvgElement {
  return { tag, attrs, children };
}

/** Create a text node */
export function text(content: string): string {
  return content;
}

/**
 * Serialize the virtual tree to an SVG string.
 * This is pure string output — no DOM needed.
 */
export function serializeToSVG(root: SvgElement, indent: number = 0): string {
  const pad = '  '.repeat(indent);
  const attrs = Object.entries(root.attrs)
    .map(([k, v]) => `${k}="${escapeAttr(String(v))}"`)
    .join(' ');

  const openTag = attrs ? `<${root.tag} ${attrs}` : `<${root.tag}`;

  if (root.children.length === 0) {
    return `${pad}${openTag}/>`;
  }

  // Check if only text children
  const allText = root.children.every(c => typeof c === 'string');
  if (allText) {
    const textContent = root.children.map(c => escapeXml(String(c))).join('');
    return `${pad}${openTag}>${textContent}</${root.tag}>`;
  }

  const childLines = root.children.map(child => {
    if (typeof child === 'string') {
      return `${'  '.repeat(indent + 1)}${escapeXml(child)}`;
    }
    return serializeToSVG(child, indent + 1);
  });

  return `${pad}${openTag}>\n${childLines.join('\n')}\n${pad}</${root.tag}>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
