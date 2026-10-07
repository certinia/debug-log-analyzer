/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { describe, expect, it, jest } from '@jest/globals';
import { Container, type Mesh } from 'pixi.js';

import { readQuads } from '#test-helpers/mesh.js';
import { timelineEvent } from '#test-helpers/timeline.js';
import { makeViewport } from '#test-helpers/viewport.js';
import type { RenderBatch } from '../../../types/flamechart.types.js';
import type { PrecomputedRect } from '../../RectangleCache.js';
import { colorToGreyscale } from '../../rendering/ColorUtils.js';
import type { TextLabelRenderer } from '../../TextLabelRenderer.js';
import { MeshSearchStyleRenderer } from '../MeshSearchStyleRenderer.js';
import { SearchTextLabelRenderer } from '../SearchTextLabelRenderer.js';

type Category = RenderBatch['category'];

const APEX = 0x2d7ff9;
const SOQL = 0x4caf50;

const batches = new Map<string, RenderBatch>([
  ['Apex', { category: 'Apex', color: APEX, rectangles: [], isDirty: false }],
  ['SOQL', { category: 'SOQL', color: SOQL, rectangles: [], isDirty: false }],
]);

function rect(x: number, category: Category, width = 100): PrecomputedRect {
  return {
    id: `${category}-${x}`,
    timeStart: x,
    timeEnd: x + width,
    depth: 0,
    duration: width,
    selfDuration: width,
    category,
    eventRef: timelineEvent(x, width, category),
    x,
    y: 0,
    width,
    height: 15,
  };
}

const viewport = makeViewport();

describe('category dim', () => {
  it('keeps every frame of a lit category in colour and greys the rest', () => {
    const container = new Container();
    const renderer = new MeshSearchStyleRenderer(container, batches);
    const culled = new Map([
      ['Apex', [rect(0, 'Apex')]],
      ['SOQL', [rect(200, 'SOQL'), rect(400, 'SOQL')]],
    ]);

    renderer.render(culled, new Set(), new Map(), viewport, [], new Set(['SOQL']));

    const colors = readQuads(container.children[0] as Mesh).map((quad) => quad.color);
    expect(colors).toEqual([colorToGreyscale(APEX), SOQL, SOQL]);
  });

  it('keeps a matched frame in colour alongside a lit category', () => {
    const container = new Container();
    const renderer = new MeshSearchStyleRenderer(container, batches);
    const apex = rect(0, 'Apex');

    renderer.render(
      new Map([
        ['Apex', [apex]],
        ['SOQL', [rect(200, 'SOQL')]],
      ]),
      new Set([apex.id]),
      new Map(),
      viewport,
      [],
      new Set(['SOQL']),
    );

    expect(readQuads(container.children[0] as Mesh).map((quad) => quad.color)).toEqual([
      APEX,
      SOQL,
    ]);
  });

  it('hands every label of a lit category to the full-strength renderer', () => {
    const render = jest.fn();
    const labels = new SearchTextLabelRenderer(
      new Container(),
      { render } as unknown as TextLabelRenderer,
      batches,
    );
    const soql = [rect(200, 'SOQL'), rect(400, 'SOQL')];

    // One pixel wide, so the dimmed Apex label is skipped before any text is measured.
    labels.render(
      new Map([
        ['Apex', [rect(0, 'Apex', 1)]],
        ['SOQL', soql],
      ]),
      new Set(),
      viewport,
      new Set(['SOQL']),
    );

    expect(render).toHaveBeenCalledWith(new Map([['SOQL', soql]]), viewport);
  });
});
