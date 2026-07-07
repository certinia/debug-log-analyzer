/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * VS Code API mock for Jest unit tests.
 * Provides stateful mocks for testing VS Code extension functionality.
 */

// Type-only import (erased at runtime, so it does not clash with the jest
// `vscode` module mapping). Typing factories against the real interfaces means
// a drift from `@types/vscode` surfaces as ONE error at the factory, not at
// every call site.
import type { EndOfLine, TextDocument } from 'vscode';

// Track subscriptions for cleanup
const subscriptions: { dispose: jest.Mock }[] = [];

// Mock Position class
export class Position {
  readonly line: number;
  readonly character: number;

  constructor(line: number, character: number) {
    this.line = line;
    this.character = character;
  }

  isEqual(other: Position): boolean {
    return this.line === other.line && this.character === other.character;
  }

  isBefore(other: Position): boolean {
    return this.line < other.line || (this.line === other.line && this.character < other.character);
  }

  isAfter(other: Position): boolean {
    return this.line > other.line || (this.line === other.line && this.character > other.character);
  }

  translate(lineDelta: number = 0, characterDelta: number = 0): Position {
    return new Position(this.line + lineDelta, this.character + characterDelta);
  }

  with(line?: number, character?: number): Position {
    return new Position(line ?? this.line, character ?? this.character);
  }
}

// Mock Range class
export class Range {
  readonly start: Position;
  readonly end: Position;

  constructor(startLine: number, startChar: number, endLine: number, endChar: number);
  constructor(start: Position, end: Position);
  constructor(
    startOrStartLine: number | Position,
    startCharOrEnd: number | Position,
    endLine?: number,
    endChar?: number,
  ) {
    if (typeof startOrStartLine === 'number') {
      this.start = new Position(startOrStartLine, startCharOrEnd as number);
      this.end = new Position(endLine!, endChar!);
    } else {
      this.start = startOrStartLine;
      this.end = startCharOrEnd as Position;
    }
  }

  get isEmpty(): boolean {
    return this.start.isEqual(this.end);
  }

  get isSingleLine(): boolean {
    return this.start.line === this.end.line;
  }

  contains(positionOrRange: Position | Range): boolean {
    if (positionOrRange instanceof Position) {
      return !positionOrRange.isBefore(this.start) && !positionOrRange.isAfter(this.end);
    }
    return this.contains(positionOrRange.start) && this.contains(positionOrRange.end);
  }

  isEqual(other: Range): boolean {
    return this.start.isEqual(other.start) && this.end.isEqual(other.end);
  }
}

// Mock Selection class (a Range anchored between two positions)
export class Selection extends Range {
  readonly anchor: Position;
  readonly active: Position;

  constructor(anchor: Position, active: Position) {
    super(anchor, active);
    this.anchor = anchor;
    this.active = active;
  }
}

// Mock ViewColumn enum (members used by the extension)
export const ViewColumn = {
  Active: -1,
  Beside: -2,
  One: 1,
  Two: 2,
} as const;
export type ViewColumn = (typeof ViewColumn)[keyof typeof ViewColumn];

// Mock Uri class
export const Uri = {
  file: jest.fn((path: string) => ({
    scheme: 'file',
    authority: '',
    path,
    fsPath: path,
    query: '',
    fragment: '',
    with: jest.fn(),
    toString: jest.fn(() => `file://${path}`),
    toJSON: jest.fn(() => ({ scheme: 'file', path, fsPath: path })),
  })),
  parse: jest.fn((value: string) => ({
    scheme: value.startsWith('file://') ? 'file' : 'unknown',
    authority: '',
    path: value.replace('file://', ''),
    fsPath: value.replace('file://', ''),
    query: '',
    fragment: '',
    with: jest.fn(),
    toString: jest.fn(() => value),
  })),
  joinPath: jest.fn((base, ...pathSegments) => ({
    ...base,
    path: [base.path, ...pathSegments].join('/'),
    fsPath: [base.fsPath, ...pathSegments].join('/'),
  })),
};

// Mock RelativePattern (constructor used for glob searches)
export const RelativePattern = jest.fn();

// Mock FoldingRange class
export class FoldingRange {
  readonly start: number;
  readonly end: number;
  readonly kind?: FoldingRangeKind;

