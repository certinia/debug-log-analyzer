/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-toolbar-button.js';
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

// styles
import { globalStyles } from '../styles/global.styles.js';

@customElement('icon-button')
export class IconButton extends LitElement {
  static styles = [
    globalStyles,
    css`
      .menu-container {
        position: relative;
        display: inline-flex;
      }

      .badge-indicator {
        background-color: var(--vscode-activityBarBadge-background);
        color: var(--vscode-activityBarBadge-foreground);
        position: absolute;
        top: 10px;
        right: 0;
        font-size: 9px;
        font-weight: 600;
        min-width: 12px;
        height: 12px;
        line-height: 12px;
        padding: 0 2px;
        border-radius: 16px;
        text-align: center;
        display: inline-block;
        box-sizing: border-box;
        pointer-events: none;
      }
    `,
  ];

  @property()
  icon: string = '';

  @property()
  badgeCount: number | null | undefined = null;

  @property()
  ariaLabel: string = 'Icon Button';

  @property()
  title: string = 'Icon Button';

  render() {
    const indicator =
      this.badgeCount !== null && this.badgeCount !== undefined
        ? html`<span class="badge-indicator">${this.badgeCount}</span>`
        : ``;

    return html`<div class="menu-container">
      <!-- keep the element empty: whitespace counts as slotted content and adds text padding -->
      <vscode-toolbar-button
        icon="${this.icon}"
        label="${this.ariaLabel}"
        title="${this.title}"
      ></vscode-toolbar-button>
      ${indicator}
    </div>`;
  }
}
