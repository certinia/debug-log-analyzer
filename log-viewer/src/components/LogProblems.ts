/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { provideVSCodeDesignSystem, vsCodeBadge, vsCodeButton } from '@vscode/webview-ui-toolkit';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { goToRow } from '../features/call-tree/components/CalltreeView.js';

// styles
import { globalStyles } from '../styles/global.styles.js';
import { notificationStyles } from '../styles/notification.styles.js';
import { skeletonStyles } from '../styles/skeleton.styles.js';

// web components
import '../features/notifications/components/NotificationPanel.js';
import './BadgeBase.js';
import './Divider.js';
import './IconButton.js';
import './IconButtonSkeleton.js';

provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeBadge());

@customElement('log-problems')
export class NotificationTag extends LitElement {
  @state()
  open = false;

  @property()
  notifications: LogProblem[] | null = null;

  colorStyles = new Map([
    ['Error', 'error'],
    ['Warning', 'warning'],
    ['Info', 'info'],
  ]);

  sortOrder = new Map([
    ['Error', 0],
    ['Warning', 1],
    ['Info', 2],
  ]);

  constructor() {
    super();
    document.addEventListener('click', (event) => {
      if (!event.composedPath().includes(this)) {
        this.open = false;
      }
    });
  }

  static styles = [
    globalStyles,
    skeletonStyles,
    css`
      :host {
        --button-icon-hover-background: var(--vscode-toolbar-hoverBackground);

        ${notificationStyles}
        display: inline-flex;
        flex: 0 0 auto;
      }

      .problems-container {
        position: relative;
        display: inline-flex;
      }

      .problems-panel {
        position: absolute;
        top: calc(100% + 10px);
        left: 50%;
        transform: translateX(-50%);
      }

      .log-problem {
        padding: 8px 16px;
        overflow-wrap: anywhere;
        text-wrap: wrap;
        display: flex;
        gap: 8px;
        border-radius: 4px;
      }

      .text-container {
        padding: 8px 0px 0px 0px;
      }

      .error {
        background-color: var(--notification-error-background);
      }

      .warning {
        background-color: var(--notification-warning-background);
      }

      .info {
        background-color: var(--notification-information-background);
      }

      .button-bar {
        display: flex;
        align-items: center;
        height: 35px;
      }

      .skeleton {
        width: 16px;
        height: 16px;
      }
    `,
  ];

  render() {
    if (!this.notifications) {
      return html`<icon-button-skeleton />`;
    }

    const count = this.notifications.length || null;
    const title = count === 0 ? 'No Problems' : `${count} Problem${count === 1 ? '' : 's'}`;
    const messages = this._renderNotificationMessages();

    return html` <div class="problems-container">
      <icon-button
        ariaLabel="${title}"
        title="${title}"
        icon="codicon-warning"
        .badgeCount="${count}"
        @click=${this._togglePanel}
      ></icon-button>

      <notification-panel class="problems-panel" .open="${this.open}">
        ${messages.length ? html`<div slot="items">${messages}</div>` : html``}
      </notification-panel>
    </div>`;
  }

  _renderNotificationMessages() {
    if (!this.notifications) {
      return [];
    }

    const sortOrder = new Map([
      ['Error', 0],
      ['Warning', 1],
      ['Info', 2],
      ['None', 3],
    ]);

    const messages: TemplateResult[] = [];
    const sortedNotifications = [...this.notifications].sort((a, b) => {
      return (sortOrder.get(a.severity) ?? 1) - (sortOrder.get(b.severity) ?? 1);
    });
    const lastIndex = sortedNotifications.length - 1;

    sortedNotifications.forEach((item, index) => {
      const colorStyle = this.colorStyles.get(item.severity) || '';

      const buttonBar = item.timestamp
        ? html`<div class="button-bar">
            <vscode-button
              aria-label="Go To Call Tree"
              title="Go To Call Tree"
              @click=${() => {
                goToRow(item.timestamp ?? 0);
              }}
              >Go To Call Tree</vscode-button
            >
          </div>`
        : '';

      const content = html`<div class="text-container">
        ${item.message
          ? html`<details>
              <summary>${item.summary}</summary>
              <div class="text-container">${item.message}</div>
            </details>`
          : item.summary}
        ${buttonBar}
      </div>`;

      messages.push(html`<div class="log-problem ${colorStyle}">${content}</div>`);
      if (index !== lastIndex) {
        messages.push(html`<divider-line></divider-line>`);
      }
    });

    return messages;
  }

  _togglePanel() {
    this.open = !this.open;
  }
}

export class LogProblem {
  summary = '';
  message = '';
  severity: 'Error' | 'Warning' | 'Info' | 'none' = 'none';
  timestamp: number | null = null;
}
