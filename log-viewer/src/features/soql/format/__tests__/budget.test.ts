/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { budgetedChunks, type SoqlBudget } from '../budget.js';
import { countLeaves, parseConditions, splitClauses } from '../clauses.js';
import { tokenize } from '../tokenize.js';

const BUDGET: SoqlBudget = { lines: 8, columns: 60 };

/** Plain text of a budgeted render, as the panel shows it. */
function render(query: string, budget: SoqlBudget = BUDGET): string {
  return budgetedChunks(tokenize(query), budget)
    .map((chunk) => (typeof chunk === 'string' ? chunk : chunk.text))
    .join('');
}

function lines(query: string, budget: SoqlBudget = BUDGET): string[] {
  return render(query, budget).split('\n');
}

function conditionCount(where: string): number {
  const clause = splitClauses(tokenize(where)).find((c) => c.keyword === 'WHERE');
  return countLeaves(parseConditions(clause?.body ?? []));
}

describe('SOQL budgeted render', () => {
  describe('clause layout', () => {
    it('gives each clause its own line', () => {
      expect(lines('SELECT Id FROM Account WHERE Name = :n ORDER BY Name LIMIT 10')).toEqual([
        'SELECT Id',
        'FROM Account',
        'WHERE Name = :n',
        'ORDER BY Name',
        'LIMIT 10',
      ]);
    });

    it('never truncates FROM, ORDER BY or LIMIT', () => {
      const query = `SELECT Id FROM AVeryLongCustomObjectName__c ORDER BY CreatedDate DESC NULLS LAST LIMIT 200 OFFSET 100`;
      const out = lines(query);
      expect(out).toContain('FROM AVeryLongCustomObjectName__c');
      expect(out).toContain('ORDER BY CreatedDate DESC NULLS LAST');
      expect(out).toContain('LIMIT 200');
      expect(out).toContain('OFFSET 100');
    });
  });

  describe('field list', () => {
    it('keeps the fields that fit and counts the rest', () => {
      const fields = Array.from({ length: 40 }, (_, i) => `Field${i}__c`).join(', ');
      const select = lines(`SELECT ${fields} FROM Account`)[0]!;

      expect(select.length).toBeLessThanOrEqual(BUDGET.columns);
      expect(select).toMatch(/\+\d+ fields$/);
      expect(select).toContain('Field0__c');
    });

    it('leaves a short field list whole', () => {
      expect(lines('SELECT Id, Name FROM Account')[0]).toBe('SELECT Id, Name');
    });

    it('keeps the shape of a subquery but not its fields', () => {
      const out = lines('SELECT Id, (SELECT Id, Email FROM Contacts) FROM Account')[0];
      expect(out).toBe('SELECT Id, (SELECT … FROM Contacts)');
    });
  });

  describe('conditions', () => {
    it('counts every comparison, at every nesting level', () => {
      expect(conditionCount('WHERE (a = 1 AND b = 2) OR c = 3')).toBe(3);
      expect(conditionCount('WHERE NOT (a = 1)')).toBe(1);
    });

    it('puts one condition on each line, led by its join', () => {
      expect(lines('SELECT Id FROM Account WHERE a = 1 AND b = 2 OR c = 3')).toEqual([
        'SELECT Id',
        'FROM Account',
        'WHERE a = 1',
        '  AND b = 2',
        '  OR c = 3',
      ]);
    });

    it('counts the conditions it left out', () => {
      const conditions = Array.from({ length: 12 }, (_, i) => `Field${i}__c = ${i}`).join(' AND ');
      const out = lines(`SELECT Id FROM Account WHERE ${conditions}`, { lines: 6, columns: 60 });

      expect(out[out.length - 1]).toMatch(/… \+\d+ conditions$/);
      expect(out.length).toBeLessThanOrEqual(6);
    });

    it('keeps a group whole when it fits', () => {
      const out = lines('SELECT Id FROM Account WHERE (a = 1 AND b = 2) OR c = 3');
      expect(out).toContain('WHERE (a = 1 AND b = 2)');
      expect(out).toContain('  OR c = 3');
    });

    it('collapses a group that does not fit, counting its own conditions', () => {
      const group = Array.from({ length: 8 }, (_, i) => `Field${i}__c = ${i}`).join(' AND ');
      const out = lines(`SELECT Id FROM Account WHERE (${group}) OR z = 1`);
      const line = out.find((l) => l.startsWith('WHERE'))!;

      expect(line).toMatch(/… \+\d+ conditions\)$/);
      expect(line.length).toBeLessThanOrEqual(BUDGET.columns);
    });

    it('gives every spare line to WHERE', () => {
      const conditions = Array.from({ length: 12 }, (_, i) => `f${i} = ${i}`).join(' AND ');
      const short = lines(`SELECT Id FROM Account WHERE ${conditions}`, { lines: 6, columns: 60 });
      const tall = lines(`SELECT Id FROM Account WHERE ${conditions}`, { lines: 12, columns: 60 });

      expect(tall.length).toBeGreaterThan(short.length);
    });

    it('says how many literals an IN list holds', () => {
      const ids = Array.from(
        { length: 200 },
        (_, i) => `'001xx0000000${String(i).padStart(3, '0')}'`,
      ).join(', ');
      const out = lines(`SELECT Id FROM Account WHERE Id IN (${ids})`);
      expect(out).toContain('WHERE Id IN (… 200 ids)');
    });

    it('leaves a short IN list alone', () => {
      const out = lines(`SELECT Id FROM Account WHERE Type IN ('a', 'b')`);
      expect(out).toContain(`WHERE Type IN ('a', 'b')`);
    });
  });
});
