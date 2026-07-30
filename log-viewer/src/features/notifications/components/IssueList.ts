/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-button.js';
import '#vscode-elements/vscode-icon.js';
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { goToRow } from '../../call-tree/navigation.js';
import { SEVERITY_META, sortBySeverity, type LogIssue } from '../types.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';

// web components
import '../../../components/Divider.js';

/**
 * Renders a list of {@link LogIssue}s, most severe first — the shared body of both
 * header popovers.
 *
 * Issues with an `eventIndex` navigate the call tree to that event.
 */
@customElement('issue-list')
export class IssueList extends LitElement {
  @property({ attribute: false })
  issues: readonly LogIssue[] = [];

  static styles = [
    globalStyles,
    css`
      :host {
        display: block;
      }

      .issue {
        display: flex;
        gap: 8px;
        padding: 8px;
        border-radius: 4px;
        overflow-wrap: anywhere;
        text-wrap: wrap;
      }

      .issue__body {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }

      .issue__summary {
        font-weight: 600;
        font-size: 12px;
      }

      .issue__message {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }

      .issue__nav {
        align-self: flex-start;
        margin-top: 2px;
      }
    `,
  ];

  render() {
    const issues = sortBySeverity(this.issues);

    return html`${issues.map(
      (issue, index) =>
        html`${index > 0 ? html`<divider-line></divider-line>` : ''}
          <div class="issue">
            <vscode-icon
              name=${SEVERITY_META[issue.severity].icon}
              size="16"
              style="color: ${SEVERITY_META[issue.severity].color}"
            ></vscode-icon>
            <div class="issue__body">
              <span class="issue__summary">${issue.summary}</span>
              ${issue.message ? html`<span class="issue__message">${issue.message}</span>` : ''}
              ${
                issue.eventIndex !== null
                  ? html`<vscode-button
                      class="issue__nav"
                      aria-label="Go To Call Tree"
                      title="Go To Call Tree"
                      @click=${() => this._goTo(issue.eventIndex)}
                      >Go To Call Tree</vscode-button
                    >`
                  : ''
              }
            </div>
          </div>`,
    )}`;
  }

  private _goTo(eventIndex: number | null): void {
    if (eventIndex !== null) {
      goToRow({ eventIndex });
    }
  }
}
