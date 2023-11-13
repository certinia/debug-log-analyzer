/*
 * Copyright (c) 2021 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { DatabaseAccess } from '../Database.js';
import { LogLine } from '../parsers/ApexLogParser.js';
import { globalStyles } from '../styles/global.styles.js';
import { goToRow } from './calltree-view/CalltreeView.js';

@customElement('call-stack')
export class CallStack extends LitElement {
  @property({ type: Number })
  timestamp = -1;
  @property({ type: Number })
  startDepth = 1;
  @property({ type: Number })
  endDepth = -1;

  static styles = [
    globalStyles,
    css`
      :host {
        overflow: hidden;
        min-width: 0%;
        min-height: 1ch;
        max-height: 30vh;
        padding: 0px 5px 0px 5px;
      }

      :host(:hover) {
        overflow: scroll;
      }

      .stackEntry {
        cursor: pointer;
      }

      .dbLinkContainer {
        display: flex;
      }

      .title {
        font-weight: bold;
      }

      .code-text {
        font-family: monospace;
        font-weight: var(--vscode-font-weight, normal);
        font-size: var(--vscode-editor-font-size, 0.9em);
      }

      details {
        display: flex;
      }
    `,
  ];

  render() {
    const stack = DatabaseAccess.instance()?.getStack(this.timestamp).reverse() || [];
    if (stack.length) {
      const details = stack.slice(this.startDepth, this.endDepth).map((entry) => {
        return this.lineLink(entry);
      });

      if (details.length === 1) {
        return details;
      }

      return html` <details>
        <summary>${details[0]}</summary>
        ${details.slice(1, -1)}
      </details>`;
    } else {
      return html` <div class="stackEntry">No call stack available</div>`;
    }
  }

  private lineLink(line: LogLine) {
    return html`
      <a
        @click=${this.onCallerClick}
        class="stackEntry code-text"
        data-timestamp="${line.timestamp}"
        >${line.text}</a
      >
    `;
  }

  private onCallerClick(evt: Event) {
    evt.stopPropagation();
    evt.preventDefault();
    const target = evt.target as HTMLElement;
    const dataTimestamp = target.getAttribute('data-timestamp');
    if (dataTimestamp) {
      goToRow(parseInt(dataTimestamp));
    }
  }
}
