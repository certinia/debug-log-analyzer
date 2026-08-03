/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { beforeAll, describe, expect, it } from '@jest/globals';
import { html } from 'lit';

jest.mock('#vscode-elements/vscode-icon.js', () => ({}));
jest.mock('#vscode-elements/vscode-badge.js', () => ({}));

import type { DetailDock } from '../DetailDock.js';
import '../DetailDock.js';
import type { PaneSection } from '../PaneView.js';

const sections: PaneSection[] = [
  { id: 'a', title: 'A', content: html`<div>a</div>` },
  { id: 'b', title: 'B', content: html`<div>b</div>` },
];

async function mount(configure: (el: DetailDock) => void): Promise<DetailDock> {
  const el = document.createElement('detail-dock') as DetailDock;
  configure(el);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('DetailDock', () => {
  beforeAll(() => {
    expect(customElements.get('detail-dock')).toBeDefined();
  });

  it('shows the empty text when there are no sections', async () => {
    const el = await mount((e) => {
      e.emptyText = 'Pick a row.';
    });
    expect(el.shadowRoot?.querySelector('.empty')?.textContent).toContain('Pick a row.');
    expect(el.shadowRoot?.querySelector('pane-view')).toBeNull();
  });

  it('maps dock position to pane-view orientation', async () => {
    const right = await mount((e) => {
      e.sections = sections;
      e.dock = 'right';
    });
    expect(right.shadowRoot?.querySelector('pane-view')?.getAttribute('orientation')).toBe(
      'vertical',
    );

    const bottom = await mount((e) => {
      e.sections = sections;
      e.dock = 'bottom';
    });
    expect(bottom.shadowRoot?.querySelector('pane-view')?.getAttribute('orientation')).toBe(
      'horizontal',
    );
  });

  it('dispatches position + hide events from the action bar', async () => {
    const el = await mount((e) => {
      e.sections = sections;
    });
    let position: string | undefined;
    let hidden = false;
    el.addEventListener('dock-position-change', (e) => {
      position = (e as CustomEvent<{ position: string }>).detail.position;
    });
    el.addEventListener('dock-hide', () => {
      hidden = true;
    });

    const icons = Array.from(el.shadowRoot?.querySelectorAll('vscode-icon') ?? []) as HTMLElement[];
    icons.find((b) => b.getAttribute('title') === 'Dock bottom')?.click();
    icons.find((b) => b.getAttribute('title') === 'Hide panel')?.click();

    expect(position).toBe('bottom');
    expect(hidden).toBe(true);
  });
});
