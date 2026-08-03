/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import type { SOQLExecuteBeginLine } from 'apex-log-parser';

import { deriveSoqlObject, parseFromObject } from '../sobjectClassification.js';

/** Minimal SOQL line stub — only the fields deriveSoqlObject reads. */
function soqlLine(text: string, explainSObject?: string): SOQLExecuteBeginLine {
  return {
    text,
    children: explainSObject ? [{ sObjectType: explainSObject }] : [],
  } as unknown as SOQLExecuteBeginLine;
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
  it('prefers the query-plan sObjectType when present', () => {
    const line = soqlLine('SELECT Id FROM Account', 'Contact');
    expect(deriveSoqlObject(line)).toBe('Contact');
  });

  it('falls back to the FROM clause without a query plan', () => {
    expect(deriveSoqlObject(soqlLine('SELECT Id FROM Opportunity'))).toBe('Opportunity');
  });
});
