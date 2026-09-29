/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { css } from 'lit';

/**
 * The positioning half of a top-layer popover, sibling to `.filter-popover` in
 * `global.styles.ts`, which carries the look. Its own module rather than a rule
 * in `globalStyles`, which nearly every component adopts and almost none of
 * them anchor anything.
 */
export const anchoredPopoverStyles = css`
  .popover-anchored {
    position: fixed;
    position-try-fallbacks:
      flip-block,
      flip-inline,
      flip-block flip-inline;
    inset: auto;
  }

  /* For a trigger that can scroll away, which would otherwise strand the popover
     at stale coordinates in the top layer. A header control never can. */
  .popover-anchored--hides-with-anchor {
    position-visibility: anchors-visible;
  }
`;
