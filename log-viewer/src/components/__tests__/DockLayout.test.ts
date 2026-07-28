/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it, beforeAll } from '@jest/globals';

// <detail-dock> pulls in vscode-elements icons, which need APIs jsdom lacks.
jest.mock('../DetailDock.js', () => ({}));

import type { DockLayout } from '../DockLayout.js';
import '../DockLayout.js';

const MIN_SIZE = 120;
const COLLAPSE_OVERSHOOT = 60;

beforeAll(() => {
  // jsdom has no pointer capture; the drag handler calls these unconditionally.
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  // jsdom performs no layout, so clientWidth/Height are 0 and the resize
  // handler's "don't grow past the viewport" clamp would pin every drag to the
  // minimum. Give the host a size so the drag maths is what's under test.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { value: 1200, configurable: true });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { value: 800, configurable: true });
});

async function mount(dock: 'left' | 'right' | 'bottom', size = 500): Promise<DockLayout> {
  const el = document.createElement('dock-layout') as DockLayout;
  el.dock = dock;
  el.size = size;
  el.visible = true;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function gutter(el: DockLayout): HTMLElement {
  const found = el.shadowRoot?.querySelector('.gutter');
  if (!found) {
    throw new Error('gutter not rendered');
  }
  return found as HTMLElement;
}

/** Drags the gutter from `from` to `to` along the axis the dock resizes on. */
async function drag(el: DockLayout, from: number, to: number): Promise<CustomEvent[]> {
  const events: CustomEvent[] = [];
  for (const type of ['dock-resize', 'dock-collapse']) {
    el.addEventListener(type, (e) => events.push(e as CustomEvent));
  }

  const handle = gutter(el);
  const axis = el.dock === 'bottom' ? 'clientY' : 'clientX';
  // jsdom has no PointerEvent; the handler only reads the coordinate and
  // pointerId, both of which a MouseEvent can carry.
  const pointer = (type: string, value: number) =>
    Object.assign(new MouseEvent(type, { [axis]: value, bubbles: true, cancelable: true }), {
      pointerId: 1,
    });

  handle.dispatchEvent(pointer('pointerdown', from));
  handle.dispatchEvent(pointer('pointermove', to));
  handle.dispatchEvent(pointer('pointerup', to));
  await el.updateComplete;
  return events;
}

describe('DockLayout resize', () => {
  it('grows when a right-docked panel is dragged left', async () => {
    const el = await mount('right', 500);
    const [event] = await drag(el, 800, 700);

    expect(event?.type).toBe('dock-resize');
    expect(event?.detail).toEqual({ size: 600 });
  });

  it('grows when a left-docked panel is dragged right — the sign flips per side', async () => {
    const el = await mount('left', 500);
    const [event] = await drag(el, 500, 600);

    expect(event?.type).toBe('dock-resize');
    expect(event?.detail).toEqual({ size: 600 });
  });

  it('resizes a bottom-docked panel on the vertical axis', async () => {
    const el = await mount('bottom', 300);
    const [event] = await drag(el, 700, 600);

    expect(event?.type).toBe('dock-resize');
    expect(event?.detail).toEqual({ size: 400 });
  });

  it('snaps to the minimum rather than going smaller', async () => {
    const el = await mount('right', 200);
    // Shrink by 100 from 200 — lands below MIN_SIZE but short of the overshoot.
    const [event] = await drag(el, 800, 900);

    expect(event?.type).toBe('dock-resize');
    expect(event?.detail).toEqual({ size: MIN_SIZE });
  });

  it('collapses instead of resizing once dragged past the overshoot', async () => {
    const el = await mount('right', 200);
    const past = 200 - (MIN_SIZE - COLLAPSE_OVERSHOOT) + 10;
    const [event] = await drag(el, 800, 800 + past);

    expect(event?.type).toBe('dock-collapse');
    expect(event?.detail).toBeNull();
  });

  it('reports nothing while the panel is hidden, since there is no handle', async () => {
    const el = await mount('right');
    el.visible = false;
    el.requestUpdate('visible', true);
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('.gutter')).toBeNull();
  });
});
