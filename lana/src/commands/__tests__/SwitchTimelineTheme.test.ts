/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { window } from 'vscode';

import { createMockContext } from '../../__tests__/helpers/test-builders.js';
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

  let onDidAcceptCallback: () => void;
  let onDidHideCallback: () => void;
  let onDidChangeActiveCallback: (items: Array<{ label: string }>) => void;

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

    mockGetConfig.mockReturnValue({
      timeline: {
        activeTheme: '50 Shades of Green',
        customThemes: {},
      },
    });

    mockUpdateConfig.mockResolvedValue(undefined);
    mockGetCurrentView.mockReturnValue(null);
  });

  describe('getCommand', () => {
    it('should return command with correct name', () => {
      const mockContext = createMockContext();
      const command = SwitchTimelineTheme.getCommand(
        mockContext as unknown as import('../../Context.js').Context,
      );

      expect(command.name).toBe('switchTimelineTheme');
    });

    it('should return command with correct title', () => {
      const mockContext = createMockContext();
      const command = SwitchTimelineTheme.getCommand(
        mockContext as unknown as import('../../Context.js').Context,
      );

      expect(command.title).toBe('Log: Timeline Theme');
    });
  });

  describe('theme list building', () => {
    it('should include all preset themes', async () => {
      const mockContext = createMockContext();
      const command = SwitchTimelineTheme.getCommand(
        mockContext as unknown as import('../../Context.js').Context,
      );

      await command.run({} as never);

      const items = mockQuickPick.items;
      expect(items.some((i) => i.label === '50 Shades of Green')).toBe(true);
      expect(items.some((i) => i.label === 'Dracula')).toBe(true);
      expect(items.some((i) => i.label === 'Nord')).toBe(true);
      expect(items.some((i) => i.label === 'Monokai Pro')).toBe(true);
    });

    it('should include custom themes from config', async () => {
      mockGetConfig.mockReturnValue({
        timeline: {
          activeTheme: '50 Shades of Green',
          customThemes: {
            'My Custom Theme': {},
            'Another Theme': {},
          },
        },
      });

      const mockContext = createMockContext();
      const command = SwitchTimelineTheme.getCommand(
        mockContext as unknown as import('../../Context.js').Context,
      );

      await command.run({} as never);

      const items = mockQuickPick.items;
      expect(items.some((i) => i.label === 'My Custom Theme')).toBe(true);
      expect(items.some((i) => i.label === 'Another Theme')).toBe(true);
    });

    it('should sort themes alphabetically', async () => {
      mockGetConfig.mockReturnValue({
        timeline: {
          activeTheme: '50 Shades of Green',
          customThemes: {
            Zebra: {},
            Alpha: {},
          },
        },
      });

      const mockContext = createMockContext();
      const command = SwitchTimelineTheme.getCommand(
        mockContext as unknown as import('../../Context.js').Context,
      );

      await command.run({} as never);

      const labels = mockQuickPick.items.map((i) => i.label);
      const sortedLabels = [...labels].sort();
      expect(labels).toEqual(sortedLabels);
    });

    it('should mark default theme with description', async () => {
      const mockContext = createMockContext();
      const command = SwitchTimelineTheme.getCommand(
        mockContext as unknown as import('../../Context.js').Context,
      );

      await command.run({} as never);

      const defaultItem = mockQuickPick.items.find((i) => i.label === '50 Shades of Green');
      expect(defaultItem?.description).toBe('default');
    });

    it('should deduplicate themes when custom theme has same name as preset', async () => {
      mockGetConfig.mockReturnValue({
        timeline: {
          activeTheme: '50 Shades of Green',
          customThemes: {
            Dracula: {}, // Same name as preset
          },
        },
      });

      const mockContext = createMockContext();
      const command = SwitchTimelineTheme.getCommand(
        mockContext as unknown as import('../../Context.js').Context,
      );

      await command.run({} as never);

      const draculaItems = mockQuickPick.items.filter((i) => i.label === 'Dracula');
      expect(draculaItems.length).toBe(1);
    });
  });

  describe('active theme selection', () => {
    it('should set active item to current theme', async () => {
      mockGetConfig.mockReturnValue({
        timeline: {
          activeTheme: 'Nord',
          customThemes: {},
        },
      });

      const mockContext = createMockContext();
      const command = SwitchTimelineTheme.getCommand(
        mockContext as unknown as import('../../Context.js').Context,
      );

      await command.run({} as never);

      expect(mockQuickPick.activeItems[0]?.label).toBe('Nord');
    });

    it('should fall back to default when active theme not found', async () => {
      mockGetConfig.mockReturnValue({
        timeline: {
          activeTheme: 'NonExistent',
          customThemes: {},
        },
      });

      const mockContext = createMockContext();
      const command = SwitchTimelineTheme.getCommand(
        mockContext as unknown as import('../../Context.js').Context,
      );

      await command.run({} as never);

      // activeItems won't be set if theme not found
      expect(mockQuickPick.activeItems.length).toBe(0);
    });
  });

  describe('theme preview', () => {
    it('should send theme change to webview on navigation', async () => {
      const mockWebview = {
        postMessage: jest.fn(),
      };
      mockGetCurrentView.mockReturnValue({ webview: mockWebview });

      const mockContext = createMockContext();
      const command = SwitchTimelineTheme.getCommand(
        mockContext as unknown as import('../../Context.js').Context,
      );

      await command.run({} as never);

      // Simulate navigating to a theme
      onDidChangeActiveCallback([{ label: 'Dracula' }]);

      expect(mockWebview.postMessage).toHaveBeenCalledWith({
        cmd: 'switchTimelineTheme',
        payload: { activeTheme: 'Dracula' },
      });
    });

    it('should not crash when no view is open', async () => {
      mockGetCurrentView.mockReturnValue(null);

      const mockContext = createMockContext();
      const command = SwitchTimelineTheme.getCommand(
        mockContext as unknown as import('../../Context.js').Context,
      );

      await command.run({} as never);

      expect(() => {
        onDidChangeActiveCallback([{ label: 'Dracula' }]);
      }).not.toThrow();
    });
  });

  describe('theme selection', () => {
    it('should update config on accept', async () => {
      const mockContext = createMockContext();
      const command = SwitchTimelineTheme.getCommand(
        mockContext as unknown as import('../../Context.js').Context,
      );

      await command.run({} as never);

      // Navigate to a theme
      onDidChangeActiveCallback([{ label: 'Nord' }]);
      // Accept selection
      onDidAcceptCallback();

      expect(mockUpdateConfig).toHaveBeenCalledWith('timeline.activeTheme', 'Nord');
    });

    it('should hide picker on accept', async () => {
      const mockContext = createMockContext();
      const command = SwitchTimelineTheme.getCommand(
        mockContext as unknown as import('../../Context.js').Context,
      );

      await command.run({} as never);

      onDidChangeActiveCallback([{ label: 'Nord' }]);
      // Need to await since onDidAccept is async
      await onDidAcceptCallback();

      expect(mockQuickPick.hide).toHaveBeenCalled();
    });
  });

  describe('theme revert', () => {
    it('should revert to original theme on hide without selection', async () => {
      const mockWebview = {
        postMessage: jest.fn(),
      };
      mockGetCurrentView.mockReturnValue({ webview: mockWebview });

      mockGetConfig.mockReturnValue({
        timeline: {
          activeTheme: '50 Shades of Green',
          customThemes: {},
        },
      });

      const mockContext = createMockContext();
      const command = SwitchTimelineTheme.getCommand(
        mockContext as unknown as import('../../Context.js').Context,
      );

      await command.run({} as never);

      // Navigate to different theme
      onDidChangeActiveCallback([{ label: 'Nord' }]);
      // Hide without accepting
      onDidHideCallback();

      // Should revert to original
      expect(mockWebview.postMessage).toHaveBeenLastCalledWith({
        cmd: 'switchTimelineTheme',
        payload: { activeTheme: '50 Shades of Green' },
      });
    });

    it('should dispose picker on hide', async () => {
      const mockContext = createMockContext();
      const command = SwitchTimelineTheme.getCommand(
        mockContext as unknown as import('../../Context.js').Context,
      );

      await command.run({} as never);
      onDidHideCallback();

      expect(mockQuickPick.dispose).toHaveBeenCalled();
    });

    it('should not revert when same theme is selected', async () => {
      const mockWebview = {
        postMessage: jest.fn(),
      };
      mockGetCurrentView.mockReturnValue({ webview: mockWebview });

      mockGetConfig.mockReturnValue({
        timeline: {
          activeTheme: '50 Shades of Green',
          customThemes: {},
        },
      });

      const mockContext = createMockContext();
      const command = SwitchTimelineTheme.getCommand(
        mockContext as unknown as import('../../Context.js').Context,
      );

      await command.run({} as never);

      // Navigate to same theme
      onDidChangeActiveCallback([{ label: '50 Shades of Green' }]);
      // Accept and hide
      onDidAcceptCallback();
      mockWebview.postMessage.mockClear();
      onDidHideCallback();

      // Should not send revert message (theme unchanged)
      expect(mockWebview.postMessage).not.toHaveBeenCalled();
    });
  });

  describe('apply', () => {
    it('should register command with context', () => {
      const mockContext = createMockContext();

      SwitchTimelineTheme.apply(mockContext as unknown as import('../../Context.js').Context);

      expect(mockContext.context.subscriptions.length).toBe(1);
    });

    it('should output registration message', () => {
      const mockContext = createMockContext();

      SwitchTimelineTheme.apply(mockContext as unknown as import('../../Context.js').Context);

      expect(mockContext.display.output).toHaveBeenCalledWith(
        "Registered command 'Lana: Timeline Theme'",
      );
    });
  });
});
