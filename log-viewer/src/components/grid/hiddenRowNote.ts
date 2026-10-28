/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  css,
  html,
  nothing,
  type ReactiveController,
  type ReactiveControllerHost,
  type TemplateResult,
} from 'lit';
import { keyed } from 'lit/directives/keyed.js';
import { styleMap } from 'lit/directives/style-map.js';

import type { GoToResult, RowKey } from '../../grid/index.js';
import { liveStatus } from '../liveStatus.js';

import '#vscode-elements/vscode-icon.js';

/** The event a go-to found the filters hiding, so the view can offer to clear them. */
export interface HiddenRow {
  eventId: number;
  /** True when the grid selected the nearest shown parent; false when it selected nothing. */
  parentSelected: boolean;
}

/**
 * Whether `goTo(path)` left its row hidden by the filters. Null when the row shows,
 * or when a newer selection superseded the go-to.
 */
export function hiddenAfterGoTo(goTo: {
  eventId: number;
  path: readonly RowKey[];
  result: GoToResult;
  selectedKey: RowKey | null;
}): HiddenRow | null {
  const { eventId, path, result, selectedKey } = goTo;
  if (!path.length || result === 'superseded') {
    return null;
  }
  if (result === 'none-shown') {
    return { eventId, parentSelected: false };
  }
  // The grid stops at the deepest shown row on the path, so a row the filters hide lands on its parent.
  return selectedKey === path.at(-1) ? null : { eventId, parentSelected: true };
}

/** What the bar reads from the grid on show. */
interface NoteGrid {
  readonly headerHeight: number;
  focus(options?: FocusOptions): void;
}

/**
 * The row a go-to or an inspector reveal found the filters hiding, shown as a bar floating
 * over the table just under its header, with a live-region message.
 *
 * Call {@link begin} as a go-to starts and check its answer after each await, then
 * {@link show} what the grid did; {@link invalidate} on any filter change or new log.
 */
export class HiddenRowController<T extends HiddenRow = HiddenRow> implements ReactiveController {
  private readonly _host: ReactiveControllerHost;
  private readonly _grid: () => NoteGrid | null;
  private readonly _onClear: (hidden: T) => Promise<void>;
  private _hidden: T | null = null;
  private _top = 0;
  private _goTos = 0;

  constructor(
    host: ReactiveControllerHost,
    options: {
      /** The grid on show: the bar sits under its header, and focus returns to it. */
      grid: () => NoteGrid | null;
      /** Clears the filters that can hide `hidden`, then goes to it again. */
      onClear: (hidden: T) => Promise<void>;
    },
  ) {
    this._host = host;
    this._grid = options.grid;
    this._onClear = options.onClear;
    host.addController(this);
  }

  // The grid can go with the host, so drop the bar and any running go-to.
  hostDisconnected(): void {
    this.invalidate();
  }

  /** Overtakes any running go-to; the returned check is false once another begins or an invalidate comes. */
  begin(): () => boolean {
    this.invalidate();
    const goTo = this._goTos;
    return () => goTo === this._goTos;
  }

  invalidate(): void {
    this._goTos++;
    this.dismiss();
  }

  /** Drops the bar, leaving any go-to still running to finish. */
  dismiss(): void {
    if (this._hidden) {
      this._hidden = null;
      this._host.requestUpdate();
    }
  }

  show(hidden: T | null): void {
    this._hidden = hidden;
    // Read here, not in render: a layout read there would reflow on every host render.
    this._top = hidden ? (this._grid()?.headerHeight ?? 0) : 0;
    this._host.requestUpdate();
  }

  /** What a screen reader hears: render on every pass, so the region exists before its first message. */
  renderStatus(): TemplateResult {
    const hidden = this._hidden;
    return liveStatus(
      !hidden
        ? ''
        : hidden.parentSelected
          ? 'The filters hide that row, so its parent is selected. Use Clear filters over the table to show it.'
          : 'The filters hide that row and every row above it. Use Clear filters over the table to show it.',
    );
  }

  /** The bar. Render it first in the element that holds the grid, so it lays over the grid's top. */
  renderNote(): unknown {
    const hidden = this._hidden;
    if (!hidden) {
      return nothing;
    }
    // Keyed on the hidden row, so each new one mounts afresh and pulses again.
    return keyed(
      hidden,
      html`<div class="hidden-note-anchor">
        <div
          class="hidden-note"
          role="group"
          aria-label="Row hidden by current filters"
          style=${styleMap({ top: `calc(${this._top}px + var(--lana-space-xs))` })}
          @keydown=${this._onKey}
        >
          <vscode-icon class="hidden-note__icon" name="filter"></vscode-icon>
          <span class="hidden-note__text">Row hidden by current filters</span>
          <button
            type="button"
            class="hidden-note__clear"
            aria-label="Clear filters and go to the hidden row"
            @click=${() => void this._clear(hidden)}
          >
            Clear filters
          </button>
          <vscode-icon
            name="close"
            action-icon
            label="Close"
            title="Close"
            @click=${this._close}
          ></vscode-icon>
        </div>
      </div>`,
    );
  }

  private async _clear(hidden: T): Promise<void> {
    await this._onClear(hidden);
    // Only when focus went with the bar: a click elsewhere while Clear ran, such as in the inspector, keeps it.
    if (!document.activeElement || document.activeElement === document.body) {
      this._grid()?.focus({ preventScroll: true });
    }
  }

  private readonly _close = (): void => {
    this.dismiss();
    this._grid()?.focus({ preventScroll: true });
  };

  private readonly _onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this._close();
    }
  };
}

/** The bar's styles, for the host that renders {@link HiddenRowController.renderNote}. */
export const hiddenRowNoteStyles = css`
  /* No height, so the rows do not move; the bar lays over them. */
  .hidden-note-anchor {
    position: relative;
    z-index: 1;
    height: 0;
  }

  .hidden-note {
    position: absolute;
    right: var(--lana-space-md);
    display: flex;
    align-items: center;
    gap: var(--lana-space-xs);
    max-width: calc(100% - 2 * var(--lana-space-md));
    padding: var(--lana-space-2xs) var(--lana-space-xs);
    border: var(--lana-stroke) solid var(--lana-surface-border);
    border-radius: var(--lana-radius-sm);
    background: var(--lana-popover-bg);
    box-shadow: var(--lana-shadow-popover);
    white-space: nowrap;
    animation: hidden-note-pulse 1.2s ease-out;
  }

  /* The click that hid the row was in the inspector, so the eye is elsewhere. */
  @keyframes hidden-note-pulse {
    0%,
    30% {
      background-color: var(--lana-attention-bg);
    }
    100% {
      background-color: var(--lana-popover-bg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .hidden-note {
      animation: none;
    }
  }

  .hidden-note__icon {
    flex: none;
    color: var(--lana-severity-warning);
  }

  .hidden-note__text {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hidden-note__clear {
    flex: none;
    padding: 0;
    border: none;
    background: none;
    color: var(--lana-link-fg);
    font: inherit;
    cursor: pointer;
  }

  .hidden-note__clear:hover {
    color: var(--lana-link-fg-active);
    text-decoration: underline;
  }

  .hidden-note__clear:focus-visible {
    outline: var(--lana-focus-ring);
    outline-offset: var(--lana-focus-offset);
  }
`;
