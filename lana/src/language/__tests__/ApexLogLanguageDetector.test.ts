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
import { ApexLogLanguageDetector, isApexLogContent } from '../ApexLogLanguageDetector.js';

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

  it('sets the key from the extension alone when there is no text document', () => {
    window.tabGroups.activeTabGroup.activeTab = {
      input: new TabInputText(Uri.parse('memfs:/logs/huge.log')),
    };

    ApexLogLanguageDetector.apply(
      createMockContext() as unknown as import('../../Context.js').Context,
    );

    expect(commands.executeCommand).toHaveBeenLastCalledWith('setContext', 'lana.isApexLog', true);
  });

  it('never reads the file when there is no text document', () => {
    window.tabGroups.activeTabGroup.activeTab = {
      input: new TabInputText(Uri.parse('memfs:/logs/huge.log')),
    };

    ApexLogLanguageDetector.apply(
      createMockContext() as unknown as import('../../Context.js').Context,
    );

    expect(workspace.fs.readFile).not.toHaveBeenCalled();
  });

  it('clears the key for a non-log extension in the tab fallback', () => {
    window.tabGroups.activeTabGroup.activeTab = {
      input: new TabInputText(Uri.parse('memfs:/notes.json')),
    };

    ApexLogLanguageDetector.apply(
      createMockContext() as unknown as import('../../Context.js').Context,
    );

    expect(commands.executeCommand).toHaveBeenLastCalledWith('setContext', 'lana.isApexLog', false);
  });

  it('clears the key when the active tab is not a text tab', () => {
    window.tabGroups.activeTabGroup.activeTab = { input: {} };

    ApexLogLanguageDetector.apply(
      createMockContext() as unknown as import('../../Context.js').Context,
    );

    expect(commands.executeCommand).toHaveBeenLastCalledWith('setContext', 'lana.isApexLog', false);
  });
});
