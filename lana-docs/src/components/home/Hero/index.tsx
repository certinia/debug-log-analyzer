import Link from '@docusaurus/Link';
import GitHubStars from '@site/src/components/GitHubStars';
import type { ReactElement } from 'react';
import InstallButtons from '../InstallButtons';
import LiveDemo from '../LiveDemo';
import styles from './styles.module.css';

const RELEASES = [
  {
    version: 'v1.22',
    summary: 'Inspector, Variables and heap analysis',
    anchor: '1220---2026-09-18',
  },
  {
    version: 'v1.20',
    summary: 'New Timeline with a minimap, zoom and pan 7× faster',
    anchor: '1200---2026-06-18',
  },
  {
    version: 'v1.18',
    summary: 'Copy and CSV export from the Analysis and Database tables',
    anchor: '1180---2025-07-09',
  },
];

export default function Hero(): ReactElement {
  return (
    <header className={styles.hero}>
      <div className="container">
        <div className={styles.intro}>
          <div>
            <h1 className={styles.title}>See where your Apex spent its time.</h1>
            <p className={styles.lede}>
              Open a Salesforce debug log in VS Code to get a flame chart of the transaction, its
              call tree, and every SOQL query, DML statement and governor limit it used.
            </p>
            <InstallButtons>
              <GitHubStars />
            </InstallButtons>
            <p className={styles.note}>Free and open source under the BSD-3-Clause license.</p>
          </div>
          <aside className={styles.releases} aria-labelledby="recent-releases">
            <h2 id="recent-releases" className={styles.releasesTitle}>
              Recent releases
            </h2>
            <ul className={styles.releaseList}>
              {RELEASES.map(({ version, summary, anchor }) => (
                <li key={version}>
                  <Link to={`/community/changelog#${anchor}`} className={styles.release}>
                    <span className={styles.version}>{version}</span>
                    <span>{summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link to="/community/changelog">All release notes</Link>
          </aside>
        </div>
        <LiveDemo />
      </div>
    </header>
  );
}
