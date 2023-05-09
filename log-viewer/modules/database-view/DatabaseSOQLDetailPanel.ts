/*
 * Copyright (c) 2021 FinancialForce.com, inc. All rights reserved.
 */
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import '../components/CallStack';
import '../components/SOQLLinterIssues';

@customElement('db-soql-detail-panel')
export class DatabaseSOQLDetailPanel extends LitElement {
  @property({ type: String })
  soql = '';
  @property({ type: Number })
  timestamp = null;

  static get styles() {
    return css`
      :host {
        display: flex;
        overflow: hidden;
        width: 100%;
      }
      call-stack {
        border-right: 2px solid var(--vscode-editorHoverWidget-border);
      }
    `;
  }

  render() {
    return html`
      <call-stack timestamp=${this.timestamp}></call-stack>
      <soql-issues timestamp=${this.timestamp} soql=${this.soql}></soql-issues>
    `;
  }
}
