/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-icon.js';
import '#vscode-elements/vscode-tab-header.js';
import '#vscode-elements/vscode-tab-panel.js';
import '#vscode-elements/vscode-tabs.js';
import { provide } from '@lit/context';
import type { VscTabsSelectEvent } from '@vscode-elements/elements/dist/vscode-tabs/vscode-tabs.js';
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { parse } from '@apexdevtools/apex-log-parser';
import type { LogLevelsChange } from '../../components/LogLevels.js';
import { TAB_TO_SOURCE, eventBus } from '../../core/events/EventBus.js';
import { waitForNextFrame } from '../../core/utility/FrameBudget.js';
import { logContext } from '../../core/log/logContext.js';
import { logStatusContext, type LogStatus } from '../../core/log/logStatus.js';
import { setCurrentLog, type LogStore } from '../../core/log/LogStore.js';
import {
  VSCodeExtensionMessenger,
  vscodeMessenger,
} from '../../core/messaging/VSCodeExtensionMessenger.js';
import type { LogIssue } from '../notifications/types.js';
import { installEscapeDeselect } from './escapeDeselect.js';
import { LogLevelsController } from './LogLevelsController.js';
import { deriveLogIdentity, type LogIdentityData } from './logIdentity.js';
import { toLogIssues } from './logIssues.js';
import { parserIssuesToNotifications } from './parserNotifications.js';

// styles
import { globalStyles, srOnly } from '../../styles/global.styles.js';

// web components
import './AppHeader.js';
import '../../components/LogInspector.js';

interface NavigateToTimelinePayload {
  timestamp: number;
}

/** In tab-strip and panel order: `vscode-tabs` is index based, and `show-tab` events use the id. */
const TABS = [
  { id: 'timeline-tab', icon: 'graph', label: 'Timeline' },
  { id: 'tree-tab', icon: 'list-tree', label: 'Call Tree' },
  { id: 'analysis-tab', icon: 'code', label: 'Analysis' },
  { id: 'database-tab', icon: 'database', label: 'Database' },
];
const TAB_IDS = TABS.map((tab) => tab.id);

