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

describe('PaneView', () => {
  beforeAll(() => {
    expect(customElements.get('pane-view')).toBeDefined();
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

  it('seeds collapsed defaults from section.collapsed', async () => {
    const el = document.createElement('pane-view') as PaneView;
    el.orientation = 'vertical';
    el.sections = [
      { id: 'a', title: 'A', content: html`<div>A</div>` },
      { id: 'b', title: 'B', content: html`<div>B</div>`, collapsed: true },
    ];
    document.body.appendChild(el);
    await el.updateComplete;
    expect(body(el, 'a')).not.toBeNull();
    expect(body(el, 'b')).toBeNull();
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

  it('takes collapse from the collapsed property, overriding section defaults', async () => {
    const el = document.createElement('pane-view') as PaneView;
    el.orientation = 'vertical';
    el.sections = [
      { id: 'a', title: 'A', content: html`<div>A</div>` },
      { id: 'b', title: 'B', content: html`<div>B</div>`, collapsed: true },
    ];
    // Inverts both defaults: the consumer's record wins.
    el.collapsed = { a: true, b: false };
    document.body.appendChild(el);
    await el.updateComplete;
    expect(body(el, 'a')).toBeNull();
    expect(body(el, 'b')).not.toBeNull();
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

  it('uses persisted pane sizes as the flex weights', async () => {
    const el = document.createElement('pane-view') as PaneView;
    el.orientation = 'vertical';
    el.sections = [
      { id: 'a', title: 'A', content: html`<div>A</div>`, weight: 3 },
      { id: 'b', title: 'B', content: html`<div>B</div>` },
    ];
    el.paneSizes = { a: 120 };
    document.body.appendChild(el);
    await el.updateComplete;

    const pane = (id: string) => el.shadowRoot?.querySelector(`.pane[data-id="${id}"]`);
    expect(pane('a')?.getAttribute('style')).toContain('flex: 120 1 0');
    // No persisted size → the section's own default weight.
    expect(pane('b')?.getAttribute('style')).toContain('flex: 1 1 0');
  });
});
