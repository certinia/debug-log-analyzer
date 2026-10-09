/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';

export interface Mounted {
  mount(host: HTMLElement, log: ApexLog): Promise<void>;
  scroller(): HTMLElement;
  /** Rows the table holds after filters and expansion. */
  visibleRowCount(): number;
}

/** What both tables under test do the same way. Every action resolves once its work is queued. */
interface Table extends Mounted {
  expandAll(): void | Promise<void>;
  collapseAll(): void | Promise<void>;
  clearSort(): void | Promise<void>;
  /** Number of matching rows across the whole tree. */
  find(text: string): Promise<number>;
  /** Length of the CSV text for every row. */
  exportCsv(): Promise<number>;
}

export interface Contender extends Table {
  sortSelfDesc(): void | Promise<void>;
  setDetailFilter(on: boolean): void | Promise<void>;
  /** Expands to, scrolls to and selects the row for `event`. */
  goTo(event: LogEvent): Promise<void>;
  setColumnVisible(field: string, visible: boolean): void | Promise<void>;
  setNameWidth(px: number): void;
}

export interface BottomUpContender extends MergedContender {
  /** Groups by a row field, or ungroups. */
  groupBy(field: 'type' | 'namespace' | null): void | Promise<void>;
}

export interface MergedContender extends Table {
  sortTotalDesc(): void | Promise<void>;
}
