/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it, type Mock, vi } from 'vitest';

import { createMockExtensionContext } from './mocks/vscode.js';
import { Context } from '../Context.js';
import { Display } from '../display/Display.js';
import { activate, deactivate } from '../Main.js';
import { disposeServices, initServices } from '../services/servicesRuntime.js';

vi.mock('../Context.js', () => ({ Context: vi.fn() }));
vi.mock('../display/Display.js', () => ({ Display: vi.fn() }));
vi.mock('../services/servicesRuntime.js', () => ({
  disposeServices: vi.fn(),
  initServices: vi.fn(),
}));

const mockContext = Context as Mock;
const mockDisplay = Display as Mock;
const mockDisposeServices = disposeServices as Mock;
const mockInitServices = initServices as Mock;

describe('Main', () => {
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
