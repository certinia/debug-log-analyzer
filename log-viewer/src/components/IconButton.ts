/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { provideVSCodeDesignSystem, vsCodeBadge, vsCodeButton } from '@vscode/webview-ui-toolkit';
import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';

// styles
import codiconStyles from '../styles/codicon.css';
import { globalStyles } from '../styles/global.styles.js';

provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeBadge());

@customElement('icon-button')
export class IconButton extends LitElement {
  static styles = [
    globalStyles,
    unsafeCSS(codiconStyles),
    css`
      vscode-button {
        --button-icon-hover-background: var(--vscode-toolbar-hoverBackground);

        height: 22px;
        width: 22px;
      }

      .badge-indicator::part(control) {
        --design-unit: 0;
        --border-width: 0;

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
        ? html`<vscode-badge class="badge-indicator">${this.badgeCount}</vscode-badge> `
        : ``;

    return html`<div class="menu-container">
      <vscode-button appearance="icon" aria-label="${this.ariaLabel}" title="${this.title}">
        <span class="codicon ${this.icon}"></span>
        ${indicator}
      </vscode-button>
    </div>`;
  }
}
