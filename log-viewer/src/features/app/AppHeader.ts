/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-progress-bar.js';
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { DebugLevels } from '../../core/log/levelFilter.js';
import type { LogIssue } from '../notifications/types.js';
import type { LogIdentityData } from './logIdentity.js';

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
  @property({ attribute: false })
  logIdentity: LogIdentityData | null = null;
  /** The levels the log was captured at; the log on screen states the levels shown. */
  @property({ attribute: false })
  capturedLevels: DebugLevels | null = null;
  @property({ attribute: false })
  chosenLevels: DebugLevels | null = null;
  @property({ type: Boolean })
  levelsBusy = false;

  static styles = [
    globalStyles,
    css`
      :host {
        background-color: var(--lana-header-bg);
        display: flex;
        flex-direction: column;
        gap: var(--lana-space-3xs);
        min-width: 0;
        /* Match the tabs' box inset (LogViewer 8px + this 8px == tabs' 8px + their internal
           8px) so the log-title, first level chip, and first tab share one left/right guide. */
        padding: 0 var(--lana-space-sm);
        position: relative;
      }

      vscode-progress-bar {
        position: absolute;
        inset: auto 0 0;
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
        .logIdentity=${this.logIdentity}
      ></nav-bar>
      <log-levels .captured=${this.capturedLevels} .chosen=${this.chosenLevels}></log-levels>
      ${
        this.levelsBusy
          ? html`<vscode-progress-bar aria-label="Applying log levels"></vscode-progress-bar>`
          : nothing
      }
      <find-widget></find-widget>
    `;
  }
}
