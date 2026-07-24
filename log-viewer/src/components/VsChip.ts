/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement } from 'lit/decorators.js';

import { globalStyles } from '../styles/global.styles.js';

/**
 * Compact chip styled as a resting VS Code dropdown face (1px border, 4px radius, dropdown
 * tokens). Two slots: `lead` for a small uppercase label, and the default slot for the
 * value (mono). Presentational only — no interactivity.
 *
 * The host is the face; slotted value text inherits the host's mono font, while the `lead`
 * slot is restyled via `::slotted`.
 */
@customElement('vs-chip')
export class VsChip extends LitElement {
  static styles = [
    globalStyles,
    css`
      :host {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: baseline;
        gap: 6px;
        padding: 2px 6px;
        border: 1px solid var(--vscode-settings-dropdownBorder, #3c3c3c);
        border-radius: 4px;
        background-color: var(--vscode-settings-dropdownBackground, #313131);
        white-space: nowrap;
        font-family: var(--vscode-editor-font-family, monospace);
        font-weight: 600;
        font-size: 11px;
        color: var(--vscode-foreground);
      }

      /* Small uppercase leading label; overrides the host's mono/value styling. */
      ::slotted([slot='lead']) {
        font-family: var(--vscode-font-family);
        font-size: 10px;
        font-weight: 400;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--vscode-descriptionForeground);
      }
    `,
  ];

  render() {
    return html`<slot name="lead"></slot><slot></slot>`;
  }
}
