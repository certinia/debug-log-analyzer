/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { provideVSCodeDesignSystem, vsCodeButton, vsCodeTag } from '@vscode/webview-ui-toolkit';
import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { hostService } from '../services/VSCodeService.js';
import codiconStyles from '../styles/codicon.css';
import { globalStyles } from '../styles/global.styles.js';
import { notificationStyles } from '../styles/notification.styles.js';
import './BadgeBase.js';
import './LogTitle.js';
import './notifications/NotificationButton.js';
import './notifications/NotificationPanel.js';
import { Notification } from './notifications/NotificationPanel.js';
import './notifications/NotificationTag.js';

provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeTag());

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
  logStatus = 'Processing...';

  @property()
  notifications: Notification[] = [];

  @property()
  parserIssues: Notification[] = [];

  static styles = [
    globalStyles,
    unsafeCSS(codiconStyles),
    css`
      :host {
        color: var(--vscode-editor-foreground);
        ${notificationStyles}
      }

      .navbar {
        padding-top: 4px;
        display: flex;
        gap: 10px;
      }

      .navbar--left {
        display: flex;
        width: 100%;
        position: relative;
        align-items: center;
      }
      .navbar--right {
        display: flex;
        flex: 1 1 auto;
        justify-content: flex-end;
        align-items: center;
        display: flex;
      }

      .log__information {
        display: flex;
        width: 100%;
        position: relative;
        white-space: nowrap;
        align-items: center;
        font-size: 1rem;
        padding: 4px 0px 4px 0px;
        gap: 5px;
      }

      .icon-button {
        width: 32px;
        height: 32px;
      }

      .codicon.icon {
        font-size: 22px;
        width: 20px;
        height: 20px;
      }
    `,
  ];

  render() {
    const sizeText = this._toSize(this.logSize),
      elapsedText = this._toDuration(this.logDuration);

    const status =
      this.notifications.length > 0
        ? 'failure'
        : this.logStatus !== 'Processing...'
          ? 'success'
          : '';

    return html`
      <div class="navbar">
        <div class="navbar--left">
          <div class="log__information">
            <log-title logName="${this.logName}" logPath="${this.logPath}"></log-title>
            <badge-base .isloading="${!sizeText}">${sizeText}</badge-base>
            <badge-base .isloading="${!elapsedText}">${elapsedText}</badge-base>
            <badge-base status="${status}">${this.logStatus}</badge-base>
            <notification-tag .notifications="${this.notifications}"></notification-tag>
          </div>
        </div>
        <div class="navbar--right">
        <notification-button .notifications="${this.parserIssues}"></notification-button>
          <vscode-button
            appearance="icon"
            aria-label="Help"
            class="icon-button"
            title="Help"
            @click=${() => {
              hostService().openHelp();
            }}
          >
            <span class="codicon icon codicon-question"</span>
          </vscode-button>
        </div>
      </div>
    `;
  }

  _goToLog() {
    hostService().openPath(this.logPath);
  }

  _toDuration(duration: number | null) {
    if (!duration && duration !== 0) {
      return '';
    }

    return (duration / 1_000_000_000).toFixed(3) + 's';
  }

  _toSize(fileSize: number | null) {
    if (!fileSize && fileSize !== 0) {
      return '';
    }

    return (fileSize / 1000000).toFixed(2) + ' MB';
  }
}
