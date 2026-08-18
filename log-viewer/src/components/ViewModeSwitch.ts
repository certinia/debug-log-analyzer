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
 * Shared by the Call Tree tab and the inspector so both render
 * identically.
 */
@customElement('view-mode-switch')
export class ViewModeSwitch extends LitElement {
  @property({ attribute: false })
  options: readonly ViewModeOption[] = [];

  @property()
  value = '';

  // On the host, not the inner row, so the consumer's aria-label names the group.
  connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'radiogroup');
  }

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
      /* Same dense sizing as the filter bar's Expand/Collapse/Columns controls
         (--filter-control-* in global.styles), so the switch reads as one
         visual family with them. Only the outer edges of the row are rounded. */
      vscode-button {
        height: var(--filter-control-height);
      }
      vscode-button::part(base) {
        padding: var(--filter-control-padding);
        font-size: var(--filter-control-font-size);
      }
      vscode-button:first-child {
        --vsc-border-left-radius: var(--filter-control-radius);
        --vsc-border-right-radius: 0;
      }
      vscode-button:not(:first-child):not(:last-child) {
        --vsc-border-left-radius: 0;
        --vsc-border-right-radius: 0;
      }
      vscode-button:last-child {
        --vsc-border-left-radius: 0;
        --vsc-border-right-radius: var(--filter-control-radius);
      }
    `,
  ];

  render() {
    return html`<div class="switch">
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
