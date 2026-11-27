/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-icon.js';
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { ISSUE_SOURCES, describeIssues, worstSeverity, type LogIssue } from '../types.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';
import { headerControlStyles } from '../../../styles/headerControl.styles.js';

// web components
import '../../../components/AnchoredPopover.js';
import './IssueList.js';

/**
 * Header notification centre — messages about the tool rather than about the log.
 * Today the only producer is the parser (unsupported event names, invalid lines).
 *
 * A bell rather than a severity glyph: the log-problems chip next door already owns
 * severity, and two severity-shaped counters in one row read as one thing split in
 * two. The bell carries only "are there messages"; the reassurance that the log
 * parsed cleanly lives in the panel's empty state, since an empty bell can't claim it.
 */
@customElement('notification-centre')
export class NotificationCentre extends LitElement {
  @property({ attribute: false })
  issues: readonly LogIssue[] = [];

  static styles = [
    globalStyles,
    headerControlStyles,
    css`
      :host {
        display: inline-flex;
        flex: 0 0 auto;
      }
    `,
  ];

  render() {
    const issues = this.issues;
    const worst = worstSeverity(issues);
    const source = ISSUE_SOURCES.notifications;
    const label = describeIssues(issues, source.noun, source.label);

    return html`<anchored-popover
      align="end"
      heading=${source.label}
      show-heading
      wide
      empty-message=${source.empty}
    >
      <span slot="trigger" class="header-control" title=${label} aria-label=${label}>
        <vscode-icon name=${source.icon} size="16"></vscode-icon>
        ${worst ? html`<span class="header-control__badge">${issues.length}</span>` : ''}
      </span>
      ${issues.length ? html`<issue-list slot="panel" .issues=${issues}></issue-list>` : ''}
    </anchored-popover>`;
  }
}
