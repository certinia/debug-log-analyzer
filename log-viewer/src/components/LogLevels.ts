/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { DebugLevel } from '../core/log-parser/ApexLogParser.js';

// styles
import { globalStyles } from '../styles/global.styles.js';
import { skeletonStyles } from '../styles/skeleton.styles.js';

@customElement('log-levels')
export class LogLevels extends LitElement {
  @property()
  logSettings: DebugLevel[] | null = null;

  constructor() {
    super();
  }

  static styles = [
    globalStyles,
    skeletonStyles,
    css`
      :host {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        align-items: center;
        min-height: 27px;
      }
      .setting {
        display: inline-block;
        font-family: var(--vscode-editor-font-family);
        background-color: var(--vscode-textBlockQuote-background);
        font-size: 0.9em;
        padding: 5px;
      }
      .setting__title {
        font-weight: bold;
      }

      .setting__level {
        color: #808080;
      }

      .setting-skeleton {
        min-width: 5ch;
        width: 100px;
        height: 1.5rem;
      }
    `,
  ];

  render() {
    if (!this.logSettings) {
      const logLevels = [];
      for (let i = 0; i < 8; i++) {
        const levelHtml = html`<div class="setting-skeleton skeleton"></div>`;
        logLevels.push(levelHtml);
      }
      return html`${logLevels}`;
    }

    const logLevels = [];
    for (const { logCategory, logLevel } of this.logSettings) {
      const levelHtml = html`<div class="setting">
        <span class="setting__title">${logCategory}:</span>
        <span class="setting__level">${logLevel}</span>
      </div>`;
      logLevels.push(levelHtml);
    }
    return html`${logLevels}`;
  }
}
