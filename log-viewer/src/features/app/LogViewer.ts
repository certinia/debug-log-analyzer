/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-icon.js';
import '#vscode-elements/vscode-tab-header.js';
import '#vscode-elements/vscode-tab-panel.js';
import '#vscode-elements/vscode-tabs.js';
import type { VscTabsSelectEvent } from '@vscode-elements/elements/dist/vscode-tabs/vscode-tabs.js';
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { parse, type ApexLog } from 'apex-log-parser';
import { eventBus } from '../../core/events/EventBus.js';
import {
  VSCodeExtensionMessenger,
  vscodeMessenger,
} from '../../core/messaging/VSCodeExtensionMessenger.js';
import {
  Notification,
  type NotificationSeverity,
} from '../notifications/components/NotificationPanel.js';

// styles
import { globalStyles } from '../../styles/global.styles.js';

// web components
import './AppHeader.js';

interface NavigateToTimelinePayload {
  timestamp: number;
}

// Tab ids in display order; vscode-tabs is index based so this maps
// index <-> id for the string-id based 'show-tab' events used app-wide.
const TAB_IDS = ['timeline-tab', 'tree-tab', 'analysis-tab', 'database-tab'];

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

  @state()
  _selectedTab = 'timeline-tab';

  @state()
  _selectedIndex = 0;

  @state()
  private _navigateToEventIndex: number | undefined = undefined;

  @state()
  private _navigateToTimestamp: number | undefined = undefined;

  static styles = [
    globalStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-width: 0;
        /* keep the layout bounded to the viewport so header children (e.g. the
           log-levels row) can detect overflow rather than widening the page.
           clip (not hidden) avoids forcing overflow-y to auto. */
        overflow-x: clip;
        padding: 0px 8px 0px 8px;
      }

      vscode-tabs {
        --vscode-panel-background: var(--vscode-editor-background);

        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }

      vscode-tab-panel {
        flex: 1;
        min-height: 0;
        overflow: auto;
        box-sizing: border-box;
        /* the toolkit's vscode-panel-view padding */
        padding: 10px 6px;
        box-shadow: inset 0 calc(max(1px, 0.0625rem) * 1)
          var(--vscode-panelSectionHeader-background);
      }

      /* icon + label as one flex row, like the toolkit's tabs; also restores
         the previous label styling — vscode-tab-header's panel mode defaults
         to 11px uppercase */
      vscode-tab-header .tab-header {
        display: flex;
        align-items: center;
        column-gap: 0.3em;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size, 13px);
        text-transform: none;
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

    // Listen for navigation messages from the extension
    VSCodeExtensionMessenger.listen<NavigateToTimelinePayload>((event) => {
      const { cmd, payload } = event.data;
      if (cmd !== 'navigateToTimeline' || payload?.timestamp === undefined) {
        return;
      }
      this._showTab('timeline-tab');
      eventBus.emit('timeline:navigate-to', { timestamp: payload.timestamp });
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
      ></app-header>

      <vscode-tabs
        panel
        .selectedIndex="${this._selectedIndex}"
        @vsc-tabs-select="${this._onTabSelect}"
      >
        <vscode-tab-header slot="header">
          <span class="tab-header"><vscode-icon name="graph"></vscode-icon>Timeline</span>
        </vscode-tab-header>
        <vscode-tab-header slot="header">
          <span class="tab-header"><vscode-icon name="list-tree"></vscode-icon>Call Tree</span>
        </vscode-tab-header>
        <vscode-tab-header slot="header">
          <span class="tab-header"><vscode-icon name="code"></vscode-icon>Analysis</span>
        </vscode-tab-header>
        <vscode-tab-header slot="header">
          <span class="tab-header"><vscode-icon name="database"></vscode-icon>Database</span>
        </vscode-tab-header>

        <vscode-tab-panel>
          <timeline-view
            .timelineRoot="${this.timelineRoot}"
            .navigateToEventIndex="${this._navigateToEventIndex}"
            .navigateToTimestamp="${this._navigateToTimestamp}"
          ></timeline-view>
        </vscode-tab-panel>
        <vscode-tab-panel>
          <call-tree-view .timelineRoot="${this.timelineRoot}"></call-tree-view>
        </vscode-tab-panel>
        <vscode-tab-panel>
          <analysis-view .timelineRoot="${this.timelineRoot}"> </analysis-view>
        </vscode-tab-panel>
        <vscode-tab-panel>
          <database-view .timelineRoot="${this.timelineRoot}"></database-view>
        </vscode-tab-panel>
      </vscode-tabs>`;
  }

  _onTabSelect(e: VscTabsSelectEvent) {
    const tabId = TAB_IDS[e.detail.selectedIndex];
    if (tabId) {
      this._showTab(tabId);
    }
  }

  _showTabEvent(e: Event) {
    const tabId = (e as CustomEvent).detail.tabid;
    this._showTab(tabId);
  }

  _showTab(tabId: string) {
    if (this._selectedTab !== tabId) {
      this._selectedTab = tabId;
      const index = TAB_IDS.indexOf(tabId);
      if (index !== -1) {
        this._selectedIndex = index;
      }

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
      logMessage.eventIndex = element.eventIndex ?? null;
      logMessage.timestamp = element.startTime || null;
      localNotifications.push(logMessage);
    });
    this.notifications = localNotifications;

    this.parserIssues = this.parserIssuesToMessages(apexLog);

    // Navigate to event location if requested (passed as prop to timeline-view)
    if (data.navigateToEventIndex !== undefined || data.navigateToTimestamp !== undefined) {
      this._showTab('timeline-tab');
      this._navigateToEventIndex = data.navigateToEventIndex;
      this._navigateToTimestamp = data.navigateToTimestamp;
    }
  }

  async _readLog(logUri: string): Promise<string> {
    let msg;
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
  navigateToEventIndex?: number;
  navigateToTimestamp?: number;
}
