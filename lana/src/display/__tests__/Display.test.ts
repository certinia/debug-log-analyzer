/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import { window } from 'vscode';

import { Display } from '../Display.js';

describe('Display', () => {
  it('writes errors to the output channel before displaying them', () => {
    const display = new Display();
    const outputChannel = (window.createOutputChannel as jest.Mock).mock.results.at(-1)?.value;

    display.showErrorMessage('Unable to read log');

    expect(outputChannel.appendLine).toHaveBeenCalledWith('Unable to read log');
    expect(outputChannel.show).toHaveBeenCalledWith(true);
    expect(window.showErrorMessage).toHaveBeenCalledWith('Unable to read log', {});
  });
});
