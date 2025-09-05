/*
 * Copyright (c) 2021 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';

// web components
import '../../../components/CallStack.js';
import '../../soql/components/SOQLLinterIssues.js';

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
        height: 100%;
      }

      call-stack {
        border-right: 2px solid var(--vscode-editorHoverWidget-border);
      }

      soql-issues {
        min-width: 25%;
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