  constructor(start: number, end: number, kind?: FoldingRangeKind) {
    this.start = start;
    this.end = end;
    this.kind = kind;
  }
}

// Mock FoldingRangeKind enum
export const FoldingRangeKind = {
  Comment: 1,
  Imports: 2,
  Region: 3,
} as const;
export type FoldingRangeKind = (typeof FoldingRangeKind)[keyof typeof FoldingRangeKind];

// Mock EventEmitter
export class EventEmitter<T> {
  private listeners: ((e: T) => void)[] = [];
  readonly event = (listener: (e: T) => void): { dispose: () => void } => {
    this.listeners.push(listener);
    return { dispose: jest.fn() };
  };
  fire(data: T): void {
    this.listeners.forEach((listener) => listener(data));
  }
  dispose = jest.fn();
}

// Mock SymbolKind enum (only the members used by the extension)
export const SymbolKind = {
  Method: 5,
} as const;
export type SymbolKind = (typeof SymbolKind)[keyof typeof SymbolKind];

// Mock DocumentSymbol
export class DocumentSymbol {
  name: string;
  detail: string;
  kind: SymbolKind;
  range: Range;
  selectionRange: Range;
  children: DocumentSymbol[] = [];

  constructor(name: string, detail: string, kind: SymbolKind, range: Range, selectionRange: Range) {
    this.name = name;
    this.detail = detail;
    this.kind = kind;
    this.range = range;
    this.selectionRange = selectionRange;
  }
}

// Mock TextLine
export interface MockTextLine {
  lineNumber: number;
  text: string;
  range: Range;
  rangeIncludingLineBreak: Range;
  firstNonWhitespaceCharacterIndex: number;
  isEmptyOrWhitespace: boolean;
}

const createMockTextLine = (lineNumber: number, text: string): MockTextLine => ({
  lineNumber,
  text,
  range: new Range(lineNumber, 0, lineNumber, text.length),
  rangeIncludingLineBreak: new Range(lineNumber, 0, lineNumber, text.length + 1),
  firstNonWhitespaceCharacterIndex: text.search(/\S/),
  isEmptyOrWhitespace: text.trim().length === 0,
});

// Mock TextDocument — typed against the real `vscode.TextDocument` so that any
// future drift in `@types/vscode` is caught here rather than at call sites.
export const createMockTextDocument = (options: {
  uri?: string;
  languageId?: string;
  content?: string;
  lines?: string[];
}): TextDocument => {
  const uri = options.uri || '/test/file.log';
  const lines = options.lines || options.content?.split('\n') || [];

  return {
    uri: Uri.file(uri),
    fileName: uri,
    languageId: options.languageId || 'apexlog',
    version: 1,
    isDirty: false,
    isUntitled: false,
    isClosed: false,
    eol: 1 as EndOfLine,
    encoding: 'utf8',
    lineCount: lines.length,
    getText: jest.fn(() => lines.join('\n')),
    // The simplified mock Position/Range/TextLine classes don't implement every
    // method of their vscode counterparts, so the methods that return them are
    // cast to the real member type. The object literal itself stays assigned to
    // `TextDocument`, so a missing property still errors here (drift detection).
    lineAt: jest.fn((lineOrPosition: number | Position) => {
      const lineNumber = typeof lineOrPosition === 'number' ? lineOrPosition : lineOrPosition.line;
      return createMockTextLine(lineNumber, lines[lineNumber] || '');
    }) as unknown as TextDocument['lineAt'],
    positionAt: jest.fn(
      (offset: number) => new Position(0, offset),
    ) as unknown as TextDocument['positionAt'],
    offsetAt: jest.fn((position: Position) => position.line * 100 + position.character),
    getWordRangeAtPosition: jest.fn(),
    validatePosition: jest.fn(
      (pos: Position) => pos,
    ) as unknown as TextDocument['validatePosition'],
    validateRange: jest.fn((range: Range) => range) as unknown as TextDocument['validateRange'],
    save: jest.fn().mockResolvedValue(true),
  };
};

