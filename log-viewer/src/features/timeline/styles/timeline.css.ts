/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

export const tooltipStyles = `
   #timeline-tooltip {
        display: none;
        position: absolute;
        max-width: 75%;
        min-width: 150px;
      }

      .timeline-tooltip {
        position: relative;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(6px);
        z-index: 1000;
        padding: 5px;
        border-radius: 4px;
        border-left: 4px solid;
        background-color: var(--tl-hover-background);
        color: var(--tl-hover-foreground);
        font-family: monospace;
        font-size: 0.92rem;
        pointer-events: auto;
        transition: opacity 0.15s ease;
      }

      .tooltip-header {
        font-weight: 500;
        margin-bottom: 10px;
        line-height: 1.3em;
        white-space: pre-wrap;
        word-break: break-all;
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
