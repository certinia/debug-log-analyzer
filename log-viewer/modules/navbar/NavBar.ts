/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { provideVSCodeDesignSystem, vsCodeButton, vsCodeTag } from '@vscode/webview-ui-toolkit';
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import '../components/LogTitle';
import '../notifications/NotificationPanel';
import { Notification } from '../notifications/NotificationPanel';
import '../notifications/NotificationTag';
import { hostService } from '../services/VSCodeService';

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

  static styles = css`
    :host {
      color: var(--vscode-editor-foreground);
    }

    .navbar {
      margin-top: 10px;
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

    #status {
      align-items: center;
      font-size: 1rem;
      margin-bottom: 5px;
      margin-top: 5px;
      gap: 5px;
    }
    .status__bar {
      display: flex;
      width: 100%;
      position: relative;
      white-space: nowrap;
    }

    a {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
      cursor: pointer;

      &:hover {
        color: var(--vscode-textLink-activeForeground);
        text-decoration: underline;
      }

      &:active {
        background: transparent;
        color: var(--vscode-textLink-activeForeground);
      }
    }

    .status-tag {
      font-family: monospace;
      font-size: inherit;
    }

    .status-tag::part(control) {
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

    .icon {
      width: 32px;
      height: 32px;
    }
    .icon-svg {
      width: 20px;
      height: 20px;
    }
  `;

  render() {
    const sizeText = this.logSize ? (this.logSize / 1000000).toFixed(2) + ' MB' : '',
      elapsedText = this._toDuration(this.logDuration);

    const statusClass =
      this.notifications.length > 0
        ? 'failure-tag'
        : this.logStatus !== 'Processing...'
        ? 'success-tag'
        : '';

    return html`
      <div class="navbar">
        <div class="navbar--left">
          <div id="status" class="status__bar">
            <log-title logName="${this.logName}" logPath="${this.logPath}"></log-title>
            <vscode-tag class="status-tag">${sizeText}</vscode-tag>
            <vscode-tag class="status-tag">${elapsedText}</vscode-tag>
            <vscode-tag class="status-tag ${statusClass}">${this.logStatus}</vscode-tag>
            <notification-tag .notifications="${this.notifications}"></notification-tag>
          </div>
        </div>
        <div class="navbar--right">
          <vscode-button
            appearance="icon"
            aria-label="Help"
            title="Help"
            class="icon"
            @click=${() => {
              hostService().openHelp();
            }}
          >
            <svg
              class="icon-svg"
              viewBox="0 0 15 15"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M5.07505 4.10001C5.07505 2.91103 6.25727 1.92502 7.50005 1.92502C8.74283 1.92502 9.92505 2.91103 9.92505 4.10001C9.92505 5.19861 9.36782 5.71436 8.61854 6.37884L8.58757 6.4063C7.84481 7.06467 6.92505 7.87995 6.92505 9.5C6.92505 9.81757 7.18248 10.075 7.50005 10.075C7.81761 10.075 8.07505 9.81757 8.07505 9.5C8.07505 8.41517 8.62945 7.90623 9.38156 7.23925L9.40238 7.22079C10.1496 6.55829 11.075 5.73775 11.075 4.10001C11.075 2.12757 9.21869 0.775024 7.50005 0.775024C5.7814 0.775024 3.92505 2.12757 3.92505 4.10001C3.92505 4.41758 4.18249 4.67501 4.50005 4.67501C4.81761 4.67501 5.07505 4.41758 5.07505 4.10001ZM7.50005 13.3575C7.9833 13.3575 8.37505 12.9657 8.37505 12.4825C8.37505 11.9992 7.9833 11.6075 7.50005 11.6075C7.0168 11.6075 6.62505 11.9992 6.62505 12.4825C6.62505 12.9657 7.0168 13.3575 7.50005 13.3575Z"
                fill="currentColor"
                fill-rule="evenodd"
                clip-rule="evenodd"
              ></path>
            </svg>
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
}
