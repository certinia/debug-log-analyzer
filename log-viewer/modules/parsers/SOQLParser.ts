/*
 * Copyright (c) 2022 FinancialForce.com, inc. All rights reserved.
 */

import {
  ApexLexer,
  ApexParser,
  CaseInsensitiveInputStream,
  QueryContext,
} from '@apexdevtools/apex-parser';
import { CharStreams, CommonTokenStream } from 'antlr4ts';
import { ANTLRErrorListener, RecognitionException, Recognizer, Token } from 'antlr4ts';

// To understand the parser AST see https://github.com/nawforce/apex-parser/blob/master/antlr/ApexParser.g4
// Start with the 'query' rule at ~532
// Salesforce SOQL Reference: https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql.htm

export class SOQLTree {
  _queryContext: QueryContext;

  constructor(queryContext: QueryContext) {
    this._queryContext = queryContext;
  }

  /* Return FROM clase SObject name, iff there is a single SObject */
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
