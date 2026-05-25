/*
 * Copyright (c) 2021 Certinia Inc. All rights reserved.
 */
import type { PropertyValues, TemplateResult } from 'lit';
import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { LogEvent } from 'apex-log-parser';
import { goToRow } from '../features/call-tree/components/CalltreeView.js';
import { DatabaseAccess } from '../features/database/services/Database.js';
import { formatSOQLToTemplate } from '../features/soql/format/formatter.js';
import { soqlSyntaxStyles } from '../features/soql/styles/soql-syntax.css.js';

// styles
import { globalStyles } from '../styles/global.styles.js';

@customElement('call-stack')
export class CallStack extends LitElement {
  @property({ type: Number })
  timestamp = -1;
  @property({ type: Number })
  eventIndex = -1;
  @property({ type: Number })
  startDepth = 1;
  @property({ type: Number })
  endDepth = -1;

  // Internal state to hold the pre-formatted Lit templates
  @state()
  private _formattedDetails: TemplateResult[] = [];

  static styles = [
    globalStyles,
    unsafeCSS(soqlSyntaxStyles),
    css`
      :host {
        overflow: hidden;
        min-width: 0%;
        min-height: 1ch;
        max-height: 30vh;
        white-space: normal;
      }

      .callstack__soql {
        margin: 4px 0;
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

      pre {
        display: inline;
      }
    `,
  ];

  // 1. THE PERFORMANCE ENGINE: Process data BEFORE rendering
  protected willUpdate(changedProperties: PropertyValues) {
    if (
      changedProperties.has('eventIndex') ||
      changedProperties.has('timestamp') ||
      changedProperties.has('startDepth') ||
      changedProperties.has('endDepth')
    ) {
      const stack =
        this.eventIndex >= 0
          ? (DatabaseAccess.instance()?.getStackByEventIndex(this.eventIndex).reverse() ?? [])
          : (DatabaseAccess.instance()?.getStack(this.timestamp).reverse() ?? []);

      if (stack.length > 0) {
        // Run the heavy loop and formatting logic here, only when inputs change
        this._formattedDetails = stack
          .slice(this.startDepth, this.endDepth)
          .map((entry) => this.lineLink(entry));
      } else {
        this._formattedDetails = [];
      }
    }
  }

  render() {
    if (!this._formattedDetails.length) {
      return html`<div class="callstack__item">No call stack available</div>`;
    }

    if (this._formattedDetails.length === 1) {
      return this._formattedDetails;
    }

    const [first, ...rest] = this._formattedDetails;
    return html`<details>
      <summary>${first}</summary>
      <div class="callstack">${rest}</div>
    </details>`;
  }

  private lineLink(line: LogEvent) {
    const isSoql = line?.type === 'SOQL_EXECUTE_BEGIN';
    const isSosl = line?.type === 'SOSL_EXECUTE_BEGIN';
    const formatted =
      (isSoql || isSosl) && line?.text
        ? this.formatSOQL(line.text, isSosl ? 'sosl' : 'soql')
        : null;
    const soqlBlock = formatted
      ? html`<div class="soql-block callstack__soql">${formatted}</div>`
      : `${line.text}`;

    return html`<a
      @click=${this.onCallerClick}
      class="callstack__item code_text"
      data-event-index="${line.eventIndex}"
      data-timestamp="${line.timestamp}"
      >${soqlBlock}</a
    >`;
  }

  private formatSOQL(soql: string, type: 'soql' | 'sosl') {
    return formatSOQLToTemplate(soql, { mode: 'pretty', dialect: type });
  }

  private onCallerClick(evt: Event) {
    const { type } = window.getSelection() ?? {};
    if (type === 'Range') {
      return;
    }

    evt.stopPropagation();
    evt.preventDefault();
    const target = (evt.target as HTMLElement).closest('.callstack__item');
    const dataEventIndex = target?.getAttribute('data-event-index');
    if (!dataEventIndex) {
      return;
    }

    goToRow({ eventIndex: parseInt(dataEventIndex, 10) });
  }
}
