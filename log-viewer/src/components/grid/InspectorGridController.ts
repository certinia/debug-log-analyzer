/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import '../ContextMenu.js';
import { css, html, type LitElement, type ReactiveController, type TemplateResult } from 'lit';

import { eventBus } from '#core/events/EventBus.js';
import { SubscriptionController } from '#core/events/SubscriptionController.js';
import { sameMembers } from '#core/utility/Util.js';
import type {
  GridContextDetail,
  GridRowDetail,
  GridSelectDetail,
  LvGrid,
  RowKey,
} from '../../grid/index.js';
import type { ContextMenu } from '../ContextMenu.js';
import { dispatchInspectorLocate } from '../inspectorReveal.js';
import { PANEL_ROW_MENU_ITEMS, runPanelRowAction } from '../panelRowMenu.js';

export interface InspectorGridOptions<R extends object> {
  grid: () => LvGrid<R> | null;
  /** The rows on screen; a new one marks the rows again. */
  source: () => unknown;
  /** The frames a row stands for, which hovering it marks in the tab on screen. */
  frames: (row: R) => readonly number[];
  /** What picking a row does: reveal its frame, or hold a mark on the frames it merges. */
  pick: (row: R | null) => void;
  /** The frame the row menu acts on; null leaves the browser's own menu. */
  menuFrame: (row: R) => number | null;
  /** The keys of the rows that stand for the frames under the pointer in the tab on screen. */
  keysFor: (eventIds: readonly number[]) => Iterable<RowKey>;
  /** Escape drops a picked row, and the mark it holds in the tab on screen. */
  dropOnClear?: boolean;
}

export const NOTHING_MARKED: ReadonlySet<RowKey> = new Set();

/** An inspector section that is one grid filling the section's height. */
export const inspectorGridStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  lv-app-grid {
    flex: 1 1 auto;
    min-height: 0;
  }
`;

/**
 * An inspector section's grid: hover marks the row's frames in the tab on screen, a pick
 * goes to `pick`, the row menu acts on one frame, and the frames under the pointer in the
 * tab are marked here as `marked`. A select made for the inspector is never a pick.
 */
export class InspectorGridController<R extends object> implements ReactiveController {
  marked: ReadonlySet<RowKey> = NOTHING_MARKED;

  private readonly _host: LitElement;
  private readonly _options: InspectorGridOptions<R>;
  private _located: readonly number[] = [];
  private _menuFrame = -1;
  private _source: unknown = null;

  constructor(host: LitElement, options: InspectorGridOptions<R>) {
    this._host = host;
    this._options = options;
    host.addController(this);
    new SubscriptionController(host, () => [
      eventBus.on('detail:locate', ({ eventIds }) => {
        // The tab reports the same list again each time the pointer leaves one of its rows.
        if (eventIds !== this._located) {
          this._located = eventIds;
          this._remark();
        }
      }),
      ...(options.dropOnClear ? [eventBus.on('selection:clear', () => this._dropPick())] : []),
      listen(host.renderRoot, 'lv-grid-select', this._onSelect),
      listen(host.renderRoot, 'lv-grid-locate', this._onLocate),
      listen(host.renderRoot, 'lv-grid-context', this._onContext),
    ]);
  }

  hostUpdate(): void {
    const source = this._options.source();
    if (source !== this._source) {
      this._source = source;
      this._remark();
    }
  }

  hostDisconnected(): void {
    // Reports stop while detached, so the last one is out of date.
    this._located = [];
    this._setMarked(NOTHING_MARKED);
  }

  private _remark(): void {
    const keys = this._located.length ? new Set(this._options.keysFor(this._located)) : null;
    this._setMarked(keys?.size ? keys : NOTHING_MARKED);
  }

  /** Selects the row at `path`, or clears the selection on null, without calling it a pick. */
  async selectActive(path: readonly RowKey[] | null): Promise<void> {
    const grid = this._options.grid();
    if (!path?.length) {
      grid?.deselect();
      return;
    }
    await grid?.goTo(path, { scrollIfVisible: false });
  }

  /** The row menu, which the host renders once. */
  menu(): TemplateResult {
    return html`<context-menu
      @menu-select=${(e: CustomEvent<{ itemId: string }>) =>
        runPanelRowAction(e.detail.itemId, this._menuFrame)}
    ></context-menu>`;
  }

  private readonly _onSelect = (e: CustomEvent<GridSelectDetail<R>>): void => {
    if (e.detail.user) {
      this._options.pick(e.detail.row);
    }
  };

  private readonly _onLocate = (e: CustomEvent<GridRowDetail<R>>): void => {
    const { row } = e.detail;
    dispatchInspectorLocate(this._host, row ? this._options.frames(row) : []);
  };

  private readonly _onContext = (e: CustomEvent<GridContextDetail<R>>): void => {
    const { row, event } = e.detail;
    const frame = row ? this._options.menuFrame(row) : null;
    const menu = this._host.renderRoot.querySelector<ContextMenu>('context-menu');
    if (frame === null || !menu || window.getSelection()?.type === 'Range') {
      return;
    }
    event.preventDefault();
    this._menuFrame = frame;
    menu.show(PANEL_ROW_MENU_ITEMS, event.clientX, event.clientY);
  };

  private _dropPick(): void {
    const grid = this._options.grid();
    if (grid?.deselect()) {
      dispatchInspectorLocate(this._host, [], true);
    }
  }

  private _setMarked(marked: ReadonlySet<RowKey>): void {
    // A new set repaints the rows, and most pointer moves leave the mark as it was.
    if (sameMembers(marked, this.marked)) {
      return;
    }
    this.marked = marked;
    this._host.requestUpdate();
  }
}

function listen<D>(
  target: EventTarget,
  type: string,
  handler: (e: CustomEvent<D>) => void,
): () => void {
  const listener = (e: Event) => handler(e as CustomEvent<D>);
  target.addEventListener(type, listener);
  return () => target.removeEventListener(type, listener);
}
