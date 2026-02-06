/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import {
  provideVSCodeDesignSystem,
  vsCodePanelTab,
  vsCodePanelView,
  vsCodePanels,
} from '@vscode/webview-ui-toolkit';
import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { ApexLog } from 'apex-log-parser';
import { Notification } from '../notifications/components/NotificationPanel.js';

// web components
import '../../components/LogLevels.js';
import '../../components/NavBar.js';
import '../analysis/components/AnalysisView.js';
import '../call-tree/components/CalltreeView.js';
import '../database/components/DatabaseView.js';
import '../find/components/FindWidget.js';
import '../timeline/components/TimelineView.js';

// styles
import codiconStyles from '../../styles/codicon.css';
import { globalStyles } from '../../styles/global.styles.js';

provideVSCodeDesignSystem().register(vsCodePanelTab(), vsCodePanelView(), vsCodePanels());

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
  @property()
  notifications: Notification[] | null = null;
  @property()
  parserIssues: Notification[] = [];
  @property()
  timelineRoot: ApexLog | null = null;

  static styles = [
    globalStyles,
    unsafeCSS(codiconStyles),
    css`
      :host {
        background-color: var(--vscode-tab-activeBackground);
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
    `,
  ];

  // TODO: use @change on vscode-panels to detect tab change instead of @click on <vscode-panel-tab
  render() {
    return html`
      <nav-bar
        .logName=${this.logName}
        .logPath=${this.logPath}
        .logSize=${this.logSize}
        .logDuration=${this.logDuration}
        .notifications=${this.notifications}
        .parserIssues=${this.parserIssues}
      ></nav-bar>
      <log-levels .logSettings=${this.timelineRoot?.debugLevels}></log-levels>
      <find-widget></find-widget>
    `;
  }
}
