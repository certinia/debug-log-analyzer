/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import './app-header/AppHeader.js';
import { globalStyles } from './global.styles.js';
import { Notification } from './notifications/NotificationPanel.js';
import parseLog, {
  RootNode,
  TruncationColor,
  getLogSettings,
  getRootMethod,
  totalDuration,
  truncateLog,
  truncated,
} from './parsers/TreeParser.js';
import { hostService } from './services/VSCodeService.js';

@customElement('log-viewer')
export class LogViewer extends LitElement {
  @property({ type: String })
  logName = '';
  @property()
  logPath = '';
  @property()
  logSize: number | null = null;
  @property()
  logDuration: number | null = null;
  @property()
  logStatus = 'Processing...';
  @property()
  notifications: Notification[] = [];
  @property()
  timelineRoot: RootNode | null = null;

  static styles = [
    globalStyles,
    css`
      :host {
        width: 100%;
        height: 100%;
      }
    `,
  ];

  constructor() {
    super();
    window.addEventListener('message', (e: MessageEvent) => {
      this.handleMessage(e);
    });
    hostService().fetchLog();
  }

  render() {
    return html`<app-header
      .logName=${this.logName}
      .logPath=${this.logPath}
      .logSize=${this.logSize}
      .logDuration=${this.logDuration}
      .logStatus=${this.logStatus}
      .notifications=${this.notifications}
      .timelineRoot=${this.timelineRoot}
    ></app-header>`;
  }

  private async handleMessage(evt: MessageEvent) {
    const message = evt.data;
    switch (message.command) {
      case 'fetchLog':
        this._handleLogFetch(message.data);

        break;
    }
  }

  async _handleLogFetch(data: any) {
    this.logName = data.logName?.trim();
    this.logPath = data.logPath?.trim();

    const logUri = data.logUri;
    const logData = data.logData || (await this._readLog(logUri));
    this.logSize = logData.length;
    document.dispatchEvent(
      new CustomEvent('logsettings', {
        detail: { logSettings: getLogSettings(logData) },
      })
    );

    parseLog(logData).then(() => {
      this.timelineRoot = getRootMethod();
      this.logDuration = totalDuration;

      const localNotifications = Array.from(this.notifications);
      truncated.forEach((element) => {
        const severity = element.color === TruncationColor.error ? 'Error' : 'Warning';

        const logMessage = new Notification();
        logMessage.summary = element.reason;
        logMessage.message = element.description;
        logMessage.severity = severity;
        localNotifications.push(logMessage);
      });
      this.notifications = localNotifications;

      this.logStatus = 'Ready';
    });
  }

  async _readLog(logUri: string): Promise<string> {
    if (logUri) {
      return fetch(logUri)
        .then((response) => {
          if (response.ok) {
            return response.text();
          } else {
            throw Error(response.statusText);
          }
        })
        .catch((err: unknown) => {
          let msg;
          if (err instanceof Error) {
            msg = err.name === 'TypeError' ? name : err.message;
          } else {
            msg = String(err);
          }

          truncateLog(0, 'Could not read log', msg || '', 'error');
          return Promise.reject('');
        });
    } else {
      return Promise.resolve('');
    }
  }
}
