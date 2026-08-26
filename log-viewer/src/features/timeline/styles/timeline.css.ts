/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { soqlSyntaxStyles } from '../../soql/styles/soql-syntax.css.js';

export const tooltipStyles = `${soqlSyntaxStyles}
   #timeline-tooltip {
        position: absolute;
        /* The origin the JS transform moves the panel from. */
        top: 0;
        left: 0;
        z-index: 1000;
        /* Fixed, not shrink-to-fit: the panel keeps one size as the pointer sweeps the chart, the
           line budget means the same amount of text everywhere, and the height JS measures no
           longer depends on where the panel last sat. The percentage is of the chart area, so a
           wide chart shows more of a query and a narrow one never overflows. */
        width: clamp(300px, 30%, 520px);
        max-width: 100%;
        max-height: min(420px, 50vh);
        /* Never a scroll container: the content is clamped, and the panel takes no pointer. */
        overflow: hidden;
        opacity: 0;
        visibility: hidden;
        /* Hit testing must behave as if the panel were not there, so the frames it overlaps
           stay hoverable and clickable. */
        pointer-events: none;
        transition: opacity 80ms ease;
        /* The panel is moved by a transform on every pointer move. Without the blur that
           used to promote it, only this keeps that off the paint path. */
        will-change: transform;
      }

      #timeline-tooltip[data-visible='true'] {
        opacity: 1;
        visibility: visible;
      }

      @media (prefers-reduced-motion: reduce) {
        #timeline-tooltip {
          transition: none;
        }
      }

      /* Flat and opaque, lifted by one shadow: a blurred surface that moves with the
         pointer costs a composite every frame and reads as window chrome, not tooling. */
      .timeline-tooltip {
        /* The clamp fade must cover exactly one line, so both read the same value. */
        --tooltip-line: 1.3em;
        position: relative;
        box-shadow: var(--lana-shadow-overlay);
        /* Tokenised so the status row can bleed to the panel edge with a matching negative margin. */
        padding: var(--lana-space-xs);
        border-radius: var(--lana-radius-sm);
        border-left: var(--lana-space-2xs) solid;
        background-color: var(--tl-hover-background);
        color: var(--tl-hover-foreground);
        /* One size throughout, and prose in the UI font: only the figures and the
           frame's own text are alignment-bearing enough to earn mono. */
        font-family: var(--lana-font-ui);
        font-size: var(--lana-text-sm);
      }

      /* A marker's summary — a frame's name is its description block instead. Two lines at
         most, and broken at a boundary where one exists: break-all chopped identifiers
         mid-word. */
      .tooltip-title {
        font-weight: 500;
        overflow-wrap: anywhere;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        overflow: hidden;
      }

      /* The frame's own text, and a marker's summary: mono, because it is code. */
      .tooltip-title,
      .tooltip-description {
        font-family: var(--lana-font-mono);
        line-height: var(--tooltip-line);
      }

      .tooltip-description {
        margin-top: var(--lana-space-3xs);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      /* Plain-text descriptions clamp to a few lines; SOQL clamps by line in JS. */
      .tooltip-description:not(.soql-block) {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
        line-clamp: 3;
        overflow: hidden;
      }

      /* soql-syntax.css sets display:inline, which drops the margin and breaks the mask. */
      .tooltip-description.soql-block {
        display: block;
      }

      .tooltip-description.is-clamped {
        mask-image: linear-gradient(
          to bottom,
          #000 calc(100% - var(--tooltip-line)),
          transparent 100%
        );
      }

      /* The secondary lines: one line each, ellipsised, and muted against the readings. */
      .tooltip-identity,
      .tooltip-status,
      .tooltip-label {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        color: var(--tl-description-foreground, #999);
      }

      /* What the frame is, whose code it is, and where it came from — one line, since
         no one of these is worth a row of its own. */
      .tooltip-identity {
        margin-top: var(--lana-space-3xs);
      }

      /* The row groups are all readings, so space parts them and no rule asserts a
         distinction that is not there. */
      .tooltip-group {
        margin-top: var(--lana-space-2xs);
      }

      /* One rule on the card, where the kind of thing changes: what the frame is, above;
         what it measured, below. The renderer marks the group, since sibling divs give
         CSS no way to select the first. */
      .tooltip-group--ruled {
        margin-top: var(--lana-space-xs);
        padding-top: var(--lana-space-xs);
        border-top: var(--lana-stroke) solid var(--lana-hover-border);
      }

      /* Says what the card left out, and appears only when it left something out. */
      .tooltip-status {
        margin: var(--lana-space-xs) calc(var(--lana-space-xs) * -1)
          calc(var(--lana-space-xs) * -1);
        padding: var(--lana-space-3xs) var(--lana-space-xs);
        border-top: var(--lana-stroke) solid var(--lana-hover-border);
      }

      /* The figure columns hold a floor, so they line up from card to card and sweeping
         the chart does not make them dance — and grow past it rather than collide, since
         any width picked for them can be exceeded by a long reading. The label takes
         what is left and truncates, being the one part that can. */
      .tooltip-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(12ch, auto) minmax(12ch, auto);
        align-items: baseline;
        column-gap: var(--lana-space-sm);
        padding: var(--lana-space-3xs) 0;
      }

      /* A reading that is not a figure has nothing to line up with, so it keeps only
         the label's column and takes whatever width it needs. */
      .tooltip-row--wide {
        grid-template-columns: minmax(0, 1fr) auto;
      }

      /* Figures in mono and tabular, so a column of them lines up on the digit. */
      .tooltip-value,
      .tooltip-self {
        font-family: var(--lana-font-mono);
        font-variant-numeric: tabular-nums;
        text-align: right;
        white-space: nowrap;
      }

      .tooltip-value {
        font-weight: 500;
      }

      .tooltip-self {
        color: var(--tl-description-foreground, #999);
      }

      /* The card still leads somewhere: the reading the hover was for, at full strength
         against the muted ones around it — weight, never a second type size. */
      .tooltip-row--lead .tooltip-value {
        font-weight: 600;
      }
`;
