/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';

/** One table implementation under test. Every action resolves once its work is queued. */
export interface Contender {
  mount(host: HTMLElement, log: ApexLog): Promise<void>;
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
  scroller(): HTMLElement;
  /** Rows the table holds after filters and expansion. */
  visibleRowCount(): number;
}
