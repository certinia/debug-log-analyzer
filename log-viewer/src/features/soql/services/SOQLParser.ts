/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import { type QueryContext } from '@apexdevtools/apex-parser';

// To understand the parser AST see https://github.com/nawforce/apex-parser/blob/master/antlr/ApexParser.g4
// Start with the 'query' rule at ~532
// Salesforce SOQL Reference: https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql.htm

export class SOQLTree {
  _queryContext: QueryContext;

  constructor(queryContext: QueryContext) {
    this._queryContext = queryContext;
  }

  /* Return true if SELECT list only contains field names, no functions, sub-queries or typeof */
  isSimpleSelect(): boolean {
    const selectList = this._queryContext.selectList();
    const selectEntries = selectList.selectEntry_list();
    return selectEntries.every((selectEntry) => selectEntry.fieldName() != null);
  }

  /* Return true for queries only containing WHERE, ORDER BY & LIMIT clauses */
  isTrivialQuery(): boolean {
    return (
      this._queryContext.usingScope() == null &&
      this._queryContext.withClause() == null &&
      this._queryContext.groupByClause() == null &&
      this._queryContext.offsetClause() == null &&
      this._queryContext.allRowsClause() == null &&
      this._queryContext.forClauses().getChildCount() === 0 &&
      this._queryContext.updateList() == null
    );
  }

  /* Return true if query has ORDER BY */
  isOrdered(): boolean {
    return this._queryContext.orderByClause() != null;
  }

  /* Return limit value if defined, maybe a number or a bound expression */
  limitValue(): number | string | undefined {
    const limitClause = this._queryContext.limitClause();
    if (limitClause == null) {
      return undefined;
    } else if (limitClause.IntegerLiteral() != null) {
      return parseInt(limitClause.IntegerLiteral()!.getText() as string);
    } else {
      return limitClause.boundExpression()?.getText() as string;
    }
  }

  /* Return FROM clase SObject name, if there is a single SObject */
  fromObject(): undefined | string {
    const fromContext = this._queryContext.fromNameList();
    const fieldNames = fromContext.fieldName_list();
    if (fieldNames.length === 1) {
      return fieldNames[0]?.getText();
    } else {
      return undefined;
    }
  }
}

export class SOQLParser {
  async parse(query: string): Promise<SOQLTree> {
    // Dynamic import for code splitting. Improves performance by reducing the amount of JS that is loaded and parsed at the start.
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const { ApexParserFactory, ThrowingErrorListener } = await import('@apexdevtools/apex-parser');
    const parser = ApexParserFactory.createParser(query, false);
    parser.removeErrorListeners();
    parser.addErrorListener(ThrowingErrorListener.INSTANCE);
    return new SOQLTree(parser.query());
  }
}
