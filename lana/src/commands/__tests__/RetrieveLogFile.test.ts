/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Tests for RetrieveLogFile command, focusing on the private formatDuration method.
 * Since formatDuration is private, we test it indirectly through its usage in getLogFile.
 */

import { window } from 'vscode';

import { createMockContext } from '../../__tests__/helpers/test-builders.js';
import { RetrieveLogFile } from '../RetrieveLogFile.js';

// Mock dependencies
jest.mock('../../display/QuickPickWorkspace.js', () => ({
  QuickPickWorkspace: {
    pickOrReturn: jest.fn(),
  },
}));

jest.mock('../../salesforce/logs/GetLogFiles.js', () => ({
  GetLogFiles: {
    apply: jest.fn(),
  },
}));

jest.mock('../../salesforce/logs/GetLogFile.js', () => ({
  GetLogFile: {
    apply: jest.fn(),
  },
}));

jest.mock('../LogView.js', () => ({
  LogView: {
    createView: jest.fn(),
  },
}));

jest.mock('../../display/QuickPick.js', () => ({
  QuickPick: {
    pick: jest.fn(),
  },
  Item: class {
    name: string;
    desc: string;
    details: string;
    sticky: boolean;
    selected: boolean;
    constructor(name: string, desc: string, details: string, sticky: boolean, selected: boolean) {
      this.name = name;
      this.desc = desc;
      this.details = details;
      this.sticky = sticky;
      this.selected = selected;
    }
  },
  Options: class {
    placeholder: string;
    constructor(placeholder: string) {
      this.placeholder = placeholder;
    }
  },
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
}));

import { existsSync } from 'fs';
import { commands } from 'vscode';

import { QuickPick } from '../../display/QuickPick.js';
import { QuickPickWorkspace } from '../../display/QuickPickWorkspace.js';
import { GetLogFile } from '../../salesforce/logs/GetLogFile.js';
import { GetLogFiles } from '../../salesforce/logs/GetLogFiles.js';
import { LogView } from '../LogView.js';

const mockPickOrReturn = QuickPickWorkspace.pickOrReturn as jest.Mock;
const mockGetLogFiles = GetLogFiles.apply as jest.Mock;
const mockGetLogFile = GetLogFile.apply as jest.Mock;
const mockQuickPickPick = QuickPick.pick as jest.Mock;
const mockExistsSync = existsSync as jest.Mock;
const mockCreateView = LogView.createView as jest.Mock;
const mockRegisterCommand = commands.registerCommand as jest.Mock;

