import Link from '@docusaurus/Link';
import type { CSSProperties, ReactElement } from 'react';
import { ASSETS_URL } from '@site/src/constants';
import ThemedImage from '@theme/ThemedImage';
import clsx from 'clsx';
import CheckList from '../CheckList';
import shared from '../shared.module.css';
import styles from './styles.module.css';

interface Feature {
  name: string;
  title: string;
  summary: string;
  points: string[];
  doc: string;
  // Base name in the assets folder; the light theme adds `-light`.
  image: string;
  alt: string;
  // CSS object-position: which part of the screenshot the panel crops to.
  focus?: string;
}

const FEATURES: Feature[] = [
  {
    name: 'Timeline',
    title: 'See where the time went',
    summary: 'A flame chart of the whole transaction.',
    points: [
      'Large logs ready `3.1×` faster since v1.24',
      'Zoom and pan `7×` faster since v1.20',
      'Search up to `10×` faster since v1.20',
      'A minimap and a governor limits strip',
    ],
    doc: '/docs/features/timeline',
    image: 'timeline',
    alt: 'Timeline tab: a flame chart of a 24.6 second transaction with its minimap, governor limits strip and the Inspector overview',
  },
  {
    name: 'Call Tree',
    title: 'Follow the execution',
    summary: 'Every call, with what it cost.',
    points: [
      'Expand, filter and scroll `3×` faster since v1.16',
      'Go to Code `6× to 10×` faster in large projects since v1.22',
      'Three views: `Time Order`, `Aggregated` and `Bottom-Up`',
    ],
    doc: '/docs/features/calltree',
    image: 'calltree',
    alt: 'Call Tree tab: nested methods with total time, self time, SOQL, DML and heap columns',
  },
  {
    name: 'Database',
    title: 'Find the slow queries',
    summary: 'Every statement that touched the database.',
    points: [
      'Every `SOQL`, `SOSL` and `DML` statement, with time and rows',
      '`Selectivity` and the `query plan` for each SOQL query',
      'Usage against each governor limit, as `used / limit`',
    ],
    doc: '/docs/features/database',
    image: 'database',
    alt: 'Database tab: SOQL and DML statements with timings, row counts, selectivity and governor usage',
  },
  {
    name: 'Inspector',
    title: 'Inspect anything',
    summary: 'Select a frame, a row or a statement to see it in depth.',
    points: [
      'The `Local` and `Static` variables at any frame, with Apex Code at `FINEST`',
      'Every value a variable held across the calls of a merged row',
      'With nothing selected, the limits nearest their ceiling and the log findings',
    ],
    doc: '/docs/features/inspector',
    image: 'inspector',
    alt: 'Inspector reading the whole log: the governor metrics nearest a limit, the log findings, and how few signatures hold its self time',
    focus: 'top',
  },
  {
    name: 'Governor limits and heap',
    title: 'Stay inside the limits',
    summary: 'How close the transaction came to its limits and heap, and where.',
    points: [
      'Heap for every method and call path, as `Net`, `Gross` and `Peak`',
      'Tells allocate-then-free churn apart from a real leak',
      'Every governor limit plotted over time',
      'The call path that used each limit stands out in the Call Tree',
    ],
    doc: '/docs/features/governor-limits-heap',
    image: 'timeline-gov-strip',
    alt: 'Governor limits strip under the Timeline, with a tooltip listing CPU time at 94.4% of its limit, DML rows, SOQL queries and heap size',
    focus: '88% 50%',
  },
  {
    name: 'Analysis',
    title: 'Find the hot Apex',
    summary: 'The methods that cost the most, ranked.',
    points: [
      'Every method in the log ranked by `self time`',
      'Group by `caller namespace` to see whose package costs the time',
    ],
    doc: '/docs/features/analysis',
    image: 'analysis',
    alt: 'Analysis tab: methods ranked by self time and grouped by type',
  },
];

export default function Features(): ReactElement {
  return (
    <section className={shared.section} aria-labelledby="features-title">
      <div className="container">
        <h2 id="features-title" className={shared.sectionTitle}>
          Visualize, analyze and optimize
        </h2>
        <ul className={styles.grid}>
          {FEATURES.map((f) => (
            <li key={f.name} className={clsx(shared.card, styles.panel)}>
              <div className={shared.cardBody}>
                <p className={styles.name}>{f.name}</p>
                <h3 className={shared.cardTitle}>{f.title}</h3>
                <p className={shared.cardSummary}>{f.summary}</p>
                <CheckList items={f.points} />
                <Link className={styles.more} to={f.doc}>
                  {f.name} docs
                </Link>
              </div>
              <div className={styles.shot}>
                <ThemedImage
                  sources={{
                    dark: `${ASSETS_URL}/${f.image}.png`,
                    light: `${ASSETS_URL}/${f.image}-light.png`,
                  }}
                  alt={f.alt}
                  loading="lazy"
                  style={{ '--focus': f.focus ?? 'center' } as CSSProperties}
                />
              </div>
            </li>
          ))}
        </ul>
        <p className={styles.platforms}>
          Works with any Salesforce <code>.log</code> file. Runs in VS Code 1.102 or later, and in
          vscode.dev, github.dev and the Salesforce Web Console.
        </p>
      </div>
    </section>
  );
}
