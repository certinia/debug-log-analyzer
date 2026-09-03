/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import {
  TabInputText,
  TabInputTextDiff,
  Uri,
  setOpenTabs,
  window,
} from '../../__tests__/mocks/vscode.js';
import { isOpenAsTextTab, isShownOnlyAsDiff } from '../TabState.js';

describe('isOpenAsTextTab', () => {
  it('is true for a URI open as a plain text tab', () => {
    const uri = Uri.file('/logs/run.log');
    setOpenTabs(new TabInputText(uri));

    expect(isOpenAsTextTab(uri)).toBe(true);
  });

  it('is true when the tab is in a non-active group', () => {
    const uri = Uri.file('/logs/run.log');
    window.tabGroups.all = [
      { tabs: [{ input: new TabInputText(Uri.file('/other.log')) }] },
      { tabs: [{ input: new TabInputText(uri) }] },
    ];

    expect(isOpenAsTextTab(uri)).toBe(true);
  });

  it('is false for a URI shown only as a diff side', () => {
    const original = Uri.parse('git:/repo/run.log');
    const modified = Uri.file('/repo/run.log');
    setOpenTabs(new TabInputTextDiff(original, modified));

    expect(isOpenAsTextTab(original)).toBe(false);
    expect(isOpenAsTextTab(modified)).toBe(false);
  });

  it('is true when the same URI is open in a diff and in a normal tab', () => {
    const uri = Uri.file('/repo/run.log');
    setOpenTabs(new TabInputTextDiff(Uri.parse('git:/repo/run.log'), uri), new TabInputText(uri));

    expect(isOpenAsTextTab(uri)).toBe(true);
  });

  it('is not a scheme check: a memfs log in a normal tab counts', () => {
    const uri = Uri.parse('memfs:/logs/virtual.log');
    setOpenTabs(new TabInputText(uri));

    expect(isOpenAsTextTab(uri)).toBe(true);
  });

  it('is false for tab kinds it does not recognise', () => {
    const uri = Uri.file('/logs/run.log');
    setOpenTabs({});

    expect(isOpenAsTextTab(uri)).toBe(false);
  });

  it('is false when no tabs are open', () => {
    expect(isOpenAsTextTab(Uri.file('/logs/run.log'))).toBe(false);
  });
});

describe('isShownOnlyAsDiff', () => {
  it('is true for a URI shown only as a diff side', () => {
    const original = Uri.parse('git:/repo/run.log');
    const modified = Uri.file('/repo/run.log');
    setOpenTabs(new TabInputTextDiff(original, modified));

    expect(isShownOnlyAsDiff(original)).toBe(true);
    expect(isShownOnlyAsDiff(modified)).toBe(true);
  });

  it('is false when the same URI is also open in a normal tab', () => {
    const uri = Uri.file('/repo/run.log');
    setOpenTabs(new TabInputTextDiff(Uri.parse('git:/repo/run.log'), uri), new TabInputText(uri));

    expect(isShownOnlyAsDiff(uri)).toBe(false);
  });

  // The reason this predicate exists: a symbol request can beat the tab model,
  // and DocumentSymbolProvider has no change event to recover with.
  it('is false when no tabs are open yet', () => {
    expect(isShownOnlyAsDiff(Uri.file('/logs/run.log'))).toBe(false);
  });

  it('is false for tab kinds it does not recognise', () => {
    setOpenTabs({});

    expect(isShownOnlyAsDiff(Uri.file('/logs/run.log'))).toBe(false);
  });
});
