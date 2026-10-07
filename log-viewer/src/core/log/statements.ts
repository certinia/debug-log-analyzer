/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  DMLBeginLine,
  LOG_CATEGORY,
  SOQLExecuteBeginLine,
  SOSLExecuteBeginLine,
} from '@apexdevtools/apex-log-parser';

import type { Derivation } from './LogStore.js';

/** The log's database statements, each kind in log order. */
export interface Statements {
  soql: SOQLExecuteBeginLine[];
  dml: DMLBeginLine[];
  sosl: SOSLExecuteBeginLine[];
  /** Every statement's index row, in log order. */
  rows: readonly number[];
}

/**
 * {@link Statements} for the log. A statement is always in the SOQL or DML
 * category, so only the rows in those two are read as events.
 */
export const statements: Derivation<Statements> = (index) => {
  const soql: SOQLExecuteBeginLine[] = [];
  const dml: DMLBeginLine[] = [];
  const sosl: SOSLExecuteBeginLine[] = [];
  const rows: number[] = [];
  const soqlId = index.categoryNames.indexOf(LOG_CATEGORY.SOQL);
  const dmlId = index.categoryNames.indexOf(LOG_CATEGORY.DML);
  const { categoryId, rowCount } = index;
  for (let row = 0; row < rowCount; row++) {
    const category = categoryId[row];
    if (category !== soqlId && category !== dmlId) {
      continue;
    }
    const event = index.event(row);
    if (event instanceof SOQLExecuteBeginLine) {
      soql.push(event);
    } else if (event instanceof DMLBeginLine) {
      dml.push(event);
    } else if (event instanceof SOSLExecuteBeginLine) {
      sosl.push(event);
    } else {
      continue;
    }
    rows.push(row);
  }
  return { soql, dml, sosl, rows };
};
