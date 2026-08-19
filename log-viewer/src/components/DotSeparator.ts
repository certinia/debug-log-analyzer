/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement } from 'lit/decorators.js';

import { tokenStyles } from '../styles/tokens.styles.js';

@customElement('dot-separator')
export class DotSeparator extends LitElement {
  static styles = [
    tokenStyles,
    css`
      :host {
        color: var(--lana-fg-muted);
        opacity: 0.5;
        flex: 0 0 auto;
      }
    `,
  ];

  render() {
    return html`<span class="metadata__separator">•</span>`;
  }
}
