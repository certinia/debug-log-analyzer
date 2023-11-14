/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { ApexLog, parse } from '../parsers/ApexLogParser.js';
import { hostService } from '../services/VSCodeService.js';
import { globalStyles } from '../styles/global.styles.js';
import './AppHeader.js';
import { Notification } from './notifications/NotificationPanel.js';

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
  parserIssues: Notification[] = [];
  @property()
  timelineRoot: ApexLog | null = null;

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
      .parserIssues=${this.parserIssues}
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

    const apexLog = parse(logData);

    this.logSize = apexLog.size;
    this.timelineRoot = apexLog;
    this.logDuration = apexLog.duration;
    document.dispatchEvent(
      new CustomEvent('logsettings', {
        detail: { logSettings: this.timelineRoot?.debugLevels },
      }),
    );

    const localNotifications = Array.from(this.notifications);
    apexLog.logIssues.forEach((element) => {
      const severity = element.type === 'error' ? 'Error' : 'Warning';

      const logMessage = new Notification();
      logMessage.summary = element.summary;
      logMessage.message = element.description;
      logMessage.severity = severity;
      localNotifications.push(logMessage);
    });
    this.notifications = localNotifications;

    this.parserIssues = this.parserIssuesToMessages(apexLog);

    this.logStatus = 'Ready';
  }

  async _readLog(logUri: string): Promise<string> {
    if (logUri) {
      return fetch(logUri)
        .then((response) => {
          if (response.ok) {
            return response.text();
          } else {
            throw Error(response.statusText || `Error reading log file: ${response.status}`);
          }
        })
        .catch((err: unknown) => {
          let msg;
          if (err instanceof Error) {
            msg = err.name === 'TypeError' ? name : err.message;
          } else {
            msg = String(err);
          }
          const logMessage = new Notification();
          logMessage.summary = 'Could not read log';
          logMessage.message = msg || '';
          logMessage.severity = 'Error';
          this.notifications.push(logMessage);

          return Promise.resolve('');
        });
    } else {
      return Promise.resolve('');
    }
  }

  private parserIssuesToMessages(apexLog: ApexLog) {
    const issues: Notification[] = [];
    apexLog.parsingErrors.forEach((message) => {
      const isUnknownType = this.isUnknownType(message);

      const logMessage = new Notification();
      logMessage.summary = isUnknownType ? message : message.slice(0, message.indexOf(':'));
      logMessage.message = isUnknownType
        ? html`<a
            href=${`command:vscode.open?${encodeURIComponent(
              JSON.stringify('https://github.com/certinia/debug-log-analyzer/issues'),
            )}`}
            >report unsupported type</a
          >`
        : message.slice(message.indexOf(':') + 1);
      logMessage.severity = 'Info';
      issues.push(logMessage);
    });
    return issues;
  }

  private isUnknownType(message: string) {
    return message.startsWith('Unsupported log event name:');
  }
}
