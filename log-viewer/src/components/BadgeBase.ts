/*
 * Copyright (c) 2021 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-badge.js';
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

// styles
import { globalStyles } from '../styles/global.styles.js';
import { skeletonStyles } from '../styles/skeleton.styles.js';

@customElement('badge-base')
export class BadgeBase extends LitElement {
  @property()
  status: 'success' | 'failure' | 'neutral' = 'neutral';

  @property({ type: Boolean })
  isloading = false;

  colorMap = new Map<string, string>([
    ['success', 'success-tag'],
    ['failure', 'failure-tag'],
  ]);

  static styles = [
    globalStyles,
    skeletonStyles,
    css`
      .tag {
        --vscode-font-family: monospace;
        --vscode-badge-background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
        --vscode-badge-foreground: var(--vscode-editor-foreground);

        font-family: monospace;
        font-size: inherit;
      }

      .success-tag {
        --vscode-badge-background: rgba(128, 255, 128, 0.2);
      }

      .failure-tag {
        --vscode-badge-background: var(--notification-error-background);
      }
    `,
  ];

  render() {
    if (this.isloading) {
      return html`<vscode-badge class="tag skeleton">&nbsp;</vscode-badge>`;
    }
    const statusTag = this.colorMap.get(this.status);
    return html`<vscode-badge class="tag ${statusTag}"><slot></slot></vscode-badge>`;
  }
}
