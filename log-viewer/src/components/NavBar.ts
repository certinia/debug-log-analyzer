/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { provideVSCodeDesignSystem, vsCodeButton } from '@vscode/webview-ui-toolkit';
import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { vscodeMessenger } from '../core/messaging/VSCodeExtensionMessenger.js';
import { formatDuration } from '../core/utility/Util.js';
import { Notification } from '../features/notifications/components/NotificationPanel.js';

// styles
import codiconStyles from '../styles/codicon.css';
import { globalStyles } from '../styles/global.styles.js';
import { notificationStyles } from '../styles/notification.styles.js';

// web components
import '../features/notifications/components/NotificationButton.js';
import '../features/notifications/components/NotificationPanel.js';
import './BadgeBase.js';
import './DotSeparator.js';
import './LogMeta.js';
import './LogProblems.js';
import './LogTitle.js';

provideVSCodeDesignSystem().register(vsCodeButton());

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
    unsafeCSS(codiconStyles),
    css`
      :host {
        display: flex;
        flex-direction: column;
        justify-content: center;
        color: var(--vscode-editor-foreground);
        ${notificationStyles}
      }

      vscode-button {
        height: 22px;
        width: 22px;
      }

      .navbar {
        display: inline-flex;
        justify-content: space-between;
        font-family: var(--vscode-font-family);
        align-items: center;
      }

      .navbar--left {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .navbar--right {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding-right: 4px;
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
          <dot-separator></dot-separator>
          <log-meta logFileSize="${sizeText}" logDuration="${elapsedText}"></log-meta>
          <log-problems .notifications="${this.notifications}"></log-problems>
        </div>
        <div class="navbar--right">
          <notification-button .notifications="${this.parserIssues}"></notification-button>
          <vscode-button
            appearance="icon"
            aria-label="Help"
            title="Help"
            @click=${() => {
              vscodeMessenger.send('openHelp');
            }}
          >
            <span class="codicon codicon-question"></span>
          </vscode-button>
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

    return (fileSize / 1_000_000).toFixed(2) + ' MB';
  }
}
