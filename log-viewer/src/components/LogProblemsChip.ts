/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-icon.js';
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
  SEVERITY_META,
  describeIssues,
  worstSeverity,
  type LogIssue,
} from '../features/notifications/types.js';

// styles
import { globalStyles } from '../styles/global.styles.js';
import { headerControlStyles } from '../styles/headerControl.styles.js';
import { skeletonStyles } from '../styles/skeleton.styles.js';

// web components
import '../features/notifications/components/IssueList.js';
import './AnchoredPopover.js';
import './IconButtonSkeleton.js';

/**
 * Header control summarising problems found in the log itself — governor limit
 * exceptions, fatal errors, skipped lines.
 *
 * The worst severity's glyph carries the severity, a corner badge carries the total,
 * so one control covers every combination; the full breakdown is in the tooltip and
 * `aria-label`. At zero it stays put and shows a tick — an empty slot would say
 * nothing. A bare icon button, not a pill: it belongs to the header's toolbar family
 * rather than the filter bar's, and a badged glyph never changes width between logs.
 */
@customElement('log-problems')
export class LogProblemsChip extends LitElement {
  /** `null` while the log is still parsing — renders a skeleton. */
  @property({ attribute: false })
  issues: readonly LogIssue[] | null = null;

  static styles = [
    globalStyles,
    headerControlStyles,
    skeletonStyles,
    css`
      :host {
        display: inline-flex;
        flex: 0 0 auto;
      }

      /* Dimming a clean tick is de-emphasis, not severity — the glyph itself is never
         tinted. Targets the element rather than the wrapper because vscode-icon sets
         color on its own :host, and a specified value beats an inherited one (outer-tree
         author styles do win over :host). */
      .problems--clean vscode-icon {
        color: var(--vscode-descriptionForeground);
      }

      .skeleton {
        width: 16px;
        height: 16px;
      }
    `,
  ];

  render() {
    if (!this.issues) {
      return html`<icon-button-skeleton></icon-button-skeleton>`;
    }

    const issues = this.issues;
    const worst = worstSeverity(issues);
    const label = describeIssues(issues, 'problem', 'No problems');

    return html`<anchored-popover
      align="start"
      heading="Log problems"
      show-heading
      wide
      empty-message="No problems found in this log"
    >
      <span
        slot="trigger"
        class="header-control ${worst ? '' : 'problems--clean'}"
        title=${label}
        aria-label=${label}
      >
        <vscode-icon name=${worst ? SEVERITY_META[worst].icon : 'pass'} size="16"></vscode-icon>
        ${worst ? html`<span class="header-control__badge">${issues.length}</span>` : ''}
      </span>
      ${issues.length ? html`<issue-list slot="panel" .issues=${issues}></issue-list>` : ''}
    </anchored-popover>`;
  }
}
