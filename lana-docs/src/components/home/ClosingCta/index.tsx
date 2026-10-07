import type { ReactElement } from 'react';
import InstallButtons from '../InstallButtons';
import shared from '../shared.module.css';
import styles from './styles.module.css';

export default function ClosingCta(): ReactElement {
  return (
    <section className={shared.section} aria-labelledby="closing-title">
      <div className="container">
        <h2 id="closing-title" className={shared.sectionTitle}>
          Open your first log
        </h2>
        <ol className={styles.steps}>
          <li>Install Apex Log Analyzer from the VS Code Marketplace.</li>
          <li>
            Open a <code>.log</code> file, or run{' '}
            <strong>Log: Retrieve Apex Log And Show Analysis</strong> to get one from your org.
          </li>
          <li>
            Click <strong>Log: Show Apex Log Analysis</strong> at the top of the file.
          </li>
        </ol>
        <InstallButtons />
      </div>
    </section>
  );
}
