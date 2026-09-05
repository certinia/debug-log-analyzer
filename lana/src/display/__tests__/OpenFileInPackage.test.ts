/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { workspace } from 'vscode';
import type { Context } from '../../Context';
import { getMethodLine, parseApex } from '../../salesforce/ApexParser/ApexSymbolLocator';
import { OpenFileInPackage } from '../OpenFileInPackage';

// Note: no `jest.mock('vscode')` — the moduleNameMapper already supplies the mock, and
// automocking would neuter the Position/Selection classes this test asserts against.
jest.mock('../../salesforce/ApexParser/ApexSymbolLocator');

const mockParseApex = parseApex as jest.Mock;
const mockGetMethodLine = getMethodLine as jest.Mock;
const mockOpenTextDocument = workspace.openTextDocument as jest.Mock;

function createContext() {
  const workspaceManager = {
    findSymbol: jest.fn(),
  };
  const display = {
    showErrorMessage: jest.fn(),
    showFile: jest.fn(),
  };
  const context = { workspaceManager, display } as unknown as Context;
  return { context, workspaceManager, display };
}

describe('OpenFileInPackage.openFileForSymbol', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParseApex.mockReturnValue({ name: 'myclass', children: [] });
    mockOpenTextDocument.mockResolvedValue({ getText: () => 'public class MyClass {}' });
  });

  it.each(['', '   ', undefined as unknown as string])(
    'returns early without touching the workspace for empty symbol %p',
    async (symbol) => {
      const { context, workspaceManager } = createContext();

      await OpenFileInPackage.openFileForSymbol(context, symbol);

      expect(workspaceManager.findSymbol).not.toHaveBeenCalled();
    },
  );

  it('resolves the symbol through the workspace manager', async () => {
    const { context, workspaceManager } = createContext();
    workspaceManager.findSymbol.mockResolvedValue({ status: 'not-found' });

    await OpenFileInPackage.openFileForSymbol(context, 'MyClass.foo()');

    expect(workspaceManager.findSymbol).toHaveBeenCalledWith('MyClass.foo()');
  });

  it('shows a not-found error and opens nothing when the class is not found', async () => {
    const { context, workspaceManager, display } = createContext();
    workspaceManager.findSymbol.mockResolvedValue({ status: 'not-found' });

    await OpenFileInPackage.openFileForSymbol(context, 'MyClass.foo()');

    expect(display.showErrorMessage).toHaveBeenCalledWith(
      "Type 'MyClass.foo()' was not found in workspace",
    );
    expect(mockOpenTextDocument).not.toHaveBeenCalled();
    expect(display.showFile).not.toHaveBeenCalled();
  });

  it('stays silent and opens nothing when the user cancels the class picker', async () => {
    const { context, workspaceManager, display } = createContext();
    workspaceManager.findSymbol.mockResolvedValue({ status: 'cancelled' });

    await OpenFileInPackage.openFileForSymbol(context, 'MyClass.foo()');

    expect(display.showErrorMessage).not.toHaveBeenCalled();
    expect(mockOpenTextDocument).not.toHaveBeenCalled();
    expect(display.showFile).not.toHaveBeenCalled();
  });

  it('opens the file at the resolved line and character on an exact match', async () => {
    const { context, workspaceManager, display } = createContext();
    workspaceManager.findSymbol.mockResolvedValue({
      status: 'found',
      uri: { path: '/ws/force-app/MyClass.cls', fsPath: '/ws/force-app/MyClass.cls' },
    });
    mockGetMethodLine.mockReturnValue({ line: 12, character: 4, isExactMatch: true });

    await OpenFileInPackage.openFileForSymbol(context, 'MyClass.foo()');

    expect(mockGetMethodLine).toHaveBeenCalledWith(
      { name: 'myclass', children: [] },
      'MyClass.foo()',
    );
    expect(display.showErrorMessage).not.toHaveBeenCalled();
    expect(display.showFile).toHaveBeenCalledTimes(1);
    const [uri, options] = display.showFile.mock.calls[0];
    expect(uri).toEqual(expect.objectContaining({ fsPath: '/ws/force-app/MyClass.cls' }));
    // line is converted to zero-indexed; character used as-is
    expect(options.selection.start).toEqual(expect.objectContaining({ line: 11, character: 4 }));
    expect(options.viewColumn).toBe(-1);
  });

  it('defaults the character to 0 when the location has none', async () => {
    const { context, workspaceManager, display } = createContext();
    workspaceManager.findSymbol.mockResolvedValue({
      status: 'found',
      uri: { path: '/ws/MyClass.cls', fsPath: '/ws/MyClass.cls' },
    });
    mockGetMethodLine.mockReturnValue({ line: 3, isExactMatch: true });

    await OpenFileInPackage.openFileForSymbol(context, 'MyClass.foo()');

    const [, options] = display.showFile.mock.calls[0];
    expect(options.selection.start).toEqual(expect.objectContaining({ line: 2, character: 0 }));
  });

  it('warns but still opens the file when the symbol location is not an exact match', async () => {
    const { context, workspaceManager, display } = createContext();
    workspaceManager.findSymbol.mockResolvedValue({
      status: 'found',
      uri: { path: '/ws/force-app/MyClass.cls', fsPath: '/ws/force-app/MyClass.cls' },
    });
    mockGetMethodLine.mockReturnValue({
      line: 1,
      character: 0,
      isExactMatch: false,
      missingSymbol: 'foo()',
    });

    await OpenFileInPackage.openFileForSymbol(context, 'MyClass.foo()');

    expect(display.showErrorMessage).toHaveBeenCalledWith(
      "Symbol 'foo()' could not be found in file 'MyClass.cls'",
    );
    // best-effort: still navigates to the class (line 1)
    expect(display.showFile).toHaveBeenCalledTimes(1);
  });

  it('surfaces a symbol-resolution failure as an error message', async () => {
    const { context, workspaceManager, display } = createContext();
    workspaceManager.findSymbol.mockRejectedValue(new Error('glob failed'));

    await expect(
      OpenFileInPackage.openFileForSymbol(context, 'MyClass.foo()'),
    ).resolves.toBeUndefined();

    expect(display.showErrorMessage).toHaveBeenCalledWith(
      "Unable to open 'MyClass.foo()': glob failed",
    );
    expect(display.showFile).not.toHaveBeenCalled();
  });

  it('surfaces a document-open failure as an error message', async () => {
    const { context, workspaceManager, display } = createContext();
    workspaceManager.findSymbol.mockResolvedValue({
      status: 'found',
      uri: { fsPath: '/ws/MyClass.cls' },
    });
    mockOpenTextDocument.mockRejectedValue(new Error('file is binary'));

    await expect(
      OpenFileInPackage.openFileForSymbol(context, 'MyClass.foo()'),
    ).resolves.toBeUndefined();

    expect(display.showErrorMessage).toHaveBeenCalledWith(
      "Unable to open 'MyClass.foo()': file is binary",
    );
    expect(display.showFile).not.toHaveBeenCalled();
  });
});
