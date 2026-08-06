/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement } from 'lit/decorators.js';

import '#vscode-elements/vscode-icon.js';
import { LogLoadedController } from '../core/events/LogLoadedController.js';
import { formatDuration } from '../core/utility/Util.js';
import {
  getCurrentExecutionHighlights,
  type ExecutionHighlights,
  type HotPathFrame,
} from '../features/call-tree/utils/ExecutionHighlights.js';
import { globalStyles } from '../styles/global.styles.js';
import { inspectorSectionStyles } from '../styles/inspectorSection.styles.js';
import { revealRowStyles } from '../styles/revealRow.styles.js';
import { dispatchInspectorReveal } from './inspectorReveal.js';

/** Frames shown, the terminus among them; the tail between them collapses into a "more" line. */
const FRAME_CAP = 10;

/**
 * The Call Tree tab's whole-log opener: the chain of calls holding most of the
 * log's time, entry point first — Visual Studio's Hot Path, Chrome's heaviest
 * stack. Each frame shows its total time and share of the log, and clicking it
 * selects that call in the tree. A truncated log heads the list with a warning,
 * because every timing below a cut-off call under-reports.
 */
@customElement('hot-path')
export class HotPath extends LitElement {
  /** The path has to follow the log itself. */
  private readonly _logLoaded = new LogLoadedController(this);

  static styles = [
    globalStyles,
    inspectorSectionStyles,
    revealRowStyles,
    css`
      /* An actionable data-quality caveat, tinted so it reads apart from the rows. */
      .caveat-row {
        display: flex;
        gap: var(--lana-space-xs);
        margin-bottom: var(--lana-space-2xs);
        padding: var(--lana-space-2xs) var(--lana-space-xs);
        background: var(--lana-callout-warning-bg);
        color: var(--lana-severity-warning);
        font-size: var(--lana-text-sm);
        white-space: normal;
      }

      .caveat-row:hover {
        background: var(--lana-callout-warning-bg-hover);
      }

      .caveat-row vscode-icon {
        flex: 0 0 auto;
      }

      .more {
        padding: var(--lana-space-3xs) 0;
        color: var(--lana-fg-muted);
        font-size: var(--lana-text-sm);
      }
    `,
  ];

  render() {
    const highlights = getCurrentExecutionHighlights();
    if (!highlights || !highlights.hotPath.length) {
      return html`<p class="note">The log has no timed calls.</p>`;
    }

    // The terminus is the frame the path exists to name, so a long path keeps it
    // and drops the middle instead: the last row shown is always the terminus.
    const path = highlights.hotPath;
    const shown =
      path.length > FRAME_CAP ? [...path.slice(0, FRAME_CAP - 1), path[path.length - 1]!] : path;
    const hidden = path.length - shown.length;
    const rows = shown.map((frame, index) =>
      this._frameRow(frame, highlights.totalTime, index === shown.length - 1),
    );
    if (hidden > 0) {
      // The dropped frames are counted where they were: above the terminus.
      rows.splice(rows.length - 1, 0, html`<div class="more">+ ${hidden} more frames</div>`);
    }
    return html`${this._truncationCaveat(highlights)}${rows}`;
  }

  /**
   * One frame: name and figures on the first line, its share of the log as a
   * meter beneath — the staircase of shrinking meters is what shows the
   * descent. The path's terminus is the hot spot, so it alone gets emphasis.
   */
  private _frameRow(frame: HotPathFrame, logTotal: number, isTerminus: boolean) {
    const share = logTotal > 0 ? (frame.totalTime / logTotal) * 100 : 0;
    return html`
      <button
        class="bleed-row reveal-row ${isTerminus ? 'reveal-row--focus' : ''}"
        type="button"
        title="Show this call in the tree"
        @click=${() => dispatchInspectorReveal(this, frame.eventIndex)}
      >
        <span class="reveal-row__name" title=${frame.text}>${frame.text}</span>
        <span class="reveal-row__value"
          >${frame.count > 1 ? `${frame.count}× · ` : ''}${formatDuration(frame.totalTime)} ·
          ${share.toFixed(1)}%</span
        >
        <span class="reveal-row__meter"
          ><span class="reveal-row__meter-fill" style="width: ${share}%"></span
        ></span>
      </button>
    `;
  }

  /** The data-quality warning that would silently poison every figure shown. */
  private _truncationCaveat(highlights: ExecutionHighlights) {
    const truncation = highlights.truncation;
    if (!truncation) {
      return '';
    }
    const text =
      truncation.regionCount === 1
        ? '1 truncated call — timings below it under-report'
        : `${truncation.regionCount} truncated calls — timings below them under-report`;
    return html`<button
      class="bleed-row caveat-row"
      type="button"
      title="Show the first truncated call in the tree"
      @click=${() => dispatchInspectorReveal(this, truncation.firstEventIndex)}
    >
      <vscode-icon name="warning"></vscode-icon>
      <span>${text}</span>
    </button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hot-path': HotPath;
  }
}