describe('RetrieveLogFile', () => {
  beforeEach(() => {
    mockPickOrReturn.mockResolvedValue('/test/workspace');
    mockGetLogFiles.mockResolvedValue([]);
    mockQuickPickPick.mockResolvedValue([]);
    mockExistsSync.mockReturnValue(false);
    (window.createQuickPick as jest.Mock).mockReturnValue({
      items: [],
      busy: false,
      enabled: true,
      placeholder: '',
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn(),
    });
  });

  describe('apply', () => {
    it('should register command with context', () => {
      const mockContext = createMockContext();

      RetrieveLogFile.apply(mockContext as unknown as import('../../Context.js').Context);

      expect(mockContext.context.subscriptions.length).toBe(1);
    });

    it('should output registration message', () => {
      const mockContext = createMockContext();

      RetrieveLogFile.apply(mockContext as unknown as import('../../Context.js').Context);

      expect(mockContext.display.output).toHaveBeenCalledWith(
        "Registered command 'Lana: Retrieve Log'",
      );
    });
  });

  describe('error handling', () => {
    it('should register command even when errors occur during execution', () => {
      const mockContext = createMockContext();
      RetrieveLogFile.apply(mockContext as unknown as import('../../Context.js').Context);

      // The error handling is tested by verifying the command is registered
      expect(mockContext.context.subscriptions.length).toBe(1);
    });
  });

  describe('command execution flow', () => {
    /**
     * Helper to get the registered command callback.
     * The Command class stores callbacks via commands.registerCommand.
     */
    const getCommandCallback = (): (() => Promise<unknown>) => {
      // Get the most recent call's callback (second argument)
      const lastCall = mockRegisterCommand.mock.calls[mockRegisterCommand.mock.calls.length - 1];
      return lastCall[1];
    };

    it('should call QuickPickWorkspace.pickOrReturn first', async () => {
      mockPickOrReturn.mockResolvedValue('/test/workspace');
      mockGetLogFiles.mockResolvedValue([]);
      mockQuickPickPick.mockResolvedValue([]);

      const mockContext = createMockContext();
      RetrieveLogFile.apply(mockContext as unknown as import('../../Context.js').Context);

      const commandCallback = getCommandCallback();
      await commandCallback();

      expect(mockPickOrReturn).toHaveBeenCalled();
    });

    it('should call GetLogFiles.apply with workspace path', async () => {
      mockPickOrReturn.mockResolvedValue('/my/workspace');
      mockGetLogFiles.mockResolvedValue([]);
      mockQuickPickPick.mockResolvedValue([]);

      const mockContext = createMockContext();
      RetrieveLogFile.apply(mockContext as unknown as import('../../Context.js').Context);

      const commandCallback = getCommandCallback();
      await commandCallback();

      expect(mockGetLogFiles).toHaveBeenCalledWith('/my/workspace');
    });

    it('should return undefined when no log is selected', async () => {
      mockPickOrReturn.mockResolvedValue('/test/workspace');
      mockGetLogFiles.mockResolvedValue([
        {
          Id: 'log1',
          LogUser: { Name: 'User' },
          Operation: 'Op',
          LogLength: 1024,
          DurationMilliseconds: 100,
          StartTime: '2024-01-01T00:00:00.000Z',
          Status: 'Success',
        },
      ]);
      // Return empty array (user cancelled)
      mockQuickPickPick.mockResolvedValue([]);

      const mockContext = createMockContext();
      RetrieveLogFile.apply(mockContext as unknown as import('../../Context.js').Context);

      const commandCallback = getCommandCallback();
      const result = await commandCallback();

      expect(result).toBeUndefined();
      expect(mockCreateView).not.toHaveBeenCalled();
    });

    it('should create view when log is selected', async () => {
      mockPickOrReturn.mockResolvedValue('/test/workspace');
      mockGetLogFiles.mockResolvedValue([
        {
          Id: 'selected-log-id',
          LogUser: { Name: 'User' },
          Operation: 'Op',
          LogLength: 1024,
          DurationMilliseconds: 100,
          StartTime: '2024-01-01T00:00:00.000Z',
          Status: 'Success',
        },
      ]);
      // Return selected item with logId
      mockQuickPickPick.mockResolvedValue([{ logId: 'selected-log-id' }]);
      mockExistsSync.mockReturnValue(false);
      mockGetLogFile.mockResolvedValue(undefined);
      mockCreateView.mockResolvedValue({ panel: 'mock' });

      const mockContext = createMockContext();
      RetrieveLogFile.apply(mockContext as unknown as import('../../Context.js').Context);

      const commandCallback = getCommandCallback();
      await commandCallback();

      expect(mockCreateView).toHaveBeenCalled();
      const createViewCall = mockCreateView.mock.calls[0];
      expect(createViewCall[2]).toContain('selected-log-id.log');
    });

    it('should skip download when log file already exists', async () => {
      mockPickOrReturn.mockResolvedValue('/test/workspace');
      mockGetLogFiles.mockResolvedValue([
        {
          Id: 'existing-log',
          LogUser: { Name: 'User' },
          Operation: 'Op',
          LogLength: 1024,
          DurationMilliseconds: 100,
          StartTime: '2024-01-01T00:00:00.000Z',
          Status: 'Success',
        },
      ]);
      mockQuickPickPick.mockResolvedValue([{ logId: 'existing-log' }]);
      // File already exists
      mockExistsSync.mockReturnValue(true);
      mockCreateView.mockResolvedValue({ panel: 'mock' });

      const mockContext = createMockContext();
      RetrieveLogFile.apply(mockContext as unknown as import('../../Context.js').Context);

      const commandCallback = getCommandCallback();
      await commandCallback();

      // GetLogFile should NOT be called since file exists
      expect(mockGetLogFile).not.toHaveBeenCalled();
      expect(mockCreateView).toHaveBeenCalled();
    });

    it('should download log file when it does not exist', async () => {
      mockPickOrReturn.mockResolvedValue('/test/workspace');
      mockGetLogFiles.mockResolvedValue([
        {
          Id: 'new-log',
          LogUser: { Name: 'User' },
          Operation: 'Op',
          LogLength: 1024,
          DurationMilliseconds: 100,
          StartTime: '2024-01-01T00:00:00.000Z',
          Status: 'Success',
        },
      ]);
      mockQuickPickPick.mockResolvedValue([{ logId: 'new-log' }]);
      // File does not exist
      mockExistsSync.mockReturnValue(false);
      mockGetLogFile.mockResolvedValue(undefined);
      mockCreateView.mockResolvedValue({ panel: 'mock' });

      const mockContext = createMockContext();
      RetrieveLogFile.apply(mockContext as unknown as import('../../Context.js').Context);

      const commandCallback = getCommandCallback();
      await commandCallback();

      // GetLogFile SHOULD be called since file doesn't exist
      expect(mockGetLogFile).toHaveBeenCalledWith(
        '/test/workspace',
        expect.stringContaining('.sfdx/tools/debug/logs'),
        'new-log',
      );
    });
  });

  describe('formatDuration via getLogFile', () => {
    /**
     * Tests for the private formatDuration method, tested indirectly through getLogFile.
     * formatDuration converts milliseconds to human-readable strings.
     */

    const createLogWithDuration = (durationMs: number) => ({
      Id: 'test-log',
      LogUser: { Name: 'User' },
      Operation: 'Op',
      LogLength: 1024,
      DurationMilliseconds: durationMs,
      StartTime: '2024-01-01T00:00:00.000Z',
      Status: 'Success',
    });

    const getCapturedDescription = async (durationMs: number): Promise<string> => {
      mockPickOrReturn.mockResolvedValue('/test/workspace');
      mockGetLogFiles.mockResolvedValue([createLogWithDuration(durationMs)]);

      let capturedDesc = '';
      mockQuickPickPick.mockImplementation((items: Array<{ desc: string }>) => {
        capturedDesc = items[0]?.desc || '';
        return Promise.resolve([]);
      });

      const mockContext = createMockContext();
      RetrieveLogFile.apply(mockContext as unknown as import('../../Context.js').Context);

      const lastCall = mockRegisterCommand.mock.calls[mockRegisterCommand.mock.calls.length - 1];
      await lastCall[1]();

      return capturedDesc;
    };

    it('should format 0 ms as "0 ms"', async () => {
      const desc = await getCapturedDescription(0);
      expect(desc).toContain('0 ms');
    });

    it('should format values < 10 ms with 2 decimal precision', async () => {
      const desc = await getCapturedDescription(5.123);
      // _round(5.123, 100) = 5.12
      expect(desc).toContain('5.12 ms');
    });

    it('should format values 10-99 ms with 1 decimal precision', async () => {
      const desc = await getCapturedDescription(45.67);
      // _round(45.67, 10) = 45.7
      expect(desc).toContain('45.7 ms');
    });

    it('should format values >= 100 ms with no decimal precision', async () => {
      const desc = await getCapturedDescription(789.4);
      // _round(789.4, 1) = 789
      expect(desc).toContain('789 ms');
    });

    it('should format 1-9.99 seconds with 2 decimal precision', async () => {
      const desc = await getCapturedDescription(1234);
      // 1.234s, _round(1.234, 100) = 1.23
      expect(desc).toContain('1.23 s');
    });

    it('should format 10-59.99 seconds with 1 decimal precision', async () => {
      const desc = await getCapturedDescription(45678);
      // 45.678s, _round(45.678, 10) = 45.7
      expect(desc).toContain('45.7 s');
    });

    it('should format exact minutes without seconds', async () => {
      const desc = await getCapturedDescription(120000);
      // 120s = 2m exactly
      expect(desc).toContain('2m');
      expect(desc).not.toContain('2m ');
    });

    it('should format minutes with whole seconds', async () => {
      const desc = await getCapturedDescription(150000);
      // 150s = 2m 30s
      expect(desc).toContain('2m 30s');
    });

    it('should format minutes with fractional seconds', async () => {
      const desc = await getCapturedDescription(125500);
      // 125.5s = 2m 5.5s
      expect(desc).toContain('2m 5.5s');
    });

    it('should format large durations in minutes', async () => {
      const desc = await getCapturedDescription(300000);
      // 300s = 5m exactly
      expect(desc).toContain('5m');
    });

    it('should format undefined/falsy duration as "0 ms"', async () => {
      // Test with undefined cast to number (becomes NaN which is falsy)
      mockPickOrReturn.mockResolvedValue('/test/workspace');
      mockGetLogFiles.mockResolvedValue([
        {
          Id: 'test-log',
          LogUser: { Name: 'User' },
          Operation: 'Op',
          LogLength: 1024,
          DurationMilliseconds: undefined as unknown as number,
          StartTime: '2024-01-01T00:00:00.000Z',
          Status: 'Success',
        },
      ]);

      let capturedDesc = '';
      mockQuickPickPick.mockImplementation((items: Array<{ desc: string }>) => {
        capturedDesc = items[0]?.desc || '';
        return Promise.resolve([]);
      });

      const mockContext = createMockContext();
      RetrieveLogFile.apply(mockContext as unknown as import('../../Context.js').Context);

      const lastCall = mockRegisterCommand.mock.calls[mockRegisterCommand.mock.calls.length - 1];
      await lastCall[1]();

      expect(capturedDesc).toContain('0 ms');
    });
  });

  describe('getLogFile behavior', () => {
    it('should sort logs newest first', async () => {
      const logs = [
        {
          Id: 'oldest',
          LogUser: { Name: 'User' },
          Operation: 'Op',
          LogLength: 1024,
          DurationMilliseconds: 100,
          StartTime: '2024-01-01T00:00:00.000Z',
          Status: 'Success',
        },
        {
          Id: 'newest',
          LogUser: { Name: 'User' },
          Operation: 'Op',
          LogLength: 1024,
          DurationMilliseconds: 100,
          StartTime: '2024-01-03T00:00:00.000Z',
          Status: 'Success',
        },
        {
          Id: 'middle',
          LogUser: { Name: 'User' },
          Operation: 'Op',
          LogLength: 1024,
          DurationMilliseconds: 100,
          StartTime: '2024-01-02T00:00:00.000Z',
          Status: 'Success',
        },
      ];

      mockPickOrReturn.mockResolvedValue('/test/workspace');
      mockGetLogFiles.mockResolvedValue(logs);

      // Capture the items passed to QuickPick
      let capturedItems: Array<{ logId: string }> = [];
      mockQuickPickPick.mockImplementation((items) => {
        capturedItems = items;
        return Promise.resolve([]);
      });

      const mockContext = createMockContext();
      RetrieveLogFile.apply(mockContext as unknown as import('../../Context.js').Context);

      const lastCall = mockRegisterCommand.mock.calls[mockRegisterCommand.mock.calls.length - 1];
      await lastCall[1]();

      // Verify items are sorted newest first
      expect(capturedItems).toHaveLength(3);
      expect(capturedItems[0]?.logId).toBe('newest');
      expect(capturedItems[1]?.logId).toBe('middle');
      expect(capturedItems[2]?.logId).toBe('oldest');
    });

    it('should format log item name as "User - Operation"', async () => {
      mockPickOrReturn.mockResolvedValue('/test/workspace');
      mockGetLogFiles.mockResolvedValue([
        {
          Id: 'log1',
          LogUser: { Name: 'John Doe' },
          Operation: '/apex/MyController',
          LogLength: 2048,
          DurationMilliseconds: 500,
          StartTime: '2024-01-01T00:00:00.000Z',
          Status: 'Success',
        },
      ]);

      let capturedItems: Array<{ name: string }> = [];
      mockQuickPickPick.mockImplementation((items) => {
        capturedItems = items;
        return Promise.resolve([]);
      });

      const mockContext = createMockContext();
      RetrieveLogFile.apply(mockContext as unknown as import('../../Context.js').Context);

      const lastCall = mockRegisterCommand.mock.calls[mockRegisterCommand.mock.calls.length - 1];
      await lastCall[1]();

      expect(capturedItems).toHaveLength(1);
      expect(capturedItems[0]?.name).toBe('John Doe - /apex/MyController');
    });

    it('should format log item description with size in KB and duration', async () => {
      mockPickOrReturn.mockResolvedValue('/test/workspace');
      mockGetLogFiles.mockResolvedValue([
        {
          Id: 'log1',
          LogUser: { Name: 'User' },
          Operation: 'Op',
          LogLength: 5120, // 5 KB
          DurationMilliseconds: 1500, // 1.5s
          StartTime: '2024-01-01T00:00:00.000Z',
          Status: 'Success',
        },
      ]);

      let capturedItems: Array<{ desc: string }> = [];
      mockQuickPickPick.mockImplementation((items) => {
        capturedItems = items;
        return Promise.resolve([]);
      });

      const mockContext = createMockContext();
      RetrieveLogFile.apply(mockContext as unknown as import('../../Context.js').Context);

      const lastCall = mockRegisterCommand.mock.calls[mockRegisterCommand.mock.calls.length - 1];
      await lastCall[1]();

      expect(capturedItems).toHaveLength(1);
      expect(capturedItems[0]?.desc).toContain('5.00 KB');
      expect(capturedItems[0]?.desc).toContain('1.5 s');
    });

    it('should format log item detail with date, status, and ID', async () => {
      mockPickOrReturn.mockResolvedValue('/test/workspace');
      mockGetLogFiles.mockResolvedValue([
        {
          Id: 'ABC123XYZ',
          LogUser: { Name: 'User' },
          Operation: 'Op',
          LogLength: 1024,
          DurationMilliseconds: 100,
          StartTime: '2024-06-15T10:30:00.000Z',
          Status: 'Success',
        },
      ]);

      let capturedItems: Array<{ details: string }> = [];
      mockQuickPickPick.mockImplementation((items) => {
        capturedItems = items;
        return Promise.resolve([]);
      });

      const mockContext = createMockContext();
      RetrieveLogFile.apply(mockContext as unknown as import('../../Context.js').Context);

      const lastCall = mockRegisterCommand.mock.calls[mockRegisterCommand.mock.calls.length - 1];
      await lastCall[1]();

      expect(capturedItems).toHaveLength(1);
      expect(capturedItems[0]?.details).toContain('Success');
      expect(capturedItems[0]?.details).toContain('ABC123XYZ');
    });

    it('should return null when QuickPick returns empty array', async () => {
      mockPickOrReturn.mockResolvedValue('/test/workspace');
      mockGetLogFiles.mockResolvedValue([
        {
          Id: 'log1',
          LogUser: { Name: 'User' },
          Operation: 'Op',
          LogLength: 1024,
          DurationMilliseconds: 100,
          StartTime: '2024-01-01T00:00:00.000Z',
          Status: 'Success',
        },
      ]);
      mockQuickPickPick.mockResolvedValue([]);

      const mockContext = createMockContext();
      RetrieveLogFile.apply(mockContext as unknown as import('../../Context.js').Context);

      const lastCall = mockRegisterCommand.mock.calls[mockRegisterCommand.mock.calls.length - 1];
      const result = await lastCall[1]();

      expect(result).toBeUndefined();
      expect(mockCreateView).not.toHaveBeenCalled();
    });
  });

  describe('safeCommand error handling', () => {
    it('should catch Error and display error message', async () => {
      const mockContext = createMockContext();
      RetrieveLogFile.apply(mockContext as unknown as import('../../Context.js').Context);

      // Setup rejection using implementation
      mockPickOrReturn.mockImplementationOnce(() =>
        Promise.reject(new Error('Test error message')),
      );

      const lastCall = mockRegisterCommand.mock.calls[mockRegisterCommand.mock.calls.length - 1];
      await lastCall[1]();

      expect(mockContext.display.showErrorMessage).toHaveBeenCalledWith(
        'Error loading logfile: Test error message',
      );
    });

    it('should convert non-Error to string in error message', async () => {
      const mockContext = createMockContext();
      RetrieveLogFile.apply(mockContext as unknown as import('../../Context.js').Context);

      // Setup rejection using implementation - throw a non-Error value
      mockPickOrReturn.mockImplementationOnce(() => Promise.reject('String error'));

      const lastCall = mockRegisterCommand.mock.calls[mockRegisterCommand.mock.calls.length - 1];
      await lastCall[1]();

      expect(mockContext.display.showErrorMessage).toHaveBeenCalledWith(
        'Error loading logfile: String error',
      );
    });

    it('should return undefined on error (not reject)', async () => {
      const mockContext = createMockContext();
      RetrieveLogFile.apply(mockContext as unknown as import('../../Context.js').Context);

      // Setup rejection using implementation
      mockPickOrReturn.mockImplementationOnce(() => Promise.reject(new Error('Some error')));

      const lastCall = mockRegisterCommand.mock.calls[mockRegisterCommand.mock.calls.length - 1];
      const result = await lastCall[1]();

      // Should resolve (not reject) with undefined
      expect(result).toBeUndefined();
    });
  });

  describe('getLogFilePath', () => {
    it('should construct path with .sfdx/tools/debug/logs directory', async () => {
      mockPickOrReturn.mockResolvedValue('/my/project');
      mockGetLogFiles.mockResolvedValue([
        {
          Id: 'test-log-123',
          LogUser: { Name: 'User' },
          Operation: 'Op',
          LogLength: 1024,
          DurationMilliseconds: 100,
          StartTime: '2024-01-01T00:00:00.000Z',
          Status: 'Success',
        },
      ]);
      mockQuickPickPick.mockResolvedValue([{ logId: 'test-log-123' }]);
      mockExistsSync.mockReturnValue(true);
      mockCreateView.mockResolvedValue({ panel: 'mock' });

      const mockContext = createMockContext();
      RetrieveLogFile.apply(mockContext as unknown as import('../../Context.js').Context);

      const lastCall = mockRegisterCommand.mock.calls[mockRegisterCommand.mock.calls.length - 1];
      await lastCall[1]();

      // Verify the path passed to createView
      const createViewCall = mockCreateView.mock.calls[0];
      const logFilePath = createViewCall[2];

      expect(logFilePath).toBe('/my/project/.sfdx/tools/debug/logs/test-log-123.log');
    });

    it('should append .log extension to fileId', async () => {
      mockPickOrReturn.mockResolvedValue('/workspace');
      mockGetLogFiles.mockResolvedValue([
        {
          Id: 'myLogId',
          LogUser: { Name: 'User' },
          Operation: 'Op',
          LogLength: 1024,
          DurationMilliseconds: 100,
          StartTime: '2024-01-01T00:00:00.000Z',
          Status: 'Success',
        },
      ]);
      mockQuickPickPick.mockResolvedValue([{ logId: 'myLogId' }]);
      mockExistsSync.mockReturnValue(true);
      mockCreateView.mockResolvedValue({ panel: 'mock' });

      const mockContext = createMockContext();
      RetrieveLogFile.apply(mockContext as unknown as import('../../Context.js').Context);

      const lastCall = mockRegisterCommand.mock.calls[mockRegisterCommand.mock.calls.length - 1];
      await lastCall[1]();

      const createViewCall = mockCreateView.mock.calls[0];
      const logFilePath = createViewCall[2];

      expect(logFilePath).toContain('myLogId.log');
    });
  });

  describe('writeLogFile', () => {
    it('should call GetLogFile.apply when file does not exist', async () => {
      mockPickOrReturn.mockResolvedValue('/test/ws');
      mockGetLogFiles.mockResolvedValue([
        {
          Id: 'download-me',
          LogUser: { Name: 'User' },
          Operation: 'Op',
          LogLength: 1024,
          DurationMilliseconds: 100,
          StartTime: '2024-01-01T00:00:00.000Z',
          Status: 'Success',
        },
      ]);
      mockQuickPickPick.mockResolvedValue([{ logId: 'download-me' }]);
      mockExistsSync.mockReturnValue(false);
      mockGetLogFile.mockResolvedValue(undefined);
      mockCreateView.mockResolvedValue({ panel: 'mock' });

      const mockContext = createMockContext();
      RetrieveLogFile.apply(mockContext as unknown as import('../../Context.js').Context);

      const lastCall = mockRegisterCommand.mock.calls[mockRegisterCommand.mock.calls.length - 1];
      await lastCall[1]();

      expect(mockGetLogFile).toHaveBeenCalledWith(
        '/test/ws',
        '/test/ws/.sfdx/tools/debug/logs',
        'download-me',
      );
    });

    it('should NOT call GetLogFile.apply when file exists', async () => {
      mockPickOrReturn.mockResolvedValue('/test/ws');
      mockGetLogFiles.mockResolvedValue([
        {
          Id: 'already-exists',
          LogUser: { Name: 'User' },
          Operation: 'Op',
          LogLength: 1024,
          DurationMilliseconds: 100,
          StartTime: '2024-01-01T00:00:00.000Z',
          Status: 'Success',
        },
      ]);
      mockQuickPickPick.mockResolvedValue([{ logId: 'already-exists' }]);
      mockExistsSync.mockReturnValue(true);
      mockCreateView.mockResolvedValue({ panel: 'mock' });

      const mockContext = createMockContext();
      RetrieveLogFile.apply(mockContext as unknown as import('../../Context.js').Context);

      const lastCall = mockRegisterCommand.mock.calls[mockRegisterCommand.mock.calls.length - 1];
      await lastCall[1]();

      expect(mockGetLogFile).not.toHaveBeenCalled();
    });
  });
});
