/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import { LogSetting } from '../parsers/TreeParser.js';
import { globalStyles } from '../styles/global.styles.js';
import { skeletonStyles } from './skeleton/skeleton.styles.js';

@customElement('log-levels')
export class LogLevels extends LitElement {
  @state()
  logSettings: LogSetting[] | null = null;

  constructor() {
    super();
    document.addEventListener('logsettings', (e: Event) => {
      this._updateLog(e);
    });
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
        padding: 4px 0;
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
    for (const { key, level } of this.logSettings) {
      const levelHtml = html`<div class="setting">
        <span class="setting__title">${key}:</span>
        <span class="setting__level">${level}</span>
      </div>`;
      logLevels.push(levelHtml);
    }
    return html`${logLevels}`;
  }

  _updateLog(e: Event) {
    this.logSettings = (e as CustomEvent).detail.logSettings;
  }
}
