/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { consume } from '@lit/context';
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import '#vscode-elements/vscode-icon.js';
import { logContext } from '../core/log/logContext.js';
import type { LogStore } from '../core/log/LogStore.js';
import { formatDuration, sharePercent } from '../core/utility/Util.js';
import {
  getExecutionHighlights,
  type ExecutionHighlights,
  type HotPathEnd,
  type HotPathFrame,
} from '../features/call-tree/utils/ExecutionHighlights.js';
import { globalStyles } from '../styles/global.styles.js';
import { inspectorSectionStyles } from '../styles/inspectorSection.styles.js';
import { revealRowStyles } from '../styles/revealRow.styles.js';
import { CategoryPaletteController, categoryLabel } from './categoryTime.js';
import { dispatchInspectorLocate, dispatchInspectorReveal } from './inspectorReveal.js';
import { revealRowMeter, revealRowTitle } from './revealRowMeter.js';

/** Frames shown, the last one among them; the tail between them collapses into a "more" line. */
const FRAME_CAP = 10;

/** Branch rows shown under a fanned-out last frame; the rest are counted in a line. */
const BRANCH_CAP = 3;

/** A share below this rounds to 0.0%, so its clause earns no room. */
const SHARE_FLOOR = 0.05;

/**
 * The Call Tree tab's whole-log opener: the chain of calls holding most of the
 * log's time, entry point first — Visual Studio's Hot Path, Chrome's heaviest
 * stack.
 *
 * Each frame gives its total time and share of the log, then the split that says
 * where the time went: the part it kept, and the part it shed to branches the
 * path does not follow. Clicking a frame selects that call in the tree.
 *
 * Where the last frame keeps little of its own time it is no hot spot, so the
 * calls the time fanned out to follow it. A truncated log heads the list with a
 * warning: every timing below a cut-off call under-reports.
 */
@customElement('hot-path')
export class HotPath extends LitElement {
  /** The log on screen, from the app root. */
  @consume({ context: logContext, subscribe: true })
  @property({ attribute: false })
  logStore: LogStore | null = null;