/** Every placeholder is `aria-hidden`, so this is the only telling. */
const LOAD_ANNOUNCEMENT: Record<LogStatus, string> = {
  parsing: 'Loading log',
  ready: 'Log loaded',
  failed: 'The log could not be loaded',
};

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
  /** The log every view reads. A new log is a new store, so consumers re-render. */
  @provide({ context: logContext })
  @state()
  private _logStore: LogStore | null = null;

  @provide({ context: logStatusContext })
  @state()
  private _logStatus: LogStatus = 'parsing';

  @state()
  _selectedTab = 'timeline-tab';

  @state()
  _selectedIndex = 0;

  @state()
  private _navigateToEventIndex: number | undefined = undefined;

  @state()
  private _navigateToTimestamp: number | undefined = undefined;

  private readonly _levels = new LogLevelsController(this, {
    publish: (log) => (this._logStore = setCurrentLog(log)),
    fail: (err) =>
      (this.notifications = [
        ...this.notifications,
        loadFailure('Could not apply log levels', err),
      ]),
  });

  /** A live region is read when its text changes, not when it arrives holding some. */
  @state()
  private _announced = false;

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
        --vscode-panel-background: var(--lana-editor-bg);

        display: flex;
        flex-direction: column;
        /* Slotted into the inspector's main area, so fill it as a flex
           item rather than relying on height:100%. */
        flex: 1 1 auto;
        min-width: 0;
        min-height: 0;
        container-type: inline-size;
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
        font-family: var(--lana-font-ui);
        font-size: var(--lana-text-lg);
        text-transform: none;
      }

      /* Too narrow for the TABS labels (about 23rem for four): icons only. Re-check on a new tab. The
         label stays the tab's accessible name. */
      @container (max-width: 25rem) {
        vscode-tab-header .tab-label {
          ${srOnly}
        }
      }
    `,
  ];

  constructor() {
    super();
    void vscodeMessenger
      .request<LogDataEvent>('fetchLog')
      .then((msg) => this._handleLogFetch(msg))
      .catch((err: unknown) => {
        this._failLoad(loadFailure('Could not load log', err));
        throw err;
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
    return html`<div class="sr-only" role="status" aria-live="polite">
        ${this._announced ? LOAD_ANNOUNCEMENT[this._logStatus] : ''}
      </div>

      <app-header
        .logName=${this.logName}
        .logPath=${this.logPath}
        .logSize=${this.logSize}
        .logDuration=${this.logDuration}
        .logProblems=${this.logProblems}
        .notifications=${this.notifications}
        .logIdentity=${this.logIdentity}
        .capturedLevels=${this._levels.captured?.debugLevels ?? null}
        .chosenLevels=${this._levels.chosen}
        .levelsBusy=${this._levels.busy}
        @log-levels-change=${this._onLogLevelsChange}
        @log-levels-reset=${this._onLogLevelsReset}
      ></app-header>

      <log-inspector .activeTab=${this._selectedTab}>
        <vscode-tabs
          slot="main"
          panel
          .selectedIndex="${this._selectedIndex}"
          @vsc-tabs-select="${this._onTabSelect}"
        >
          ${TABS.map(
            ({ icon, label }) =>
              html`<vscode-tab-header slot="header">
                <span class="tab-header" title=${label}
                  ><vscode-icon name=${icon}></vscode-icon
                  ><span class="tab-label">${label}</span></span
                >
              </vscode-tab-header>`,
          )}

          <vscode-tab-panel>
            <timeline-view
              .navigateToEventIndex="${this._navigateToEventIndex}"
              .navigateToTimestamp="${this._navigateToTimestamp}"
            ></timeline-view>
          </vscode-tab-panel>
          <vscode-tab-panel>
            <call-tree-view></call-tree-view>
          </vscode-tab-panel>
          <vscode-tab-panel>
            <analysis-view></analysis-view>
          </vscode-tab-panel>
          <vscode-tab-panel>
            <database-view></database-view>
          </vscode-tab-panel> </vscode-tabs
      ></log-inspector>`;
  }

  protected override firstUpdated(): void {
    // Fills the region a pass after it exists, so the parsing state is a change.
    this._announced = true;
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

      void this._refreshFind();
    }
  }

  // The new tab's panel shows only once the tabs have rendered too.
  private async _refreshFind(): Promise<void> {
    await this.updateComplete;
    await waitForNextFrame();
    document.dispatchEvent(new CustomEvent('lv-find-refresh', { detail: null }));
  }

  async _handleLogFetch(data: LogDataEvent) {
    this.logName = data.logName?.trim() || '';
    this.logPath = data.logPath?.trim() || '';

    const logUri = data.logUri;
    const read = data.logData
      ? { logData: data.logData, error: null }
      : await this._readLog(logUri || '');
    const logData = read.logData;

    // `parse('')` succeeds, so without this a log that could not be read reports
    // itself as an empty one and every section prints its own "nothing here" line.
    if (read.error) {
      this._failLoad(read.error);
      return;
    }

    // A throw here rejects `_handleLogFetch`, which the constructor's `catch` publishes.
    const apexLog = parse(logData);

    // Published before the views render, so every tab reads the same log
    // whichever one loads first.
    this._logStore = setCurrentLog(apexLog);
    this._logStatus = 'ready';
    this._levels.open(apexLog);

    this.logSize = apexLog.size;
    this.logDuration = apexLog.duration.total;
    this.logIdentity = deriveLogIdentity(apexLog);

    // Rebuilt per load, never appended to: it describes *this* log, so a previous
    // log's problems must not carry over.
    this.logProblems = toLogIssues(apexLog);

    this.notifications = parserIssuesToNotifications(apexLog.parsingErrors);

    // Navigate to event location if requested (passed as prop to timeline-view)
    if (data.navigateToEventIndex !== undefined || data.navigateToTimestamp !== undefined) {
      this._showTab('timeline-tab');
      this._navigateToEventIndex = data.navigateToEventIndex;
      this._navigateToTimestamp = data.navigateToTimestamp;
    }
  }

  private _onLogLevelsChange(event: CustomEvent<LogLevelsChange>): void {
    void this._levels.choose(event.detail.category, event.detail.level);
  }

  private _onLogLevelsReset(): void {
    this._levels.reset();
  }

  private _failLoad(problem: LogIssue) {
    // Every placeholder stops on `failed`, so with no problem card the window
    // empties silently.
    this._logStatus = 'failed';
    this.logProblems = [...(this.logProblems ?? []), problem];
  }

  /**
   * Reads the log, returning the failure as a {@link LogIssue} rather than publishing it —
   * the caller owns `logProblems` so it can rebuild the list for each load.
   */
  async _readLog(logUri: string): Promise<{ logData: string; error: LogIssue | null }> {
    let cause: unknown;
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
        cause = err;
      }
    } else {
      cause = 'Invalid Log Path';
    }

    return { logData: '', error: loadFailure('Could not read log', cause) };
  }
}

function loadFailure(summary: string, err: unknown): LogIssue {
  return {
    summary,
    message: err instanceof Error ? err.message : String(err),
    severity: 'error',
    label: null,
    action: null,
    category: null,
    timestamp: null,
  };
}

interface LogDataEvent {
  logName?: string;
  logUri?: string;
  logPath?: string;
  logData?: string;
  navigateToEventIndex?: number;
  navigateToTimestamp?: number;
}
