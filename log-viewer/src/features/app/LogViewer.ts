/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { parse } from '../../core/log-parser/ApexLogParser.js';
import { type ApexLog } from '../../core/log-parser/LogEvents.js';
import { vscodeMessenger } from '../../core/messaging/VSCodeExtensionMessenger.js';
import {
  Notification,
  type NotificationSeverity,
} from '../notifications/components/NotificationPanel.js';
import { getSettings } from '../settings/Settings.js';
import type { TimelineGroup } from '../timeline/services/Timeline.js';
import { keyMap, setColors } from '../timeline/services/Timeline.js';

// styles
import { globalStyles } from '../../styles/global.styles.js';

// web components
import './AppHeader.js';

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
  notifications: Notification[] | null = null;
  @property()
  parserIssues: Notification[] = [];
  @property()
  timelineRoot: ApexLog | null = null;
  @property()
  timelineKeys: TimelineGroup[] = [];

  @state()
  _selectedTab = 'timeline-tab';

  static styles = [
    globalStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        padding: 0px 8px 0px 8px;

        --panel-tab-active-foreground: var(--vscode-panelTitle-activeBorder);
        --panel-tab-selected-text: var(--vscode-panelTitle-activeForeground, #e7e7e7);
      }

      vscode-panels {
        height: 100%;
      }

      vscode-panels::part(tabpanel) {
        overflow: auto;
        box-shadow: inset 0 calc(max(1px, 0.0625rem) * 1)
          var(--vscode-panelSectionHeader-background);
      }

      vscode-panel-view {
        height: 100%;
      }

      vscode-panel-tab[aria-selected='true'] {
        color: var(--panel-tab-selected-text);
      }

      vscode-panel-tab:hover {
        color: var(--panel-tab-selected-text);
      }
    `,
  ];

  constructor() {
    super();
    vscodeMessenger.request<LogDataEvent>('fetchLog').then((msg) => {
      this._handleLogFetch(msg);
    });

    document.addEventListener('show-tab', (e: Event) => {
      this._showTabEvent(e);
    });

    getSettings().then((settings) => {
      setColors(settings.timeline.colors);
      this.timelineKeys = Array.from(keyMap.values());
    });
  }

  render() {
    return html`<app-header
        .logName=${this.logName}
        .logPath=${this.logPath}
        .logSize=${this.logSize}
        .logDuration=${this.logDuration}
        .notifications=${this.notifications}
        .parserIssues=${this.parserIssues}
        .timelineRoot=${this.timelineRoot}
        .timelineKeys=${this.timelineKeys}
      ></app-header>

      <vscode-panels activeid="${this._selectedTab}">
        <vscode-panel-tab
          id="timeline-tab"
          data-show="timeline-view"
          @click="${this._showTabHTMLElem}"
        >
          <span class="codicon codicon-graph">&nbsp;</span>
          <span>Timeline</span>
        </vscode-panel-tab>
        <vscode-panel-tab
          id="tree-tab"
          data-show="call-tree-view"
          @click="${this._showTabHTMLElem}"
        >
          <span class="codicon codicon-list-tree">&nbsp;</span>
          <span>Call Tree</span>
        </vscode-panel-tab>
        <vscode-panel-tab
          id="analysis-tab"
          data-show="analysis-view"
          @click="${this._showTabHTMLElem}"
        >
          <span class="codicon codicon-code">&nbsp;</span>
          <span>Analysis</span>
        </vscode-panel-tab>
        <vscode-panel-tab id="database-tab" data-show="db-view" @click="${this._showTabHTMLElem}">
          <span class="codicon codicon-database">&nbsp;</span>
          <span>Database</span>
        </vscode-panel-tab>

        <vscode-panel-view id="view1">
          <timeline-view
            .timelineRoot="${this.timelineRoot}"
            .timelineKeys="${this.timelineKeys}"
          ></timeline-view>
        </vscode-panel-view>
        <vscode-panel-view id="view2">
          <call-tree-view .timelineRoot="${this.timelineRoot}"></call-tree-view>
        </vscode-panel-view>
        <vscode-panel-view id="view3">
          <analysis-view .timelineRoot="${this.timelineRoot}"> </analysis-view>
        </vscode-panel-view>
        <vscode-panel-view id="view4">
          <database-view .timelineRoot="${this.timelineRoot}"></database-view>
        </vscode-panel-view>
      </vscode-panels>`;
  }

  _showTabHTMLElem(e: Event) {
    const input = e.currentTarget as HTMLElement;
    this._showTab(input.id);
  }

  _showTabEvent(e: Event) {
    const tabId = (e as CustomEvent).detail.tabid;
    this._showTab(tabId);
  }

  _showTab(tabId: string) {
    if (this._selectedTab !== tabId) {
      this._selectedTab = tabId;

      // Not really happy this is here, find needs a refactor
      const findEvt = {
        detail: {
          text: '',
          count: 0,
          options: { matchCase: false },
        },
      };
      document.dispatchEvent(new CustomEvent('lv-find', findEvt));
    }
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

    const localNotifications = Array.from(this.notifications ?? []);
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
  }

  async _readLog(logUri: string): Promise<string> {
    let msg = '';
    if (logUri) {
      try {
        const response = await fetch(logUri);
        if (!response.ok || !response.body) {
          throw new Error(response.statusText || `Error reading log file: ${response.status}`);
        }

        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        const chunks: string[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          chunks.push(value);
        }
        return chunks.join('');
      } catch (err: unknown) {
        msg = (err instanceof Error ? err.message : String(err)) ?? '';
      }
    } else {
      msg = 'Invalid Log Path';
    }

    const logMessage = new Notification();
    logMessage.summary = 'Could not read log';
    logMessage.message = msg;
    logMessage.severity = 'Error';
    this.notifications = [logMessage];
    return '';
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
