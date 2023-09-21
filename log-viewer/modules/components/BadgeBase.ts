/*
 * Copyright (c) 2021 Certinia Inc. All rights reserved.
 */
import { provideVSCodeDesignSystem, vsCodeTag } from '@vscode/webview-ui-toolkit';
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { globalStyles } from '../global.styles';

provideVSCodeDesignSystem().register(vsCodeTag());

@customElement('badge-base')
export class BadgeBase extends LitElement {
  @property()
  status: 'success' | 'failure' | 'neutral' = 'neutral';
  colorMap = new Map<string, string>([
    ['success', 'success-tag'],
    ['failure', 'failure-tag'],
  ]);

  static styles = [
    globalStyles,
    css`
      :host {
      }

      .tag {
        font-family: monospace;
        font-size: inherit;
      }

      .tag::part(control) {
        color: var(--vscode-editor-foreground);
        background-color: var(--button-icon-hover-background, rgba(90, 93, 94, 0.31));
        text-transform: inherit;
        border: none;
      }
      .success-tag::part(control) {
        background-color: rgba(128, 255, 128, 0.2);
      }

      .failure-tag::part(control) {
        background-color: var(--notification-error-background);
      }
    `,
  ];

  render() {
    const statusTag = this.colorMap.get(this.status);

    return html`<vscode-tag class="tag ${statusTag}"><slot></slot></vscode-tag>`;
  }
}
