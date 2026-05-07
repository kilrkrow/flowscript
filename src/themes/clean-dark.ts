/**
 * "Clean Dark" theme — dark-mode counterpart to the default clean theme.
 * Deep indigo backgrounds, muted borders, pastel accents.
 */

import type { Theme } from './clean.js';

export const cleanDarkTheme: Theme = {
  name: 'clean-dark',
  background: '#1a1a2e',
  node: {
    fill: '#252538',
    stroke: '#484870',
    strokeWidth: 1.2,
    borderRadius: 6,
    shadow: true,
    font: { family: "'Inter', system-ui, sans-serif", size: 13, color: '#e8e6ff', weight: 500 },
  },
  edge: {
    stroke: '#8080a8',
    strokeWidth: 1.5,
    arrowSize: 10,
    labelFont: { family: "'Inter', system-ui, sans-serif", size: 11, color: '#a0a0c8', weight: 500 },
    semanticStrokes: {
      'fs-edge-yes':   '#4caf50',
      'fs-edge-no':    '#ef5350',
      'fs-edge-retry': '#9c84e8',
    },
  },
  shapes: {
    start:      { fill: '#1b2e1b', stroke: '#4caf50',  textColor: '#7dd87d' },
    end:        { fill: '#1e2428', stroke: '#78909c',  textColor: '#b0bec5' },
    decision:   { fill: '#2b2410', stroke: '#c49b2b',  textColor: '#f4d76a' },
    process:    { fill: '#252538', stroke: '#484870',  textColor: '#e8e6ff' },
    subprocess: { fill: '#2a2a42', stroke: '#6666a0' },
    io:         { fill: '#102030', stroke: '#42a5f5',  textColor: '#90caf9' },
    data:       { fill: '#18183a', stroke: '#5c6bc0',  textColor: '#9fa8da' },
    circle:     { fill: '#28102e', stroke: '#ab47bc',  textColor: '#ce93d8' },
    note:       { fill: '#2a2600', stroke: '#fdd835',  textColor: '#fff176' },
    manual:     { fill: '#2c1515', stroke: '#ef5350',  textColor: '#ef9a9a' },
    delay:      { fill: '#26103a', stroke: '#9c27b0',  textColor: '#ce93d8' },
  },
  group: {
    fills:       ['#1a2040', '#142216', '#1e1432', '#2c2410'],
    strokes:     ['#3060a0', '#306040', '#6040a0', '#908020'],
    headerFills: ['#1e2850', '#182a1a', '#22183a', '#342c12'],
    labelFont: { family: "'Inter', system-ui, sans-serif", size: 12, color: '#7eb3f0', weight: 700 },
  },
  lane: {
    fills:       ['#1a1e24', '#241e14', '#162216', '#1e1430', '#24161a'],
    strokes:     ['#3a4a60', '#5c4820', '#285040', '#3a2060', '#5c2030'],
    headerFills: ['#1e2530', '#2e2212', '#182a16', '#221630', '#2a181e'],
    headerWidth: 120,
    dividerStroke: '#3a3a50',
    dividerDash: '4,3',
    labelFont: { family: "'Inter', system-ui, sans-serif", size: 12, color: '#a0b0c0', weight: 700 },
  },
};
