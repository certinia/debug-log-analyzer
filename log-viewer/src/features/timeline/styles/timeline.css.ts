/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { soqlSyntaxStyles } from '../../soql/styles/soql-syntax.css.js';

export const tooltipStyles = `${soqlSyntaxStyles}
   #timeline-tooltip {
        position: absolute;
        z-index: 1000;
        /* Fixed, not shrink-to-fit: the panel keeps one size as the pointer sweeps the chart, the
           line budget means the same amount of text everywhere, and the height JS measures no
           longer depends on where the panel last sat. Scales with the viewport, so a large
           monitor shows more of a query. */
        width: clamp(300px, 36vw, 620px);
        max-height: min(420px, 50vh);
        /* Never a scroll container: the content is clamped, and the panel takes no pointer. */
        overflow: hidden;
        opacity: 0;
        visibility: hidden;
        /* Hit testing must behave as if the panel were not there, so the frames it overlaps
           stay hoverable and clickable. */
        pointer-events: none;
        transition: opacity 120ms ease;
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

      .timeline-tooltip {
        position: relative;
        box-shadow: var(--lana-shadow-overlay);
        backdrop-filter: blur(6px);
        /* Tokenised so the status row can bleed to the panel edge with a matching negative margin. */
        padding: var(--lana-space-xs);
        border-radius: var(--lana-radius-sm);
        border-left: 4px solid;
        background-color: var(--tl-hover-background);
        color: var(--tl-hover-foreground);
        font-family: monospace;
        font-size: 0.92rem;
      }

      .tooltip-header {
        font-weight: 500;
        margin-bottom: 10px;
        line-height: 1.3em;
        white-space: pre-wrap;
        word-break: break-all;
      }

      /* Plain-text descriptions clamp to a few lines; SOQL clamps by line in JS. */
      .tooltip-header:not(.soql-block) {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
        overflow: hidden;
      }

      /* soql-syntax.css sets display:inline, which drops the margin and breaks the mask. */
      .tooltip-header.soql-block {
        display: block;
      }

      .tooltip-header.is-clamped {
        mask-image: linear-gradient(to bottom, #000 calc(100% - 1.3em), transparent 100%);
      }

      /* Thin foot rail: what was cut, and where the full detail is. */
      .tooltip-status {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--lana-space-sm);
        margin: var(--lana-space-xs) calc(var(--lana-space-xs) * -1)
          calc(var(--lana-space-xs) * -1);
        padding: var(--lana-space-3xs) var(--lana-space-xs);
        border-top: var(--lana-stroke) solid var(--lana-hover-border);
        font-size: var(--lana-text-sm);
        color: var(--tl-description-foreground, #999);
      }

      .tooltip-status-info,
      .tooltip-status-action {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      .tooltip-status-action {
        flex: 0 0 auto;
        font-style: italic;
      }

      .tooltip-category {
        display: flex;
        align-items: center;
        gap: var(--lana-space-2xs);
        padding: var(--lana-space-3xs) 0;
        color: var(--tl-description-foreground, #999);
      }

      .tooltip-swatch {
        width: 8px;
        height: 8px;
        border-radius: var(--lana-radius-sm);
        flex: 0 0 auto;
      }

      .tooltip-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        padding: 2px 0;
      }

      .tooltip-label {
        flex: 1 1 auto;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        padding-right: 12px;
        color: var(--tl-description-foreground, #999);
        opacity: 0.9;
      }

      .tooltip-value {
        flex-shrink: 0;
        font-variant-numeric: tabular-nums;
        font-weight: 500;
        font-family: monospace;
        text-align: right;
        white-space: pre-wrap;
      }
`;
