/**
 * Tests for the centralized shape port abstraction.
 *
 * Confirms:
 * - Rectangular fallback matches the previous router math exactly
 *   (so existing geometry doesn't shift).
 * - Circle ports lie on the rendered boundary (not the bounding box).
 * - Decision diamonds anchor at the tips, with the same 0.9 inset
 *   that the previous router used.
 */

import { describe, it, expect } from 'bun:test';
import {
  getPortForNodeShape,
  getPortForDirection,
  shapePort,
} from '../src/layout/shape-ports.js';
import type { FlowNode } from '../src/parser/ast.js';

function rect(width = 180, height = 44): FlowNode {
  return {
    id: 'n1', label: 'X', shape: 'process',
    x: 100, y: 50, width, height,
  };
}

function circle(width = 60, height = 60): FlowNode {
  return {
    id: 'n2', label: 'C', shape: 'circle',
    x: 100, y: 50, width, height,
  };
}

function decision(width = 160, height = 100): FlowNode {
  return {
    id: 'n3', label: 'D?', shape: 'decision',
    x: 100, y: 50, width, height,
  };
}

describe('shape ports — rectangular fallback', () => {
  it('returns the centerline cardinal points for a rect', () => {
    const r = rect();
    expect(getPortForNodeShape(r, 'N')).toEqual({ x: 100, y: 28 });
    expect(getPortForNodeShape(r, 'S')).toEqual({ x: 100, y: 72 });
    expect(getPortForNodeShape(r, 'E')).toEqual({ x: 190, y: 50 });
    expect(getPortForNodeShape(r, 'W')).toEqual({ x: 10,  y: 50 });
  });

  it('honors offset on the side parallel to the edge', () => {
    const r = rect();
    expect(getPortForNodeShape(r, 'N', 20)).toEqual({ x: 120, y: 28 });
    expect(getPortForNodeShape(r, 'S', -20)).toEqual({ x: 80, y: 72 });
    expect(getPortForNodeShape(r, 'E', 5)).toEqual({ x: 190, y: 55 });
  });

  it('shapePort is an alias for getPortForNodeShape', () => {
    const r = rect();
    expect(shapePort(r, 'E')).toEqual(getPortForNodeShape(r, 'E'));
  });

  it('falls back to rect math for shapes without a custom port impl', () => {
    // io is intentionally a fallback — confirm it matches a process rect.
    const io: FlowNode = { ...rect(), shape: 'io' };
    const proc = rect();
    expect(getPortForNodeShape(io, 'N')).toEqual(getPortForNodeShape(proc, 'N'));
    expect(getPortForNodeShape(io, 'E', 7)).toEqual(getPortForNodeShape(proc, 'E', 7));
  });
});

describe('shape ports — circle', () => {
  it('returns points on the rendered boundary, not the bounding box', () => {
    const c = circle(); // r = 30
    expect(getPortForNodeShape(c, 'N')).toEqual({ x: 100, y: 20 });
    expect(getPortForNodeShape(c, 'S')).toEqual({ x: 100, y: 80 });
    expect(getPortForNodeShape(c, 'E')).toEqual({ x: 130, y: 50 });
    expect(getPortForNodeShape(c, 'W')).toEqual({ x: 70,  y: 50 });
  });

  it('uses min(width,height)/2 as the radius (rendered as a circle)', () => {
    const c = circle(80, 40); // r = 20
    const port = getPortForNodeShape(c, 'N');
    expect(port.y).toBeCloseTo(50 - 20);
    expect(port.x).toBeCloseTo(100);
  });

  it('offset along a cardinal sweeps along the arc, staying on-curve', () => {
    const c = circle(); // r = 30
    const r = 30;
    const offset = 15;
    const port = getPortForNodeShape(c, 'N', offset);
    // Distance from center should still equal the radius.
    const dx = port.x - 100;
    const dy = port.y - 50;
    expect(Math.hypot(dx, dy)).toBeCloseTo(r, 5);
  });

  it('getPortForDirection lands on the circle for arbitrary vectors', () => {
    const c = circle();
    const port = getPortForDirection(c, 1, 1); // SE diagonal
    const dist = Math.hypot(port.x - 100, port.y - 50);
    expect(dist).toBeCloseTo(30, 5);
    expect(port.x).toBeGreaterThan(100);
    expect(port.y).toBeGreaterThan(50);
  });
});

describe('shape ports — decision (diamond)', () => {
  it('anchors at the tips, using the existing 0.9 horizontal factor', () => {
    const d = decision(); // hw=80, hh=50
    expect(getPortForNodeShape(d, 'N')).toEqual({ x: 100, y: 0 });
    expect(getPortForNodeShape(d, 'S')).toEqual({ x: 100, y: 100 });
    expect(getPortForNodeShape(d, 'E')).toEqual({ x: 100 + 80 * 0.9, y: 50 });
    expect(getPortForNodeShape(d, 'W')).toEqual({ x: 100 - 80 * 0.9, y: 50 });
  });

  it('ignores offset (decisions stack edges at the tip)', () => {
    const d = decision();
    expect(getPortForNodeShape(d, 'N', 25)).toEqual(getPortForNodeShape(d, 'N'));
    expect(getPortForNodeShape(d, 'E', 25)).toEqual(getPortForNodeShape(d, 'E'));
  });
});
