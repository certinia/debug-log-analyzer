import { css } from 'lit';

export const globalStyles = css`
  a {
    color: var(--vscode-textLink-foreground);
    text-decoration: none;
    cursor: pointer;

    &:hover {
      color: var(--vscode-textLink-activeForeground);
      text-decoration: underline;
    }

    &:active {
      background: transparent;
      color: var(--vscode-textLink-activeForeground);
      text-decoration: underline;
    }
  }

  ::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  ::-webkit-scrollbar-corner {
    background-color: var(--vscode-editor-background);
  }

  ::-webkit-scrollbar-thumb {
    background-color: var(--vscode-scrollbarSlider-background);
  }

  .findMatch {
    animation-duration: 0;
    animation-name: inherit !important;
    color: var(--vscode-editor-findMatchForeground);
    background-color: var(--vscode-editor-findMatchHighlightBackground, 'yellow');
  }

  .currentFindMatch {
    color: var(--vscode-editor-findMatchHighlightForeground);
    background-color: var(--vscode-editor-findMatchBackground, '#8B8000');
    border: 2px solid var(--vscode-editor-findMatchBorder);
    padding: 1px;
    box-sizing: border-box;
  }
`;
