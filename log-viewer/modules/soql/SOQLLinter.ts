import { SOQLParser, SOQLTree } from '../parsers/SOQLParser';
export class SOQLLinter {
  lint(soql: string): string[] {
    const tree = new SOQLParser().parse(soql);

    const rule1 = new UnboundedSOQLRule();
    if (rule1.test(tree)) {
      return [rule1.message];
    }
    return [];
  }
}

class UnboundedSOQLRule {
  message = 'SOQL is unbounded. Add conditions in WHERE clause or LIMIT the SOQL.';
  severity = '';

  test(soqlTree: SOQLTree): boolean {
    const whereCxt = soqlTree._queryContext.whereClause();
    return !whereCxt?.isEmpty || false;
  }
}
