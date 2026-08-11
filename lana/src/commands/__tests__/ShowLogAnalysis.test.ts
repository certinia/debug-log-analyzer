import { describe, expect, it } from '@jest/globals';

import { TabInputText, window } from 'vscode';
import { URI } from 'vscode-uri';

import { createMockContext } from '../../__tests__/helpers/test-builders.js';
import { fileOrFolderExists } from '../../services/salesforceServices.js';
import { LogView } from '../LogView.js';
import { ShowLogAnalysis } from '../ShowLogAnalysis.js';

jest.mock('../../services/salesforceServices.js', () => ({
  fileOrFolderExists: jest.fn().mockResolvedValue(true),
}));

jest.mock('../LogView.js', () => ({
  LogView: {
    createView: jest.fn(),
  },
}));

const mockCreateView = LogView.createView as jest.Mock;
const mockFileOrFolderExists = fileOrFolderExists as jest.Mock;

describe('ShowLogAnalysis', () => {
  it('reports asynchronous view creation failures', async () => {
    const context = createMockContext();
    mockCreateView.mockRejectedValueOnce(new Error('Unable to load log viewer'));

    await ShowLogAnalysis.getCommand(context as unknown as import('../../Context.js').Context).run(
      URI.parse('file:///test.log'),
    );

    expect(context.display.showErrorMessage).toHaveBeenCalledWith(
      'Error showing logfile: Unable to load log viewer',
    );
  });

  it('passes active editor content for virtual documents', async () => {
    const context = createMockContext();
    const logUri = URI.parse('untitled:sample-log.log');
    const activeTextEditor = window.activeTextEditor;
    mockFileOrFolderExists.mockResolvedValueOnce(false);
    Object.defineProperty(window, 'activeTextEditor', {
      configurable: true,
      value: { document: { uri: logUri, getText: () => 'virtual log content' } },
    });

    await ShowLogAnalysis.getCommand(context as unknown as import('../../Context.js').Context).run(
      logUri,
    );

    expect(mockCreateView).toHaveBeenCalledWith(
      context,
      expect.any(Promise),
      logUri,
      'virtual log content',
    );
    Object.defineProperty(window, 'activeTextEditor', {
      configurable: true,
      value: activeTextEditor,
    });
  });

  it('uses the active text tab when no editor is available', async () => {
    const context = createMockContext();
    const logUri = URI.parse('file:///sample-log.log');
    const activeTextEditor = window.activeTextEditor;
    const activeTab = window.tabGroups.activeTabGroup.activeTab;
    Object.defineProperty(window, 'activeTextEditor', { configurable: true, value: undefined });
    Object.defineProperty(window.tabGroups.activeTabGroup, 'activeTab', {
      configurable: true,
      value: { input: new TabInputText(logUri) },
    });

    await ShowLogAnalysis.getCommand(
      context as unknown as import('../../Context.js').Context,
    ).run();

    expect(mockCreateView).toHaveBeenCalledWith(context, expect.any(Promise), logUri, undefined);
    Object.defineProperty(window, 'activeTextEditor', {
      configurable: true,
      value: activeTextEditor,
    });
    Object.defineProperty(window.tabGroups.activeTabGroup, 'activeTab', {
      configurable: true,
      value: activeTab,
    });
  });
});
