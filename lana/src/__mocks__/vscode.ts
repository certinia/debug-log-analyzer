/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
/* eslint-disable @typescript-eslint/naming-convention */

export const RelativePattern = jest.fn();

export const Uri = {
  file: jest.fn((path: string) => ({ fsPath: path })),
  joinPath: jest.fn((base: { fsPath: string }, ...paths: string[]) => ({
    fsPath: [base.fsPath, ...paths].join('/'),
  })),
};

export const workspace = {
  findFiles: jest.fn(),
  openTextDocument: jest.fn(),
  workspaceFolders: [],
};

export const window = {
  showInformationMessage: jest.fn(),
  showErrorMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  createOutputChannel: jest.fn(() => ({
    appendLine: jest.fn(),
    show: jest.fn(),
  })),
};
