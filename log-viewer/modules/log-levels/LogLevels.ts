/*
 * Copyright (c) 2021 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import { LogSetting } from '../parsers/TreeParser';

@customElement('log-levels')
export class LogLevels extends LitElement {
  @state()
  logSettings: LogSetting[] = [];

  constructor() {
    super();
    document.addEventListener('logsettings', (e: Event) => {
      this._updateLog(e);
    });
  }

  static styles = css`
    :host {
      padding: 10px 0;
      min-height: 27px;
    }
    .setting {
      display: inline-block;
      font-family: var(--vscode-editor-font-family);
      background-color: var(--vscode-textBlockQuote-background);
      font-size: 0.9em;
      padding: 5px;
      margin-right: 5px;
      margin-bottom: 5px;
    }
    .setting__title {
      font-weight: bold;
      margin-right: 2px;
    }
    .setting__level {
      color: #808080;
    }
  `;

  render() {
    const logLevels = [];
    for (const { key, level } of this.logSettings) {
      if (level !== 'NONE') {
        const levelHtml = html`<div class="setting">
          <span class="setting__title">${key}:</span>
          <span class="setting__level">${level}</span>
        </div>`;
        logLevels.push(levelHtml);
      }
    }
    return html`${logLevels}`;
  }

  _updateLog(e: Event) {
    this.logSettings = (e as CustomEvent).detail.logSettings;
  }
}
