import { css } from 'lit';

/** Opacity only, and deliberately: it is the one property Blink runs on the
 *  compositor, so the pulse keeps moving through the synchronous parse it covers.
 *  A background-position or transform shimmer would freeze for the whole parse. */
export const skeletonStyles = css`
  .skeleton {
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    background-color: var(--lana-skeleton-bg);
    border-radius: var(--lana-radius-sm);
    min-width: 1ch;
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

  @media (prefers-reduced-motion: reduce) {
    .skeleton {
      animation: none;
    }
  }
`;
