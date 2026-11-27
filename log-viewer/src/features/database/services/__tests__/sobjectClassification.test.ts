/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import { rawStoreOf } from '#test-helpers/apexLog.js';
import type { SoqlEvent } from '#core/log/statements.js';
import { deriveSoqlObject, parseFromObject } from '../sobjectClassification.js';

/** A parsed query, with a plan on `explainSObject` when given. */
async function soqlLine(text: string, explainSObject?: string): Promise<SoqlEvent> {
  const explain = explainSObject
    ? `09:18:22.6 (1001)|SOQL_EXECUTE_EXPLAIN|[1]|Index on ${explainSObject} : [Id], cardinality: 1, sobjectCardinality: 2, relativeCost 0.1\n`
    : '';
  const { log } = await rawStoreOf(
    `09:18:22.6 (1000)|SOQL_EXECUTE_BEGIN|[1]|Aggregations:0|${text}\n` +
      explain +
      '09:18:22.6 (1002)|SOQL_EXECUTE_END|[1]|Rows:1\n',
  );
  return log.event(1) as SoqlEvent; // the only event is the query
}

describe('parseFromObject', () => {
  it('reads a simple FROM clause', () => {
    expect(parseFromObject('SELECT Id FROM Account')).toBe('Account');
  });

  it('is case-insensitive on the FROM keyword', () => {
    expect(parseFromObject('select Id from Contact')).toBe('Contact');
  });

  it('reads namespaced custom / metadata objects', () => {
    expect(parseFromObject('SELECT Id FROM ns__Config__mdt')).toBe('ns__Config__mdt');
    expect(parseFromObject('SELECT Id FROM ns2__MyObject__c')).toBe('ns2__MyObject__c');
  });

  it('ignores a subquery FROM and returns the outer object', () => {
    expect(parseFromObject('SELECT Id, (SELECT Id FROM Contacts) FROM Account')).toBe('Account');
  });

  it('handles nested subqueries', () => {
    const query = 'SELECT Id, (SELECT Id, (SELECT Id FROM Notes) FROM Contacts) FROM Account';
    expect(parseFromObject(query)).toBe('Account');
  });

  it('returns null when there is no FROM', () => {
    expect(parseFromObject('DELETE something')).toBeNull();
    expect(parseFromObject(undefined)).toBeNull();
  });
});

describe('deriveSoqlObject', () => {
  it('prefers the query-plan sObjectType when present', async () => {
    const line = await soqlLine('SELECT Id FROM Account', 'Contact');
    expect(deriveSoqlObject(line)).toBe('Contact');
  });

  it('falls back to the FROM clause without a query plan', async () => {
    expect(deriveSoqlObject(await soqlLine('SELECT Id FROM Opportunity'))).toBe('Opportunity');
  });
});
