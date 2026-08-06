/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-icon.js';
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { vscodeMessenger } from '../core/messaging/VSCodeExtensionMessenger.js';

// styles
import { globalStyles } from '../styles/global.styles.js';
import { headerControlStyles } from '../styles/headerControl.styles.js';
import { menuRowStyles } from '../styles/menuRow.styles.js';

// web components
import type { AnchoredPopover } from './AnchoredPopover.js';
import './AnchoredPopover.js';
import './Divider.js';

const REPORT_ISSUE_URL = 'https://github.com/certinia/debug-log-analyzer/issues/new/choose';

/** Webviews can't follow external hrefs directly — hand the URL to VS Code's own opener. */
function reportIssueHref(): string {
  return `command:vscode.open?${encodeURIComponent(JSON.stringify(REPORT_ISSUE_URL))}`;
}

/**
 * The header's `•••` meta menu: always present, holding the actions that don't earn
 * permanent header space, plus whatever the header collapses into it when narrow.
 *
 * Unlike `<overflow-list>`, this toggle renders whether or not anything is collapsed
 * in — its own rows are always there — so a marker dot is what tells the user
 * something extra has moved inside.
 */
@customElement('header-menu')
export class HeaderMenu extends LitElement {
  /**
   * Shows a marker dot on the toggle when a collapsed child has content. Presence only,
   * on the accent colour: header chrome carries no severity colour, so at narrow widths
   * the dot says *something* is in here and the menu says how bad.
   */
  @property({ type: Boolean })
  marker = false;

  /**
   * How many controls the header has collapsed in here. Told rather than counted: the
   * slot holds one wrapper, so only the consumer knows how many sections are inside.
   */
  @property({ type: Number, attribute: 'collapsed-count' })
  collapsedCount = 0;

  static styles = [
    globalStyles,
    headerControlStyles,
    menuRowStyles,
    css`
      :host {
        display: inline-flex;
        flex: 0 0 auto;
      }

      .toggle__marker {
        position: absolute;
        top: 1px;
        right: 2px;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background-color: var(--vscode-activityBarBadge-background);
        pointer-events: none;
      }

      /* Collapsed controls arrive as full-width sections, not as a row of icons. */
      .collapsed {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 4px;
        padding: 2px 4px;
      }

      /* Nothing collapsed in yet — the row and its divider would frame empty space. */
      .collapsed--empty {
        display: none;
      }
    `,
  ];

  render() {
    const count = this.collapsedCount;
    const label = count ? `More — ${count} collapsed item${count === 1 ? '' : 's'}` : 'More';

    return html`<anchored-popover align="end" heading="More">
      <span slot="trigger" class="header-control toggle" title=${label} aria-label=${label}>
        <vscode-icon name="ellipsis" size="16"></vscode-icon>
        ${this.marker ? html`<span class="toggle__marker"></span>` : ''}
      </span>
      <div slot="panel" @click=${this._onPanelClick}>
        <div class="collapsed ${count ? '' : 'collapsed--empty'}">
          <slot name="collapsed"></slot>
        </div>
        ${count ? html`<divider-line></divider-line>` : ''}
        <button
          class="filter-popover-row menu-row"
          @click=${() => vscodeMessenger.send('openHelp')}
        >
          <vscode-icon name="question" size="16"></vscode-icon>
          <span>Help &amp; documentation</span>
        </button>
        <a class="filter-popover-row menu-row" href=${reportIssueHref()}>
          <vscode-icon name="github" size="16"></vscode-icon>
          <span>Report an issue</span>
        </a>
      </div>
    </anchored-popover>`;
  }

  /**
   * A menu closes when one of its rows is used — including the rows the header collapses
   * in, whose commands would otherwise act behind a panel that covers most of the view.
   * Native light-dismiss only handles clicks *outside* the panel.
   */
  private _onPanelClick(event: Event): void {
    const activated = event
      .composedPath()
      .some(
        (node) =>
          node instanceof HTMLElement && (node.localName === 'button' || node.localName === 'a'),
      );
    if (activated) {
      this.shadowRoot?.querySelector<AnchoredPopover>('anchored-popover')?.close();
    }
  }
}
