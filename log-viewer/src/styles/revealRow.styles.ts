/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { css } from 'lit';

/**
 * The shell of a clickable inspector row: the row's text keeps the panel-wide
 * content edge and only the hover background bleeds past it, via the negative
 * side margins the padding wins back. Kills the UA button chrome too, so the
 * row reads as the section's own text. Shared by the reveal rows, the hot-path
 * caveat and the findings list, so every clickable line presents one face.
 */
export const bleedRowStyles = css`
  .bleed-row {
    box-sizing: border-box;
    width: calc(100% + 2 * var(--lana-space-2xs));
    margin: 0 calc(-1 * var(--lana-space-2xs));
    border: 0;
    border-radius: var(--lana-radius-sm);
    padding: var(--lana-space-3xs) var(--lana-space-2xs);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .bleed-row:hover {
    background-color: var(--lana-row-hover-bg);
  }

  .bleed-row:focus-visible {
    outline: var(--lana-stroke) solid var(--lana-focus-border);
    outline-offset: calc(-1 * var(--lana-stroke));
  }
`;

/**
 * A clickable line in an inspector section that reveals one event in the tab on
 * screen: the code's name on the left, its figures held to the right edge, an
 * optional full-width sub line and magnitude meter beneath them. Layout only —
 * the markup pairs it with the bleed-row shell.
 *
 * The row's category hue arrives as `--row-hue` and the self-time share of its
 * own bar as `--self-pct`, both set inline on the row, so these rules stay
 * static. The palette is data (the flame chart's), which is why the hue is not a
 * `--lana-*` token; a row that sets neither reads as one plain full-length bar.
 */
export const revealRowStyles = [
  bleedRowStyles,
  css`
    .reveal-row {
      --row-hue: var(--lana-meter-fill);
      --self-pct: 100%;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: baseline;
      column-gap: var(--lana-space-sm);
      row-gap: var(--lana-space-3xs);
    }

    /* The meter's hue is decorative, so the category it stands for is spoken
       here instead: hidden from view, part of the button's accessible name. */
    .reveal-row__sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    .reveal-row__name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--lana-font-mono);
    }

    /* A column of its own, wide enough for the longest reading and never wrapped,
       so the figures line up down the section and the name is what truncates. */
    .reveal-row__value {
      justify-self: end;
      min-width: 7ch;
      white-space: nowrap;
      text-align: right;
      color: var(--lana-fg-muted);
      font-family: var(--lana-font-mono);
      font-variant-numeric: tabular-nums;
    }

    /* The row's headline figure, held at full strength. */
    .reveal-row__value--primary {
      color: var(--lana-fg);
    }

    .reveal-row__sub {
      grid-column: 1 / -1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--lana-fg-muted);
      font-family: var(--lana-font-mono);
      font-variant-numeric: tabular-nums;
    }

    /* Holds the track and the hover targets over it, so a target can be taller
       than the track without the track clipping it. */
    .reveal-row__meter-wrap {
      display: block;
      grid-column: 1 / -1;
      position: relative;
    }

    /* Transparent targets across the wrapper, each part sized as its share of
       the log, so hovering the bar names the part under the pointer. */
    .reveal-row__meter-hits {
      display: flex;
      position: absolute;
      inset-inline: 0;
      /* Grown past the track to a target a pointer can hit, no further than the
         row's own padding, so it never covers the row below. */
      inset-block: calc(-1 * var(--lana-space-3xs));
    }

    .reveal-row__meter-hit {
      flex: 0 0 auto;
    }

    /* Magnitude strip: length carries the share of the log, one denominator per
       section. The hue is identity only, over a track mixed from it so the track
       reads as this row's own in either theme. */
    .reveal-row__meter {
      display: block;
      /* Spans the row on its own: a section may place the track straight in the
         grid, without the hover targets the wrapper carries. */
      grid-column: 1 / -1;
      overflow: hidden;
      height: var(--lana-space-2xs);
      border-radius: var(--lana-radius-sm);
      background: color-mix(in srgb, var(--row-hue) 15%, transparent);
    }

    /* Solid up to the self share is time this code spent itself; faded past it is time in its children. */
    .reveal-row__meter-fill {
      display: block;
      height: 100%;
      background: linear-gradient(
        90deg,
        var(--row-hue) 0 var(--self-pct),
        color-mix(in srgb, var(--row-hue) 35%, transparent) var(--self-pct) 100%
      );
    }

    /* The frame the walk lands on — the hot spot the path exists to name. */
    .reveal-row--focus .reveal-row__name {
      font-weight: 600;
    }

    .reveal-row--focus .reveal-row__value {
      color: var(--lana-fg);
    }
  `,
];
