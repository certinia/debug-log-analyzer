/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import { commands, window } from 'vscode';

import { asContext, createMockContext } from '../../__tests__/helpers/test-builders.js';
import { WhatsNewNotification } from '../WhatsNewNotification.js';

const mockShowInformationMessage = window.showInformationMessage as jest.Mock;
const mockExecuteCommand = commands.executeCommand as jest.Mock;

const SEE_WHATS_NEW = "See What's New";
const VIEWED_KEY = 'update.confirmed.versions';

function contextForVersion(version: string, viewed: string[] = []) {
  const mockContext = createMockContext();
  mockContext.context.extension.packageJSON = { name: 'lana', version };
  (mockContext.context.globalState.get as jest.Mock).mockReturnValue(viewed);
  return mockContext;
}

describe('WhatsNewNotification', () => {
  beforeEach(() => {
    mockShowInformationMessage.mockResolvedValue(undefined);
  });

  describe('when it shows', () => {
    it('shows the notification for a minor release the user has not seen', async () => {
      const mockContext = contextForVersion('1.2.0');

      await WhatsNewNotification.apply(asContext(mockContext));

      expect(mockShowInformationMessage).toHaveBeenCalledWith(
        "Apex Log Analyzer has been updated. See What's New.",
        SEE_WHATS_NEW,
      );
    });

    it('shows for a pre-release build of a minor version', async () => {
      const mockContext = contextForVersion('1.2.0-rc.1');

      await WhatsNewNotification.apply(asContext(mockContext));

      expect(mockShowInformationMessage).toHaveBeenCalled();
    });

    it('opens the changelog when the user accepts', async () => {
      mockShowInformationMessage.mockResolvedValue(SEE_WHATS_NEW);
      const mockContext = contextForVersion('1.2.0');

      await WhatsNewNotification.apply(asContext(mockContext));

      expect(mockExecuteCommand).toHaveBeenCalledWith('extension.open', 'test.lana', 'changelog');
    });

    it('does not open the changelog when the notification is dismissed', async () => {
      mockShowInformationMessage.mockResolvedValue(undefined);
      const mockContext = contextForVersion('1.2.0');

      await WhatsNewNotification.apply(asContext(mockContext));

      expect(mockExecuteCommand).not.toHaveBeenCalled();
    });

    it('records the version before the notification is answered', async () => {
      // The notification may never be answered, so the write must not wait on it.
      mockShowInformationMessage.mockReturnValue(new Promise(() => undefined));
      const mockContext = contextForVersion('1.2.0');

      void WhatsNewNotification.apply(asContext(mockContext));
      await Promise.resolve();

      expect(mockContext.context.globalState.update).toHaveBeenCalledWith(VIEWED_KEY, ['1.2.0']);
    });
  });

  describe('when it stays quiet', () => {
    it('does not show for a patch release', async () => {
      const mockContext = contextForVersion('1.2.3');

      await WhatsNewNotification.apply(asContext(mockContext));

      expect(mockShowInformationMessage).not.toHaveBeenCalled();
      expect(mockContext.context.globalState.update).not.toHaveBeenCalled();
    });

    it('does not show a version the user has already seen', async () => {
      const mockContext = contextForVersion('1.2.0', ['1.2.0']);

      await WhatsNewNotification.apply(asContext(mockContext));

      expect(mockShowInformationMessage).not.toHaveBeenCalled();
    });

    it('treats no stored versions as none seen', async () => {
      const mockContext = createMockContext();
      mockContext.context.extension.packageJSON = { name: 'lana', version: '1.2.0' };
      (mockContext.context.globalState.get as jest.Mock).mockReturnValue(undefined);

      await WhatsNewNotification.apply(asContext(mockContext));

      expect(mockShowInformationMessage).toHaveBeenCalled();
    });
  });

  describe('error boundary', () => {
    it('reports a failure instead of rejecting', async () => {
      mockShowInformationMessage.mockRejectedValue(new Error('notifications are off'));
      const mockContext = contextForVersion('1.2.0');

      await expect(WhatsNewNotification.apply(asContext(mockContext))).resolves.toBeUndefined();

      expect(mockContext.display.output).toHaveBeenCalledWith(
        "Unable to show the What's New notification: notifications are off",
      );
    });

    it('reports a non-Error failure', async () => {
      mockShowInformationMessage.mockRejectedValue('no window');
      const mockContext = contextForVersion('1.2.0');

      await WhatsNewNotification.apply(asContext(mockContext));

      expect(mockContext.display.output).toHaveBeenCalledWith(
        "Unable to show the What's New notification: no window",
      );
    });
  });
});
