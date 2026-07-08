/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-toolbar-button.js';
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { vscodeMessenger } from '../core/messaging/VSCodeExtensionMessenger.js';
import { formatDuration } from '../core/utility/Util.js';
import type { Notification } from '../features/notifications/components/NotificationPanel.js';

// styles
import { globalStyles } from '../styles/global.styles.js';
import { notificationStyles } from '../styles/notification.styles.js';

// web components
import '../features/notifications/components/NotificationButton.js';
import '../features/notifications/components/NotificationPanel.js';
import './BadgeBase.js';
import './Divider.js';
import './DotSeparator.js';
import './LogMeta.js';
import './LogProblems.js';
import './LogTitle.js';

@customElement('nav-bar')
export class NavBar extends LitElement {
  @property()
  logName = '';

  @property()
  logPath = '';

  @property()
  logSize = null;

  @property()
  logDuration = null;

  @property()
  notifications: Notification[] | null = null;

  @property()
  parserIssues: Notification[] = [];

  static styles = [
    globalStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        justify-content: center;
        color: var(--vscode-editor-foreground);
        ${notificationStyles}
      }

      .navbar {
        display: flex;
        gap: 8px;
        justify-content: space-between;
        font-family: var(--vscode-font-family);
        align-items: center;
        min-width: 0;
      }

      .navbar--left {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        flex: 1 1 auto;
      }

      .navbar--left-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        flex: 0 1 auto;
      }

      .navbar--right {
        display: flex;
        align-items: center;
        gap: 4px;
        padding-right: 4px;
        flex: 0 0 auto;
      }
    `,
  ];

  render() {
    const sizeText = this._toSize(this.logSize),
      elapsedText = this._formatDuration(this.logDuration);

    return html`
      <div class="navbar">
        <div class="navbar--left">
          <log-title logName="${this.logName}" logPath="${this.logPath}"></log-title>
          <div class="navbar--left-meta">
            <dot-separator></dot-separator>
            <log-meta logFileSize="${sizeText}" logDuration="${elapsedText}"></log-meta>
            <divider-line orientation="vertical"></divider-line>
            <log-problems .notifications="${this.notifications}"></log-problems>
          </div>
        </div>
        <div class="navbar--right">
          <notification-button .notifications="${this.parserIssues}"></notification-button>
          <vscode-toolbar-button
            icon="question"
            label="Help"
            title="Help"
            @click=${() => {
              vscodeMessenger.send('openHelp');
            }}
          ></vscode-toolbar-button>
        </div>
      </div>
    `;
  }

  _goToLog() {
    vscodeMessenger.send('openPath', this.logPath);
  }

  _formatDuration(duration: number | null) {
    if (!duration && duration !== 0) {
      return '';
    }

    return formatDuration(duration);
  }

  _toSize(fileSize: number | null) {
    if (!fileSize && fileSize !== 0) {
      return '';
    }

    return parseFloat((fileSize / 1_000_000).toFixed(2)) + ' MB';
  }
}
