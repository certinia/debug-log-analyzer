/*
 * Copyright (c) 2021 Certinia Inc. All rights reserved.
 */
import { Method } from '../../parsers/ApexLogParser.js';
import { SOQLLinter } from '../../soql/SOQLLinter.js';

describe('SOQL Linter rule tests', () => {
  it('No where clause should return rule', async () => {
    const soql = 'SELECT Id FROM ANOBJECT__c';

    const results = await new SOQLLinter().lint(soql);
    const undoundedSoqlRule = {
      summary: 'SOQL is unbounded. Add a WHERE or LIMIT clause or both.',
      message:
        'As well as potentially taking a long time to execute or even timing out, unbounded SOQL queries can cause the SOQL row and heap limits to be exceeded.',
      severity: 'Warning',
    };

    expect(results).toEqual([undoundedSoqlRule]);
  });

  it('Leading % wildcard should return rule', async () => {
    const soql = "SELECT Id FROM ANOBJECT__c WHERE Name LIKE '%SomeName'";

    const results = await new SOQLLinter().lint(soql);
    const leadingWildcardRule = {
      summary:
        'Avoid a leading "%" wildcard when using a LIKE clause. This will impact query performance.',
      message: 'The index can not be used when using a leading "%" wildcard with a LIKE clause',
      severity: 'Warning',
    };

    expect(results).toEqual([leadingWildcardRule]);
  });
});

describe('LastModifiedDate Index Rule', () => {
  const lastModifiedDateIndexRule = {
    summary:
      'Index on SystemModStamp can not be used for LastModifiedDate when LastModifiedDate < 2023-01-01T00:00:00Z.',
    message:
      'Under the hood, the SystemModStamp is indexed, but LastModifiedDate is not. The Salesforce query optimizer will intelligently attempt to use the index on SystemModStamp even when the SOQL query filters on LastModifiedDate. However, the query optimizer cannot use the index if the SOQL query filter uses LastModifiedDate to determine the upper boundary of a date range because SystemModStamp can be greater (i.e. a later date) than LastModifiedDate. This is to avoid missing records that fall in between the two timestamps. The same logic applies when using date literals.',
    severity: 'Info',
  };

  it('< on LastModifiedDate should return rule', async () => {
    const soql = 'SELECT Id FROM Obj__c WHERE LastModifiedDate < TODAY';

    const results = await new SOQLLinter().lint(soql);

    expect(results).toEqual([lastModifiedDateIndexRule]);
  });

  it('> on LastModifiedDate should not return rule', async () => {
    const soql = 'SELECT Id FROM Obj__c WHERE LastModifiedDate > TODAY';

    const results = await new SOQLLinter().lint(soql);

    expect(results).toEqual([]);
  });

  it('= on LastModifiedDate should not return rule', async () => {
    const soql = 'SELECT Id FROM Obj__c WHERE LastModifiedDate = TODAY';

    const results = await new SOQLLinter().lint(soql);

    expect(results).toEqual([]);
  });
});

describe('Negative Filter Operator Rule tests', () => {
  const negativeFilterRule = {
    summary:
      'Avoid negative filter operators, the index can not be used and this will impact query performance.',
    message:
      "The index can not be used when using one of the negative filter operators e.g !=, <>, NOT, EXCLUDES or when comparing with an empty value ( name != ''). Use the positive filter operators instead e.g status = 'Open, Cancelled' instead of status != 'Closed'.",
    severity: 'Warning',
  };

  it('!= : should return rule', async () => {
    const soql = "SELECT Id FROM ANOBJECT__c WHERE Name != 'A Name'";

    const results = await new SOQLLinter().lint(soql);

    expect(results).toEqual([negativeFilterRule]);
  });

  it('<> : should return rule', async () => {
    const soql = "SELECT Id FROM ANOBJECT__c WHERE Name <> 'A Name'";

    const results = await new SOQLLinter().lint(soql);

    expect(results).toEqual([negativeFilterRule]);
  });

  it('EXCLUDES : should return rule', async () => {
    const soql = "SELECT Id FROM ANOBJECT__c WHERE Name EXCLUDES ('A Name')";

    const results = await new SOQLLinter().lint(soql);

    expect(results).toEqual([negativeFilterRule]);
  });

  it('NOT : should return rule', async () => {
    const soql = "SELECT Id FROM ANOBJECT__c WHERE NOT Name = 'A Name'";

    const results = await new SOQLLinter().lint(soql);

    expect(results).toEqual([negativeFilterRule]);
  });

  it('NOT IN : should return rule', async () => {
    const soql = "SELECT Id FROM ANOBJECT__c WHERE Id NOT IN ('a0000000000aaaa')";

    const results = await new SOQLLinter().lint(soql);

    expect(results).toEqual([negativeFilterRule]);
  });
});

describe('Order By Without Limit Rule tests', () => {
  const orderByWithoutLimit = {
    summary:
      'Avoid ORDER BY unless the result set needs to be ordered, it can increase query time.',
    message:
      "An ORDER BY clause doesn't have anything to do with selectivity. Selectivity is determined by available indexes that align with filter conditions (WHERE clause) and record visibility (sharing rules, etc.). Once the optimizer determines which rows to return, it applies the ORDER BY logic to sort the records in the return set. However an ORDER BY and LIMIT can sometimes be optimizable.",
    severity: 'Info',
  };

  it('Order by only should return rule', async () => {
    const soql = "SELECT Id FROM AnObject__c WHERE Status__c = 'Open' ORDER BY AField__c";

    const results = await new SOQLLinter().lint(soql);

    expect(results).toEqual([orderByWithoutLimit]);
  });

  it('Order by with limit should not return rule', async () => {
    const soql = 'SELECT Id FROM AnObject__c ORDER BY AField__c LIMIT 1000';

    const results = await new SOQLLinter().lint(soql);

    expect(results).toEqual([]);
  });
});

describe('SOQL in Trigger Rule tests', () => {
  const triggerNonSelective = {
    summary: 'Ensure SOQL in trigger is selective.',
    message:
      'An exception will occur when a non-selective query in a trigger executes against an object that contains more than 1 million records. To avoid this error, ensure that the query is selective',
    severity: 'Warning',
  };

  it('soql in trigger should return rule', async () => {
    const soql = 'SELECT Id FROM AnObject__c WHERE value__c > 0';
    const mockTriggerLine = new Method(
      [
        '04:16:39.166 (1166781977)',
        'CODE_UNIT_STARTED',
        '[EXTERNAL]',
        'a0000000000aaaa',
        'Account on Account trigger event AfterInsert',
        '__sfdc_trigger/Account',
      ],
      ['CODE_UNIT_FINISHED'],
      'Code Unit',
      'method',
    );
    mockTriggerLine.text = 'Account on Account trigger event AfterInsert';

    const results = await new SOQLLinter().lint(soql, [mockTriggerLine]);

    expect(results).toEqual([triggerNonSelective]);
  });

  it('soql outside trigger should not return rule', async () => {
    const soql = 'SELECT Id FROM AnObject__c WHERE value__c > 0';

    const results = await new SOQLLinter().lint(soql);

    expect(results).toEqual([]);
  });
});
