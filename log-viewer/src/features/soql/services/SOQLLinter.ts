/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import { type Stack } from '../../database/services/Database.js';
import { SOQLParser, SOQLTree } from './SOQLParser.js';

//todo : need a general concept of stack (to pull out linter)
export class SOQLLinter {
  async lint(soql: string, stack?: Stack): Promise<SOQLLinterRule[]> {
    const results: SOQLLinterRule[] = [];

    const tree = await new SOQLParser().parse(soql);
    const rules = [
      new UnboundedSOQLRule(),
      new LeadingPercentWildcardRule(),
      new NegativeFilterOperatorRule(),
      new OrderByWithoutLimitRule(),
      new LastModifiedDateSystemModStampIndexRule(),
      new TriggerNonSelectiveQuery(),
    ];

    rules.forEach((rule) => {
      if (rule.test(tree, stack || [])) {
        results.push(rule);
      }
    });

    return results;
  }
}

export const SEVERITY_TYPES = ['Error', 'Warning', 'Info']; // needs to ordered from highest tp lowest priority
export type Severity = (typeof SEVERITY_TYPES)[number];
// TODO: add categories (ORDER BY, fieldlist, WHERE etc)
export interface SOQLLinterRule {
  message: string;
  severity: Severity;
  summary: string;

  // returns true if the rule applies e.g SOQL does not have a where clause
  test?(soqlTree: SOQLTree, stack: Stack): boolean;
}

class UnboundedSOQLRule implements SOQLLinterRule {
  summary = 'SOQL is unbounded. Add a WHERE or LIMIT clause or both.';
  severity: Severity = 'Warning';
  message =
    'As well as potentially taking a long time to execute or even timing out, unbounded SOQL queries can cause the SOQL row and heap limits to be exceeded.';

  test(soqlTree: SOQLTree, _stack: Stack): boolean {
    const qryCtxt = soqlTree._queryContext;
    return !qryCtxt.whereClause() && !qryCtxt.limitClause();
  }
}

// TODO: support bind variables?
class LeadingPercentWildcardRule implements SOQLLinterRule {
  summary =
    'Avoid a leading "%" wildcard when using a LIKE clause. This will impact query performance.';
  message = 'The index can not be used when using a leading "%" wildcard with a LIKE clause';
  severity: Severity = 'Warning';

  test(soqlTree: SOQLTree, _stack: Stack): boolean {
    const qryCtxt = soqlTree._queryContext;
    const whereClause = qryCtxt.whereClause();
    if (whereClause) {
      const hasLeadingWildcard = whereClause
        .logicalExpression()
        .conditionalExpression()
        .find((exp) => {
          const fieldExp = exp.fieldExpression();
          if (
            fieldExp?.comparisonOperator().LIKE() &&
            fieldExp.value().StringLiteral()?.text.startsWith("'%")
          ) {
            return exp;
          }
        });

      return !!hasLeadingWildcard;
    }

    return false;
  }
}

class NegativeFilterOperatorRule implements SOQLLinterRule {
  summary =
    'Avoid negative filter operators, the index can not be used and this will impact query performance.';
  message =
    "The index can not be used when using one of the negative filter operators e.g !=, <>, NOT, EXCLUDES or when comparing with an empty value ( name != ''). Use the positive filter operators instead e.g status = 'Open, Cancelled' instead of status != 'Closed'.";
  severity: Severity = 'Warning';

  test(soqlTree: SOQLTree, _stack: Stack): boolean {
    const qryCtxt = soqlTree._queryContext;
    const whereClause = qryCtxt.whereClause();
    if (whereClause) {
      const exp = whereClause.logicalExpression();

      const hasNegativeOp =
        exp.NOT() ||
        exp.conditionalExpression().find((exp) => {
          const operator = exp.fieldExpression()?.comparisonOperator();

          if (
            operator &&
            (operator.NOTEQUAL() ||
              operator.LESSANDGREATER() ||
              operator.NOT() ||
              operator.EXCLUDES())
          ) {
            return exp;
          }
        });

      return !!hasNegativeOp;
    }

    return false;
  }
}

class OrderByWithoutLimitRule implements SOQLLinterRule {
  summary = 'Avoid ORDER BY unless the result set needs to be ordered, it can increase query time.';
  message =
    "An ORDER BY clause doesn't have anything to do with selectivity. Selectivity is determined by available indexes that align with filter conditions (WHERE clause) and record visibility (sharing rules, etc.). Once the optimizer determines which rows to return, it applies the ORDER BY logic to sort the records in the return set. However an ORDER BY and LIMIT can sometimes be optimizable.";
  severity: Severity = 'Info';

  test(soqlTree: SOQLTree, _stack: Stack): boolean {
    const qryCtxt = soqlTree._queryContext;
    const orderByClause = qryCtxt.orderByClause();
    const limitClause = qryCtxt.limitClause();

    return !!orderByClause && !limitClause;
  }
}

class LastModifiedDateSystemModStampIndexRule implements SOQLLinterRule {
  summary =
    'Index on SystemModStamp can not be used for LastModifiedDate when LastModifiedDate < 2023-01-01T00:00:00Z.';
  message =
    'Under the hood, the SystemModStamp is indexed, but LastModifiedDate is not. The Salesforce query optimizer will intelligently attempt to use the index on SystemModStamp even when the SOQL query filters on LastModifiedDate. However, the query optimizer cannot use the index if the SOQL query filter uses LastModifiedDate to determine the upper boundary of a date range because SystemModStamp can be greater (i.e. a later date) than LastModifiedDate. This is to avoid missing records that fall in between the two timestamps. The same logic applies when using date literals.';
  severity: Severity = 'Info';

  test(soqlTree: SOQLTree, _stack: Stack): boolean {
    const qryCtxt = soqlTree._queryContext;
    const whereClause = qryCtxt.whereClause();
    if (whereClause) {
      const result = whereClause
        .logicalExpression()
        .conditionalExpression()
        .find((exp) => {
          const fieldExp = exp.fieldExpression();
          if (
            fieldExp?.fieldName()?.text.toLowerCase().endsWith('lastmodifieddate') &&
            fieldExp.comparisonOperator().LT()
          ) {
            return exp;
          }
        });

      return !!result;
    }

    return false;
  }
}

class TriggerNonSelectiveQuery implements SOQLLinterRule {
  summary = 'Ensure SOQL in trigger is selective.';
  message =
    'An exception will occur when a non-selective query in a trigger executes against an object that contains more than 1 million records. To avoid this error, ensure that the query is selective';
  severity: Severity = 'Warning';

  test(soqlTree: SOQLTree, stack: Stack): boolean {
    const inTriggerCtxt = stack.find((entry) => {
      return entry.text.includes(' trigger event ');
    });

    return !!inTriggerCtxt;
  }
}
