import useBaseUrl from '@docusaurus/useBaseUrl';
import { useColorMode } from '@docusaurus/theme-common';
import { ASSETS_URL, MARKETPLACE_URL } from '@site/src/constants';
import ThemedImage from '@theme/ThemedImage';
import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import styles from './styles.module.css';

// A missing demo can still answer 200: the dev server falls back to the site's HTML page.
async function isDemoBuilt(settingsUrl: string): Promise<boolean> {
  try {
    const response = await fetch(settingsUrl, { method: 'HEAD' });
    return response.ok && (response.headers.get('content-type') ?? '').includes('json');
  } catch {
    return false;
  }
}

export default function LiveDemo(): ReactElement {
  const { colorMode } = useColorMode();
  const demoUrl = useBaseUrl('/demo/viewer.html');
  const settingsUrl = useBaseUrl('/demo/settings.json');
  const [missing, setMissing] = useState(false);
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

  const launch = async () => {
    const theme = colorMode;
    const built = await isDemoBuilt(settingsUrl);
    setMissing(!built);
    if (built) {
      setLaunchTheme(theme);
    }
  };
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
        {!launchTheme && !missing && (
          <button type="button" className="button button--primary" onClick={() => void launch()}>
            Open demo
          </button>
        )}
        {missing ? (
          <span role="status" className={styles.label}>
            {process.env.NODE_ENV === 'development' ? (
              <>
                <strong>Demo not built.</strong> Run <code>pnpm build</code>, then{' '}
                <code>pnpm --filter docs-site build:demo</code>, and reload.
              </>
            ) : (
              <>
                <strong>The live demo is not available right now.</strong>{' '}
                <a href={MARKETPLACE_URL}>Install the extension</a> to try it on your own logs.
              </>
            )}
          </span>
        ) : (
          <span className={styles.label}>
            <strong>Live demo</strong> of a 20 MB sample log, in your browser
          </span>
        )}
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
        <div className={styles.poster} onClick={() => void launch()}>
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
