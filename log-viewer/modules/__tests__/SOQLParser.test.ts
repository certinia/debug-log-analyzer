/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 * @jest-environment jsdom
 */

import { SOQLParser, SyntaxException } from '../parsers/SOQLParser';

describe('Analyse database tests', () => {
  it('throws on unparsable query', async () => {
    const parser = new SOQLParser();
    try {
      parser.parse('');
      expect(true).toBe(false);
    } catch (ex) {
      expect(ex).toEqual(new SyntaxException(1, 0, "mismatched input '<EOF>' expecting 'select'"));
    }
  });

  it('can extract simple FROM object', async () => {
    const parser = new SOQLParser();
    const tree = parser.parse('SELECT Id From Account');
    expect(tree.fromObject()).toEqual('Account');
  });
});
