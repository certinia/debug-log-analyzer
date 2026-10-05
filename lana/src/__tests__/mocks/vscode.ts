/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { type Mock, vi } from 'vitest';
// Type-only import (erased at runtime, so it does not clash with the vitest
// `vscode` alias). Typing factories against the real interfaces means
// a drift from `@types/vscode` surfaces as ONE error at the factory, not at
// every call site.
import type { EndOfLine, TextDocument } from 'vscode';
import { URI, Utils } from 'vscode-uri';

// A bare `vi.fn()` infers vitest's unexported `Procedure`, which the composite build cannot emit.
const fn = (): Mock => vi.fn();

// Track subscriptions for cleanup
const subscriptions: { dispose: Mock }[] = [];

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

// Delegate URI semantics to vscode-uri so virtual URI tests match VS Code.
export const Uri = {
  file: (path: string) => URI.file(path),
  parse: (value: string) => URI.parse(value),
  joinPath: (base: URI, ...pathSegments: string[]) => Utils.joinPath(base, ...pathSegments),
};

export class TabInputText {
  readonly uri: ReturnType<typeof Uri.parse>;

  constructor(uri: ReturnType<typeof Uri.parse>) {
    this.uri = uri;
  }
}

export class TabInputTextDiff {
  readonly original: ReturnType<typeof Uri.parse>;
  readonly modified: ReturnType<typeof Uri.parse>;

  constructor(original: ReturnType<typeof Uri.parse>, modified: ReturnType<typeof Uri.parse>) {
    this.original = original;
    this.modified = modified;
  }
}

// Mock RelativePattern (constructor used for glob searches)
export const RelativePattern = fn();

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
    return { dispose: fn() };
  };
  fire(data: T): void {
    this.listeners.forEach((listener) => listener(data));
  }
  dispose = fn();
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
    getText: vi.fn(() => lines.join('\n')),
    // The simplified mock Position/Range/TextLine classes don't implement every
    // method of their vscode counterparts, so the methods that return them are
    // cast to the real member type. The object literal itself stays assigned to
    // `TextDocument`, so a missing property still errors here (drift detection).
    lineAt: vi.fn((lineOrPosition: number | Position) => {
      const lineNumber = typeof lineOrPosition === 'number' ? lineOrPosition : lineOrPosition.line;
      return createMockTextLine(lineNumber, lines[lineNumber] || '');
    }) as unknown as TextDocument['lineAt'],
    positionAt: vi.fn(
      (offset: number) => new Position(0, offset),
    ) as unknown as TextDocument['positionAt'],
    offsetAt: vi.fn((position: Position) => position.line * 100 + position.character),
    getWordRangeAtPosition: fn(),
    validatePosition: vi.fn((pos: Position) => pos) as unknown as TextDocument['validatePosition'],
    validateRange: vi.fn((range: Range) => range) as unknown as TextDocument['validateRange'],
    save: fn().mockResolvedValue(true),
  };
};

// Mock workspace
export const workspace = {
  workspaceFolders: [] as { uri: ReturnType<typeof Uri.file>; name: string; index: number }[],
  textDocuments: [] as TextDocument[],
  getConfiguration: vi.fn(() => ({
    get: fn(),
    has: vi.fn(() => false),
    inspect: fn(),
    update: fn().mockResolvedValue(undefined),
  })),
  onDidChangeConfiguration: vi.fn(() => ({ dispose: fn() })),
  onDidCloseTextDocument: vi.fn(() => {
    const disposable = { dispose: fn() };
    subscriptions.push(disposable);
    return disposable;
  }),
  onDidOpenTextDocument: vi.fn(() => ({ dispose: fn() })),
  onDidChangeTextDocument: vi.fn(() => ({ dispose: fn() })),
  onDidSaveTextDocument: vi.fn(() => ({ dispose: fn() })),
  openTextDocument: fn(),
  findFiles: fn(),
  asRelativePath: vi.fn((uri: { fsPath: string } | string) =>
    typeof uri === 'string' ? uri : uri.fsPath,
  ),
  fs: {
    readFile: fn(),
    writeFile: fn(),
    stat: fn(),
    readDirectory: fn(),
    createDirectory: fn(),
    delete: fn(),
    rename: fn(),
    copy: fn(),
  },
};

export const extensions = {
  getExtension: fn(),
};

// Mock window
export const window = {
  showInformationMessage: fn().mockResolvedValue(undefined),
  showWarningMessage: fn().mockResolvedValue(undefined),
  showErrorMessage: fn().mockResolvedValue(undefined),
  showQuickPick: fn().mockResolvedValue(undefined),
  showInputBox: fn().mockResolvedValue(undefined),
  createQuickPick: vi.fn(() => ({
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
    onDidChangeValue: vi.fn(() => ({ dispose: fn() })),
    onDidAccept: vi.fn(() => ({ dispose: fn() })),
    onDidHide: vi.fn(() => ({ dispose: fn() })),
    onDidChangeActive: vi.fn(() => ({ dispose: fn() })),
    onDidChangeSelection: vi.fn(() => ({ dispose: fn() })),
    show: fn(),
    hide: fn(),
    dispose: fn(),
  })),
  createOutputChannel: vi.fn(() => ({
    name: 'Test Channel',
    append: fn(),
    appendLine: fn(),
    clear: fn(),
    show: fn(),
    hide: fn(),
    dispose: fn(),
    replace: fn(),
  })),
  createWebviewPanel: fn(),
  tabGroups: {
    activeTabGroup: { activeTab: undefined as { input: unknown } | undefined },
    all: [] as { tabs: { input: unknown }[] }[],
    onDidChangeTabs: vi.fn((_listener: (event: unknown) => unknown) => ({
      dispose: fn(),
    })),
  },
  activeTextEditor: undefined as unknown,
  visibleTextEditors: [],
  onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: fn() })),
  onDidChangeTextEditorSelection: vi.fn(() => ({ dispose: fn() })),
  onDidChangeVisibleTextEditors: vi.fn(() => ({ dispose: fn() })),
  showTextDocument: fn(),
  createTextEditorDecorationType: vi.fn(() => ({
    key: 'mock-decoration-type',
    dispose: fn(),
  })),
  setStatusBarMessage: vi.fn(() => ({ dispose: fn() })),
  withProgress: vi.fn((_options, task) => task({ report: fn() })),
};

