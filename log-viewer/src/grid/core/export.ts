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
  /** Write each row's descendants under it. Default true; false writes top-level rows only. */
  tree?: boolean;
}

type Value = ReturnType<ExportColumn<unknown>['value']>;

function cell(value: Value, format: ExportOptions['format']): string {
  const text = value === null || value === undefined ? '' : String(value);
  return format === 'csv' ? `"${text.replaceAll('"', '""')}"` : text.replaceAll(/[\t\r\n]+/g, ' ');
}

const separator = (format: ExportOptions['format']): string => (format === 'csv' ? ',' : '\t');

export function headerLine<R>(
  columns: readonly ExportColumn<R>[],
  format: ExportOptions['format'],
): string {
  return columns.map((column) => cell(column.title, format)).join(separator(format));
}

export function rowLine<R>(
  row: R,
  columns: readonly ExportColumn<R>[],
  format: ExportOptions['format'],
): string {
  return columns.map((column) => cell(column.value(row), format)).join(separator(format));
}

/** A group's line: its key, alone, as Tabulator writes one. */
export const groupLine = (key: string, format: ExportOptions['format']): string =>
  cell(key, format);
