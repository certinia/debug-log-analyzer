/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-button.js';
import '#vscode-elements/vscode-option.js';
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

  /**
   * Render as a picker, which takes about half the width; set by `<datagrid-filter-bar>`.
   * `vs-select` is not imported here: every bar loads it through `gridToolbar`, and the
   * inspector's switch, which never compacts, would pull a canvas-measuring select into jsdom.
   */
  @property({ type: Boolean })
  compact = false;

  // On the host, not the inner row, so the consumer's aria-label names the group. Compact,
  // it holds one combobox, not radios, and a named element must have a role.
  protected override willUpdate(): void {
    this.setAttribute('role', this.compact ? 'group' : 'radiogroup');
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
    if (this.compact) {
      // Keyed by label: the select's face shows an option's value.
      const current = this.options.find((opt) => opt.value === this.value)?.label ?? '';
      return html`<vs-select
        dense
        label=${this.getAttribute('aria-label') ?? ''}
        .value=${current}
        @change=${(event: Event) => {
          const label = (event.target as HTMLInputElement).value;
          const picked = this.options.find((opt) => opt.label === label);
          if (picked) {
            this._select(picked.value);
          }
        }}
      >
        ${this.options.map(
          (opt) =>
            html`<vscode-option ?selected=${opt.label === current}>${opt.label}</vscode-option>`,
        )}
      </vs-select>`;
    }
    return html`<div class="switch">
      ${this.options.map(
        (opt) =>
          html`<vscode-button
            role="radio"
            aria-checked=${this.value === opt.value ? 'true' : 'false'}
            ?secondary=${this.value !== opt.value}
            title="Show ${opt.label}"
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
