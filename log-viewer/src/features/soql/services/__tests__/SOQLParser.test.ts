/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from 'vitest';

import { SOQLParser, SyntaxException } from '../SOQLParser.js';

type Tree = Awaited<ReturnType<SOQLParser['parse']>>;

describe('SOQLParser', () => {
  it('throws on unparsable query', async () => {
    await expect(new SOQLParser().parse('')).rejects.toEqual(
      new SyntaxException(1, 0, "mismatched input '<EOF>' expecting 'select'"),
    );
  });

  it.each<[string, string, (tree: Tree) => unknown, unknown]>([
    ['the FROM object', 'SELECT Id FROM Account', (tree) => tree.fromObject(), 'Account'],
    ['a select of fields only', 'SELECT Id FROM Account', (tree) => tree.isSimpleSelect(), true],
    [
      'a select of more than fields',
      'SELECT Count(Id) FROM Account',
      (tree) => tree.isSimpleSelect(),
      false,
    ],
    ['a trivial query', 'SELECT Id FROM Account', (tree) => tree.isTrivialQuery(), true],
    [
      'a query with non-trivial clauses',
      'SELECT Id FROM Account GROUP BY Name LIMIT 2',
      (tree) => tree.isTrivialQuery(),
      false,
    ],
    ['no LIMIT', 'SELECT Id FROM Account', (tree) => tree.limitValue(), undefined],
    ['a LIMIT number', 'SELECT Id FROM Account LIMIT 2', (tree) => tree.limitValue(), 2],
    [
      'a LIMIT expression',
      'SELECT Id FROM Account LIMIT :tmp',
      (tree) => tree.limitValue(),
      ':tmp',
    ],
    ['no ORDER BY', 'SELECT Id FROM Account', (tree) => tree.isOrdered(), false],
    ['an ORDER BY', 'SELECT Id FROM Account ORDER BY Name', (tree) => tree.isOrdered(), true],
  ])('reads %s', async (_name, soql, read, expected) => {
    expect(read(await new SOQLParser().parse(soql))).toEqual(expected);
  });
});
