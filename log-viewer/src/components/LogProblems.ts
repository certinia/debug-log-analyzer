/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { provideVSCodeDesignSystem, vsCodeButton } from '@vscode/webview-ui-toolkit';
import { LitElement, css, html, unsafeCSS, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { goToRow } from '../features/call-tree/components/CalltreeView.js';

// styles
import codiconStyles from '../styles/codicon.css';
import { globalStyles } from '../styles/global.styles.js';
import { notificationStyles } from '../styles/notification.styles.js';
import { skeletonStyles } from '../styles/skeleton.styles.js';

// web components
import '../features/notifications/components/NotificationPanel.js';
import './BadgeBase.js';
import './Divider.js';

provideVSCodeDesignSystem().register(vsCodeButton());

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
    unsafeCSS(codiconStyles),
    skeletonStyles,
    css`
      :host {
        ${notificationStyles}
        display: inline-flex;
      }

      .icon {
        position: relative;
        width: 22px;
        height: 22px;
      }

      .codicon.icon {
        font-size: 22px;
        width: 20px;
        height: 20px;
      }

      .problems-container {
        position: relative;
        display: inline-flex;
      }

      .problems-icon {
        color: var(--vscode-descriptionForeground);
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

      .badge-indicator {
        color: rgb(255, 255, 255);
        background-color: rgb(0, 120, 212);
        position: absolute;
        top: 10px;
        left: 10px;
        font-size: 9px;
        font-weight: 600;
        min-width: 13px;
        height: 13px;
        line-height: 13px;
        padding: 0px 2px;
        border-radius: 16px;
        text-align: center;
        box-sizing: border-box;
        display: inline-block;
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
      // todo: create icon skeleton component
      return html` <span class="skeleton"></span>`;
    }

    const count = this.notifications.length;
    const badge = count > 0 ? html`<div class="badge-indicator">${count}</div>` : '';
    const title = count === 0 ? 'No Problems' : `${count} Problem${count === 1 ? '' : 's'}`;

    const messages = this._renderNotificationMessages();

    return html` <div class="problems-container">
      <vscode-button
        appearance="icon"
        aria-label="${title}"
        title="${title}"
        @click=${this._togglePanel}
      >
        <span class="codicon codicon-warning problems-icon"></span>
        ${badge}
      </vscode-button>
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
      return (sortOrder.get(a.severity) || 999) - (sortOrder.get(b.severity) || 999);
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
