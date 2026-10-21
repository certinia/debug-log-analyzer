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
  const results = (detail: { totalMatches: number; currentMatch: number }): void => {
    document.dispatchEvent(new CustomEvent('lv-find-results', { detail }));
  };

  async function shown() {
    const widget = new FindWidget();
    document.body.append(widget);
    await widget.updateComplete;
    const root = widget.renderRoot;
    return {
      widget,
      shownText: () => root.querySelector('.matches-count [aria-hidden]')?.textContent,
      spoken: () => root.querySelector('[role="status"]')?.textContent,
    };
  }

  it.each([
    ['shows the match the view holds', { totalMatches: 5, currentMatch: 4 }, '4 of 5', '4 of 5'],
    [
      'shows no position when the view holds none',
      { totalMatches: 5, currentMatch: 0 },
      '? of 5',
      '5 matches',
    ],
    ['shows no matches', { totalMatches: 0, currentMatch: 0 }, 'No Matches', 'No Matches'],
  ])('%s', async (_name, detail, text, spokenText) => {
    const { widget, shownText, spoken } = await shown();
    results(detail);
    await widget.updateComplete;

    expect(shownText()).toBe(text);
    expect(spoken()).toBe(spokenText);
  });

  it.each([
    ['searches its text again without moving, when open', true, [{ text: 'foo', count: 0 }]],
    ['does nothing when closed', false, []],
  ])('on a refresh, %s', async (_name, open, searches) => {
    const { widget } = await shown();
    widget.isVisble = open;
    Object.assign(widget.inputbox ?? {}, { value: 'foo' });
    const seen: { text: string; count: number }[] = [];
    const onFind = (e: Event): void => {
      const { text, count } = (e as CustomEvent<{ text: string; count: number }>).detail;
      seen.push({ text, count });
    };
    document.addEventListener('lv-find', onFind);
    document.dispatchEvent(new CustomEvent('lv-find-refresh', { detail: null }));
    document.removeEventListener('lv-find', onFind);

    expect(seen).toEqual(searches);
  });

  it('keeps its count on a refresh until the view reports', async () => {
    const { widget, shownText } = await shown();
    widget.isVisble = true;
    Object.assign(widget.inputbox ?? {}, { value: 'foo' });
    results({ totalMatches: 5, currentMatch: 2 });
    document.dispatchEvent(new CustomEvent('lv-find-refresh', { detail: null }));
    await widget.updateComplete;

    expect(shownText()).toBe('2 of 5');
  });

  it.each([
    ['closes, and asks the views to drop the search, when open', true, 1],
    ['does nothing when closed', false, 0],
  ])('on a dismiss, %s', async (_name, open, closes) => {
    const { widget } = await shown();
    widget.isVisble = open;
    const onClose = jest.fn();
    document.addEventListener('lv-find-close', onClose);
    document.dispatchEvent(new CustomEvent('lv-find-dismiss', { detail: null }));
    document.removeEventListener('lv-find-close', onClose);

    expect(onClose).toHaveBeenCalledTimes(closes);
    expect(widget.isVisble).toBe(false);
  });

  it.each([
    ['Enter goes to the first', false, 1],
    ['Shift+Enter goes to the last', true, 5],
  ])('from no position, %s match', async (_name, shiftKey, match) => {
    const { widget } = await shown();
    const box = widget.inputbox;
    // jsdom focuses only an element with a tabindex; a browser focuses the textfield's input.
    Object.assign(box ?? {}, { tabIndex: 0 });
    box?.focus();
    const press = (init: KeyboardEventInit = {}): void =>
      void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ...init }));
    press();
    results({ totalMatches: 5, currentMatch: 0 });
    const counts: number[] = [];
    const onMatch = (e: Event): void => {
      counts.push((e as CustomEvent<{ count: number }>).detail.count);
    };
    document.addEventListener('lv-find-match', onMatch);
    press({ shiftKey });
    document.removeEventListener('lv-find-match', onMatch);

    expect(counts).toEqual([match]);
  });
});
