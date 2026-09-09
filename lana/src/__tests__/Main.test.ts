/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import { createMockExtensionContext } from './mocks/vscode.js';
import { Context } from '../Context.js';
import { Display } from '../display/Display.js';
import { activate, deactivate } from '../Main.js';
import { disposeServices, initServices } from '../services/servicesRuntime.js';

jest.mock('../Context.js', () => ({ Context: jest.fn() }));
jest.mock('../display/Display.js', () => ({ Display: jest.fn() }));
jest.mock('../services/servicesRuntime.js', () => ({
  disposeServices: jest.fn(),
  initServices: jest.fn(),
}));

const mockContext = Context as jest.Mock;
const mockDisplay = Display as jest.Mock;
const mockDisposeServices = disposeServices as jest.Mock;
const mockInitServices = initServices as jest.Mock;

describe('Main', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('activates without initializing Salesforce Services', () => {
    const extensionContext = createMockExtensionContext();

    activate(extensionContext as unknown as import('vscode').ExtensionContext);

    expect(mockDisplay).toHaveBeenCalledWith();
    expect(mockContext).toHaveBeenCalledWith(extensionContext, expect.anything());
    expect(mockInitServices).not.toHaveBeenCalled();
  });

  it('deactivates without loading the Salesforce Services chunk', () => {
    deactivate();

    expect(mockDisposeServices).not.toHaveBeenCalled();
  });
});
