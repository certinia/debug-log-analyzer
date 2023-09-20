import { css } from 'lit';

export const globalStyles = css`
  a {
    color: var(--vscode-textLink-foreground);
    text-decoration: none;
    cursor: pointer;

    :hover {
      color: var(--vscode-textLink-activeForeground);
      text-decoration: underline;
    }

    :active {
      background: transparent;
      color: var(--vscode-textLink-activeForeground);
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
`;
