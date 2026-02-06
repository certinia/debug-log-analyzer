/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

import { DebugLevel } from 'apex-log-parser';

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
        font-family: var(--vscode-editor-font-family);
      }

      vscode-tag::part(control) {
        --badge-background: var(--vscode-textBlockQuote-background);
        --button-border: none;
        --badge-foreground: none;
        font-family: var(--vscode-editor-font-family);
        font-size: 0.9rem;
      }

      .setting__title {
        font-weight: 600;
        opacity: 0.9;
      }

      .setting__level {
        color: var(--vscode-descriptionForeground, #808080);
        font-weight: 500;
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
        logLevels.push(html`<div class="setting-skeleton skeleton"></div>`);
      }
      return logLevels;
    }

    return html`${repeat(
      this.logSettings,
      ({ logCategory, logLevel }) =>
        html`<vscode-tag>
          <span class="setting__title">${logCategory}:</span>
          <span class="setting__level">${logLevel}</span>
        </vscode-tag>`,
    )}`;
  }
}
