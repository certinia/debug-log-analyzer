import Link from '@docusaurus/Link';
import clsx from 'clsx';
import type { CSSProperties, ReactElement } from 'react';
import shared from '../shared.module.css';
import styles from './styles.module.css';

interface Measured {
  task: string;
  version: string;
  before: number;
  after: number;
  unit: string;
  gain: 'faster' | 'less';
}

// Older releases only published a speed-up factor, not the raw timings.
interface Reported {
  task: string;
  version: string;
  factor: number;
  upTo?: boolean;
}

type Gain = Measured | Reported;

const GAINS: Gain[] = [
  {
    task: 'Timeline and minimap ready, 100 MB log',
    version: '1.24',
    before: 1964,
    after: 637,
    unit: 'ms',
    gain: 'faster',
  },
  {
    task: 'Memory after opening, 100 MB log',
    version: '1.24',
    before: 503,
    after: 268,
    unit: 'MB',
    gain: 'less',
  },
  { task: 'Zoom and pan the Timeline', version: '1.20', factor: 7 },
  { task: 'Search a large log', version: '1.20', factor: 10, upTo: true },
];

function afterShare(g: Gain): number {
  return 'factor' in g ? 1 / g.factor : g.after / g.before;
}

function change(g: Gain): string {
  if ('factor' in g) {
    return `${g.upTo ? 'Up to ' : ''}${g.factor}× faster`;
  }
  return g.gain === 'faster'
    ? `${(g.before / g.after).toFixed(1)}× faster`
    : `${Math.round((1 - g.after / g.before) * 100)}% less`;
}

export default function Performance(): ReactElement {
  return (
    <section className={styles.performance} aria-labelledby="performance-title">
      <div className="container">
        <div className={clsx(shared.card, shared.cardBody)}>
          <h2 id="performance-title" className={clsx(shared.sectionTitle, styles.title)}>
            Built for 100 MB logs
          </h2>
          <p className={styles.lede}>
            Each row compares a release with the one before it. A shorter bar costs less.{' '}
            <Link to="/community/changelog">See the release notes</Link>
          </p>
          <div className={styles.legend} aria-hidden="true">
            <span className={styles.legendItem}>
              <span className={clsx(styles.swatch, styles.before)} />
              Before
            </span>
            <span className={styles.legendItem}>
              <span className={clsx(styles.swatch, styles.after)} />
              After
            </span>
          </div>
          <ul className={styles.chart}>
            {GAINS.map((g) => (
              <li key={g.task} className={styles.row}>
                <span className={styles.task}>{g.task}</span>
                <span className={styles.bars} aria-hidden="true">
                  <span className={clsx(styles.bar, styles.before)} />
                  <span
                    className={clsx(styles.bar, styles.after)}
                    style={{ '--share': afterShare(g) } as CSSProperties}
                  />
                </span>
                <span className={styles.result}>
                  {change(g)}
                  {'before' in g && (
                    <span className={styles.measured}>
                      {g.before.toLocaleString('en-US')} {g.unit} to{' '}
                      {g.after.toLocaleString('en-US')} {g.unit}
                    </span>
                  )}
                </span>
                <span className={styles.version}>v{g.version}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
