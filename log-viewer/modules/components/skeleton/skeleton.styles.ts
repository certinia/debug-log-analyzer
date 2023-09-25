import { css } from 'lit';

export const skeletonStyles = css`
  .skeleton {
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    background-color: rgb(229 231 235);
    border-radius: 0.25rem;
    min-width: 5ch;
    width: 100%;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
`;
