/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

// jsdom can't run the real elements (they read document.baseURI / setFormValue).
jest.mock('#vscode-elements/vscode-icon.js', () => ({}));

import type { AnchoredPopover } from '../AnchoredPopover.js';
import '../AnchoredPopover.js';

async function mount(panelContent: string, showHeading = false): Promise<AnchoredPopover> {
  const el = document.createElement('anchored-popover') as AnchoredPopover;
  el.heading = 'Log problems';
  el.emptyMessage = 'No problems found in this log';
  if (showHeading) {
    el.setAttribute('show-heading', '');
  }
  el.innerHTML = `<span slot="trigger">face</span>${panelContent}`;
  document.body.appendChild(el);
  await el.updateComplete;
  // The panel slot is only readable after the first render, which schedules a second.
  await el.updateComplete;
  return el;
}

function panel(el: AnchoredPopover): HTMLElement | null {
  return el.shadowRoot?.querySelector('.panel') ?? null;
}

describe('AnchoredPopover', () => {
  it('opens from the trigger via the native popover API, not a hover handler', async () => {
    const el = await mount('<div slot="panel">an issue</div>');
    const trigger = el.shadowRoot?.querySelector('.trigger');

    // A popovertarget button gives click-to-open plus light-dismiss for free; hover
    // opening would trap the links these panels contain.
    expect(trigger?.getAttribute('popovertarget')).toBe(panel(el)?.id);
    expect(panel(el)?.hasAttribute('popover')).toBe(true);
  });

  it('still opens with nothing to show, replacing the slot with the empty message', async () => {
    const el = await mount('');

    expect(el.shadowRoot?.querySelector('.panel__empty')?.textContent).toContain(
      'No problems found in this log',
    );
    expect(el.shadowRoot?.querySelector('.panel__items--empty')).not.toBeNull();
  });

  it('hides the empty message once the panel slot has content', async () => {
    const el = await mount('<div slot="panel">an issue</div>');

    expect(el.shadowRoot?.querySelector('.panel__empty')).toBeNull();
    expect(el.shadowRoot?.querySelector('.panel__items--empty')).toBeNull();
  });

  it('labels the panel with its heading without showing it — menus are untitled', async () => {
    const el = await mount('');

    expect(panel(el)?.getAttribute('aria-label')).toBe('Log problems');
    expect(el.shadowRoot?.querySelector('.panel__head')).toBeNull();
  });

  it('renders the heading visibly only with show-heading', async () => {
    const el = await mount('', true);

    expect(el.shadowRoot?.querySelector('.panel__head')?.textContent).toBe('Log problems');
  });
});
