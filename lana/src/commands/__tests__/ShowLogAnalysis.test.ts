import { describe, expect, it } from '@jest/globals';

import { Uri } from 'vscode';

import { createMockContext } from '../../__tests__/helpers/test-builders.js';
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

describe('ShowLogAnalysis', () => {
  it('reports asynchronous view creation failures', async () => {
    const context = createMockContext();
    mockCreateView.mockRejectedValueOnce(new Error('Unable to load log viewer'));

    await ShowLogAnalysis.getCommand(context as unknown as import('../../Context.js').Context).run(
      Uri.parse('file:///test.log'),
    );

    expect(context.display.showErrorMessage).toHaveBeenCalledWith(
      'Error showing logfile: Unable to load log viewer',
    );
  });
});