// Mock commands
export const commands = {
  registerCommand: vi.fn((_command: string, _callback: (...args: unknown[]) => unknown) => {
    const disposable = { dispose: fn() };
    subscriptions.push(disposable);
    return disposable;
  }),
  executeCommand: fn().mockResolvedValue(undefined),
  getCommands: fn().mockResolvedValue([]),
};

// Mock languages
export const languages = {
  setTextDocumentLanguage: fn().mockResolvedValue(undefined),
  registerFoldingRangeProvider: vi.fn((_selector, _provider) => {
    const disposable = { dispose: fn() };
    subscriptions.push(disposable);
    return disposable;
  }),
  registerHoverProvider: vi.fn(() => {
    const disposable = { dispose: fn() };
    subscriptions.push(disposable);
    return disposable;
  }),
  registerCodeLensProvider: vi.fn(() => {
    const disposable = { dispose: fn() };
    subscriptions.push(disposable);
    return disposable;
  }),
  registerDocumentSymbolProvider: vi.fn(() => {
    const disposable = { dispose: fn() };
    subscriptions.push(disposable);
    return disposable;
  }),
  registerCompletionItemProvider: vi.fn(() => ({ dispose: fn() })),
  registerDefinitionProvider: vi.fn(() => ({ dispose: fn() })),
  createDiagnosticCollection: vi.fn(() => ({
    name: 'test',
    set: fn(),
    delete: fn(),
    clear: fn(),
    forEach: fn(),
    get: fn(),
    has: fn(),
    dispose: fn(),
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
  subscriptions: { dispose: Mock }[];
  workspaceState: {
    get: Mock;
    update: Mock;
    keys: Mock;
  };
  globalState: {
    get: Mock;
    update: Mock;
    keys: Mock;
    setKeysForSync: Mock;
  };
  extensionPath: string;
  extensionUri: ReturnType<typeof Uri.file>;
  storagePath: string | undefined;
  storageUri: ReturnType<typeof Uri.file> | undefined;
  globalStoragePath: string;
  globalStorageUri: ReturnType<typeof Uri.file>;
  logPath: string;
  logUri: ReturnType<typeof Uri.file>;
  asAbsolutePath: Mock;
  extension: {
    id: string;
    extensionUri: ReturnType<typeof Uri.file>;
    extensionPath: string;
    isActive: boolean;
    packageJSON: Record<string, unknown>;
    extensionKind: number;
    exports: unknown;
    activate: Mock;
  };
}

export const createMockExtensionContext = (): MockExtensionContext => ({
  subscriptions: [],
  workspaceState: {
    get: fn(),
    update: fn().mockResolvedValue(undefined),
    keys: vi.fn(() => []),
  },
  globalState: {
    get: fn(),
    update: fn().mockResolvedValue(undefined),
    keys: vi.fn(() => []),
    setKeysForSync: fn(),
  },
  extensionPath: '/test/extension',
  extensionUri: Uri.file('/test/extension'),
  storagePath: '/test/storage',
  storageUri: Uri.file('/test/storage'),
  globalStoragePath: '/test/global-storage',
  globalStorageUri: Uri.file('/test/global-storage'),
  logPath: '/test/logs',
  logUri: Uri.file('/test/logs'),
  asAbsolutePath: vi.fn((relativePath: string) => `/test/extension/${relativePath}`),
  extension: {
    id: 'test.lana',
    extensionUri: Uri.file('/test/extension'),
    extensionPath: '/test/extension',
    isActive: true,
    packageJSON: { name: 'lana', version: '1.0.0' },
    extensionKind: 1,
    exports: undefined,
    activate: fn().mockResolvedValue(undefined),
  },
});

// Reset function for cleaning up between tests
export const resetMocks = (): void => {
  // Clear all subscriptions
  subscriptions.length = 0;

  // Reset all mock functions
  vi.clearAllMocks();

  // Reset workspace folders
  workspace.workspaceFolders = [];
  workspace.textDocuments = [];

  // Reset active editor
  window.activeTextEditor = undefined;
  window.visibleTextEditors = [];
  window.tabGroups.activeTabGroup.activeTab = undefined;
  window.tabGroups.all = [];
};

/** Arranges open tabs for isOpenAsTextTab; one group is enough for most tests. */
export const setOpenTabs = (...inputs: unknown[]): void => {
  window.tabGroups.all = [{ tabs: inputs.map((input) => ({ input })) }];
};

// Export as default for module replacement
export default {
  Position,
  Range,
  Selection,
  ViewColumn,
  Uri,
  TabInputText,
  TabInputTextDiff,
  RelativePattern,
  FoldingRange,
  FoldingRangeKind,
  Hover,
  MarkdownString,
  ThemeColor,
  ConfigurationTarget,
  workspace,
  extensions,
  window,
  commands,
  languages,
  createMockTextDocument,
  createMockExtensionContext,
  resetMocks,
};
