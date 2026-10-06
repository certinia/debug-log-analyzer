/*
 * Copyright (c) 2021 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from 'vitest';
import { ApexLogParser, LogEvent } from '@apexdevtools/apex-log-parser';

import { SOQLLinter } from '../SOQLLinter.js';

class DummySOQLLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.category = 'Code Unit';
    this.cpuType = 'method';
    this.exitTypes = ['CODE_UNIT_FINISHED'];
  }
}

const UNBOUNDED = {
  summary: 'SOQL is unbounded. Add a WHERE or LIMIT clause or both.',
  message:
    'As well as potentially taking a long time to execute or even timing out, unbounded SOQL queries can cause the SOQL row and heap limits to be exceeded.',
  severity: 'Warning',
};

const LEADING_WILDCARD = {
  summary:
    'Avoid a leading "%" wildcard when using a LIKE clause. This will impact query performance.',
  message: 'The index can not be used when using a leading "%" wildcard with a LIKE clause',
  severity: 'Warning',
};

const LAST_MODIFIED_DATE_INDEX = {
  summary:
    'Index on SystemModStamp can not be used for LastModifiedDate when LastModifiedDate < 2023-01-01T00:00:00Z.',
  message:
    'Under the hood, the SystemModStamp is indexed, but LastModifiedDate is not. The Salesforce query optimizer will intelligently attempt to use the index on SystemModStamp even when the SOQL query filters on LastModifiedDate. However, the query optimizer cannot use the index if the SOQL query filter uses LastModifiedDate to determine the upper boundary of a date range because SystemModStamp can be greater (i.e. a later date) than LastModifiedDate. This is to avoid missing records that fall in between the two timestamps. The same logic applies when using date literals.',
  severity: 'Info',
};

const NEGATIVE_FILTER = {
  summary:
    'Avoid negative filter operators, the index can not be used and this will impact query performance.',
  message:
    "The index can not be used when using one of the negative filter operators e.g !=, <>, NOT, EXCLUDES or when comparing with an empty value ( name != ''). Use the positive filter operators instead e.g status = 'Open, Cancelled' instead of status != 'Closed'.",
  severity: 'Warning',
};

const ORDER_BY_WITHOUT_LIMIT = {
  summary: 'ORDER BY without a LIMIT.',
  message:
    'Sorting costs time and does nothing for selectivity, which comes from indexes on the WHERE clause. Drop the ORDER BY unless the caller needs the order, or add a LIMIT, since ORDER BY with a LIMIT can be optimised.',
  severity: 'Info',
};

const TRIGGER_NON_SELECTIVE = {
  summary: 'Ensure SOQL in trigger is selective.',
  message:
    'An exception will occur when a non-selective query in a trigger executes against an object that contains more than 1 million records. To avoid this error, ensure that the query is selective',
  severity: 'Warning',
};

describe('SOQLLinter', () => {
  it.each<[string, string, object[]]>([
    ['no WHERE clause', 'SELECT Id FROM ANOBJECT__c', [UNBOUNDED]],
    [
      'a leading % wildcard',
      "SELECT Id FROM ANOBJECT__c WHERE Name LIKE '%SomeName'",
      [LEADING_WILDCARD],
    ],
    [
      '< on LastModifiedDate',
      'SELECT Id FROM Obj__c WHERE LastModifiedDate < TODAY',
      [LAST_MODIFIED_DATE_INDEX],
    ],
    ['> on LastModifiedDate', 'SELECT Id FROM Obj__c WHERE LastModifiedDate > TODAY', []],
    ['= on LastModifiedDate', 'SELECT Id FROM Obj__c WHERE LastModifiedDate = TODAY', []],
    ['!=', "SELECT Id FROM ANOBJECT__c WHERE Name != 'A Name'", [NEGATIVE_FILTER]],
    ['<>', "SELECT Id FROM ANOBJECT__c WHERE Name <> 'A Name'", [NEGATIVE_FILTER]],
    ['EXCLUDES', "SELECT Id FROM ANOBJECT__c WHERE Name EXCLUDES ('A Name')", [NEGATIVE_FILTER]],
    ['NOT', "SELECT Id FROM ANOBJECT__c WHERE NOT Name = 'A Name'", [NEGATIVE_FILTER]],
    ['NOT IN', "SELECT Id FROM ANOBJECT__c WHERE Id NOT IN ('a0000000000aaaa')", [NEGATIVE_FILTER]],
    [
      'ORDER BY without LIMIT',
      "SELECT Id FROM AnObject__c WHERE Status__c = 'Open' ORDER BY AField__c",
      [ORDER_BY_WITHOUT_LIMIT],
    ],
    ['ORDER BY with LIMIT', 'SELECT Id FROM AnObject__c ORDER BY AField__c LIMIT 1000', []],
    ['a selective query outside a trigger', 'SELECT Id FROM AnObject__c WHERE value__c > 0', []],
  ])('lints a query with %s', async (_name, soql, expected) => {
    expect(await new SOQLLinter().lint(soql)).toEqual(expected);
  });

  it('asks a query in a trigger to be selective', async () => {
    const parser = new ApexLogParser();
    const trigger = new DummySOQLLine(parser, [
      '04:16:39.166 (1166781977)',
      'CODE_UNIT_STARTED',
      '[EXTERNAL]',
      'a0000000000aaaa',
      'Account on Account trigger event AfterInsert',
      '__sfdc_trigger/Account',
    ]);
    trigger.text = 'Account on Account trigger event AfterInsert';

    const results = await new SOQLLinter().lint('SELECT Id FROM AnObject__c WHERE value__c > 0', [
      trigger,
    ]);

    expect(results).toEqual([TRIGGER_NON_SELECTIVE]);
  });
});
