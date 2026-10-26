/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';

import type { ContextMenuItem } from './ContextMenu.js';
import { getSettings, updateSetting, type LanaSettings } from '../features/settings/Settings.js';
import type { GridColumn, LvGrid } from '../grid/index.js';
import {
  columnMenuItems,
  getColumnView,
  pairedTitle,
  resolveColumnView,
  toggleField,
  type ColumnView,
  type MenuColumn,
  type SeenReportedPair,
} from './grid/ColumnViews.js';

export interface ColumnTarget {
  /** Each column a view can name, in order. */
  columns(): readonly MenuColumn[];
  /** Shows only the fields in `visible`, or every column for null, and titles each pair to match. */
  show(visible: ReadonlySet<string> | null, pairs?: readonly SeenReportedPair[]): void;
}

/** An lv-grid as a column view target: the view sets each column's `hidden`. */
export function gridColumnTarget<R extends object>(grid: LvGrid<R>): ColumnTarget {
  return heldColumnTarget(
    () => grid.columns,
    (columns) => (grid.columns = columns),
  );
}

/** {@link gridColumnTarget} for columns a host holds and binds to its grid, which a render would set back. */
export function heldColumnTarget<R>(
  read: () => readonly GridColumn<R>[],
  write: (columns: GridColumn<R>[]) => void,
): ColumnTarget {
  return {
    columns: read,
    show: (visible, pairs = []) => {
      const isShown = (id: string): boolean => !visible || visible.has(id);
      write(
        read().map((column) => ({
          ...column,
          hidden: !isShown(column.id),
          title: pairedTitle(column.id, pairs, isShown) ?? column.title,
        })),
      );
    },
  };
}

/** What a grid keeps in settings: the view on show, and the views the user edited. */
export interface ColumnSettings {
  columnView?: string;
  columnOverrides?: Record<string, string[]>;
}

export interface ColumnSettingsOptions {
  /** Settings section holding the two keys, e.g. `database.soql`. */
  section: string;
  /** That same section, read off the settings object. */
  read: (settings: LanaSettings) => ColumnSettings | undefined;
  /** The presets to choose from; the first is the default. */
  views: ColumnView[];
  /** Fields shown whichever view is on, e.g. the Name column. */
  alwaysVisible: string[];
  /** Seen and Reported columns whose titles change when both show. */
  pairs?: readonly SeenReportedPair[];
  /** Every grid's columns the view applies to. The call tree has three. */
  targets: () => ColumnTarget[];
}

/**
 * Owns a grid's column view: which preset is on show, the per-view overrides the
 * user edited, and both halves of that in settings.
 *
 * The two keys are private globalState, not registered `lana.*` settings, so
 * nothing pushes a change to them and one read per host is enough. Two hosts on
 * one section each read their own copy, and neither hears the other's writes.
 */
export class ColumnSettingsController implements ReactiveController {
  private readonly _host: ReactiveControllerHost;
  private readonly _options: ColumnSettingsOptions;
  private _view: string;
  private _overrides: Record<string, string[]> = {};
  private _read: Promise<void> | null = null;

  constructor(host: ReactiveControllerHost, options: ColumnSettingsOptions) {
    this._host = host;
    this._options = options;
    this._view = options.views[0]!.id;
    host.addController(this);
  }

  hostConnected(): void {
    // Once per host: a re-attach comes back to the state it left with.
    this._read ??= getSettings()
      .then((settings) => this._adopt(settings))
      // No extension host to ask (standalone browser): the grid keeps its defaults.
      .catch(() => {});
  }

  /** The preset on show. */
  get view(): string {
    return this._view;
  }

  /** The presets the user has edited, which are the ones a reset applies to. */
  get editedViews(): string[] {
    return Object.keys(this._overrides);
  }

  /** Effective fields for a view id: the user override, else the built-in preset. */
  private fieldsFor(id: string): string[] | null {
    return this._overrides[id] ?? getColumnView(this._options.views, id)?.fields ?? null;
  }

  /** Apply the view on show to `target`. */
  applyTo(target: ColumnTarget): void {
    const fields = this.fieldsFor(this._view);
    target.show(
      fields === null ? null : new Set([...this._options.alwaysVisible, ...fields]),
      this._options.pairs,
    );
  }

  /** Show `id` and remember it. */
  choose(id: string): void {
    this._show(id);
    updateSetting(`${this._options.section}.columnView`, id);
  }

  /** Add or remove one column from the view on show, and remember it. */
  toggle(target: ColumnTarget, field: string): void {
    const fields = target.columns().map((column) => column.id);
    this._overrides = {
      ...this._overrides,
      [this._view]: toggleField(this.fieldsFor(this._view), field, fields),
    };
    this._apply();
    this._host.requestUpdate();
    updateSetting(`${this._options.section}.columnOverrides`, this._overrides);
  }

  /** Give a view back its built-in columns. Defaults to the one on show. */
  reset(id: string = this._view): void {
    if (!this._overrides[id]) {
      return;
    }
    const { [id]: _dropped, ...rest } = this._overrides;
    this._overrides = rest;
    if (id === this._view) {
      this._apply();
    }
    this._host.requestUpdate();
    updateSetting(`${this._options.section}.columnOverrides`, this._overrides);
  }

  /** The column header menu for `target`, against the state now. */
  menuItems(target: ColumnTarget): ContextMenuItem[] {
    const { views, alwaysVisible, pairs } = this._options;
    return columnMenuItems(
      target.columns(),
      this._view,
      views,
      alwaysVisible,
      this.editedViews,
      pairs,
    );
  }

  private _adopt(settings: LanaSettings): void {
    const stored = this._options.read(settings);
    this._overrides = stored?.columnOverrides ?? {};
    this._show(resolveColumnView(this._options.views, stored?.columnView));
  }

  private _show(id: string): void {
    this._view = id;
    this._apply();
    this._host.requestUpdate();
  }

  private _apply(): void {
    for (const target of this._options.targets()) {
      this.applyTo(target);
    }
  }
}
