/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { asContext, createMockContext } from '../../__tests__/helpers/test-builders.js';
import { createMockTextDocument } from '../../__tests__/mocks/vscode.js';
import {
  TabInputText,
  Uri,
  commands,
  languages,
  window,
  workspace,
} from '../../__tests__/mocks/vscode.js';
import { ApexLogLanguageDetector, isApexLogContent } from '../ApexLogLanguageDetector.js';

describe('isApexLogContent', () => {
  const USER_INFO =
    '17:23:32.3 (3925848)|USER_INFO|[EXTERNAL]|0054R00000B6Q3p|luke.cotter@example.com|(GMT+00:00) Greenwich Mean Time (Europe/London)|GMT+00:00';

  it.each([
    [
      'a settings header on line 1',
      [
        '64.0 APEX_CODE,FINE;APEX_PROFILING,NONE;CALLOUT,NONE;DB,INFO;NBA,NONE;SYSTEM,NONE;VALIDATION,NONE;VISUALFORCE,NONE;WAVE,NONE;WORKFLOW,NONE',
        '09:45:31.888 (1000)|EXECUTION_STARTED',
      ],
    ],
    [
      'preamble text before the settings header',
      [
        'Some preamble text from browser UI',
        'Another line of preamble',
        '64.0 APEX_CODE,FINE;APEX_PROFILING,NONE;CALLOUT,NONE;DB,INFO',
      ],
    ],
    [
      'a settings header with no API version',
      [
        'APEX_CODE,FINE;APEX_PROFILING,INFO;CALLOUT,INFO;DB,FINEST;NBA,INFO;SYSTEM,DEBUG;VALIDATION,INFO;VISUALFORCE,INFO;WAVE,INFO;WORKFLOW,FINE',
      ],
    ],
    [
      'EXECUTION_STARTED and no header',
      ['Some preamble text', '09:45:31.888 (1000)|EXECUTION_STARTED'],
    ],
    ['USER_INFO and no header', ['Some preamble text', USER_INFO]],
  ])('detects a log with %s', (_label, lines) => {
    expect(isApexLogContent(createMockTextDocument({ lines }))).toBe(true);
  });

  it.each([
    [
      'another log format',
      [
        '[2024-01-15 09:45:31] INFO: Application started',
        '[2024-01-15 09:45:32] DEBUG: Loading configuration',
        '[2024-01-15 09:45:33] ERROR: Connection failed',
      ],
    ],
    ['an empty document', []],
  ])('rejects %s', (_label, lines) => {
    expect(isApexLogContent(createMockTextDocument({ lines }))).toBe(false);
  });
});

describe('ApexLogLanguageDetector', () => {
  function openDocumentAt(uri: string) {
    const doc = createMockTextDocument({
      languageId: 'plaintext',
      lines: ['09:45:31.888 (1000)|EXECUTION_STARTED'],
    });
    Object.defineProperty(doc, 'uri', { value: Uri.parse(uri) });
    workspace.textDocuments = [doc];
    return doc;
  }

  it.each(['log', 'txt'])('detects .%s Apex logs from arbitrary URI schemes', (extension) => {
    const doc = openDocumentAt(`git:/repository/logs/virtual.${extension}`);

    ApexLogLanguageDetector.apply(asContext(createMockContext()));

    expect(languages.setTextDocumentLanguage).toHaveBeenCalledWith(doc, 'apexlog');
  });

  it('retains the existing extension prefilter', () => {
    openDocumentAt('git:/repository/logs/virtual.json');

    ApexLogLanguageDetector.apply(asContext(createMockContext()));

    expect(languages.setTextDocumentLanguage).not.toHaveBeenCalled();
  });

  it('sets the key from the extension alone, without reading, when there is no text document', () => {
    window.tabGroups.activeTabGroup.activeTab = {
      input: new TabInputText(Uri.parse('memfs:/logs/huge.log')),
    };

    ApexLogLanguageDetector.apply(asContext(createMockContext()));

    expect(commands.executeCommand).toHaveBeenLastCalledWith('setContext', 'lana.isApexLog', true);
    expect(workspace.fs.readFile).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-log extension', { input: new TabInputText(Uri.parse('memfs:/notes.json')) }],
    ['a tab that is not a text tab', { input: {} }],
  ])('clears the key for %s in the tab fallback', (_label, activeTab) => {
    window.tabGroups.activeTabGroup.activeTab = activeTab;

    ApexLogLanguageDetector.apply(asContext(createMockContext()));

    expect(commands.executeCommand).toHaveBeenLastCalledWith('setContext', 'lana.isApexLog', false);
  });
});
