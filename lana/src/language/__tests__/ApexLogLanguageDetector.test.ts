/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { createMockContext } from '../../__tests__/helpers/test-builders.js';
import { createMockTextDocument } from '../../__tests__/mocks/vscode.js';
import {
  TabInputText,
  Uri,
  commands,
  languages,
  window,
  workspace,
} from '../../__tests__/mocks/vscode.js';
import {
  ApexLogLanguageDetector,
  isApexLogContent,
  isApexLogFile,
} from '../ApexLogLanguageDetector.js';

describe('isApexLogContent', () => {
  it('should detect standard log with settings header on line 1', () => {
    const doc = createMockTextDocument({
      lines: [
        '64.0 APEX_CODE,FINE;APEX_PROFILING,NONE;CALLOUT,NONE;DB,INFO;NBA,NONE;SYSTEM,NONE;VALIDATION,NONE;VISUALFORCE,NONE;WAVE,NONE;WORKFLOW,NONE',
        '09:45:31.888 (1000)|EXECUTION_STARTED',
      ],
    });

    expect(isApexLogContent(doc)).toBe(true);
  });

  it('should detect log with preamble text before settings header', () => {
    const doc = createMockTextDocument({
      lines: [
        'Some preamble text from browser UI',
        'Another line of preamble',
        '64.0 APEX_CODE,FINE;APEX_PROFILING,NONE;CALLOUT,NONE;DB,INFO',
        '09:45:31.888 (1000)|EXECUTION_STARTED',
      ],
    });

    expect(isApexLogContent(doc)).toBe(true);
  });

  it('should detect log without settings header but with EXECUTION_STARTED', () => {
    const doc = createMockTextDocument({
      lines: [
        'Some preamble text',
        '09:45:31.888 (1000)|EXECUTION_STARTED',
        '09:45:31.889 (2000)|USER_INFO|[EXTERNAL]|user@example.com',
      ],
    });

    expect(isApexLogContent(doc)).toBe(true);
  });

  it('should detect log without settings header but with USER_INFO', () => {
    const doc = createMockTextDocument({
      lines: ['Some preamble text', '09:45:31.889 (2000)|USER_INFO|[EXTERNAL]|user@example.com'],
    });

    expect(isApexLogContent(doc)).toBe(true);
  });

  it('should detect real-world log starting with USER_INFO and no settings header', () => {
    const doc = createMockTextDocument({
      lines: [
        '17:23:32.3 (3925848)|USER_INFO|[EXTERNAL]|0054R00000B6Q3p|luke.cotter@example.com|(GMT+00:00) Greenwich Mean Time (Europe/London)|GMT+00:00',
        '17:23:32.3 (4conversionId)|EXECUTION_STARTED',
      ],
    });

    expect(isApexLogContent(doc)).toBe(true);
  });

  it('should detect log with settings header missing API version', () => {
    const doc = createMockTextDocument({
      lines: [
        'APEX_CODE,FINE;APEX_PROFILING,INFO;CALLOUT,INFO;DB,FINEST;NBA,INFO;SYSTEM,DEBUG;VALIDATION,INFO;VISUALFORCE,INFO;WAVE,INFO;WORKFLOW,FINE',
        '17:23:32.3 (3925848)|USER_INFO|[EXTERNAL]|0054R00000B6Q3p|luke.cotter@example.com|(GMT+00:00) Greenwich Mean Time (Europe/London)|GMT+00:00',
        '17:23:32.3 (4000)|EXECUTION_STARTED',
      ],
    });

    expect(isApexLogContent(doc)).toBe(true);
  });

  it('should not detect non-apex log file', () => {
    const doc = createMockTextDocument({
      lines: [
        '[2024-01-15 09:45:31] INFO: Application started',
        '[2024-01-15 09:45:32] DEBUG: Loading configuration',
        '[2024-01-15 09:45:33] ERROR: Connection failed',
      ],
    });

    expect(isApexLogContent(doc)).toBe(false);
  });

  it('should not detect empty document', () => {
    const doc = createMockTextDocument({
      lines: [],
    });

    expect(isApexLogContent(doc)).toBe(false);
  });
});

