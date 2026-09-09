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
async function mountSections(
  paneSections: PaneSection[],
  props: Partial<PaneView> = {},
): Promise<PaneView> {
  const el = document.createElement('pane-view') as PaneView;
  Object.assign(el, { orientation: 'vertical', sections: paneSections }, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

/** With the collapse loop wired, the way the inspector owns the record. */
async function mount(orientation: PaneOrientation): Promise<PaneView> {
  const el = await mountSections(sections, { orientation });
  el.addEventListener('pane-toggle', (e) => {
    el.collapsed = (e as CustomEvent<{ collapsed: Record<string, boolean> }>).detail.collapsed;
  });
  return el;
}

function pane(el: PaneView, id: string): HTMLElement | null {
  return el.shadowRoot?.querySelector<HTMLElement>(`.pane[data-id="${id}"]`) ?? null;
}

function paneIds(el: PaneView): string[] {
  return [...(el.shadowRoot?.querySelectorAll<HTMLElement>('.pane') ?? [])].map(
    (found) => found.dataset.id ?? '',
  );
}

function body(el: PaneView, id: string): HTMLElement | null {
  return el.shadowRoot?.querySelector(`.pane[data-id="${id}"] .pane-body`) ?? null;
}

function sash(el: PaneView, index = 0): HTMLElement {
  const found = el.shadowRoot?.querySelectorAll('.pane-sash')[index];
  if (!found) {
    throw new Error('sash not rendered');
  }
  return found as HTMLElement;
}

/**
 * What the pane hands the stylesheet: the rule it selects, then its weight and
 * the size it was dragged to. The flex itself is in CSS, which jsdom does not
 * compute.
 */
function sizing(el: PaneView, id: string): string {
  const found = pane(el, id);
  if (!found) {
    throw new Error(`no pane for ${id}`);
  }
  if (!found.hasAttribute('data-open')) {
    return 'closed';
  }
  const parts = [found.getAttribute('data-tier') ?? found.getAttribute('data-sizing') ?? ''];
  for (const name of ['--pane-grow', '--pane-size']) {
    const value = found.style.getPropertyValue(name);
    if (value) {
      parts.push(value);
    }
  }
  return parts.join(' ');
}

/** The share the fill panes resolve from, or null while they resolve from zero. */
function share(el: PaneView): string | null {
  const view = stack(el);
  return view.hasAttribute('data-content') ? view.style.getPropertyValue('--pane-count') : null;
}

// jsdom has no PointerEvent; the handlers only read the coordinate and pointerId.
function pointer(type: string, clientY: number): Event {
  return Object.assign(new MouseEvent(type, { clientY, bubbles: true, cancelable: true }), {
    pointerId: 1,
  });
}

function headerOf(el: PaneView, id: string): HTMLElement {
  const found = el.shadowRoot?.querySelector<HTMLElement>(`.pane[data-id="${id}"] .pane-header`);
  if (!found) {
    throw new Error(`no header for ${id}`);
  }
  return found;
}

// jsdom has no DragEvent; the handlers only read the coordinate, and treat a
// missing dataTransfer as nothing to carry.
function dragEvent(type: string, clientY = 0): Event {
  return new MouseEvent(type, { clientY, bubbles: true, cancelable: true });
}

/** The headers are 20px tall here: above 10 drops before, below it drops after. */
function stack(el: PaneView): HTMLElement {
  const found = el.shadowRoot?.querySelector<HTMLElement>('.pane-view');
  if (!found) {
    throw new Error('stack not rendered');
  }
  return found;
}

/** The whole stack takes the drop, so only where the pointer is decides. */
async function dragSection(el: PaneView, fromId: string, clientY: number): Promise<void> {
  headerOf(el, fromId).dispatchEvent(dragEvent('dragstart'));
  stack(el).dispatchEvent(dragEvent('dragover', clientY));
  await el.updateComplete;
  stack(el).dispatchEvent(dragEvent('drop', clientY));
  await el.updateComplete;
}

function reorders(el: PaneView): string[][] {
  const seen: string[][] = [];
  el.addEventListener('pane-reorder', (e) => {
    seen.push((e as CustomEvent<{ ids: string[] }>).detail.ids);
  });
  return seen;
}

/** Every pane measures 100px in jsdom, so a +20 drag makes the pair 120/80. */
async function drag(el: PaneView, handle: HTMLElement, to = 120): Promise<void> {
  handle.dispatchEvent(pointer('pointerdown', 100));
  handle.dispatchEvent(pointer('pointermove', to));
  handle.dispatchEvent(pointer('pointerup', to));
  await el.updateComplete;
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
    // jsdom performs no layout either, so the panes need boxes before a drop
    // coordinate can name one. Stacked 100 tall, matching `offsetHeight`: `a`
    // is 0-100, `b` 100-200, `c` 200-300.
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const isPane = this.classList.contains('pane');
      const top = isPane
        ? [...(this.parentElement?.querySelectorAll('.pane') ?? [])].indexOf(this) * 100
        : 0;
      const height = isPane ? 100 : 20;
      return {
        top,
        left: 0,
        width: 200,
        height,
        bottom: top + height,
        right: 200,
        x: 0,
        y: top,
      } as unknown as DOMRect;
    };
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
    headerOf(el, 'b').click();
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
    const h = headerOf(el, 'a');
    h.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await el.updateComplete;
    expect(body(el, 'a')).toBeNull();
  });

  it('ignores a held Enter, so the pane does not flap', async () => {
    const el = await mount('vertical');
    const h = headerOf(el, 'a');
    let toggles = 0;
    el.addEventListener('pane-toggle', () => toggles++);

    h.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    h.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, repeat: true }));
    h.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, repeat: true }));
    await el.updateComplete;

    expect(toggles).toBe(1);
    expect(body(el, 'a')).toBeNull();
  });

  it('keeps a repeated Space from scrolling the stack', async () => {
    const el = await mount('vertical');
    const event = new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
      repeat: true,
    });
    headerOf(el, 'a').dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('does not collapse in horizontal mode and keeps all panes open', async () => {
    const el = await mount('horizontal');
    // No twistie, headers are not buttons.
    expect(el.shadowRoot?.querySelectorAll('.pane-header vscode-icon').length).toBe(0);
    expect(el.shadowRoot?.querySelector('.pane-header--button')).toBeNull();

    headerOf(el, 'b').click();
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

    headerOf(el, 'a').click();
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
    const el = await mountSections(sections);
    el.collapsed = { b: true };
    await el.updateComplete;
    expect(body(el, 'a')).not.toBeNull();
    expect(body(el, 'b')).toBeNull();
  });

  it('does not collapse when the consumer ignores pane-toggle (fully controlled)', async () => {
    const el = await mountSections(sections);

    headerOf(el, 'a').click();
    await el.updateComplete;
    expect(body(el, 'a')).not.toBeNull();
  });

  it('shares the pair their combined size on a sash drag', async () => {
    const el = await mount('vertical');
    await drag(el, sash(el));

    // The dragged size is the basis, so the pane is that size however tight the
    // panel gets; the weight rescaled onto the unit scale shares any free space.
    expect(sizing(el, 'a')).toBe('fill 1.2 120px');
    expect(sizing(el, 'b')).toBe('fill 0.8 80px');
  });

  it('holds every pane at its measured size, through the drag and after it', async () => {
    const el = await mountSections([
      { id: 'a', title: 'A', content: html`<div>A</div>`, fit: 'content' },
      { id: 'b', title: 'B', content: html`<div>B</div>` },
      { id: 'c', title: 'C', content: html`<div>C</div>` },
    ]);

    // Mid-gesture, with `a` nowhere near the b-c sash the drag names.
    const handle = sash(el, 1);
    handle.dispatchEvent(pointer('pointerdown', 100));
    handle.dispatchEvent(pointer('pointermove', 120));
    await el.updateComplete;

    // Its basis is its measured size, not its content: the bases add up to the
    // panel, so flexbox shrinks nothing and the boundary tracks the pointer.
    expect(sizing(el, 'a')).toBe('content 100px');

    handle.dispatchEvent(pointer('pointerup', 120));
    await el.updateComplete;

    // And keeps it: handing a pane back to sizing itself frees the room it holds
    // to the panes the drag sized, which shrinks a section nobody dragged.
    expect(sizing(el, 'a')).toBe('content 100px');
  });

  it('leaves the panes away from the sash at the size they had', async () => {
    const el = await mountSections([
      { id: 'a', title: 'A', content: html`<div>A</div>`, fit: 'content' },
      { id: 'b', title: 'B', content: html`<div>B</div>` },
      { id: 'c', title: 'C', content: html`<div>C</div>` },
    ]);

    // The b-c sash, so the drag never names the content pane above it.
    await drag(el, sash(el, 1));

    expect(sizing(el, 'a')).toBe('content 100px');
    expect(sizing(el, 'b')).toBe('fill 1.2 120px');
    expect(sizing(el, 'c')).toBe('fill 0.8 80px');
  });

  it('rescales the dragged sizes onto the unit scale the weights use', async () => {
    const el = await mountSections([
      { id: 'a', title: 'A', content: html`<div>A</div>`, weight: 3 },
      { id: 'b', title: 'B', content: html`<div>B</div>` },
      { id: 'c', title: 'C', content: html`<div>C</div>` },
    ]);

    await drag(el, sash(el, 1));

    // Every open pane holds a size, so the sizes decide how free space splits;
    // the weights are the scale those sizes land on.
    expect(sizing(el, 'a')).toBe('fill 1.6666666666666667 100px');
    expect(sizing(el, 'b')).toBe('fill 2 120px');
    expect(sizing(el, 'c')).toBe('fill 1.3333333333333333 80px');
  });

  it('leaves no size behind for a drag that ends where it began', async () => {
    const el = await mount('vertical');
    const handle = sash(el);
    handle.dispatchEvent(pointer('pointerdown', 100));
    handle.dispatchEvent(pointer('pointermove', 140));
    handle.dispatchEvent(pointer('pointermove', 100));
    handle.dispatchEvent(pointer('pointerup', 100));
    await el.updateComplete;

    // Nothing moved on screen, so nothing is pinned: the sections go on sizing
    // themselves.
    expect(sizing(el, 'a')).toBe('fill 1');
    expect(sizing(el, 'b')).toBe('fill 1');
  });

  it('hands the stack back when a section opens with no size of its own', async () => {
    const el = await mount('vertical');
    await drag(el, sash(el));
    expect(sizing(el, 'a')).toBe('fill 1.2 120px');

    el.sections = [...sections, { id: 'd', title: 'D', content: html`<div>D</div>` }];
    await el.updateComplete;

    // The newcomer has no size, and the sized panes leave it no share: it would
    // open at its floor, so every section shares the panel again.
    expect(sizing(el, 'a')).toBe('fill 1');
    expect(sizing(el, 'd')).toBe('fill 1');
  });

  it('leaves the sizes alone for a sash click that never moved', async () => {
    const el = await mount('vertical');

    const handle = sash(el);
    handle.dispatchEvent(pointer('pointerdown', 100));
    handle.dispatchEvent(pointer('pointerup', 100));
    await el.updateComplete;

    expect(sizing(el, 'a')).toBe(sizing(el, 'c'));
  });

  it('restores the sizes when the drag is cancelled', async () => {
    const el = await mount('vertical');

    const handle = sash(el);
    handle.dispatchEvent(pointer('pointerdown', 100));
    handle.dispatchEvent(pointer('pointermove', 120));
    handle.dispatchEvent(pointer('pointercancel', 120));
    await el.updateComplete;

    // Back to the measured 100/100, so a-and-b weigh the same again.
    expect(sizing(el, 'a')).toBe(sizing(el, 'b'));

    // The gesture is over: a stray move can no longer resize.
    handle.dispatchEvent(pointer('pointermove', 200));
    await el.updateComplete;
    expect(sizing(el, 'a')).toBe(sizing(el, 'b'));
  });

  // A height dragged down the side is not a width along the bottom, and a reset
  // hands every size back: one guard in `willUpdate`, both its arms.
  it.each([
    ['the panel is re-docked', (el: PaneView) => (el.orientation = 'horizontal')],
    ['the layout is reset', (el: PaneView) => el.layoutEpoch++],
  ])('drops the dragged sizes when %s', async (_name, change) => {
    const el = await mount('vertical');
    await drag(el, sash(el));
    expect(sizing(el, 'a')).toBe('fill 1.2 120px');

    change(el);
    await el.updateComplete;

    expect(sizing(el, 'a')).toBe('fill 1');
    expect(sizing(el, 'b')).toBe('fill 1');
  });

  it('sizes a content pane to its content, shrinkable, and never stretches it', async () => {
    const el = await mountSections([
      { id: 'a', title: 'A', content: html`<div>A</div>`, fit: 'content' },
      { id: 'b', title: 'B', content: html`<div>B</div>` },
    ]);

    expect(sizing(el, 'a')).toBe('content');
    expect(sizing(el, 'b')).toBe('fill 1');
    expect(share(el)).toBe('2');
  });

  it('renders a sash beside a content pane too', async () => {
    const el = await mountSections([
      { id: 'a', title: 'A', content: html`<div>A</div>`, fit: 'content' },
      { id: 'b', title: 'B', content: html`<div>B</div>` },
      { id: 'c', title: 'C', content: html`<div>C</div>` },
    ]);

    // a↔b and b↔c: a content pane holds the size it is dragged to.
    expect(el.shadowRoot?.querySelectorAll('.pane-sash').length).toBe(2);
  });

  it('pins a content pane to its dragged size, and keeps it out of the fill scale', async () => {
    const el = await mountSections([
      { id: 'a', title: 'A', content: html`<div>A</div>`, fit: 'content' },
      { id: 'b', title: 'B', content: html`<div>B</div>` },
      { id: 'c', title: 'C', content: html`<div>C</div>` },
    ]);

    await drag(el, sash(el));

    // A basis, not a weight: it never stretches, and it still shrinks to scroll.
    expect(sizing(el, 'a')).toBe('content 120px');
    // The content pane's size is no part of the fill panes' weights, so b and c
    // split what is left between the two of them.
    expect(sizing(el, 'b')).toBe('fill 0.888888888888889 80px');
    expect(sizing(el, 'c')).toBe('fill 1.1111111111111112 100px');
    expect(share(el)).toBe('3');
  });

  it('takes a fill pane down to the same size a content pane goes to', async () => {
    const el = await mountSections([
      { id: 'a', title: 'A', content: html`<div>A</div>`, fit: 'content' },
      { id: 'b', title: 'B', content: html`<div>B</div>` },
      { id: 'c', title: 'C', content: html`<div>C</div>`, weight: 4 },
    ]);

    // Drag b down to 60 of the pair's 200px.
    await drag(el, sash(el, 1), 60);

    // Both kinds end up sized by the same basis, so neither bottoms out sooner
    // than the other — `--lana-pane-min` alone decides how small that is, and it
    // is one value for every section.
    expect(sizing(el, 'b')).toBe('fill 1.5 60px');
    expect(sizing(el, 'c')).toBe('fill 3.5 140px');
  });

  it('gives a content pane the room it was dragged to, past its content', async () => {
    const el = await mountSections([
      { id: 'a', title: 'A', content: html`<div>A</div>`, fit: 'content' },
      { id: 'b', title: 'B', content: html`<div>B</div>` },
    ]);

    await drag(el, sash(el), 160);
    // The drag is what the user asked for; a double-click is how they take it back.
    expect(sizing(el, 'a')).toBe('content 160px');
  });

  it('drags every section to the same floor, whatever its neighbour asks for', async () => {
    // A pane's floor must not depend on what its neighbour holds.
    const el = await mountSections([
      { id: 'a', title: 'A', content: html`<div>A</div>`, fit: 'content' },
      { id: 'b', title: 'B', content: html`<div>B</div>`, fit: 'content' },
      { id: 'c', title: 'C', content: html`<div>C</div>` },
    ]);

    await drag(el, sash(el, 0), -500);
    await drag(el, sash(el, 1), -500);

    // `--lana-pane-min` is the only floor, and jsdom resolves no layout, so both
    // sections reach the same 0 — a content pane above a content pane, and one
    // above a fill pane.
    expect(sizing(el, 'a')).toBe('content 0px');
    expect(sizing(el, 'b')).toBe('content 0px');
  });

  describe('height tier', () => {
    const tiered = (): PaneSection[] => [
      { id: 'a', title: 'A', content: html`<div>A</div>`, height: 'md' },
      { id: 'b', title: 'B', content: html`<div>B</div>` },
      { id: 'c', title: 'C', content: html`<div>C</div>` },
    ];

    it('leaves a tiered section to CSS, so the token is what sizes it', async () => {
      const el = await mountSections(tiered());

      // The tier and nothing else: no weight, no dragged size, so the token in
      // the stylesheet is the whole answer.
      expect(sizing(el, 'a')).toBe('md');
    });

    it('leaves the fill panes sharing what is left, so their weights decide', async () => {
      const el = await mountSections([
        { id: 'a', title: 'A', content: html`<div>A</div>`, height: 'md' },
        { id: 'b', title: 'B', content: html`<div>B</div>`, weight: 2 },
        { id: 'c', title: 'C', content: html`<div>C</div>`, weight: 4 },
      ]);

      // A tier is a bounded slot, so the fill panes resolve from zero and split
      // the rest 2:4. A share each would over-subscribe the panel, and flexbox
      // shrinks by basis alone — which would flatten 2 against 4.
      expect(sizing(el, 'b')).toBe('fill 2');
      expect(sizing(el, 'c')).toBe('fill 4');
      expect(share(el)).toBeNull();
    });

    it('still hands the fill panes a share beside a content pane', async () => {
      const el = await mountSections([
        { id: 'a', title: 'A', content: html`<div>A</div>`, height: 'md' },
        { id: 'b', title: 'B', content: html`<div>B</div>`, fit: 'content' },
        { id: 'c', title: 'C', content: html`<div>C</div>` },
      ]);

      // Nothing bounds a content pane, so the guard against it squeezing the
      // grids to the floor stays.
      expect(sizing(el, 'c')).toBe('fill 1');
      expect(share(el)).toBe('3');
    });

    it('hands the tier over to a dragged size', async () => {
      const el = await mountSections(tiered());

      await drag(el, sash(el), 140);

      // Still on its tier; the dragged size is what every rule reads first.
      expect(sizing(el, 'a')).toBe('md 140px');
    });

    it('shares the width like any fill pane when the sections sit side by side', async () => {
      const el = await mountSections(tiered(), { orientation: 'horizontal' });

      // A height means nothing along this axis.
      expect(pane(el, 'a')?.hasAttribute('data-tier')).toBe(false);
      expect(sizing(el, 'a')).toBe('fill 1');
    });

    it('drops the tier while the section is collapsed', async () => {
      const el = await mountSections(tiered());
      el.collapsed = { a: true };
      await el.updateComplete;

      expect(sizing(el, 'a')).toBe('closed');
    });
  });

  it('shrinks the pane above, then the one above that, out to the top', async () => {
    const el = await mountSections([
      { id: 'a', title: 'A', content: html`<div>A</div>` },
      { id: 'b', title: 'B', content: html`<div>B</div>` },
      { id: 'c', title: 'C', content: html`<div>C</div>` },
      { id: 'd', title: 'D', content: html`<div>D</div>` },
    ]);

    // Each pane is 100 here. Dragging the b-c sash to the top makes c as large
    // as the stack allows: b gives up its room first, then a.
    await drag(el, sash(el, 1), -1000);

    expect(sizing(el, 'b')).toBe('fill 0 0px');
    expect(sizing(el, 'a')).toBe('fill 0 0px');
    expect(sizing(el, 'c')).toBe('fill 3 300px');
    // d is past the far end of the drag, and keeps its size: the room the
    // cascade moved never comes out of a section the reader did not drag.
    expect(sizing(el, 'd')).toBe('fill 1 100px');
  });

  it('shrinks the pane below, then the one below that, out to the bottom', async () => {
    const el = await mountSections([
      { id: 'a', title: 'A', content: html`<div>A</div>` },
      { id: 'b', title: 'B', content: html`<div>B</div>` },
      { id: 'c', title: 'C', content: html`<div>C</div>` },
    ]);

    await drag(el, sash(el, 0), 1000);

    expect(sizing(el, 'b')).toBe('fill 0 0px');
    expect(sizing(el, 'c')).toBe('fill 0 0px');
    expect(sizing(el, 'a')).toBe('fill 3 300px');
  });

  it('hands a content pane back to its content on a double-click', async () => {
    const el = await mountSections([
      { id: 'a', title: 'A', content: html`<div>A</div>`, fit: 'content' },
      { id: 'b', title: 'B', content: html`<div>B</div>` },
    ]);

    await drag(el, sash(el));
    expect(sizing(el, 'a')).toBe('content 120px');

    sash(el).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await el.updateComplete;

    expect(sizing(el, 'a')).toBe('content');
  });

  describe('fill pane share', () => {
    const mixed: PaneSection[] = [
      { id: 'a', title: 'A', content: html`<div>A</div>`, fit: 'content' },
      { id: 'b', title: 'B', content: html`<div>B</div>`, fit: 'content' },
      { id: 'c', title: 'C', content: html`<div>C</div>` },
    ];

    it('gives the fill pane a share to shrink from, and leaves the content panes alone', async () => {
      const el = await mountSections(mixed);

      // Three open panes, so the fill pane starts from a third and grows.
      expect(share(el)).toBe('3');
      expect(sizing(el, 'c')).toBe('fill 1');
      expect(sizing(el, 'a')).toBe('content');
      expect(sizing(el, 'b')).toBe('content');
    });

    it('widens the share as sections collapse', async () => {
      const el = await mountSections(mixed, { collapsed: { b: true } });

      expect(share(el)).toBe('2');
    });

    it('shares by weight alone once no content pane is open', async () => {
      const el = await mountSections(mixed, { collapsed: { a: true, b: true } });

      // One section read on its own gets the whole panel either way, and with
      // several fill panes a share each would flatten their weights.
      expect(share(el)).toBeNull();
      expect(sizing(el, 'c')).toBe('fill 1');
    });

    it('leaves a dragged content pane at the size it was dragged to', async () => {
      const el = await mountSections(mixed);

      await drag(el, sash(el));

      expect(sizing(el, 'a')).toBe('content 120px');
      expect(sizing(el, 'b')).toBe('content 80px');
      expect(sizing(el, 'c')).toBe('fill 1 100px');
      expect(share(el)).toBe('3');
    });

    it('shares nothing side by side, where the axis is the width', async () => {
      const el = await mountSections(mixed, { orientation: 'horizontal' });

      expect(share(el)).toBeNull();
      expect(sizing(el, 'c')).toBe('fill 1');
    });
  });

  describe('reorder', () => {
    it('moves the panes it already has, rather than rebuilding them', async () => {
      const el = await mount('vertical');
      const before = pane(el, 'a');

      el.sections = [sections[2]!, sections[0]!, sections[1]!];
      await el.updateComplete;

      // Same element: a rebuilt pane would re-mount its body's grid and lose
      // the scroll, the expanded rows and the row the user picked.
      expect(pane(el, 'a')).toBe(before);
      expect(paneIds(el)).toEqual(['c', 'a', 'b']);
    });

    it('drops a section before the one it is over the top half of', async () => {
      const el = await mount('vertical');
      const seen = reorders(el);

      await dragSection(el, 'c', 20);

      expect(seen).toEqual([['c', 'a', 'b']]);
    });

    it('drops it after the one it is over the bottom half of', async () => {
      const el = await mount('vertical');
      const seen = reorders(el);

      // Over `c`'s body, nowhere near a header: the section under the pointer is
      // what the drop reads.
      await dragSection(el, 'a', 280);

      expect(seen).toEqual([['b', 'c', 'a']]);
    });

    it('marks the edge the section would land on, and the one being dragged', async () => {
      const el = await mount('vertical');

      headerOf(el, 'c').dispatchEvent(dragEvent('dragstart'));
      stack(el).dispatchEvent(dragEvent('dragover', 20));
      await el.updateComplete;

      expect(el.shadowRoot?.querySelector('.pane[data-id="a"]')?.className).toContain(
        'pane--drop-before',
      );
      expect(el.shadowRoot?.querySelector('.pane[data-id="c"]')?.className).toContain(
        'pane--dragging',
      );

      // The gesture ends: no mark is left behind.
      headerOf(el, 'c').dispatchEvent(dragEvent('dragend'));
      await el.updateComplete;
      expect(el.shadowRoot?.querySelector('.pane--drop-before')).toBeNull();
      expect(el.shadowRoot?.querySelector('.pane--dragging')).toBeNull();
    });

    it('marks the last edge when the section would land at the end', async () => {
      const el = await mount('vertical');

      headerOf(el, 'a').dispatchEvent(dragEvent('dragstart'));
      stack(el).dispatchEvent(dragEvent('dragover', 280));
      await el.updateComplete;

      expect(el.shadowRoot?.querySelector('.pane[data-id="c"]')?.className).toContain(
        'pane--drop-after',
      );
      // One boundary, one mark: nothing else is marked.
      expect(el.shadowRoot?.querySelectorAll('.pane--drop-before').length).toBe(0);
    });

    it('marks one edge however the boundary was reached', async () => {
      const el = await mount('vertical');

      // The bottom of `a` and the top of `b` are the same boundary, and `c`
      // would land on it either way.
      headerOf(el, 'c').dispatchEvent(dragEvent('dragstart'));
      stack(el).dispatchEvent(dragEvent('dragover', 80));
      await el.updateComplete;
      const fromBelow = el.shadowRoot?.querySelector('.pane--drop-before')?.getAttribute('data-id');

      stack(el).dispatchEvent(dragEvent('dragover', 120));
      await el.updateComplete;

      expect(fromBelow).toBe('b');
      expect(el.shadowRoot?.querySelector('.pane--drop-before')?.getAttribute('data-id')).toBe('b');
    });

    it('marks neither edge of where the section already sits', async () => {
      const el = await mount('vertical');
      const seen = reorders(el);

      headerOf(el, 'b').dispatchEvent(dragEvent('dragstart'));
      // Its own top edge, its own bottom edge, and the top of the next section:
      // every one of them moves nothing.
      for (const at of [120, 180, 220]) {
        stack(el).dispatchEvent(dragEvent('dragover', at));
        await el.updateComplete;
        expect(el.shadowRoot?.querySelector('.pane--drop-before')).toBeNull();
        expect(el.shadowRoot?.querySelector('.pane--drop-after')).toBeNull();
      }

      stack(el).dispatchEvent(dragEvent('drop', 120));
      expect(seen).toEqual([]);
    });

    it('drops the mark when the drag leaves the stack', async () => {
      const el = await mount('vertical');

      headerOf(el, 'c').dispatchEvent(dragEvent('dragstart'));
      stack(el).dispatchEvent(dragEvent('dragover', 20));
      await el.updateComplete;
      expect(el.shadowRoot?.querySelector('.pane--drop-before')).not.toBeNull();

      stack(el).dispatchEvent(dragEvent('dragleave'));
      await el.updateComplete;

      expect(el.shadowRoot?.querySelector('.pane--drop-before')).toBeNull();
    });

    it('reports nothing for a section dropped on itself', async () => {
      const el = await mount('vertical');
      const seen = reorders(el);

      await dragSection(el, 'b', 120);

      expect(seen).toEqual([]);
    });

    it('does not reorder itself when the consumer ignores pane-reorder', async () => {
      const el = await mount('vertical');

      await dragSection(el, 'c', 20);

      // Controlled, like collapse: the consumer owns the order.
      expect(el.sections.map((section) => section.id)).toEqual(['a', 'b', 'c']);
    });

    it('moves a section one place with Alt+Arrow', async () => {
      const el = await mount('vertical');
      const seen = reorders(el);

      headerOf(el, 'a').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }),
      );
      headerOf(el, 'c').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }),
      );

      expect(seen).toEqual([
        ['b', 'a', 'c'],
        ['a', 'c', 'b'],
      ]);
    });

    it('ignores Alt+Arrow off either end, and a held key', async () => {
      const el = await mount('vertical');
      const seen = reorders(el);

      headerOf(el, 'a').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }),
      );
      headerOf(el, 'c').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }),
      );
      headerOf(el, 'a').dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          altKey: true,
          bubbles: true,
          repeat: true,
        }),
      );

      expect(seen).toEqual([]);
    });

    it('keeps Alt+Arrow off the collapse it shares a header with', async () => {
      const el = await mount('vertical');
      let toggles = 0;
      el.addEventListener('pane-toggle', () => toggles++);

      headerOf(el, 'a').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }),
      );

      expect(toggles).toBe(0);
    });

    it('reorders side by side too, where the axis is the width', async () => {
      const el = await mount('horizontal');
      const seen = reorders(el);

      // Focusable on both axes, so the keyboard reaches the reorder in the
      // bottom dock as well.
      expect(headerOf(el, 'a').getAttribute('tabindex')).toBe('0');
      headerOf(el, 'a').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }),
      );

      expect(seen).toEqual([['b', 'a', 'c']]);
    });
  });

  it('reports a header right-click, so the consumer can offer the sections', async () => {
    const el = await mount('vertical');
    const seen: Array<{ id: string; x: number; y: number }> = [];
    el.addEventListener('pane-menu', (e) => {
      seen.push((e as CustomEvent<{ id: string; x: number; y: number }>).detail);
    });

    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 12,
    });
    headerOf(el, 'b').dispatchEvent(event);

    expect(seen).toEqual([{ id: 'b', x: 40, y: 12 }]);
    // The host's own menu never opens over it.
    expect(event.defaultPrevented).toBe(true);
  });
});
