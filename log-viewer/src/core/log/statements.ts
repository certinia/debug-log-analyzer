/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { type EventOf, eventType } from '@apexdevtools/apex-log-parser';

import type { Derivation } from './LogStore.js';

export type SoqlEvent = EventOf<'SOQL_EXECUTE_BEGIN'>;
export type DmlEvent = EventOf<'DML_BEGIN'>;
export type SoslEvent = EventOf<'SOSL_EXECUTE_BEGIN'>;

/** The log's database statements, each kind in log order. */
export interface Statements {
  soql: SoqlEvent[];
  dml: DmlEvent[];
  sosl: SoslEvent[];
  /** Every statement's index row, in log order. */
  rows: readonly number[];
}

const SOQL = eventType('SOQL_EXECUTE_BEGIN').typeId;
const DML = eventType('DML_BEGIN').typeId;
const SOSL = eventType('SOSL_EXECUTE_BEGIN').typeId;

/** {@link Statements} for the log, found by type id: only a statement is read as an event. */
export const statements: Derivation<Statements> = (index) => {
  const soql: SoqlEvent[] = [];
  const dml: DmlEvent[] = [];
  const sosl: SoslEvent[] = [];
  const rows: number[] = [];
  const type = index.column(index.log.columns.type);
  for (let row = 0; row < index.rowCount; row++) {
    const typeId = type[row];
    if (typeId === SOQL) {
      soql.push(index.event(row) as SoqlEvent);
    } else if (typeId === DML) {
      dml.push(index.event(row) as DmlEvent);
    } else if (typeId === SOSL) {
      sosl.push(index.event(row) as SoslEvent);
    } else {
      continue;
    }
    rows.push(row);
  }
  return { soql, dml, sosl, rows };
};
