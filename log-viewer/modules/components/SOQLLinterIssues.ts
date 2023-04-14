/*
 * Copyright (c) 2021 FinancialForce.com, inc. All rights reserved.
 */
import { LitElement, html, css, PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { SOQLLinter, SOQLLinterRule } from '../soql/SOQLLinter';
import { DatabaseAccess } from '../Database';

@customElement('soql-issues')
export class SOQLLinterIssues extends LitElement {
  @property({ type: String })
  soql = '';

  @property({ type: Number })
  timestamp = 0;

  @state()
  issues: SOQLLinterRule[] = [];

  static get styles() {
    return css`
      :host {
        flex: 1;
        max-height: 30vh;
        overflow-y: scroll;
        border-left: 2px solid var(--vscode-editorHoverWidget-border);
        padding: 0px 5px 0px 5px;
      }
      .title {
        font-weight: bold;
      }
      details {
        margin-bottom: 1rem;
        overflow-wrap: anywhere;
        white-space: normal;
      }
    `;
  }

  updated(changedProperties: PropertyValues): void {
    if (changedProperties.has('soql')) {
      const stack = DatabaseAccess.instance()?.getStack(this.timestamp).reverse() || [];
      this.issues = new SOQLLinter().lint(this.soql, stack);
    }
  }

  render() {
    const htmlText: TemplateResult[] = [
      html`<span class="title" title="SOQL issues">SOQL issues</span>`,
    ];

    if (this.issues.length) {
      this.issues.forEach((issue) => {
        htmlText.push(
          html`
            <details>
              <summary title="${issue.summary}">${issue.summary}</summary>
              <p>${issue.message}</p>
            </details>
          `
        );
      });
    } else {
      htmlText.push(html`<div class="issue-detail">No SOQL issues 👍</div>`);
    }

    return htmlText;
  }
}
