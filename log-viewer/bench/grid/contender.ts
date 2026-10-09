/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';

/** What every bench page needs of a table. */
export interface Mounted {
  mount(host: HTMLElement, log: ApexLog): Promise<void>;
  scroller(): HTMLElement;
  /** Rows the table holds after filters and expansion. */
  visibleRowCount(): number;
}

/** One Time Order table under test. Every action resolves once its work is queued. */
export interface Contender extends Mounted {
  expandAll(): void | Promise<void>;
  collapseAll(): void | Promise<void>;
  sortSelfDesc(): void | Promise<void>;
  clearSort(): void | Promise<void>;
  setDetailFilter(on: boolean): void | Promise<void>;
  /** Expands to, scrolls to and selects the row for `event`. */
  goTo(event: LogEvent): Promise<void>;
  /** Number of matching rows across the whole tree. */
  find(text: string): Promise<number>;
  /** Length of the CSV text for every row. */
  exportCsv(): Promise<number>;
  setColumnVisible(field: string, visible: boolean): void | Promise<void>;
  setNameWidth(px: number): void;
}

/** One Bottom-Up table under test, driven the way the Call Tree's Bottom-Up tab drives it. */
export interface BottomUpContender extends MergedContender {
  /** Groups by a row field, or ungroups. */
  groupBy(field: 'type' | 'namespace' | null): void | Promise<void>;
}

/** One Aggregated or Bottom-Up table under test: the actions both tabs have. */
export interface MergedContender extends Mounted {
  sortTotalDesc(): void | Promise<void>;
  clearSort(): void | Promise<void>;
  expandAll(): void | Promise<void>;
  collapseAll(): void | Promise<void>;
  /** Number of matching rows across the whole tree. */
  find(text: string): Promise<number>;
  /** Length of the CSV text for every row. */
  exportCsv(): Promise<number>;
}
