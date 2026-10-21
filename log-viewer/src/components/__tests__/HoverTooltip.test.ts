/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import type { HoverTooltip } from '../HoverTooltip.js';
import '../HoverTooltip.js';

const rect = (left: number, top: number, width = 20, height = 20) =>
  ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;

describe('hover-tooltip', () => {
  let tip: HoverTooltip;

  beforeEach(() => {
    // jsdom has no popover API and lays nothing out.
    HTMLElement.prototype.showPopover = () => {};
    HTMLElement.prototype.hidePopover = () => {};
    Object.assign(window, { innerWidth: 1000, innerHeight: 600 });
    tip = document.createElement('hover-tooltip');
    document.body.append(tip);
    tip.getBoundingClientRect = () => rect(0, 0, 100, 30);
  });

  const place = () => [tip.style.left, tip.style.top];

  it('shows the text, centred below the element', () => {
    tip.show(rect(400, 100), 'Reset levels');

    expect(tip.open).toBe(true);
    expect(tip.textContent).toBe('Reset levels');
    expect(place()).toEqual(['360px', '124px']);
  });

  it('shows above the element when there is no room below', () => {
    tip.show(rect(400, 560), 'Reset levels');

    expect(place()).toEqual(['360px', '526px']);
  });

  it.each([
    ['left', rect(0, 100), '8px'],
    ['right', rect(980, 100), '892px'],
  ])('stays inside the window at the %s edge', (_, anchor, left) => {
    tip.show(anchor, 'Reset levels');

    expect(place()[0]).toBe(left);
  });

  it('measures at the window origin, not where the last tooltip was', () => {
    const measuredAt: string[] = [];
    tip.getBoundingClientRect = () => {
      measuredAt.push(tip.style.left);
      return rect(0, 0, 100, 30);
    };
    tip.show(rect(980, 100), 'First');

    tip.show(rect(400, 100), 'Second');

    expect(measuredAt).toEqual(['0px', '0px']);
  });

  it('hides', () => {
    tip.show(rect(400, 100), 'Reset levels');

    tip.hide();

    expect(tip.open).toBe(false);
  });
});
