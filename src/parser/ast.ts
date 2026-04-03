/**
 * FlowScript AST type definitions.
 * These are pure data structures — no methods, no side effects.
 */

export type ShapeType =
  | 'start'
  | 'end'
  | 'decision'
  | 'process'
  | 'subprocess'
  | 'io'
  | 'data'
  | 'circle'
  | 'note'
  | 'manual'
  | 'delay';

export type Direction = 'TB' | 'BT' | 'LR' | 'RL';
export type RoutingStyle = 'orthogonal' | 'bezier' | 'polyline';
export type ConnectionMode = 'implicit' | 'explicit';

export interface StyleOverrides {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  text?: string;
  borderRadius?: number;
  border?: string; // 'dashed', 'dotted', 'solid'
}

export interface FlowNode {
  id: string;
  label: string;
  shape: ShapeType;
  style?: StyleOverrides;
  group?: string;
  /** Set by layout engine */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  condition?: string; // 'yes' | 'no' | custom
  style?: StyleOverrides;
  /** Set by edge router — waypoints for the path */
  points?: Array<{ x: number; y: number }>;
}

export interface FlowGroup {
  id: string;
  label: string;
  children: string[]; // node IDs
  style?: StyleOverrides;
  /** Set by layout engine */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface Directive {
  key: string;
  value: string;
}

export interface FlowDocument {
  meta: Record<string, string>;   // frontmatter
  directives: Directive[];
  nodes: Map<string, FlowNode>;
  edges: FlowEdge[];
  groups: FlowGroup[];
}

/**
 * Helper to get a directive value with a fallback.
 */
export function getDirective(doc: FlowDocument, key: string, fallback: string): string {
  const d = doc.directives.find(d => d.key === key);
  return d ? d.value : fallback;
}

/**
 * Get typed direction from directives.
 */
export function getDirection(doc: FlowDocument): Direction {
  const val = getDirective(doc, 'direction', 'TB').toUpperCase();
  if (val === 'TB' || val === 'BT' || val === 'LR' || val === 'RL') return val;
  return 'TB';
}

/**
 * Get routing style from directives.
 */
export function getRouting(doc: FlowDocument): RoutingStyle {
  const val = getDirective(doc, 'routing', 'orthogonal').toLowerCase();
  if (val === 'orthogonal' || val === 'bezier' || val === 'polyline') return val;
  return 'orthogonal';
}
