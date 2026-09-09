/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

export const soqlSyntaxStyles = `
.soql-block {
  display: inline;
  font-family: var(--lana-font-mono);
  white-space: pre-wrap;
  word-break: break-word;
}

.soql-block.soql-inline {
  white-space: nowrap;
}

.soql-tok-keyword {
  color: var(--vscode-debugTokenExpression-name, inherit);
  font-weight: 700;
}

.soql-tok-function {
  color: var(--vscode-symbolIcon-functionForeground, var(--vscode-debugTokenExpression-name, inherit));
  font-weight: 700;
}

.soql-tok-string {
  color: var(--vscode-debugTokenExpression-string, #ce9178);
}

.soql-tok-number {
  color: var(--vscode-debugTokenExpression-number, #b5cea8);
}

.soql-tok-bind {
  color: var(--vscode-symbolIcon-variableForeground, var(--vscode-debugTokenExpression-name, inherit));
  font-style: italic;
}

.soql-tok-punct {
  opacity: 0.65;
}

/* Stands in for text a budgeted render left out — quieter than the query itself. */
.soql-tok-elision {
  color: var(--lana-fg-muted);
  font-style: italic;
}
`;