// Mock workspace
export const workspace = {
  workspaceFolders: [] as { uri: ReturnType<typeof Uri.file>; name: string; index: number }[],
  textDocuments: [] as TextDocument[],
  getConfiguration: jest.fn(() => ({
    get: jest.fn(),
    has: jest.fn(() => false),
    inspect: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
  })),
  onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
  onDidCloseTextDocument: jest.fn(() => {
    const disposable = { dispose: jest.fn() };
    subscriptions.push(disposable);
    return disposable;
  }),
  onDidOpenTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
  onDidChangeTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
  onDidSaveTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
  openTextDocument: jest.fn(),
  findFiles: jest.fn(),
  asRelativePath: jest.fn((uri: { fsPath: string } | string) =>
    typeof uri === 'string' ? uri : uri.fsPath,
  ),
  fs: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    stat: jest.fn(),
    readDirectory: jest.fn(),
    createDirectory: jest.fn(),
    delete: jest.fn(),
    rename: jest.fn(),
    copy: jest.fn(),
  },
};

// Mock window
export const window = {
  showInformationMessage: jest.fn().mockResolvedValue(undefined),
  showWarningMessage: jest.fn().mockResolvedValue(undefined),
  showErrorMessage: jest.fn().mockResolvedValue(undefined),
  showQuickPick: jest.fn().mockResolvedValue(undefined),
  showInputBox: jest.fn().mockResolvedValue(undefined),
  createQuickPick: jest.fn(() => ({
    items: [],
    selectedItems: [],
    activeItems: [],
    placeholder: '',
    title: '',
    step: undefined,
    totalSteps: undefined,
    enabled: true,
    busy: false,
    ignoreFocusOut: false,
    canSelectMany: false,
    matchOnDescription: false,
    matchOnDetail: false,
    value: '',
    onDidChangeValue: jest.fn(() => ({ dispose: jest.fn() })),
    onDidAccept: jest.fn(() => ({ dispose: jest.fn() })),
    onDidHide: jest.fn(() => ({ dispose: jest.fn() })),
    onDidChangeActive: jest.fn(() => ({ dispose: jest.fn() })),
    onDidChangeSelection: jest.fn(() => ({ dispose: jest.fn() })),
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
  })),
  createOutputChannel: jest.fn(() => ({
    name: 'Test Channel',
    append: jest.fn(),
    appendLine: jest.fn(),
    clear: jest.fn(),
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
    replace: jest.fn(),
  })),
  createWebviewPanel: jest.fn(),
  activeTextEditor: undefined as unknown,
  visibleTextEditors: [],
  onDidChangeActiveTextEditor: jest.fn(() => ({ dispose: jest.fn() })),
  onDidChangeVisibleTextEditors: jest.fn(() => ({ dispose: jest.fn() })),
  showTextDocument: jest.fn(),
  createTextEditorDecorationType: jest.fn(() => ({
    key: 'mock-decoration-type',
    dispose: jest.fn(),
  })),
  setStatusBarMessage: jest.fn(() => ({ dispose: jest.fn() })),
  withProgress: jest.fn((_options, task) => task({ report: jest.fn() })),
};

// Mock commands
export const commands = {
  registerCommand: jest.fn((_command: string, _callback: (...args: unknown[]) => unknown) => {
    const disposable = { dispose: jest.fn() };
    subscriptions.push(disposable);
    return disposable;
  }),
  executeCommand: jest.fn().mockResolvedValue(undefined),
  getCommands: jest.fn().mockResolvedValue([]),
};

// Mock languages
export const languages = {
  registerFoldingRangeProvider: jest.fn((_selector, _provider) => {
    const disposable = { dispose: jest.fn() };
    subscriptions.push(disposable);
    return disposable;
  }),
  registerHoverProvider: jest.fn(() => {
    const disposable = { dispose: jest.fn() };
    subscriptions.push(disposable);
    return disposable;
  }),
  registerCodeLensProvider: jest.fn(() => {
    const disposable = { dispose: jest.fn() };
    subscriptions.push(disposable);
    return disposable;
  }),
  registerDocumentSymbolProvider: jest.fn(() => {
    const disposable = { dispose: jest.fn() };
    subscriptions.push(disposable);
    return disposable;
  }),
  registerCompletionItemProvider: jest.fn(() => ({ dispose: jest.fn() })),
  registerDefinitionProvider: jest.fn(() => ({ dispose: jest.fn() })),
  createDiagnosticCollection: jest.fn(() => ({
    name: 'test',
    set: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
    forEach: jest.fn(),
    get: jest.fn(),
    has: jest.fn(),
    dispose: jest.fn(),
  })),
};

