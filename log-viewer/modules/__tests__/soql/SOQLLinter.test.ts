/*
 * Copyright (c) 2021 FinancialForce.com, inc. All rights reserved.
 */
import { SOQLLinter } from '../../soql/SOQLLinter';

describe('SOQL Linter rule tests', () => {
  it('No where clause should return rule', async () => {
    const soql = 'SELECT Id FROM ANOBJECT__c';

    const results = new SOQLLinter().lint(soql);
    const undoundedSoqlRule = {
      summary: 'SOQL is unbounded. Add a WHERE or LIMIT clause or both.',
      message:
        'As well as potentially taking a long time to execute or even timing out, unbounded SOQL queries can cause the SOQL row and heap limits to be exceeded.',
    };

    expect(results).toEqual([undoundedSoqlRule]);
  });

  it('Leading % wildcard should return rule', async () => {
    const soql = "SELECT Id FROM ANOBJECT__c WHERE Name LIKE '%SomeName'";

    const results = new SOQLLinter().lint(soql);
    const leadingWildcardRule = {
      summary:
        'Avoid a leading "%" wildcard when using a LIKE clause. This will impact query performance.',
      message: 'The index can not be used when using a leading "%" wildcard with a LIKE clause',
    };

    expect(results).toEqual([leadingWildcardRule]);
  });
});

describe('Negative Filter Operator Rule tests', () => {
  const negativeFilterRule = {
    summary:
      'Avoid negative filter operators, the index can not be used and this will impact query performance.',
    message:
      "The index can not be used when using one of the negative filter operators e.g !=, <>, NOT, EXCLUDES or when comparing with an empty value ( name != ''). Use the positive filter operators instead e.g status = 'Open, Cancelled' instead of status != 'Closed'.",
  };

  it('!= : should return rule', async () => {
    const soql = "SELECT Id FROM ANOBJECT__c WHERE Name != 'A Name'";

    const results = new SOQLLinter().lint(soql);

    expect(results).toEqual([negativeFilterRule]);
  });

  it('<> : should return rule', async () => {
    const soql = "SELECT Id FROM ANOBJECT__c WHERE Name <> 'A Name'";

    const results = new SOQLLinter().lint(soql);

    expect(results).toEqual([negativeFilterRule]);
  });

  it('EXCLUDES : should return rule', async () => {
    const soql = "SELECT Id FROM ANOBJECT__c WHERE Name EXCLUDES ('A Name')";

    const results = new SOQLLinter().lint(soql);

    expect(results).toEqual([negativeFilterRule]);
  });

  it('NOT : should return rule', async () => {
    const soql = "SELECT Id FROM ANOBJECT__c WHERE NOT Name = 'A Name'";

    const results = new SOQLLinter().lint(soql);

    expect(results).toEqual([negativeFilterRule]);
  });

  it('NOT IN : should return rule', async () => {
    const soql = "SELECT Id FROM ANOBJECT__c WHERE Id NOT IN ('a0000000000aaaa')";

    const results = new SOQLLinter().lint(soql);

    expect(results).toEqual([negativeFilterRule]);
  });
});

describe('Order By Without Limit Rule tests', () => {
  const orderByWithoutLimit = {
    summary:
      'Avoid ORDER BY unless the result set needs to be ordered, it can increase query time.',
    message:
      "An ORDER BY clause doesn't have anything to do with selectivity. Selectivity is determined by available indexes that align with filter conditions (WHERE clause) and record visibility (sharing rules, etc.). Once the optimizer determines which rows to return, it applies the ORDER BY logic to sort the records in the return set. However an ORDER BY and LIMIT can sometimes be optimizable.",
  };

  it('Order by only should return rule', async () => {
    const soql = "SELECT Id FROM AnObject__c WHERE Status__c = 'Open' ORDER BY AField__c";

    const results = new SOQLLinter().lint(soql);

    expect(results).toEqual([orderByWithoutLimit]);
  });

  it('Order by with limit should not return rule', async () => {
    const soql = 'SELECT Id FROM AnObject__c ORDER BY AField__c LIMIT 1000';

    const results = new SOQLLinter().lint(soql);

    expect(results).toEqual([]);
  });
});
