/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { ApexLog, parse } from '../parsers/ApexLogParser.js';
import { vscodeMessenger } from '../services/VSCodeExtensionMessenger.js';
import { globalStyles } from '../styles/global.styles.js';
import type { TimelineGroup } from '../timeline/Timeline.js';
import './AppHeader.js';
import './find-widget/FindWidget.js';
import { Notification, type NotificationSeverity } from './notifications/NotificationPanel.js';

import { keyMap, setColors } from '../timeline/Timeline.js';

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
  @property()
  timelineKeys: TimelineGroup[] = [];

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
    vscodeMessenger.request<LogDataEvent>('fetchLog').then((msg) => {
      this._handleLogFetch(msg);
    });

    vscodeMessenger.request<VSCodeLanaConfig>('getConfig').then((msg) => {
      setColors(msg.timeline.colors);
      this.timelineKeys = Array.from(keyMap.values());
    });
  }

  render() {
    return html` <find-widget></find-widget>
      <app-header
        .logName=${this.logName}
        .logPath=${this.logPath}
        .logSize=${this.logSize}
        .logDuration=${this.logDuration}
        .logStatus=${this.logStatus}
        .notifications=${this.notifications}
        .parserIssues=${this.parserIssues}
        .timelineRoot=${this.timelineRoot}
        .timelineKeys=${this.timelineKeys}
      ></app-header>`;
  }

  async _handleLogFetch(data: LogDataEvent) {
    this.logName = data.logName?.trim() || '';
    this.logPath = data.logPath?.trim() || '';

    const logUri = data.logUri;
    const logData = data.logData || (await this._readLog(logUri || ''));

    const apexLog = parse(logData);

    this.logSize = apexLog.size;
    this.timelineRoot = apexLog;
    this.logDuration = apexLog.duration.total;

    const localNotifications = Array.from(this.notifications);
    apexLog.logIssues.forEach((element) => {
      const severity = this.toSeverity(element.type);

      const logMessage = new Notification();
      logMessage.summary = element.summary;
      logMessage.message = element.description;
      logMessage.severity = severity;
      logMessage.timestamp = element.startTime || null;
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
          const msg = err instanceof Error ? err.message : String(err);

          const logMessage = new Notification();
          logMessage.summary = 'Could not read log';
          logMessage.message = msg || '';
          logMessage.severity = 'Error';
          this.notifications.push(logMessage);
          return Promise.resolve('');
        });
    } else {
      const logMessage = new Notification();
      logMessage.summary = 'Could not read log';
      logMessage.message = 'Invalid Log Path';
      logMessage.severity = 'Error';
      this.notifications.push(logMessage);
      return Promise.resolve('');
    }
  }

  severity = new Map<string, NotificationSeverity>([
    ['error', 'Error'],
    ['unexpected', 'Warning'],
    ['skip', 'Info'],
  ]);
  private toSeverity(errorType: 'unexpected' | 'error' | 'skip') {
    return this.severity.get(errorType) || 'Info';
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

      issues.push(logMessage);
    });
    return issues;
  }

  private isUnknownType(message: string) {
    return message.startsWith('Unsupported log event name:');
  }
}

interface LogDataEvent {
  logName?: string;
  logUri?: string;
  logPath?: string;
  logData?: string;
}

/* eslint-disable @typescript-eslint/naming-convention */
interface VSCodeLanaConfig {
  timeline: {
    colors: {
      'Code Unit': '#88AE58';
      Workflow: '#51A16E';
      Method: '#2B8F81';
      Flow: '#337986';
      DML: '#285663';
      SOQL: '#5D4963';
      'System Method': '#5C3444';
    };
  };
}
