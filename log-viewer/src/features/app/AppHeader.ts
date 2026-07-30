/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { ApexLog } from 'apex-log-parser';
import type { LogIssue } from '../notifications/types.js';

// web components
import '../../components/LogLevels.js';
import '../../components/NavBar.js';
import '../analysis/components/AnalysisView.js';
import '../call-tree/components/CalltreeView.js';
import '../database/components/DatabaseView.js';
import '../find/components/FindWidget.js';
import '../timeline/components/TimelineView.js';

// styles
import { globalStyles } from '../../styles/global.styles.js';

@customElement('app-header')
export class AppHeader extends LitElement {
  @property({ type: String })
  logName = '';
  @property()
  logPath = '';
  @property()
  logSize = null;
  @property()
  logDuration = null;
  @property({ attribute: false })
  logProblems: readonly LogIssue[] | null = null;
  @property({ attribute: false })
  notifications: readonly LogIssue[] = [];
  @property()
  timelineRoot: ApexLog | null = null;

  static styles = [
    globalStyles,
    css`
      :host {
        background-color: var(--vscode-tab-activeBackground);
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        /* Match the tabs' box inset (LogViewer 8px + this 8px == tabs' 8px + their internal
           8px) so the log-title, first level chip, and first tab share one left/right guide. */
        padding: 0 8px;
      }
    `,
  ];

  render() {
    return html`
      <nav-bar
        .logName=${this.logName}
        .logPath=${this.logPath}
        .logSize=${this.logSize}
        .logDuration=${this.logDuration}
        .logProblems=${this.logProblems}
        .notifications=${this.notifications}
      ></nav-bar>
      <log-levels .logSettings=${this.timelineRoot?.debugLevels}></log-levels>
      <find-widget></find-widget>
    `;
  }
}
