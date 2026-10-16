/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { FindWidget } from '../FindWidget.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('FindWidget', () => {
  it('announces the match count as a status', async () => {
    const widget = new FindWidget();
    document.body.append(widget);
    widget.totalMatches = 5;
    widget.currentMatch = 2;
    await widget.updateComplete;
    const status = widget.renderRoot.querySelector('[role="status"]');
    expect(status?.textContent).toBe('2 of 5');
  });
});
