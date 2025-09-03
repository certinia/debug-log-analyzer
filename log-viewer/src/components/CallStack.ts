/*
 * Copyright (c) 2021 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { LogEvent } from '../core/log-parser/LogEvents.js';
import { goToRow } from '../features/call-tree/components/CalltreeView.js';
import { DatabaseAccess } from '../features/database/services/Database.js';
import { globalStyles } from '../styles/global.styles.js';

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
        white-space: normal;
      }

      :host(:hover) {
        overflow: scroll;
      }

      details summary {
        cursor: pointer;
      }

      details summary > * {
        display: inline;
      }

      .callstack {
        display: flex;
        flex-direction: column;
      }

      .callstack__item {
        cursor: pointer;
      }

      .code_text {
        font-family: monospace;
        font-weight: var(--vscode-font-weight, normal);
        font-size: var(--vscode-editor-font-size, 0.9em);
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
        <div class="callstack">${details.slice(1, -1)}</div>
      </details>`;
    } else {
      return html` <div class="callstack__item">No call stack available</div>`;
    }
  }

  private lineLink(line: LogEvent) {
    return html`
      <a
        @click=${this.onCallerClick}
        class="callstack__item code_text"
        data-timestamp="${line.timestamp}"
        >${line.text}</a
      >
    `;
  }

  private onCallerClick(evt: Event) {
    const { type } = window.getSelection() ?? {};
    if (type === 'Range') {
      return;
    }

    evt.stopPropagation();
    evt.preventDefault();
    const target = evt.target as HTMLElement;
    const dataTimestamp = target.getAttribute('data-timestamp');
    if (dataTimestamp) {
      goToRow(parseInt(dataTimestamp));
    }
  }
}
