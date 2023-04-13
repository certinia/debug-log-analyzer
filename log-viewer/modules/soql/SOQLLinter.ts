import { SOQLParser, SOQLTree } from '../parsers/SOQLParser';
export class SOQLLinter {
  lint(soql: string): SOQLLinterRule[] {
    const results: SOQLLinterRule[] = [];

    const tree = new SOQLParser().parse(soql);
    const rules = [
      new UnboundedSOQLRule(),
      new LeadingPercentWildcardRule(),
      new NegativeFilterOperatorRule(),
      new OrderByWithoutLimitRule(),
    ];

    rules.forEach((rule) => {
      if (rule.test(tree)) {
        results.push(rule);
      }
    });

    return results;
  }
}

// TODO: add severity
// TODO: add categories (ORDER BY, fieldlist, WHERE etc)
export interface SOQLLinterRule {
  message: string;
  summary: string;

  // returns true if the rule applies e.g SOQL does not have a where clause
  test(soqlTree: SOQLTree): boolean;
}

class UnboundedSOQLRule implements SOQLLinterRule {
  summary = 'SOQL is unbounded. Add a WHERE or LIMIT clause or both.';
  message =
    'As well as potentially taking a long time to execute or even timing out, unbounded SOQL queries can cause the SOQL row and heap limits to be exceeded.';

  test(soqlTree: SOQLTree): boolean {
    const qryCtxt = soqlTree._queryContext;
    return !qryCtxt.whereClause() && !qryCtxt.limitClause();
  }
}

// TODO: support bind variables?
class LeadingPercentWildcardRule implements SOQLLinterRule {
  summary =
    'Avoid a leading "%" wildcard when using a LIKE clause. This will impact query performance.';
  message = 'The index can not be used when using a leading "%" wildcard with a LIKE clause';

  test(soqlTree: SOQLTree): boolean {
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

  test(soqlTree: SOQLTree): boolean {
    const qryCtxt = soqlTree._queryContext;
    const whereClause = qryCtxt.whereClause();
    if (whereClause) {
      const hasNegativeOp = whereClause
        .logicalExpression()
        .conditionalExpression()
        .find((exp) => {
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

  test(soqlTree: SOQLTree): boolean {
    const qryCtxt = soqlTree._queryContext;
    const orderByClause = qryCtxt.orderByClause();
    const limitClause = qryCtxt.limitClause();

    return !!orderByClause && !limitClause;
  }
}
