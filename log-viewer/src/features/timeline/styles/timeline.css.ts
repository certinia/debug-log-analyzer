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
        background-color: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        font-family: monospace;
        font-size: 0.92rem;
        pointer-events: none;
        transition: opacity 0.15s ease;
      }

      .tooltip-header {
        font-weight: 500;
        margin-bottom: 10px;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1em;
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
      }

      .tooltip-value {
        flex-shrink: 0;
        font-variant-numeric: tabular-nums;
        font-weight: 500;
        font-family: monospace;
        opacity: 0.9;
        text-align: right;
        white-space: nowrap;
        color: var(--vscode-descriptionForeground, #999)
      }
`;
