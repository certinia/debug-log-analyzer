/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { beforeAll, describe, expect, it } from '@jest/globals';
import { html } from 'lit';

jest.mock('#vscode-elements/vscode-icon.js', () => ({}));
jest.mock('#vscode-elements/vscode-badge.js', () => ({}));

import type { PaneOrientation, PaneSection, PaneView } from '../PaneView.js';
import '../PaneView.js';

const sections: PaneSection[] = [
  { id: 'a', title: 'A', content: html`<div class="content-a">A body</div>` },
  { id: 'b', title: 'B', content: html`<div class="content-b">B body</div>` },
  { id: 'c', title: 'C', content: html`<div class="content-c">C body</div>` },
];

/**
 * Collapse is controlled: the consumer owns the record and feeds it back. Mount
 * with that loop wired, the way the inspector does.
 */
async function mount(orientation: PaneOrientation): Promise<PaneView> {
  const el = document.createElement('pane-view') as PaneView;
  el.sections = sections;
  el.orientation = orientation;
  el.addEventListener('pane-toggle', (e) => {
    el.collapsed = (e as CustomEvent<{ collapsed: Record<string, boolean> }>).detail.collapsed;
  });
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function header(el: PaneView, id: string): HTMLElement | null {
  return el.shadowRoot?.querySelector(`.pane[data-id="${id}"] .pane-header`) ?? null;
}

function body(el: PaneView, id: string): HTMLElement | null {
  return el.shadowRoot?.querySelector(`.pane[data-id="${id}"] .pane-body`) ?? null;
}

function sash(el: PaneView): HTMLElement {
  const found = el.shadowRoot?.querySelector('.pane-sash');
  if (!found) {
    throw new Error('sash not rendered');
  }
  return found as HTMLElement;
}

function paneStyle(el: PaneView, id: string): string {
  return el.shadowRoot?.querySelector(`.pane[data-id="${id}"]`)?.getAttribute('style') ?? '';
}

// jsdom has no PointerEvent; the handlers only read the coordinate and pointerId.
function pointer(type: string, clientY: number): Event {
  return Object.assign(new MouseEvent(type, { clientY, bubbles: true, cancelable: true }), {
    pointerId: 1,
  });
}

describe('PaneView', () => {
  beforeAll(() => {
    expect(customElements.get('pane-view')).toBeDefined();
    // jsdom has no pointer capture, and performs no layout — the sash handler
    // calls the first and measures with the second.
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.hasPointerCapture = () => true;
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      value: 100,
      configurable: true,
    });
  });

  it('renders a header per section with a twistie when vertical', async () => {
    const el = await mount('vertical');
    expect(el.shadowRoot?.querySelectorAll('.pane').length).toBe(3);
    expect(el.shadowRoot?.querySelectorAll('.pane-header vscode-icon').length).toBe(3);
    // All open by default → a body each.
    expect(body(el, 'a')).not.toBeNull();
    expect(body(el, 'b')).not.toBeNull();
    expect(body(el, 'c')).not.toBeNull();
  });

  it('renders a sash between each pair of open sections (2 for 3 open)', async () => {
    const el = await mount('vertical');
    expect(el.shadowRoot?.querySelectorAll('.pane-sash').length).toBe(2);
  });

  it('collapses a section on header click, removing its body and its sashes', async () => {
    const el = await mount('vertical');
    header(el, 'b')?.click();
    await el.updateComplete;

    expect(body(el, 'b')).toBeNull();
    // b collapsed splits the chain, so a↔b and b↔c sashes both disappear.
    expect(el.shadowRoot?.querySelectorAll('.pane-sash').length).toBe(0);
    // End sections stay open.
    expect(body(el, 'a')).not.toBeNull();
    expect(body(el, 'c')).not.toBeNull();
  });

  it('toggles with the keyboard (Enter)', async () => {
    const el = await mount('vertical');
    const h = header(el, 'a');
    h?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await el.updateComplete;
    expect(body(el, 'a')).toBeNull();
  });

  it('does not collapse in horizontal mode and keeps all panes open', async () => {
    const el = await mount('horizontal');
    // No twistie, headers are not buttons.
    expect(el.shadowRoot?.querySelectorAll('.pane-header vscode-icon').length).toBe(0);
    expect(el.shadowRoot?.querySelector('.pane-header--button')).toBeNull();

    header(el, 'b')?.click();
    await el.updateComplete;
    expect(body(el, 'b')).not.toBeNull();
    // All three open → two sashes between neighbours.
    expect(el.shadowRoot?.querySelectorAll('.pane-sash').length).toBe(2);
  });

  it('emits pane-toggle with the collapsed map and keeps state across same-id updates', async () => {
    const el = await mount('vertical');
    let last: Record<string, boolean> | undefined;
    el.addEventListener('pane-toggle', (e) => {
      last = (e as CustomEvent<{ collapsed: Record<string, boolean> }>).detail.collapsed;
    });

    header(el, 'a')?.click();
    await el.updateComplete;
    expect(last?.a).toBe(true);
    expect(body(el, 'a')).toBeNull();

    // A new selection re-supplies the same section ids — the consumer still owns
    // the collapse record, so the user's collapse survives.
    el.sections = sections.map((s) => ({ ...s }));
    await el.updateComplete;
    expect(body(el, 'a')).toBeNull();
  });

  it('takes collapse from the collapsed property', async () => {
    const el = document.createElement('pane-view') as PaneView;
    el.orientation = 'vertical';
    el.sections = sections;
    el.collapsed = { b: true };
    document.body.appendChild(el);
    await el.updateComplete;
    expect(body(el, 'a')).not.toBeNull();
    expect(body(el, 'b')).toBeNull();
  });

  it('does not collapse when the consumer ignores pane-toggle (fully controlled)', async () => {
    const el = document.createElement('pane-view') as PaneView;
    el.orientation = 'vertical';
    el.sections = sections;
    document.body.appendChild(el);
    await el.updateComplete;

    header(el, 'a')?.click();
    await el.updateComplete;
    expect(body(el, 'a')).not.toBeNull();
  });

  it('emits pane-resize on a sash drag, the pair sharing their combined size', async () => {
    const el = await mount('vertical');
    let sizes: Record<string, number> | undefined;
    el.addEventListener('pane-resize', (e) => {
      sizes = (e as CustomEvent<{ sizes: Record<string, number> }>).detail.sizes;
    });

    const handle = sash(el);
    handle.dispatchEvent(pointer('pointerdown', 100));
    handle.dispatchEvent(pointer('pointermove', 120));
    handle.dispatchEvent(pointer('pointerup', 120));
    await el.updateComplete;

    // Keyed by axis: a height dragged here is not a width in the bottom dock.
    expect(sizes?.['vertical:a']).toBe(120);
    expect(sizes?.['vertical:b']).toBe(80);
  });

  it('does not emit pane-resize for a sash click that never moved', async () => {
    const el = await mount('vertical');
    let emitted = 0;
    el.addEventListener('pane-resize', () => emitted++);

    const handle = sash(el);
    handle.dispatchEvent(pointer('pointerdown', 100));
    handle.dispatchEvent(pointer('pointerup', 100));
    await el.updateComplete;

    expect(emitted).toBe(0);
  });

  it('does not emit pane-resize when the drag is cancelled, and restores the sizes', async () => {
    const el = await mount('vertical');
    let emitted = 0;
    el.addEventListener('pane-resize', () => emitted++);

    const handle = sash(el);
    handle.dispatchEvent(pointer('pointerdown', 100));
    handle.dispatchEvent(pointer('pointermove', 120));
    handle.dispatchEvent(pointer('pointercancel', 120));
    await el.updateComplete;

    expect(emitted).toBe(0);
    // Back to the measured 100/100, so a-and-b weigh the same again.
    const style = (id: string) =>
      el.shadowRoot?.querySelector(`.pane[data-id="${id}"]`)?.getAttribute('style');
    expect(style('a')).toBe(style('b'));

    // The gesture is over: a stray move can no longer resize.
    handle.dispatchEvent(pointer('pointermove', 200));
    await el.updateComplete;
    expect(style('a')).toBe(style('b'));
  });

  it('keeps the persisted ratio when every open pane has a size', async () => {
    const el = document.createElement('pane-view') as PaneView;
    el.orientation = 'vertical';
    el.sections = [
      { id: 'a', title: 'A', content: html`<div>A</div>` },
      { id: 'b', title: 'B', content: html`<div>B</div>` },
    ];
    el.paneSizes = { 'vertical:a': 300, 'vertical:b': 100 };
    document.body.appendChild(el);
    await el.updateComplete;

    // 2 units over 400px → 3:1, the dragged ratio.
    const pane = (id: string) => el.shadowRoot?.querySelector(`.pane[data-id="${id}"]`);
    expect(pane('a')?.getAttribute('style')).toContain('flex: 1.5 1 0');
    expect(pane('b')?.getAttribute('style')).toContain('flex: 0.5 1 0');
  });

  it('rescales persisted pane sizes onto the weight scale of a pane without one', async () => {
    const el = document.createElement('pane-view') as PaneView;
    el.orientation = 'vertical';
    el.sections = [
      { id: 'a', title: 'A', content: html`<div>A</div>`, weight: 3 },
      { id: 'b', title: 'B', content: html`<div>B</div>` },
    ];
    // Only a was on screen when the drag happened; b must not become a sliver.
    el.paneSizes = { 'vertical:a': 120 };
    document.body.appendChild(el);
    await el.updateComplete;

    const pane = (id: string) => el.shadowRoot?.querySelector(`.pane[data-id="${id}"]`);
    expect(pane('a')?.getAttribute('style')).toContain('flex: 3 1 0');
    expect(pane('b')?.getAttribute('style')).toContain('flex: 1 1 0');
  });

  it('ignores sizes dragged on the other axis, and re-seeds when re-docked', async () => {
    const el = document.createElement('pane-view') as PaneView;
    el.orientation = 'vertical';
    el.sections = [
      { id: 'a', title: 'A', content: html`<div>A</div>` },
      { id: 'b', title: 'B', content: html`<div>B</div>` },
    ];
    // Widths from the bottom dock; replaying them as heights is a layout the
    // user never chose, so the vertical dock falls back to even weights.
    el.paneSizes = { 'horizontal:a': 300, 'horizontal:b': 100 };
    document.body.appendChild(el);
    await el.updateComplete;

    const pane = (id: string) => el.shadowRoot?.querySelector(`.pane[data-id="${id}"]`);
    expect(pane('a')?.getAttribute('style')).toContain('flex: 1 1 0');
    expect(pane('b')?.getAttribute('style')).toContain('flex: 1 1 0');

    // Re-docking flips orientation on the same element: its own sizes apply now.
    el.orientation = 'horizontal';
    await el.updateComplete;
    expect(pane('a')?.getAttribute('style')).toContain('flex: 1.5 1 0');
    expect(pane('b')?.getAttribute('style')).toContain('flex: 0.5 1 0');
  });

  it('sizes a content pane to its content, shrinkable, and never stretches it', async () => {
    const el = document.createElement('pane-view') as PaneView;
    el.orientation = 'vertical';
    el.sections = [
      { id: 'a', title: 'A', content: html`<div>A</div>`, fit: 'content' },
      { id: 'b', title: 'B', content: html`<div>B</div>` },
    ];
    document.body.appendChild(el);
    await el.updateComplete;

    const pane = (id: string) => el.shadowRoot?.querySelector(`.pane[data-id="${id}"]`);
    expect(pane('a')?.getAttribute('style')).toContain('flex: 0 1 auto');
    expect(pane('b')?.getAttribute('style')).toContain('flex: 1 1 calc(100% / 2)');
  });

  it('renders a sash beside a content pane too', async () => {
    const el = document.createElement('pane-view') as PaneView;
    el.orientation = 'vertical';
    el.sections = [
      { id: 'a', title: 'A', content: html`<div>A</div>`, fit: 'content' },
      { id: 'b', title: 'B', content: html`<div>B</div>` },
      { id: 'c', title: 'C', content: html`<div>C</div>` },
    ];
    document.body.appendChild(el);
    await el.updateComplete;

    // a↔b and b↔c: a content pane holds the size it is dragged to.
    expect(el.shadowRoot?.querySelectorAll('.pane-sash').length).toBe(2);
  });

  it('pins a content pane to its dragged size, and keeps it out of the fill scale', async () => {
    const el = document.createElement('pane-view') as PaneView;
    el.orientation = 'vertical';
    el.sections = [
      { id: 'a', title: 'A', content: html`<div>A</div>`, fit: 'content' },
      { id: 'b', title: 'B', content: html`<div>B</div>` },
      { id: 'c', title: 'C', content: html`<div>C</div>` },
    ];
    el.paneSizes = { 'vertical:a': 500, 'vertical:b': 300, 'vertical:c': 100 };
    document.body.appendChild(el);
    await el.updateComplete;

    const pane = (id: string) => el.shadowRoot?.querySelector(`.pane[data-id="${id}"]`);
    // A basis, not a weight: it never stretches, and it still shrinks to scroll.
    expect(pane('a')?.getAttribute('style')).toContain('flex: 0 1 500px');
    // The content pane's size is no part of the fill panes' weights.
    expect(pane('b')?.getAttribute('style')).toContain('flex: 1.5 1 calc(100% / 3)');
    expect(pane('c')?.getAttribute('style')).toContain('flex: 0.5 1 calc(100% / 3)');
  });

  it('hands a content pane back to its content on a double-click', async () => {
    const el = document.createElement('pane-view') as PaneView;
    el.orientation = 'vertical';
    el.sections = [
      { id: 'a', title: 'A', content: html`<div>A</div>`, fit: 'content' },
      { id: 'b', title: 'B', content: html`<div>B</div>` },
    ];
    el.paneSizes = { 'vertical:a': 500 };
    document.body.appendChild(el);
    await el.updateComplete;

    let detail: { sizes: Record<string, number>; orientation: string } | undefined;
    el.addEventListener('pane-resize', (e) => {
      detail = (e as CustomEvent<{ sizes: Record<string, number>; orientation: string }>).detail;
    });
    sash(el).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await el.updateComplete;

    const pane = (id: string) => el.shadowRoot?.querySelector(`.pane[data-id="${id}"]`);
    expect(pane('a')?.getAttribute('style')).toContain('flex: 0 1 auto');
    // The size is gone rather than zeroed, so the consumer replaces the axis.
    expect(detail?.sizes['vertical:a']).toBeUndefined();
    expect(detail?.orientation).toBe('vertical');
  });

  describe('fill pane share', () => {
    const mixed: PaneSection[] = [
      { id: 'a', title: 'A', content: html`<div>A</div>`, fit: 'content' },
      { id: 'b', title: 'B', content: html`<div>B</div>`, fit: 'content' },
      { id: 'c', title: 'C', content: html`<div>C</div>` },
    ];

    async function mountMixed(
      orientation: PaneOrientation,
      props: Partial<PaneView> = {},
    ): Promise<PaneView> {
      const el = document.createElement('pane-view') as PaneView;
      Object.assign(el, { orientation, sections: mixed }, props);
      document.body.appendChild(el);
      await el.updateComplete;
      return el;
    }

    it('gives the fill pane a share to shrink from, and leaves the content panes alone', async () => {
      const el = await mountMixed('vertical');

      // Three open panes, so the fill pane starts from a third and grows.
      expect(paneStyle(el, 'c')).toContain('flex: 1 1 calc(100% / 3)');
      expect(paneStyle(el, 'a')).toContain('flex: 0 1 auto');
      expect(paneStyle(el, 'b')).toContain('flex: 0 1 auto');
    });

    it('widens the share as sections collapse', async () => {
      const el = await mountMixed('vertical', { collapsed: { b: true } });

      expect(paneStyle(el, 'c')).toContain('flex: 1 1 calc(100% / 2)');
    });

    it('shares by weight alone once no content pane is open', async () => {
      const el = await mountMixed('vertical', { collapsed: { a: true, b: true } });

      // One section read on its own gets the whole panel either way, and with
      // several fill panes a share each would flatten their weights.
      expect(paneStyle(el, 'c')).toContain('flex: 1 1 0');
    });

    it('leaves a dragged content pane at the size it was given', async () => {
      const el = await mountMixed('vertical', { paneSizes: { 'vertical:a': 500 } });

      expect(paneStyle(el, 'a')).toContain('flex: 0 1 500px');
      expect(paneStyle(el, 'c')).toContain('flex: 1 1 calc(100% / 3)');
    });

    it('shares nothing side by side, where the axis is the width', async () => {
      const el = await mountMixed('horizontal');

      expect(paneStyle(el, 'c')).toContain('flex: 1 1 0');
    });
  });
});
