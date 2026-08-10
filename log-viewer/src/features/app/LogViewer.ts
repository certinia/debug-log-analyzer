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
import { TAB_TO_SOURCE, eventBus } from '../../core/events/EventBus.js';
import {
  VSCodeExtensionMessenger,
  vscodeMessenger,
} from '../../core/messaging/VSCodeExtensionMessenger.js';
import { DatabaseAccess } from '../database/services/Database.js';
import type { LogIssue } from '../notifications/types.js';
import { installEscapeDeselect } from './escapeDeselect.js';
import { deriveLogIdentity, type LogIdentityData } from './logIdentity.js';
import { toLogIssue } from './logIssues.js';
import { parserIssuesToNotifications } from './parserNotifications.js';

// styles
import { globalStyles } from '../../styles/global.styles.js';

// web components
import './AppHeader.js';
import '../../components/LogInspector.js';

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
  /** Problems found in the log itself. `null` until the first log is parsed. */
  @property({ attribute: false })
  logProblems: readonly LogIssue[] | null = null;
  /** Notifications about the tool — today, parser diagnostics. */
  @property({ attribute: false })
  notifications: readonly LogIssue[] = [];
  /** Transaction identity for the header. `null` until the first log is parsed. */
  @property({ attribute: false })
  logIdentity: LogIdentityData | null = null;
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
        /* Half of the x=16 guide the header and tabs share (see AppHeader). */
        padding: 0 var(--lana-space-sm);
      }

      vscode-tabs {
        --vscode-panel-background: var(--vscode-editor-background);

        display: flex;
        flex-direction: column;
        /* Slotted into the inspector's main area, so fill it as a flex
           item rather than relying on height:100%. */
        flex: 1 1 auto;
        min-width: 0;
        min-height: 0;
      }

      vscode-tab-panel {
        flex: 1;
        min-height: 0;
        overflow: auto;
        box-sizing: border-box;
        /* No padding here: each view owns its own inset so a docked details
           panel can sit flush to the window edge. */
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
    vscodeMessenger
      .request<LogDataEvent>('fetchLog')
      .then((msg) => this._handleLogFetch(msg))
      .catch((error: unknown) => {
        this.logProblems = [this._logRequestError(error)];
      });

    document.addEventListener('show-tab', (e: Event) => {
      this._showTabEvent(e);
    });

    // Escape, when nothing else claims it, deselects on the active tab.
    installEscapeDeselect(() => TAB_TO_SOURCE[this._selectedTab]);

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
        .logProblems=${this.logProblems}
        .notifications=${this.notifications}
        .logIdentity=${this.logIdentity}
        .timelineRoot=${this.timelineRoot}
      ></app-header>

      <log-inspector .activeTab=${this._selectedTab}>
        <vscode-tabs
          slot="main"
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
          </vscode-tab-panel> </vscode-tabs
      ></log-inspector>`;
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
    const read = data.logData
      ? { logData: data.logData, error: null }
      : await this._readLog(logUri || '');
    const logData = read.logData;

    // Published before parsing, so a throw further down can't discard the only
    // explanation the user would get. `logProblems` stays null while parsing otherwise.
    if (read.error) {
      this.logProblems = [read.error];
    }

    let apexLog: ApexLog;
    try {
      apexLog = parse(logData);
    } catch (err) {
      // Resolve the identity even when parsing throws, or the header's identity
      // skeletons would pulse forever with nothing left to fill them.
      this.logIdentity = { entryPoint: null, user: null, startTime: null };
      throw err;
    }

    // The event-lookup service backs the inspector on every tab, so it is
    // created with the parsed log rather than by whichever tab loads first.
    await DatabaseAccess.create(apexLog);
    // After the service holds the log, never before: whole-log content reads it
    // straight from there.
    eventBus.emit('log:loaded', {});

    this.logSize = apexLog.size;
    this.timelineRoot = apexLog;
    this.logDuration = apexLog.duration.total;
    // Raw text is needed for the user: USER_INFO precedes EXECUTION_STARTED, so the
    // parser never sees it. See deriveLogIdentity.
    this.logIdentity = deriveLogIdentity(apexLog, logData);

    // Rebuilt per load, never appended to: both surfaces describe *this* log, so a
    // previous log's problems must not carry over.
    this.logProblems = [...(read.error ? [read.error] : []), ...apexLog.logIssues.map(toLogIssue)];

    this.notifications = parserIssuesToNotifications(apexLog.parsingErrors);

    // Navigate to event location if requested (passed as prop to timeline-view)
    if (data.navigateToEventIndex !== undefined || data.navigateToTimestamp !== undefined) {
      this._showTab('timeline-tab');
      this._navigateToEventIndex = data.navigateToEventIndex;
      this._navigateToTimestamp = data.navigateToTimestamp;
    }
  }

  private _logRequestError(error: unknown): LogIssue {
    return {
      summary: 'Could not load log',
      message: error instanceof Error ? error.message : String(error),
      severity: 'error',
      label: null,
      action: null,
      category: null,
      timestamp: null,
    };
  }

  /**
   * Reads the log, returning the failure as a {@link LogIssue} rather than publishing it —
   * the caller owns `logProblems` so it can rebuild the list for each load.
   */
  async _readLog(logUri: string): Promise<{ logData: string; error: LogIssue | null }> {
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
        return { logData: chunks.join(''), error: null };
      } catch (err: unknown) {
        msg = (err instanceof Error ? err.message : String(err)) ?? '';
      }
    } else {
      msg = 'Invalid Log Path';
    }

    return {
      logData: '',
      error: {
        summary: 'Could not read log',
        message: msg,
        severity: 'error',
        label: null,
        action: null,
        category: null,
        timestamp: null,
      },
    };
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