  private readonly _palette = new CategoryPaletteController(this);

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
        white-space: normal;
      }

      .caveat-row:hover {
        background: var(--lana-callout-warning-bg-hover);
      }

      .caveat-row vscode-icon {
        flex: 0 0 auto;
      }

      /* A pointer to where the last frame's time went, indented under it. */
      .branch-row {
        padding-left: var(--lana-space-md);
      }

      .summary,
      .more {
        padding: var(--lana-space-3xs) 0;
        color: var(--lana-fg-muted);
        font-variant-numeric: tabular-nums;
      }
    `,
  ];

  render() {
    const log = this.logStore?.log;
    const highlights = log && getExecutionHighlights(log);
    if (!highlights || !highlights.hotPath.length) {
      return html`<p class="note">The log has no timed calls.</p>`;
    }

    // The last frame is the one the path exists to name, so a long path keeps it
    // and drops the middle instead. Rows read their neighbour from the whole
    // path, never from the shown list, so a collapsed middle leaves the figures
    // on either side of it true.
    const path = highlights.hotPath;
    const last = path.length - 1;
    const shown =
      path.length > FRAME_CAP
        ? [...path.keys()].slice(0, FRAME_CAP - 1).concat(last)
        : [...path.keys()];
    const branches = highlights.hotPathBranches;
    const rows = shown.map((index) =>
      this._frameRow(
        path[index]!,
        path[index + 1],
        highlights.totalTime,
        index === last ? highlights.hotPathEnd : null,
        branches.length,
      ),
    );
    const hidden = path.length - shown.length;
    if (hidden > 0) {
      // The dropped frames are counted where they were: above the last frame.
      rows.splice(rows.length - 1, 0, html`<div class="more">+ ${hidden} more frames</div>`);
    }
    rows.push(
      ...branches
        .slice(0, BRANCH_CAP)
        .map((branch) => this._branchRow(branch, highlights.totalTime)),
    );
    if (branches.length > BRANCH_CAP) {
      rows.push(html`<div class="more">+ ${branches.length - BRANCH_CAP} more branches</div>`);
    }
    return html`${this._truncationCaveat(highlights)}${summary(path, highlights.totalTime)}${rows}`;
  }

  /**
   * One frame: the name and figures, the split of its time beneath, then
   * the shared meter — length is the frame's share of the log, solid up to its
   * self time, with a hover target per part — so a hot-path row and a hot-spot
   * row read the same way. `end` is set on the last frame only, and says whether
   * it is the hot spot, which is the one frame that earns emphasis.
   */
  private _frameRow(
    frame: HotPathFrame,
    child: HotPathFrame | undefined,
    logTotal: number,
    end: HotPathEnd | null,
    branchCount: number,
  ) {
    const total = sharePercent(frame.totalTime, logTotal);
    const self = sharePercent(frame.selfTime, logTotal);
    const offTime = branchTime(frame, child);
    // The last frame sheds its time to nothing the path names, so it reads as
    // held below the frame rather than off the path.
    const offWhere = end !== null ? 'below this frame' : 'to branches';
    const title = revealRowTitle(
      frame,
      child ? `${formatDuration(child.totalTime)} on the path` : '',
      offTime > 0 ? `${formatDuration(offTime)} ${offWhere}` : '',
    );
    return html`
      <button
        class="bleed-row reveal-row ${end === 'hot-spot' ? 'reveal-row--focus' : ''}"
        type="button"
        title=${title}
        style=${styleMap({
          '--row-hue': this._palette.colorFor(frame.category),
          '--self-pct': `${sharePercent(frame.selfTime, frame.totalTime)}%`,
        })}
        @click=${() => dispatchInspectorReveal(this, frame.eventIndex)}
        @pointerenter=${() => dispatchInspectorLocate(this, frame.eventIndexes)}
        @pointerleave=${() => dispatchInspectorLocate(this, [])}
      >
        ${categoryLabel(frame.category)}
        <span class="reveal-row__name" title=${frame.text}>${frame.text}</span>
        <span class="reveal-row__value"
          >${frame.count > 1 ? `${frame.count}× · ` : ''}${formatDuration(frame.totalTime)} ·
          ${total.toFixed(1)}%</span
        >
        <span class="reveal-row__sub"
          >${caption(frame, self, offTime, sharePercent(offTime, logTotal), offWhere, end, branchCount)}</span
        >
        ${revealRowMeter(
          total,
          [
            { share: self, title: `self ${formatDuration(frame.selfTime)}` },
            ...(child
              ? [
                  {
                    share: sharePercent(child.totalTime, logTotal),
                    title: `${formatDuration(child.totalTime)} on the path`,
                  },
                ]
              : []),
            {
              share: sharePercent(offTime, logTotal),
              title: `${formatDuration(offTime)} ${offWhere}`,
            },
          ],
          title,
        )}
      </button>
    `;
  }

  /** Where the last frame's time went: a pointer, so it gives no split of its own. */
  private _branchRow(branch: HotPathFrame, logTotal: number) {
    const churn = branch.count > 1 ? `${branch.count}× · ` : '';
    return html`
      <button
        class="bleed-row reveal-row branch-row"
        type="button"
        title=${`${churn}total ${formatDuration(branch.totalTime)}`}
        @click=${() => dispatchInspectorReveal(this, branch.eventIndex)}
        @pointerenter=${() => dispatchInspectorLocate(this, branch.eventIndexes)}
        @pointerleave=${() => dispatchInspectorLocate(this, [])}
      >
        ${categoryLabel(branch.category)}
        <span class="reveal-row__name" title=${branch.text}>${branch.text}</span>
        <span class="reveal-row__value"
          >${churn}${formatDuration(branch.totalTime)} ·
          ${sharePercent(branch.totalTime, logTotal).toFixed(1)}%</span
        >
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

/** The frame's time that went to children the path does not follow. */
function branchTime(frame: HotPathFrame, child: HotPathFrame | undefined): number {
  return Math.max(frame.totalTime - frame.selfTime - (child?.totalTime ?? 0), 0);
}

/** The reading in one line: how far the path runs, and what it holds at each end. */
function summary(path: HotPathFrame[], logTotal: number) {
  const first = path[0]!;
  const last = path[path.length - 1]!;
  const frames = `${path.length} ${path.length === 1 ? 'frame' : 'frames'}`;
  const tail = `${formatDuration(last.totalTime)} (${sharePercent(last.totalTime, logTotal).toFixed(1)}%)`;
  return html`<div class="summary">
    ${
      path.length === 1
        ? `${frames} · ${tail}`
        : `${frames} · ${formatDuration(first.totalTime)} at entry → ${tail} at the last frame`
    }
  </div>`;
}

/** Where the row's own time went, in time and as a share of the log. */
function caption(
  frame: HotPathFrame,
  self: number,
  offTime: number,
  offPath: number,
  offWhere: string,
  end: HotPathEnd | null,
  branchCount: number,
): string {
  const parts = [`self ${formatDuration(frame.selfTime)} (${self.toFixed(1)}%)`];
  if (offPath >= SHARE_FLOOR) {
    parts.push(`${formatDuration(offTime)} (${offPath.toFixed(1)}%) ${offWhere}`);
  }
  if (end === 'hot-spot') {
    parts.push('the hot spot');
  } else if (end === 'fan-out') {
    // A frame keeping little of its own time only splits the time up; the rows
    // below name the ways, so say how many there are.
    parts.push(branchCount > 1 ? `fans out ${branchCount} ways` : 'fans out below');
  }
  return parts.join(' · ');
}

declare global {
  interface HTMLElementTagNameMap {
    'hot-path': HotPath;
  }
}
