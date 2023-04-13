/*
 * Copyright (c) 2021 FinancialForce.com, inc. All rights reserved.
 */
import { LitElement, html, css, PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { SOQLLinter, SOQLLinterRule } from '../soql/SOQLLinter';

@customElement('soql-issues')
export class SOQLLinterIssues extends LitElement {
  @property({ type: String })
  soql = '';

  @state()
  issues: SOQLLinterRule[] = [];

  static get styles() {
    return css`
      :host {
        min-width: 0%;
        border-left: 2px solid var(--vscode-editorHoverWidget-border);
        padding: 0px 5px 0px 5px;
        flex: 1 0 0px;
      }
      .issue-detail {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .title {
        font-weight: bold;
      }
    `;
  }

  updated(changedProperties: PropertyValues): void {
    if (changedProperties.has('soql')) {
      this.issues = new SOQLLinter().lint(this.soql);
    }
  }

  render() {
    const htmlText: TemplateResult[] = [
      html`<span class="title" title="SOQL issues">SOQL issues</span>`,
    ];

    if (this.issues.length) {
      this.issues.forEach((issue) => {
        htmlText.push(
          html`<div class="issue-detail" title="${issue.summary}">${issue.summary}</div>`
        );
      });
    } else {
      htmlText.push(html`<div class="issue-detail">No SOQL issues 👍</div>`);
    }

    return htmlText;
  }
}