describe('isApexLogFile', () => {
  it('decodes only the first 4 KB returned by the filesystem provider', async () => {
    const prefix = 'not an Apex log'.padEnd(4096, ' ');
    workspace.fs.readFile.mockResolvedValue(
      new TextEncoder().encode(`${prefix}09:45:31.888 (1000)|EXECUTION_STARTED`),
    );
    const uri = Uri.file('/logs/large.log');

    await expect(isApexLogFile(uri)).resolves.toBe(false);

    expect(workspace.fs.readFile).toHaveBeenCalledWith(uri);
  });

  it('uses the registered filesystem provider for an arbitrary URI scheme', async () => {
    workspace.fs.readFile.mockResolvedValue(
      new TextEncoder().encode('09:45:31.888 (1000)|EXECUTION_STARTED'),
    );
    const uri = Uri.parse('git:/repository/logs/virtual.log');

    await expect(isApexLogFile(uri)).resolves.toBe(true);

    expect(workspace.fs.readFile).toHaveBeenCalledWith(uri);
  });
});

describe('ApexLogLanguageDetector', () => {
  it.each(['log', 'txt'])('detects .%s Apex logs from arbitrary URI schemes', (extension) => {
    const doc = createMockTextDocument({
      languageId: 'plaintext',
      lines: ['09:45:31.888 (1000)|EXECUTION_STARTED'],
    });
    Object.defineProperty(doc, 'uri', {
      value: Uri.parse(`git:/repository/logs/virtual.${extension}`),
    });
    workspace.textDocuments = [doc];

    ApexLogLanguageDetector.apply(
      createMockContext() as unknown as import('../../Context.js').Context,
    );

    expect(languages.setTextDocumentLanguage).toHaveBeenCalledWith(doc, 'apexlog');
  });

  it('retains the existing extension prefilter', () => {
    const doc = createMockTextDocument({
      languageId: 'plaintext',
      lines: ['09:45:31.888 (1000)|EXECUTION_STARTED'],
    });
    Object.defineProperty(doc, 'uri', { value: Uri.parse('git:/repository/logs/virtual.json') });
    workspace.textDocuments = [doc];

    ApexLogLanguageDetector.apply(
      createMockContext() as unknown as import('../../Context.js').Context,
    );

    expect(languages.setTextDocumentLanguage).not.toHaveBeenCalled();
  });

  it('does not publish a stale async result after the active tab changes', async () => {
    let resolveSlowRead: ((bytes: Uint8Array) => void) | undefined;
    const slowRead = new Promise<Uint8Array>((resolve) => {
      resolveSlowRead = resolve;
    });
    const slowUri = Uri.parse('memfs:/logs/slow.log');
    const fastUri = Uri.parse('memfs:/logs/fast.log');
    workspace.fs.readFile.mockImplementation((uri: { path: string }) =>
      uri.path === slowUri.path
        ? slowRead
        : Promise.resolve(new TextEncoder().encode('not an Apex log')),
    );

    let notifyTabsChanged: (() => void) | undefined;
    window.tabGroups.onDidChangeTabs.mockImplementation((listener: (event: unknown) => void) => {
      notifyTabsChanged = () => listener({});
      return { dispose: jest.fn() };
    });
    window.tabGroups.activeTabGroup.activeTab = { input: new TabInputText(slowUri) };

    ApexLogLanguageDetector.apply(
      createMockContext() as unknown as import('../../Context.js').Context,
    );
    window.tabGroups.activeTabGroup.activeTab = { input: new TabInputText(fastUri) };
    notifyTabsChanged?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(commands.executeCommand).toHaveBeenLastCalledWith('setContext', 'lana.isApexLog', false);

    resolveSlowRead?.(new TextEncoder().encode('09:45:31.888 (1000)|EXECUTION_STARTED'));
    await slowRead;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(commands.executeCommand).not.toHaveBeenCalledWith('setContext', 'lana.isApexLog', true);
  });
});
