/*
 * Copyright (c) 2021 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-icon.js';
import { LitElement, css, html, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { SOQLExecuteBeginLine } from 'apex-log-parser';
import { DatabaseAccess } from '../../database/services/Database.js';
import {
  SEVERITY_TYPES,
  SOQLLinter,
  type SOQLLinterRule,
  type Severity,
} from '../services/SOQLLinter.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';

const severityToIcon = new Map<string, string>(
  Object.entries({ error: 'error', warning: 'warning', info: 'info' }),
);

/** Selectivity issue derived directly from the query-plan explain line. */
class ExplainLineSelectivityRule implements SOQLLinterRule {
  message = '';
  severity: Severity = 'Error';
  summary = 'Query is not selective.';
  constructor(relativeCost: number) {
    this.message = `The relative cost of the query is ${relativeCost}.`;
  }
}

function getIssuesFromSOQLLine(soqlLine: SOQLExecuteBeginLine | null): SOQLLinterRule[] {
  const soqlIssues: SOQLLinterRule[] = [];
  const explain = soqlLine?.children[0];
  if (explain?.relativeCost && explain.relativeCost > 1) {
    soqlIssues.push(new ExplainLineSelectivityRule(explain.relativeCost));
  }
  return soqlIssues;
}

/** Lint the SOQL at `eventIndex`, combining explain-line + linter rules, sorted by severity. */
export async function computeSoqlIssues(eventIndex: number): Promise<SOQLLinterRule[]> {
  const stack =
    eventIndex >= 0
      ? (DatabaseAccess.instance()?.getStackByEventIndex(eventIndex).reverse() ?? [])
      : [];
  const soqlLine = stack[0] as SOQLExecuteBeginLine | undefined;
  if (!soqlLine) {
    return [];
  }
  const issues = getIssuesFromSOQLLine(soqlLine).concat(
    await new SOQLLinter().lint(soqlLine.text, stack),
  );
  issues.sort((a, b) => SEVERITY_TYPES.indexOf(a.severity) - SEVERITY_TYPES.indexOf(b.severity));
  return issues;
}

@customElement('soql-issues')
export class SOQLLinterIssues extends LitElement {
  @property({ type: String })
  soql = '';

  @property({ type: Number })
  eventIndex = -1;

  // When true (e.g. inside the details panel), fill the container and scroll
  // normally instead of the 30vh cap used in the inline grid detail.
  @property({ type: Boolean })
  unbounded = false;

  // Pre-computed issues. When null the component computes them itself.
  @property({ attribute: false })
  issues: SOQLLinterRule[] | null = null;

  @state()
  private _issues: SOQLLinterRule[] = [];

  static styles = [
    globalStyles,
    css`
      :host {
        flex: 1;
        max-height: 30vh;
        overflow-y: scroll;
        padding: 0px 5px 0px 5px;
      }
      :host([unbounded]) {
        max-height: none;
        overflow-y: auto;
      }
      details {
        margin-bottom: 0.25em;
        overflow-wrap: anywhere;
        white-space: normal;
      }
      summary {
        display: flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
      }
      summary vscode-icon {
        flex: 0 0 auto;
      }
      .sev-error {
        color: var(--vscode-problemsErrorIcon-foreground, var(--vscode-errorForeground));
      }
      .sev-warning {
        color: var(--vscode-problemsWarningIcon-foreground, var(--vscode-editorWarning-foreground));
      }
      .sev-info {
        color: var(--vscode-problemsInfoIcon-foreground, var(--vscode-editorInfo-foreground));
      }
      p {
        margin: 2px 0 4px 20px;
      }
      .empty {
        color: var(--vscode-descriptionForeground);
      }
    `,
  ];

  async updated(changed: PropertyValues): Promise<void> {
    if (this.issues) {
      if (changed.has('issues')) {
        this._issues = this.issues;
      }
      return;
    }
    if (changed.has('soql') || changed.has('eventIndex')) {
      this._issues = await computeSoqlIssues(this.eventIndex);
    }
  }

  render() {
    if (!this._issues.length) {
      return html`<div class="empty">No SOQL issues</div>`;
    }

    return this._issues.map((issue) => {
      const sev = issue.severity.toLowerCase();
      return html`<details>
        <summary title=${issue.summary}>
          <vscode-icon class="sev-${sev}" name=${severityToIcon.get(sev) ?? 'info'}></vscode-icon>
          <span>${issue.summary}</span>
        </summary>
        <p>${issue.message}</p>
      </details>`;
    });
  }
}
