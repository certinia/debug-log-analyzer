/*
 * Copyright (c) 2021 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import '../components/CallStack.js';
import '../components/SOQLLinterIssues.js';
import { globalStyles } from '../global.styles.js';

@customElement('db-soql-detail-panel')
export class DatabaseSOQLDetailPanel extends LitElement {
  @property({ type: String })
  soql = '';
  @property({ type: Number })
  timestamp = null;

  static styles = [
    globalStyles,
    css`
      :host {
        display: flex;
        overflow: hidden;
        width: 100%;
      }
      call-stack {
        border-right: 2px solid var(--vscode-editorHoverWidget-border);
      }
    `,
  ];

  render() {
    return html`
      <call-stack timestamp=${this.timestamp}></call-stack>
      <soql-issues timestamp=${this.timestamp} soql=${this.soql}></soql-issues>
    `;
  }
}
