/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { sightOf } from '../sight.js';

// jsdom lays nothing out, so each box is set by hand.
function place(el: Element, top: number, height: number): void {
  el.getBoundingClientRect = () => ({ top, bottom: top + height, height }) as DOMRect;
}

/**
 * A page that scrolls from 100 to 300, holding a grid at `gridTop`: a 20px header, then
 * five 20px rows.
 */
function page(gridTop: number) {
  const pane = document.createElement('div');
  pane.style.overflowY = 'auto';
  place(pane, 100, 200);
  const scroller = document.createElement('div');
  place(scroller, gridTop, 120);
  const head = document.createElement('div');
  head.className = 'head';
  place(head, gridTop, 20);
  const rows = Array.from({ length: 5 }, (_, i) => {
    const row = document.createElement('div');
    row.dataset.index = String(i);
    place(row, gridTop + 20 + i * 20, 20);
    return row;
  });
  scroller.append(head, ...rows);
  pane.append(scroller);
  document.body.append(pane);
  return { pane, scroller, rows };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('sightOf', () => {
  it('gives the rows below the header and inside the box that clips the grid', () => {
    // Rows sit at 70..170 and the pane shows from 100, so rows 1 to 4 show, at least in part.
    const { scroller, rows } = page(50);

    expect(sightOf(scroller, rows)).toEqual({ first: 1, last: 4 });
  });

  it('leaves out a row under the totals row', () => {
    const { scroller, rows } = page(50);
    const foot = document.createElement('div');
    foot.className = 'foot';
    place(foot, 150, 20);
    scroller.append(foot);

    expect(sightOf(scroller, rows)).toEqual({ first: 1, last: 3 });
  });

  it.each([
    ['above', -200],
    ['below', 400],
  ])('says the grid is %s when it is out of sight', (where, gridTop) => {
    const { scroller, rows } = page(gridTop);

    expect(sightOf(scroller, rows)).toBe(where);
  });

  it('says a grid hidden in a section in sight is folded', () => {
    const { pane, scroller, rows } = page(150);
    const section = document.createElement('section');
    place(section, 150, 20);
    pane.append(section);
    section.append(scroller);
    place(scroller, 0, 0);

    expect(sightOf(scroller, rows)).toBe('folded');
  });
});
