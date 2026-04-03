/**
 * "Clean" theme — the default. White backgrounds, crisp borders, colored shape accents.
 * Designed to match the visual quality target from the mockups.
 */

export interface Theme {
  name: string;
  background: string;
  node: {
    fill: string;
    stroke: string;
    strokeWidth: number;
    borderRadius: number;
    shadow: boolean;
    font: { family: string; size: number; color: string; weight: number };
  };
  edge: {
    stroke: string;
    strokeWidth: number;
    arrowSize: number;
    labelFont: { family: string; size: number; color: string; weight: number };
  };
  shapes: Record<string, { fill: string; stroke: string; textColor?: string }>;
  group: {
    fills: string[];
    strokes: string[];
    headerFills: string[];
    labelFont: { family: string; size: number; color: string; weight: number };
  };
}

export const cleanTheme: Theme = {
  name: 'clean',
  background: '#ffffff',
  node: {
    fill: '#ffffff',
    stroke: '#d0d0d6',
    strokeWidth: 1.2,
    borderRadius: 6,
    shadow: true,
    font: { family: "'Inter', system-ui, sans-serif", size: 13, color: '#28251D', weight: 500 },
  },
  edge: {
    stroke: '#5a5a62',
    strokeWidth: 1.5,
    arrowSize: 10,
    labelFont: { family: "'Inter', system-ui, sans-serif", size: 11, color: '#6a6a72', weight: 500 },
  },
  shapes: {
    start:    { fill: '#d4edda', stroke: '#4caf50', textColor: '#2e7d32' },
    end:      { fill: '#eceff1', stroke: '#78909c', textColor: '#37474f' },
    decision: { fill: '#fff8e1', stroke: '#f9a825', textColor: '#e65100' },
    process:  { fill: '#ffffff', stroke: '#d0d0d6' },
    subprocess: { fill: '#f5f5f5', stroke: '#9e9e9e' },
    io:       { fill: '#e3f2fd', stroke: '#42a5f5', textColor: '#1565c0' },
    data:     { fill: '#e8eaf6', stroke: '#5c6bc0', textColor: '#283593' },
    circle:   { fill: '#f3e5f5', stroke: '#ab47bc', textColor: '#6a1b9a' },
    note:     { fill: '#fffde7', stroke: '#fdd835', textColor: '#f57f17' },
    manual:   { fill: '#fce4ec', stroke: '#ef5350', textColor: '#c62828' },
    delay:    { fill: '#f3e5f5', stroke: '#9c27b0', textColor: '#6a1b9a' },
  },
  group: {
    fills:       ['#eff6ff', '#f0fdf4', '#faf5ff', '#fef3c7'],
    strokes:     ['#93c5fd', '#86efac', '#c4b5fd', '#fcd34d'],
    headerFills: ['#dbeafe', '#dcfce7', '#ede9fe', '#fef08a'],
    labelFont: { family: "'Inter', system-ui, sans-serif", size: 12, color: '#1e40af', weight: 700 },
  },
};
