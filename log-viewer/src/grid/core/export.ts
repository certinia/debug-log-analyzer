/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/** A column as export writes it: its header and the value of each row. */
export interface ExportColumn<R> {
  title: string;
  value(row: R): string | number | boolean | null | undefined;
}

export interface ExportOptions {
  /** `csv` quotes every value; `tsv` is what the clipboard takes. */
  format: 'csv' | 'tsv';
  /**
   * Write each row's descendants under it. Default true; false writes top-level rows only.
   * When true and a row is below the top level, each line starts with a Level cell: 1 for a
   * top-level row or a group, 2 for its children, and so on.
   */
  tree?: boolean;
}

type Value = ReturnType<ExportColumn<unknown>['value']>;

function cell(value: Value, format: ExportOptions['format']): string {
  const text = value === null || value === undefined ? '' : String(value);
  return format === 'csv' ? `"${text.replaceAll('"', '""')}"` : text.replaceAll(/[\t\r\n]+/g, ' ');
}

const separator = (format: ExportOptions['format']): string => (format === 'csv' ? ',' : '\t');

const lead = (level: Value, format: ExportOptions['format']): string =>
  level === undefined ? '' : cell(level, format) + separator(format);

/** With `levels`, the line starts with a `Level` title. */
export function headerLine<R>(
  columns: readonly ExportColumn<R>[],
  format: ExportOptions['format'],
  levels = false,
): string {
  return (
    lead(levels ? 'Level' : undefined, format) +
    columns.map((column) => cell(column.title, format)).join(separator(format))
  );
}

/** With `level`, the line starts with it: 1 for a top-level row. */
export function rowLine<R>(
  row: R,
  columns: readonly ExportColumn<R>[],
  format: ExportOptions['format'],
  level?: number,
): string {
  return (
    lead(level, format) +
    columns.map((column) => cell(column.value(row), format)).join(separator(format))
  );
}

/** A group's line: its key, alone, as Tabulator writes one, after its `level` if given. */
export const groupLine = (key: string, format: ExportOptions['format'], level?: number): string =>
  lead(level, format) + cell(key, format);
