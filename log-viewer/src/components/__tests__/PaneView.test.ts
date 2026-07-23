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

async function mount(orientation: PaneOrientation): Promise<PaneView> {
  const el = document.createElement('pane-view') as PaneView;
  el.sections = sections;
  el.orientation = orientation;
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
});
