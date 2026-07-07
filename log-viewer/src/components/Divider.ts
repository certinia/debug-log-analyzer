/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('divider-line')
export class Divider extends LitElement {
  @property({ reflect: true })
  orientation: 'horizontal' | 'vertical' = 'horizontal';

  static styles = css`
    :host {
      --border-width: 1;
      --divider-background: var(--vscode-settings-dropdownListBorder, #454545);

      display: inline-block;
      box-sizing: border-box;
      border-left:;
      flex: 0 0 auto;
    }

    :host([orientation='horizontal']) {
      width: 100%;
      border-top: calc(var(--border-width) * 1px) solid var(--divider-background);
    }

    :host([orientation='vertical']) {
      border-left: calc(var(--border-width) * 1px) solid var(--divider-background);
    }

    .divider {
      display: inline-block;
    }
  `;

  render() {
    return html` <span class="divider"></span> `;
  }
}
