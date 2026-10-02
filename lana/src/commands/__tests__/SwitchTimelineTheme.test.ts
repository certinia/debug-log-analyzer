/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import { Uri, window } from 'vscode';

import { asContext, createMockContext } from '../../__tests__/helpers/test-builders.js';
import { SwitchTimelineTheme } from '../SwitchTimelineTheme.js';

// Mock AppConfig
jest.mock('../../workspace/AppConfig.js', () => ({
  getConfig: jest.fn(),
  updateConfig: jest.fn(),
}));

// Mock LogView
jest.mock('../LogView.js', () => ({
  LogView: {
    getCurrentView: jest.fn(),
  },
}));

import { getConfig, updateConfig } from '../../workspace/AppConfig.js';
import { LogView } from '../LogView.js';

const mockGetConfig = getConfig as jest.Mock;
const mockUpdateConfig = updateConfig as jest.Mock;
const mockGetCurrentView = LogView.getCurrentView as jest.Mock;

function themeConfig(activeTheme: string, customThemes: Record<string, object> = {}) {
  return { timeline: { activeTheme, customThemes } };
}

describe('SwitchTimelineTheme', () => {
  let mockQuickPick: {
    items: Array<{ label: string; description?: string }>;
    activeItems: Array<{ label: string }>;
    placeholder: string;
    show: jest.Mock;
    hide: jest.Mock;
    dispose: jest.Mock;
    onDidChangeActive: jest.Mock;
    onDidAccept: jest.Mock;
    onDidHide: jest.Mock;
  };

  let onDidAcceptCallback: () => Promise<void>;
  let onDidHideCallback: () => void;
  let onDidChangeActiveCallback: (items: Array<{ label: string }>) => void;
  const webview = { postMessage: jest.fn() };

  async function openPicker() {
    const mockContext = createMockContext();
    await SwitchTimelineTheme.getCommand(asContext(mockContext)).run({} as never);
    return mockContext;
  }

  const sentTheme = (activeTheme: string) => ({
    cmd: 'switchTimelineTheme',
    payload: { activeTheme },
  });

  beforeEach(() => {
    mockQuickPick = {
      items: [],
      activeItems: [],
      placeholder: '',
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn(),
      onDidChangeActive: jest.fn((cb) => {
        onDidChangeActiveCallback = cb;
        return { dispose: jest.fn() };
      }),
      onDidAccept: jest.fn((cb) => {
        onDidAcceptCallback = cb;
        return { dispose: jest.fn() };
      }),
      onDidHide: jest.fn((cb) => {
        onDidHideCallback = cb;
        return { dispose: jest.fn() };
      }),
    };
    (window.createQuickPick as jest.Mock).mockReturnValue(mockQuickPick);
    mockGetConfig.mockReturnValue(themeConfig('50 Shades of Green'));
    mockUpdateConfig.mockResolvedValue(undefined);
    mockGetCurrentView.mockReturnValue({ webview });
  });

  it('registers the command and says so', () => {
    const mockContext = createMockContext();

    SwitchTimelineTheme.apply(asContext(mockContext));

    expect(mockContext.context.subscriptions).toHaveLength(1);
    expect(mockContext.display.output).toHaveBeenCalledWith(
      "Registered command 'Lana: Timeline Theme'",
    );
  });

  it('reports a failure to change the theme rather than failing silently', async () => {
    mockGetConfig.mockImplementation(() => {
      throw new Error('config unavailable');
    });
    const mockContext = createMockContext();
    const command = SwitchTimelineTheme.getCommand(asContext(mockContext));

    await expect(command.run(Uri.parse('memfs:/logs/a.log'))).resolves.toBeUndefined();

    expect(mockContext.display.showErrorMessage).toHaveBeenCalledWith(
      'Error changing timeline theme: config unavailable',
    );
  });

  describe('theme list', () => {
    it('lists the presets and marks only the default', async () => {
      await openPicker();

      expect(mockQuickPick.items).toEqual(
        expect.arrayContaining([
          { label: '50 Shades of Green', description: 'default' },
          { label: 'Dracula', description: '' },
          { label: 'Nord', description: '' },
          { label: 'Monokai Pro', description: '' },
        ]),
      );
    });

    it('adds custom themes once each, sorted with the presets', async () => {
      mockGetConfig.mockReturnValue(
        themeConfig('50 Shades of Green', { Zebra: {}, Alpha: {}, Dracula: {} }),
      );

      await openPicker();

      const labels = mockQuickPick.items.map((i) => i.label);
      expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
      expect(labels.filter((label) => label === 'Dracula')).toHaveLength(1);
      expect(mockQuickPick.items).toEqual(
        expect.arrayContaining([
          { label: 'Alpha', description: 'custom' },
          { label: 'Zebra', description: 'custom' },
          { label: 'Dracula', description: '' },
        ]),
      );
    });

    it('focuses the current theme', async () => {
      mockGetConfig.mockReturnValue(themeConfig('Nord'));
      await openPicker();
      expect(mockQuickPick.activeItems.map((i) => i.label)).toEqual(['Nord']);
    });

    it('focuses nothing when the current theme no longer exists', async () => {
      mockGetConfig.mockReturnValue(themeConfig('NonExistent'));
      await openPicker();
      expect(mockQuickPick.activeItems).toHaveLength(0);
    });
  });

  describe('preview', () => {
    it('sends each theme to the open view as the user moves through the list', async () => {
      await openPicker();
      onDidChangeActiveCallback([{ label: 'Dracula' }]);
      expect(webview.postMessage).toHaveBeenCalledWith(sentTheme('Dracula'));
    });

    it('does nothing when no view is open', async () => {
      mockGetCurrentView.mockReturnValue(null);
      await openPicker();
      expect(() => onDidChangeActiveCallback([{ label: 'Dracula' }])).not.toThrow();
    });
  });

  describe('accept', () => {
    it('saves the chosen theme and closes the picker', async () => {
      await openPicker();
      onDidChangeActiveCallback([{ label: 'Nord' }]);
      await onDidAcceptCallback();

      expect(mockUpdateConfig).toHaveBeenCalledWith('timeline.activeTheme', 'Nord');
      expect(mockQuickPick.hide).toHaveBeenCalled();
    });

    it('reports a failure to save the chosen theme, and still closes', async () => {
      mockUpdateConfig.mockRejectedValue(new Error('settings are read-only'));
      const mockContext = await openPicker();
      onDidChangeActiveCallback([{ label: 'Nord' }]);
      await onDidAcceptCallback();

      expect(mockContext.display.showErrorMessage).toHaveBeenCalledWith(
        'Error changing timeline theme: settings are read-only',
      );
      expect(mockQuickPick.hide).toHaveBeenCalled();
    });
  });

  describe('hide', () => {
    it('disposes the picker and reverts the preview when nothing was chosen', async () => {
      await openPicker();
      onDidChangeActiveCallback([{ label: 'Nord' }]);
      onDidHideCallback();

      expect(mockQuickPick.dispose).toHaveBeenCalled();
      expect(webview.postMessage).toHaveBeenLastCalledWith(sentTheme('50 Shades of Green'));
    });

    it('keeps the chosen theme after it is accepted', async () => {
      await openPicker();
      onDidChangeActiveCallback([{ label: 'Nord' }]);
      await onDidAcceptCallback();
      webview.postMessage.mockClear();
      onDidHideCallback();

      expect(webview.postMessage).not.toHaveBeenCalled();
    });
  });
});
