/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { workspace } from 'vscode';
import type { Context } from '../../Context';
import { getMethodLine, parseApex } from '../../salesforce/ApexParser/ApexSymbolLocator';
import type { ApexSymbol } from '../../salesforce/codesymbol/ApexSymbolParser';
import { parseSymbol } from '../../salesforce/codesymbol/ApexSymbolParser';
import { OpenFileInPackage } from '../OpenFileInPackage';

// Note: no `jest.mock('vscode')` — the moduleNameMapper already supplies the mock, and
// automocking would neuter the Position/Selection classes this test asserts against.
jest.mock('../../salesforce/codesymbol/ApexSymbolParser');
jest.mock('../../salesforce/ApexParser/ApexSymbolLocator');

const mockParseSymbol = parseSymbol as jest.Mock;
const mockParseApex = parseApex as jest.Mock;
const mockGetMethodLine = getMethodLine as jest.Mock;
const mockOpenTextDocument = workspace.openTextDocument as jest.Mock;

function createSymbol(overrides: Partial<ApexSymbol> = {}): ApexSymbol {
  return {
    fullSymbol: 'MyClass.foo()',
    namespace: null,
    outerClass: 'MyClass',
    innerClass: null,
    method: 'foo',
    parameters: '',
    ...overrides,
  };
}

function createContext() {
  const workspaceManager = {
    initialiseWorkspaceProjectInfo: jest.fn().mockResolvedValue(undefined),
    getAllProjects: jest.fn().mockReturnValue([{ namespace: 'ns' }]),
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

      expect(workspaceManager.initialiseWorkspaceProjectInfo).not.toHaveBeenCalled();
      expect(mockParseSymbol).not.toHaveBeenCalled();
    },
  );

  it('initialises project info and parses the symbol against all projects', async () => {
    const { context, workspaceManager } = createContext();
    mockParseSymbol.mockReturnValue(createSymbol());
    workspaceManager.findSymbol.mockResolvedValue(null);

    await OpenFileInPackage.openFileForSymbol(context, 'MyClass.foo()');

    expect(workspaceManager.initialiseWorkspaceProjectInfo).toHaveBeenCalledTimes(1);
    expect(mockParseSymbol).toHaveBeenCalledWith('MyClass.foo()', [{ namespace: 'ns' }]);
  });

  it('shows a not-found error and opens nothing when the class is not found', async () => {
    const { context, workspaceManager, display } = createContext();
    mockParseSymbol.mockReturnValue(createSymbol({ fullSymbol: 'MyClass.foo()' }));
    workspaceManager.findSymbol.mockResolvedValue(null);

    await OpenFileInPackage.openFileForSymbol(context, 'MyClass.foo()');

    expect(display.showErrorMessage).toHaveBeenCalledWith(
      "Type 'MyClass.foo()' was not found in workspace",
    );
    expect(mockOpenTextDocument).not.toHaveBeenCalled();
    expect(display.showFile).not.toHaveBeenCalled();
  });

  it('opens the file at the resolved line and character on an exact match', async () => {
    const { context, workspaceManager, display } = createContext();
    mockParseSymbol.mockReturnValue(createSymbol());
    workspaceManager.findSymbol.mockResolvedValue({ fsPath: '/ws/force-app/MyClass.cls' });
    mockGetMethodLine.mockReturnValue({ line: 12, character: 4, isExactMatch: true });

    await OpenFileInPackage.openFileForSymbol(context, 'MyClass.foo()');

    expect(mockGetMethodLine).toHaveBeenCalledWith(
      { name: 'myclass', children: [] },
      'MyClass.foo()',
    );
    expect(display.showErrorMessage).not.toHaveBeenCalled();
    expect(display.showFile).toHaveBeenCalledTimes(1);
    const [path, options] = display.showFile.mock.calls[0];
    expect(path).toBe('/ws/force-app/MyClass.cls');
    // line is converted to zero-indexed; character used as-is
    expect(options.selection.start).toEqual(expect.objectContaining({ line: 11, character: 4 }));
    expect(options.viewColumn).toBe(-1);
  });

  it('defaults the character to 0 when the location has none', async () => {
    const { context, workspaceManager, display } = createContext();
    mockParseSymbol.mockReturnValue(createSymbol());
    workspaceManager.findSymbol.mockResolvedValue({ fsPath: '/ws/MyClass.cls' });
    mockGetMethodLine.mockReturnValue({ line: 3, isExactMatch: true });

    await OpenFileInPackage.openFileForSymbol(context, 'MyClass.foo()');

    const [, options] = display.showFile.mock.calls[0];
    expect(options.selection.start).toEqual(expect.objectContaining({ line: 2, character: 0 }));
  });

  it('warns but still opens the file when the symbol location is not an exact match', async () => {
    const { context, workspaceManager, display } = createContext();
    mockParseSymbol.mockReturnValue(createSymbol());
    workspaceManager.findSymbol.mockResolvedValue({ fsPath: '/ws/force-app/MyClass.cls' });
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
});
