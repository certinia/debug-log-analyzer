/*
 * Copyright (c) 2021 Certinia Inc. All rights reserved.
 */
import { LitElement, type PropertyValues, type TemplateResult, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { DatabaseAccess } from '../Database.js';
import { SOQLExecuteBeginLine, SOQLExecuteExplainLine } from '../parsers/TreeParserLegacy.js';
import {
  SEVERITY_TYPES,
  SOQLLinter,
  type SOQLLinterRule,
  type Severity,
} from '../soql/SOQLLinter.js';
import { globalStyles } from '../styles/global.styles.js';

@customElement('soql-issues')
export class SOQLLinterIssues extends LitElement {
  @property({ type: String })
  soql = '';

  @property({ type: Number })
  timestamp = 0;

  @state()
  issues: SOQLLinterRule[] = [];

  static styles = [
    globalStyles,
    css`
      :host {
        flex: 1;
        max-height: 30vh;
        overflow-y: scroll;
        padding: 0px 5px 0px 5px;
      }
      .title {
        font-weight: bold;
      }
      details {
        margin-bottom: 0.25em;
        overflow-wrap: anywhere;
        white-space: normal;
      }
    `,
  ];

  updated(changedProperties: PropertyValues): void {
    if (changedProperties.has('soql')) {
      const stack = DatabaseAccess.instance()?.getStack(this.timestamp).reverse() || [];
      const soqlLine = stack[0] as SOQLExecuteBeginLine;
      this.issues = this.getIssuesFromSOQLLine(soqlLine);
      this.issues = this.issues.concat(new SOQLLinter().lint(this.soql, stack));
      this.issues.sort((a, b) => {
        return SEVERITY_TYPES.indexOf(a.severity) - SEVERITY_TYPES.indexOf(b.severity);
      });
    }
  }

  render() {
    const htmlText: TemplateResult[] = [
      html`<span class="title" title="SOQL issues">SOQL issues</span>`,
    ];

    if (this.issues.length) {
      const severityToEmoji = new Map<string, string>(
        Object.entries({
          error: '❌',
          warning: '⚠️',
          info: 'ℹ️',
        }),
      );
      this.issues.forEach((issue) => {
        htmlText.push(html`
          <details>
            <summary title="${issue.summary}">
              <span title="${issue.severity}"
                >${severityToEmoji.get(issue.severity.toLowerCase())}
              </span>
              ${issue.summary}
            </summary>
            <p>${issue.message}</p>
          </details>
        `);
      });
    } else {
      htmlText.push(html`<div class="issue-detail">No SOQL issues 👍</div>`);
    }

    return htmlText;
  }

  getIssuesFromSOQLLine(soqlLine: SOQLExecuteBeginLine | null): SOQLLinterRule[] {
    const soqlIssues = [];
    if (soqlLine) {
      const explain = soqlLine.children[0] as SOQLExecuteExplainLine;
      if (explain?.relativeCost && explain.relativeCost > 1) {
        soqlIssues.push(new ExplainLineSelectivityRule(explain.relativeCost));
      }
    }
    return soqlIssues;
  }
}

class ExplainLineSelectivityRule implements SOQLLinterRule {
  message = '';
  severity: Severity = 'Error';
  summary = 'Query is not selective.';
  constructor(relativeCost: number) {
    this.message = `The relative cost of the query is ${relativeCost}.`;
  }
}
