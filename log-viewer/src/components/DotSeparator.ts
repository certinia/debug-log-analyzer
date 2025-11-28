/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('dot-separator')
export class DotSeparator extends LitElement {
  static styles = css`
    :host {
      color: var(--vscode-descriptionForeground, #999);
      opacity: 0.5;
    }
  `;

  render() {
    return html`<span class="metadata__separator">•</span>`;
  }
}
