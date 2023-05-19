/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */

import {
  ApexLexer,
  ApexParser,
  CaseInsensitiveInputStream,
  QueryContext,
} from '@apexdevtools/apex-parser';
import {
  ANTLRErrorListener,
  CharStreams,
  CommonTokenStream,
  RecognitionException,
  Recognizer,
  Token,
} from 'antlr4ts';

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
    const selectEntries = selectList.selectEntry();
    return selectEntries.every((selectEntry) => selectEntry.fieldName() !== undefined);
  }

  /* Return true for queries only containing WHERE, ORDER BY & LIMIT clauses */
  isTrivialQuery(): boolean {
    return (
      this._queryContext.usingScope() === undefined &&
      this._queryContext.withClause() === undefined &&
      this._queryContext.groupByClause() === undefined &&
      this._queryContext.offsetClause() === undefined &&
      this._queryContext.allRowsClause() === undefined &&
      this._queryContext.forClauses().childCount === 0 &&
      this._queryContext.updateList() === undefined
    );
  }

  /* Return true if query has ORDER BY */
  isOrdered(): boolean {
    return this._queryContext.orderByClause() !== undefined;
  }

  /* Return limit value if defined, maybe a number or a bound expression */
  limitValue(): number | string | undefined {
    const limitClause = this._queryContext.limitClause();
    if (limitClause === undefined) {
      return undefined;
    } else if (limitClause?.IntegerLiteral() !== undefined) {
      return parseInt(limitClause?.IntegerLiteral()?.text as string);
    } else {
      return limitClause?.boundExpression()?.text as string;
    }
  }

  /* Return FROM clase SObject name, if there is a single SObject */
  fromObject(): undefined | string {
    const fromContext = this._queryContext.fromNameList();
    const fieldNames = fromContext.fieldName();
    if (fieldNames.length === 1) {
      return fieldNames[0].text;
    } else {
      return undefined;
    }
  }
}

export class SOQLParser {
  parse(query: string): SOQLTree {
    const lexer = new ApexLexer(new CaseInsensitiveInputStream(CharStreams.fromString(query)));
    const tokens = new CommonTokenStream(lexer);
    const parser = new ApexParser(tokens);
    parser.removeErrorListeners();
    parser.addErrorListener(new ThrowingErrorListener());
    return new SOQLTree(parser.query());
  }
}

export class SyntaxException {
  line: number;
  column: number;
  message: string;

  constructor(line: number, column: number, message: string) {
    this.line = line;
    this.column = column;
    this.message = message;
  }
}

class ThrowingErrorListener implements ANTLRErrorListener<Token> {
  syntaxError<Token>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognizer: Recognizer<Token, any>,
    offendingSymbol: Token,
    line: number,
    charPositionInLine: number,
    msg: string,
    _e: RecognitionException | undefined
  ): void {
    throw new SyntaxException(line, charPositionInLine, msg);
  }
}
