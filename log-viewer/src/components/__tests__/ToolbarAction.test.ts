/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

import type { ToolbarAction } from '../ToolbarAction.js';
import '../ToolbarAction.js';

describe('ToolbarAction', () => {
  it('on the bar, is an icon button named and titled by its label', async () => {
    const el = document.createElement('toolbar-action') as ToolbarAction;
    el.icon = 'copy';
    el.label = 'Copy to Clipboard';
    document.body.appendChild(el);
    await el.updateComplete;

    const button = el.shadowRoot?.querySelector('vscode-toolbar-button');
    // An icon with no name is silent to a screen reader and has no hover hint.
    expect(button?.getAttribute('label')).toBe('Copy to Clipboard');
    expect(button?.getAttribute('title')).toBe('Copy to Clipboard');
    expect(button?.getAttribute('icon')).toBe('copy');
    expect(el.shadowRoot?.querySelector('.menu-row')).toBeNull();
    el.remove();
  });
});
