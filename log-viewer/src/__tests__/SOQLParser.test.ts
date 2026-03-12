/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { ApexSyntaxError } from '@apexdevtools/apex-parser';

import { SOQLParser } from '../features/soql/services/SOQLParser.js';

describe('Analyse database tests', () => {
  it('throws on unparsable query', async () => {
    const parser = new SOQLParser();
    try {
      await parser.parse('');
      expect(true).toBe(false);
    } catch (ex) {
      expect(ex).toBeInstanceOf(ApexSyntaxError);
      const syntaxError = ex as ApexSyntaxError;
      expect(syntaxError.line).toBe(1);
      expect(syntaxError.column).toBe(0);
    }
  });

  it('extracts simple FROM object', async () => {
    const parser = new SOQLParser();
    const tree = await parser.parse('SELECT Id FROM Account');
    expect(tree.fromObject()).toEqual('Account');
  });

  it('determines if only fields are being selected', async () => {
    const parser = new SOQLParser();
    const tree = await parser.parse('SELECT Id FROM Account');
    expect(tree.isSimpleSelect()).toEqual(true);
  });

  it('determines if none-fields are being selected', async () => {
    const parser = new SOQLParser();
    const tree = await parser.parse('SELECT Count(Id) FROM Account');
    expect(tree.isSimpleSelect()).toEqual(false);
  });

  it('determines if none-trival clauses are being used', async () => {
    const parser = new SOQLParser();
    const tree = await parser.parse('SELECT Id FROM Account GROUP BY Name LIMIT 2');
    expect(tree.isTrivialQuery()).toEqual(false);
  });

  it('determines no LIMIT', async () => {
    const parser = new SOQLParser();
    const tree = await parser.parse('SELECT Id FROM Account');
    expect(tree.limitValue()).toEqual(undefined);
  });

  it('determines LIMIT number', async () => {
    const parser = new SOQLParser();
    const tree = await parser.parse('SELECT Id FROM Account LIMIT 2');
    expect(tree.limitValue()).toEqual(2);
  });

  it('determines LIMIT expression', async () => {
    const parser = new SOQLParser();
    const tree = await parser.parse('SELECT Id FROM Account LIMIT :tmp');
    expect(tree.limitValue()).toEqual(':tmp');
  });

  it('determines if does not have ORDER BY', async () => {
    const parser = new SOQLParser();
    const tree = await parser.parse('SELECT Id FROM Account');
    expect(tree.isOrdered()).toEqual(false);
  });

  it('determines if has ORDER BY', async () => {
    const parser = new SOQLParser();
    const tree = await parser.parse('SELECT Id FROM Account ORDER BY Name');
    expect(tree.isOrdered()).toEqual(true);
  });
});