// Mock Hover
export class Hover {
  contents: unknown;
  range?: Range;

  constructor(contents: unknown, range?: Range) {
    this.contents = contents;
    this.range = range;
  }
}

// Mock MarkdownString
export class MarkdownString {
  value: string;
  isTrusted: boolean = false;
  supportThemeIcons: boolean = false;
  supportHtml: boolean = false;

  constructor(value?: string, supportThemeIcons?: boolean) {
    this.value = value || '';
    this.supportThemeIcons = supportThemeIcons || false;
  }

  appendText(value: string): MarkdownString {
    this.value += value;
    return this;
  }

  appendMarkdown(value: string): MarkdownString {
    this.value += value;
    return this;
  }

  appendCodeblock(value: string, language?: string): MarkdownString {
    this.value += `\n\`\`\`${language || ''}\n${value}\n\`\`\`\n`;
    return this;
  }
}

// Mock ThemeColor
export class ThemeColor {
  id: string;

  constructor(id: string) {
    this.id = id;
  }
}

// Mock ConfigurationTarget enum
export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
} as const;
export type ConfigurationTarget = (typeof ConfigurationTarget)[keyof typeof ConfigurationTarget];

// Mock ExtensionContext
export interface MockExtensionContext {
  subscriptions: { dispose: jest.Mock }[];
  workspaceState: {
    get: jest.Mock;
    update: jest.Mock;
    keys: jest.Mock;
  };
  globalState: {
    get: jest.Mock;
    update: jest.Mock;
    keys: jest.Mock;
    setKeysForSync: jest.Mock;
  };
  extensionPath: string;
  extensionUri: ReturnType<typeof Uri.file>;
  storagePath: string | undefined;
  storageUri: ReturnType<typeof Uri.file> | undefined;
  globalStoragePath: string;
  globalStorageUri: ReturnType<typeof Uri.file>;
  logPath: string;
  logUri: ReturnType<typeof Uri.file>;
  asAbsolutePath: jest.Mock;
  extension: {
    id: string;
    extensionUri: ReturnType<typeof Uri.file>;
    extensionPath: string;
    isActive: boolean;
    packageJSON: Record<string, unknown>;
    extensionKind: number;
    exports: unknown;
    activate: jest.Mock;
  };
}

export const createMockExtensionContext = (): MockExtensionContext => ({
  subscriptions: [],
  workspaceState: {
    get: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
    keys: jest.fn(() => []),
  },
  globalState: {
    get: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
    keys: jest.fn(() => []),
    setKeysForSync: jest.fn(),
  },
  extensionPath: '/test/extension',
  extensionUri: Uri.file('/test/extension'),
  storagePath: '/test/storage',
  storageUri: Uri.file('/test/storage'),
  globalStoragePath: '/test/global-storage',
  globalStorageUri: Uri.file('/test/global-storage'),
  logPath: '/test/logs',
  logUri: Uri.file('/test/logs'),
  asAbsolutePath: jest.fn((relativePath: string) => `/test/extension/${relativePath}`),
  extension: {
    id: 'test.lana',
    extensionUri: Uri.file('/test/extension'),
    extensionPath: '/test/extension',
    isActive: true,
    packageJSON: { name: 'lana', version: '1.0.0' },
    extensionKind: 1,
    exports: undefined,
    activate: jest.fn().mockResolvedValue(undefined),
  },
});

// Reset function for cleaning up between tests
export const resetMocks = (): void => {
  // Clear all subscriptions
  subscriptions.length = 0;

  // Reset all mock functions
  jest.clearAllMocks();

  // Reset workspace folders
  workspace.workspaceFolders = [];

  // Reset active editor
  window.activeTextEditor = undefined;
  window.visibleTextEditors = [];
};

// Export as default for module replacement
export default {
  Position,
  Range,
  Selection,
  ViewColumn,
  Uri,
  RelativePattern,
  FoldingRange,
  FoldingRangeKind,
  Hover,
  MarkdownString,
  ThemeColor,
  ConfigurationTarget,
  workspace,
  window,
  commands,
  languages,
  createMockTextDocument,
  createMockExtensionContext,
  resetMocks,
};
