/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-button.js';
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { globalStyles } from '../styles/global.styles.js';

export interface ViewModeOption {
  value: string;
  label: string;
}

/**
 * A segmented "view mode" switch: a joined row of buttons where one is active.
 * Presentation only — the consumer owns `value` and reacts to `view-mode-change`.
 * Shared by the Call Tree tab and the database detail side bar so both render
 * identically.
 */
@customElement('view-mode-switch')
export class ViewModeSwitch extends LitElement {
  @property({ attribute: false })
  options: ViewModeOption[] = [];

  @property()
  value = '';

  static styles = [
    globalStyles,
    css`
      :host {
        display: inline-flex;
      }
      .switch {
        display: flex;
        gap: 0;
      }
      vscode-button {
        height: 26px;
      }
      vscode-button::part(base) {
        padding: 0 8px;
      }
      vscode-button:first-child {
        --vsc-border-left-radius: 2px;
        --vsc-border-right-radius: 0;
      }
      vscode-button:not(:first-child):not(:last-child) {
        --vsc-border-left-radius: 0;
        --vsc-border-right-radius: 0;
      }
      vscode-button:last-child {
        --vsc-border-left-radius: 0;
        --vsc-border-right-radius: 2px;
      }
    `,
  ];

  render() {
    return html`<div class="switch" role="radiogroup">
      ${this.options.map(
        (opt) =>
          html`<vscode-button
            role="radio"
            aria-checked=${this.value === opt.value ? 'true' : 'false'}
            ?secondary=${this.value !== opt.value}
            @click=${() => this._select(opt.value)}
            >${opt.label}</vscode-button
          >`,
      )}
    </div>`;
  }

  private _select(value: string) {
    if (value === this.value) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent('view-mode-change', { detail: { value }, bubbles: true, composed: true }),
    );
  }
}
