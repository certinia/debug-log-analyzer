import useBaseUrl from '@docusaurus/useBaseUrl';
import { useColorMode } from '@docusaurus/theme-common';
import { ASSETS_URL } from '@site/src/constants';
import ThemedImage from '@theme/ThemedImage';
import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import styles from './styles.module.css';

export default function LiveDemo(): ReactElement {
  const { colorMode } = useColorMode();
  const demoUrl = useBaseUrl('/demo/viewer');
  const figure = useRef<HTMLElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  // The theme at launch goes in the URL; later toggles are posted, so the frame never reloads.
  const [launchTheme, setLaunchTheme] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const syncTheme = useCallback(() => {
    frame.current?.contentWindow?.postMessage(
      { type: 'lana-demo-theme', theme: colorMode },
      window.location.origin,
    );
  }, [colorMode]);

  useEffect(syncTheme, [syncTheme]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === figure.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const launch = () => setLaunchTheme(colorMode);
  const toggleFullscreen = () =>
    fullscreen ? void document.exitFullscreen() : void figure.current?.requestFullscreen();
  const close = () => {
    if (fullscreen) {
      void document.exitFullscreen();
    }
    setLaunchTheme(null);
  };

  return (
    <figure ref={figure} className={clsx(styles.demo, launchTheme && styles.live)}>
      <div className={styles.bar}>
        {!launchTheme && (
          <button type="button" className="button button--primary" onClick={launch}>
            Open demo
          </button>
        )}
        <span className={styles.label}>
          <strong>Live demo</strong> of a 20 MB sample log, in your browser
        </span>
        {launchTheme && (
          <span className={styles.controls}>
            <button
              type="button"
              className="button button--secondary button--sm"
              onClick={toggleFullscreen}
            >
              {fullscreen ? 'Exit full screen' : 'Full screen'}
            </button>
            <button type="button" className="button button--secondary button--sm" onClick={close}>
              Close demo
            </button>
          </span>
        )}
      </div>
      {launchTheme ? (
        <iframe
          ref={frame}
          title="Apex Log Analyzer live demo"
          src={`${demoUrl}?theme=${launchTheme}`}
          onLoad={syncTheme}
        />
      ) : (
        // A mouse shortcut only; the Open demo button is the keyboard and screen reader path.
        <div className={styles.poster} onClick={launch}>
          <ThemedImage
            sources={{
              dark: `${ASSETS_URL}/timeline.png`,
              light: `${ASSETS_URL}/timeline-light.png`,
            }}
            alt="Apex Log Analyzer showing a 24.6 second transaction: the Timeline flame chart with its minimap and governor limits strip, beside the Inspector overview"
            width={1920}
            height={1023}
            fetchPriority="high"
          />
        </div>
      )}
    </figure>
  );
}
